// Primer pedido del video adelantado: Player lo lanza mientras el reproductor de Vega se inicia (initialize tarda), así
// cuando el lector propio empieza ya tiene la lista del canal o la cabecera del MP4 / MKV. Es el mismo pedido que el
// lector iba a hacer (no suma conexiones a la línea); si no se usa en 10 s se descarta.
// Canales: apenas llega la lista se pide también el segmento donde empieza el lector (liveStartSeg), a la vez que el
// reproductor se inicia; antes ese segmento (varios MB) se pedía recién con el reproductor listo.
import { UA } from '../lib/http';
import { liveStartSeg, parseList } from '../lib/hlslist';
import { viaBridge } from './bridge';

export type ListGot = { code: number; url: string; text?: string; type?: string };
// lo mismo que LiveHls.get en modo 'seg': bytes, o el texto si llegó una página (motivo de XUI) o una lista
export type SegGot = { code: number; url: string; text?: string; data?: Uint8Array; type?: string };
export type RangeGot = { data: Uint8Array; size: number } | null;

const TTL = 10000;
let list: { url: string; p: Promise<ListGot>; at: number } | null = null;
// el segmento tarda más que la lista en llegar: se guarda más tiempo
const SEG_TTL = 30000;
let seg: { url: string; p: Promise<SegGot>; at: number; ctrl: AbortController; owner: string } | null = null;
// el último canal pedido por adelantado: solo él pide su primer segmento al llegar la lista (si el reproductor ya se
// cerró o se pidió otro canal, no queda un segmento bajando que nadie va a usar)
let job: { url: string } | null = null;

const resolve = (base: string, loc: string) => {
  if (/^https?:\/\//i.test(loc)) return loc;
  const m = /^(https?:\/\/[^/]+)/i.exec(base);
  return loc.startsWith('/') && m ? m[1] + loc : base.replace(/[^/]*$/, '') + loc;
};

// lista HLS del canal (sigue las redirecciones del balanceador como livehls.ts)
export function prefetchList(url: string): void {
  const j = { url };
  job = j;
  const p = (async (): Promise<ListGot> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let at = url;
    try {
      for (let hop = 0; hop < 6; hop++) {
        const res = await fetch(at, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'manual' } as any);
        const loc = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && loc) {
          at = resolve(at, loc);
          continue;
        }
        const final = (res as any).url || at;
        const type = res.headers.get('content-type') || '';
        if (res.status !== 200) return { code: res.status, url: final, type };
        const text = await res.text();
        if (job === j) startSeg(url, text, final);
        return { code: 200, url: final, text, type };
      }
      return { code: 310, url: at };
    } catch {
      return { code: 0, url: at };
    } finally {
      clearTimeout(timer);
    }
  })();
  list = { url, p, at: Date.now() };
}

// el segmento donde va a empezar el lector (solo una lista de segmentos: con calidades, fMP4 o SAMPLE-AES el lector
// sigue otro camino y lo pide él)
function startSeg(owner: string, text: string, base: string): void {
  if (!text.trim().startsWith('#EXTM3U')) return;
  const l = parseList(text, base);
  if (l.master || l.fmp4 || l.sampleAes || !l.segs.length) return;
  const s = liveStartSeg(l.segs);
  abortSeg();
  const ctrl = new AbortController();
  const timeout = Math.max(10000, l.target * 2500);
  const p = (async (): Promise<SegGot> => {
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let at = s.url;
    try {
      for (let hop = 0; hop < 6; hop++) {
        const res = await fetch(at, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'manual' } as any);
        const loc = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && loc) {
          at = resolve(at, loc);
          continue;
        }
        const final = (res as any).url || at;
        const type = res.headers.get('content-type') || '';
        if (res.status !== 200) return { code: res.status, url: final, type };
        if (/mpegurl|text\/html/i.test(type)) return { code: 200, url: final, text: await res.text(), type };
        return { code: 200, url: final, data: new Uint8Array(await res.arrayBuffer()), type };
      }
      return { code: 310, url: at };
    } catch {
      return { code: 0, url: at };
    } finally {
      clearTimeout(timer);
    }
  })();
  seg = { url: s.url, p, at: Date.now(), ctrl, owner };
}

// el segmento ya pedido (el lector se queda con su pedido para poder cortarlo al cerrar)
export function takeSeg(url: string): { p: Promise<SegGot>; ctrl: AbortController } | null {
  if (!seg || seg.url !== url) return null;
  // vencido: se corta (el lector lo pide de nuevo; no quedan dos bajadas del mismo segmento)
  if (Date.now() - seg.at > SEG_TTL) {
    abortSeg();
    return null;
  }
  const got = { p: seg.p, ctrl: seg.ctrl };
  seg = null;
  return got;
}

