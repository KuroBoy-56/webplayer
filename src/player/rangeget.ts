// Pedido de un tramo del archivo (Range) para los lectores propios (mp4mse.ts, mkvmse.ts), pensado para servidores
// IPTV como XUI: un plazo para que el servidor conteste (12 s) y otro para bajar según el tamaño, en lugar de 30 s
// fijos; si una vez no contesta, los siguientes pedidos cierran la conexión al terminar (Connection: close: algunos
// servidores no atienden un pedido nuevo mientras la conexión anterior sigue abierta); y si el servidor manda más de
// lo pedido (ignora el final del Range) se deja enseguida: leerlo entero tardaría minutos (el lector pasa al modo
// directo). why dice el motivo para el reporte.
import { UA } from '../lib/http';
import { takeRange } from './prefetch';
import { bridgeFailed, viaBridge } from './bridge';

// lastData: cuándo llegó el último tramo (Player espera más mientras el servidor sigue entregando)
// reqs / waitMs: pedidos hechos y lo que tardó el servidor en contestar cada uno (para el aviso de apertura lenta)
// errs: pedidos que se cortaron por la red (la descarga adelantada mira si pasa con varios pedidos a la vez)
export type RangeState = { close: boolean; unbounded: boolean; size: number; why: string; lastData?: number; reqs?: number; waitMs?: number; errs?: number; from?: number; bridge?: number };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// Pedidos a la vez de los lectores de películas y series (índice, video, final del archivo: todos juntos), como mucho
// las conexiones de la línea (max_connections de la cuenta; sin saberlo, 4). De más, el servidor IPTV los rechaza y todo
// pasa a ir de a uno (2.0.15: con el final del archivo y el índice por partes podían llegar a ser 6). En un servidor que
// rechazó pedidos a la vez hace poco (la línea admite uno, u otros equipos la ocupan): uno solo, en orden
let lineMax = 0;
export function setLineMax(n: number): void {
  lineMax = n > 0 ? Math.floor(n) : 0;
  wake();
}
export function lineLimit(): number {
  return lineMax;
}
// servidores que no admitieron varios pedidos a la vez hace poco (4 minutos; antes toda la sesión: un momento con la
// línea llena dejaba todas las películas siguientes de a un pedido)
const singleHosts = new Map<string, number>();
const SINGLE_MS = 4 * 60000;
export const hostOf = (u: string) => (/^https?:\/\/([^/]+)/i.exec(u) || ['', ''])[1].toLowerCase();
export function markSingle(url: string): void {
  singleHosts.set(hostOf(url), Date.now());
}
export function isSingle(url: string): boolean {
  return lineMax === 1 || Date.now() - (singleHosts.get(hostOf(url)) || 0) < SINGLE_MS;
}
const capFor = (url: string) => (isSingle(url) ? 1 : lineMax || 4);
let busy = 0;
const queue: (() => void)[] = [];
function wake(): void {
  const w = queue.splice(0);
  for (const r of w) r();
}
async function slot(url: string, alive: () => boolean): Promise<boolean> {
  while (busy >= capFor(url)) {
    await new Promise<void>(r => queue.push(r));
    if (!alive()) {
      // el lugar que se liberó pasa al siguiente
      wake();
      return false;
    }
  }
  busy++;
  return true;
}
function free(): void {
  busy = Math.max(0, busy - 1);
  wake();
}

// Dirección final de cada archivo (la del balanceador de XUI, con su token): los pedidos siguientes del mismo archivo van
// directo ahí, sin pasar otra vez por la redirección (un viaje menos por pedido al abrir y al saltar). Si falla, se
// olvida y se vuelve a la original.
const finalUrl = new Map<string, string>();

