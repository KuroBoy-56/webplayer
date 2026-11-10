// Pedido de un tramo del archivo (Range) para los lectores propios (mp4mse.ts, mkvmse.ts), pensado para servidores
// IPTV como XUI: un plazo para que el servidor conteste (12 s) y otro para bajar según el tamaño, en lugar de 30 s
// fijos; si una vez no contesta, los siguientes pedidos cierran la conexión al terminar (Connection: close: algunos
// servidores no atienden un pedido nuevo mientras la conexión anterior sigue abierta); y si el servidor manda más de
// lo pedido (ignora el final del Range) se deja enseguida: leerlo entero tardaría minutos (el lector pasa al modo
// directo). why dice el motivo para el reporte.
import { UA } from '../lib/http';
import { takeRange } from './prefetch';

// lastData: cuándo llegó el último tramo (Player espera más mientras el servidor sigue entregando)
// reqs / waitMs: pedidos hechos y lo que tardó el servidor en contestar cada uno (para el aviso de apertura lenta)
// errs: pedidos que se cortaron por la red (la descarga adelantada mira si pasa con varios pedidos a la vez)
export type RangeState = { close: boolean; unbounded: boolean; size: number; why: string; lastData?: number; reqs?: number; waitMs?: number; errs?: number };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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
    const ctrl = new AbortController();
    requests.add(ctrl);
    let phase = 'contestar';
    let limit = 12000;
    let timer = setTimeout(() => ctrl.abort(), limit);
    const t0 = Date.now();
    try {
      const headers: Record<string, string> = { 'User-Agent': UA, Range: 'bytes=' + off + '-' + (off + len - 1) };
      if (st.close) headers.Connection = 'close';
      const target = finalUrl.get(url) || url;
      const r = await fetch(target, { headers, signal: ctrl.signal });
      st.reqs = (st.reqs || 0) + 1;
      st.waitMs = (st.waitMs || 0) + (Date.now() - t0);
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
      const tot = Number((r.headers.get('content-range') || '').split('/')[1]);
      if (tot > 0) st.size = tot;
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
      st.why = ctrl.signal.aborted
        ? 'sin ' + phase + ' en ' + Math.round((Date.now() - t0) / 1000) + ' s (' + Math.round(len / 1024) + ' KB en ' + Math.round(off / 1048576) + ' MB)'
        : 'red: ' + String(e?.message || e).slice(0, 60);
      // la próxima vez la conexión se cierra al terminar cada pedido
      st.close = true;
      await sleep(500);
    } finally {
      clearTimeout(timer);
      requests.delete(ctrl);
    }
  }
  return null;
}