// cierre del reproductor o de la miniatura antes de usar lo pedido: se corta (no queda bajando en la línea).
// owner: solo si es el de ese canal (la miniatura que se cierra no corta el de la pantalla grande)
export function dropPrefetch(owner: string): void {
  if (job && job.url === owner) job = null;
  if (seg && seg.owner === owner) abortSeg();
  // el principio de una película o capítulo que ya nadie va a leer
  if (win && win.url === owner) {
    win.stop.abort();
    win = null;
  }
}

function abortSeg(): void {
  if (!seg) return;
  seg.ctrl.abort();
  seg = null;
}

export function takeList(url: string): Promise<ListGot> | null {
  if (!list || list.url !== url || Date.now() - list.at > TTL) return null;
  const p = list.p;
  list = null;
  return p;
}

// [off, off + len) del archivo
function fetchRange(url: string, off: number, len: number, stop: AbortSignal): Promise<RangeGot> {
  return (async (): Promise<RangeGot> => {
    if (stop.aborted) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    stop.addEventListener('abort', () => ctrl.abort(), { once: true } as any);
    try {
      const r = await fetch(viaBridge(url) || url, { headers: { 'User-Agent': UA, Range: 'bytes=' + off + '-' + (off + len - 1) }, signal: ctrl.signal });
      // sin partes (200) o mandaría el resto del archivo: lo pide el lector, que lo detecta y sigue por otro camino
      if (r.status !== 206 || Number(r.headers.get('content-length') || 0) > len + 65536) {
        ctrl.abort();
        return null;
      }
      const size = Number((r.headers.get('content-range') || '').split('/')[1]) || 0;
      return { data: new Uint8Array(await r.arrayBuffer()), size };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
}

// El principio del archivo, mientras el reproductor se inicia: la cabecera (len: los idiomas y el índice del MP4 al
// principio) y, apenas llega, el principio del video (more), de a un pedido (líneas de una sola conexión). Cualquier
// lectura del lector que caiga dentro sale de aquí sin volver a pedirla (cabecera, primer tramo del video, principio del
// mdat). Se guarda 20 s.
const RANGE_TTL = 20000;
type Part = { off: number; len: number; p: Promise<RangeGot> };
let win: { url: string; at: number; parts: Part[]; stop: AbortController } | null = null;

export function prefetchRange(url: string, off: number, len: number, more = 0): void {
  win?.stop.abort();
  const stop = new AbortController();
  const first = fetchRange(url, off, len, stop.signal);
  const w = { url, at: Date.now(), parts: [{ off, len, p: first }] as Part[], stop };
  if (more > 0) w.parts.push({ off: off + len, len: more, p: first.then(got => (got && win === w ? fetchRange(url, off + len, more, stop.signal) : null)) });
  win = w;
}

function parts(url: string): Part[] | null {
  return win && win.url === url && Date.now() - win.at < RANGE_TTL ? win.parts : null;
}

// trozo [from, to) de lo que llegó en cada parte (null si una parte no llegó entera)
async function slice(list: Part[], from: number, to: number): Promise<Uint8Array | null> {
  const got = await Promise.all(list.map(x => x.p));
  const out: Uint8Array[] = [];
  for (let i = 0; i < list.length; i++) {
    const g = got[i];
    const a = Math.max(from, list[i].off) - list[i].off;
    const b = Math.min(to, list[i].off + list[i].len) - list[i].off;
    if (!g || g.data.length < b) return out.length ? concat(out) : null;
    out.push(g.data.subarray(a, b));
  }
  return out.length === 1 ? out[0] : concat(out);
}

function concat(list: Uint8Array[]): Uint8Array {
  if (list.length === 1) return list[0];
  const out = new Uint8Array(list.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of list) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

// [off, off + len) entero, si cae dentro de lo pedido (el resto de los pedidos, rangeGet)
export function takeRange(url: string, off: number, len: number): Promise<RangeGot> | null {
  const list = parts(url);
  const end = off + len;
  const need = list ? list.filter(x => x.off < end && x.off + x.len > off) : [];
  if (!need.length || need[0].off > off || need[need.length - 1].off + need[need.length - 1].len < end) return null;
  return Promise.all([slice(need, off, end), need[0].p]).then(([d, g]) => (d && d.length === len ? { data: d, size: g?.size || 0 } : null));
}

// largo del pedido adelantado que empieza en off (0 si no hay): el lector de MP4 con el índice del panel lo usa como
// principio del video, o lo corta
export function prefetchedAt(url: string, off: number): number {
  const p = parts(url)?.[0];
  return p && p.off === off ? p.len : 0;
}

// lo que haya desde off (hasta len bytes) aunque no llegue al final: el lector de MKV junta el resto con otro pedido
export function takeRangeFrom(url: string, off: number, len: number): Promise<RangeGot> | null {
  const list = parts(url);
  const at = list ? list.findIndex(x => x.off <= off && off < x.off + x.len) : -1;
  if (at < 0) return null;
  const need = list!.slice(at);
  return Promise.all([slice(need, off, off + len), need[0].p]).then(([d, g]) => (d && d.length ? { data: d, size: g?.size || 0 } : null));
}