export async function rangeGet(url: string, off: number, len: number, st: RangeState, requests: Set<AbortController>, alive: () => boolean): Promise<Uint8Array | null> {
  // el primer pedido ya lanzado por Player mientras se iniciaba el reproductor (prefetch.ts)
  const pre = takeRange(url, off, len);
  if (pre) {
    const got = await pre;
    if (got) {
      if (got.size > 0) st.size = got.size;
      return got.data;
    }
  }
  for (let tries = 0; tries < 3 && alive() && !st.unbounded; tries++) {
    if (!(await slot(url, alive))) return null;
    const ctrl = new AbortController();
    requests.add(ctrl);
    let phase = 'contestar';
    // por el puente: la máquina puede tardar lo que tarda el servidor IPTV en darle la primera parte (y reintentar)
    const bridge = viaBridge(url);
    let limit = bridge ? 28000 : 12000;
    let timer = setTimeout(() => ctrl.abort(), limit);
    const t0 = Date.now();
    try {
      // off < 0: los últimos len bytes del archivo (donde va el índice de casi todos los MP4 de los servidores IPTV)
      const headers: Record<string, string> = { 'User-Agent': UA, Range: off < 0 ? 'bytes=-' + len : 'bytes=' + off + '-' + (off + len - 1) };
      if (st.close) headers.Connection = 'close';
      const target = bridge || finalUrl.get(url) || url;
      const r = await fetch(target, { headers, signal: ctrl.signal });
      st.reqs = (st.reqs || 0) + 1;
      st.waitMs = (st.waitMs || 0) + (Date.now() - t0);
      if (bridge) st.bridge = (st.bridge || 0) + 1;
      if (bridge && r.status !== 206) {
        // el puente no entregó (apagado: 409; la máquina no consiguió el video: 504): directo desde ahora
        bridgeFailed(url);
        st.why = 'puente ' + r.status;
        ctrl.abort();
        continue;
      }
      if (r.status !== 206 && target !== url) {
        // el token del balanceador venció o no admite otro pedido: otra vez por la dirección original
        finalUrl.delete(url);
        ctrl.abort();
        continue;
      }
      if (r.status === 206 && r.url && r.url !== target) {
        if (finalUrl.size > 30) finalUrl.clear();
        finalUrl.set(url, r.url);
      }
      if (r.status !== 206) {
        st.why = r.status === 200 ? 'el servidor no entrega por partes (200)' : 'pedido ' + r.status;
        if (r.status === 200) st.unbounded = true;
        ctrl.abort();
        return null;
      }
      const cr = r.headers.get('content-range') || '';
      const tot = Number(cr.split('/')[1]);
      if (tot > 0) st.size = tot;
      // el final del archivo: tiene que decir desde dónde (si no, no se sabe qué parte llegó)
      if (off < 0) {
        const from = Number((/bytes\s+(\d+)-/i.exec(cr) || [])[1]);
        if (!(tot > 0) || !(from >= 0)) {
          st.why = 'final del archivo sin Content-Range';
          ctrl.abort();
          return null;
        }
        st.from = from;
      }
      const cl = Number(r.headers.get('content-length') || 0);
      if (cl > len + 65536) {
        // ignora el final del pedido: mandaría todo el resto del archivo
        st.why = 'el servidor manda más de lo pedido (' + Math.round(cl / 1048576) + ' MB por ' + Math.round(len / 1024) + ' KB)';
        st.unbounded = true;
        ctrl.abort();
        return null;
      }
      // bajar: 15 s más lo que tarda a 40 KB/s (XUI entrega las películas a la velocidad del video, sobre todo el final
      // del archivo, donde está el índice de muchos MP4: con 150 KB/s se cortaba un pedido que sí estaba llegando)
      clearTimeout(timer);
      phase = 'bajar';
      limit = 15000 + Math.round((len / (40 * 1024)) * 1000);
      timer = setTimeout(() => ctrl.abort(), limit);
      const out = new Uint8Array(await r.arrayBuffer());
      st.lastData = Date.now();
      return out;
    } catch (e: any) {
      if (!alive()) return null;
      st.errs = (st.errs || 0) + 1;
      finalUrl.delete(url);
      // el puente no contestó a tiempo (máquina caída o sin red hacia ella): directo desde ahora
      if (bridge) bridgeFailed(url);
      st.why = ctrl.signal.aborted
        ? 'sin ' + phase + ' en ' + Math.round((Date.now() - t0) / 1000) + ' s (' + Math.round(len / 1024) + ' KB en ' + Math.round(off / 1048576) + ' MB)'
        : 'red: ' + String(e?.message || e).slice(0, 60);
      // la próxima vez la conexión se cierra al terminar cada pedido
      st.close = true;
      await sleep(500);
    } finally {
      clearTimeout(timer);
      requests.delete(ctrl);
      free();
    }
  }
  return null;
}
