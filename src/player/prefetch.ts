// Primer pedido del video adelantado: Player lo lanza mientras el reproductor de Vega se inicia (initialize tarda), así
// cuando el lector propio empieza ya tiene la lista del canal o la cabecera del MP4 / MKV. Es el mismo pedido que el
// lector iba a hacer (no suma conexiones a la línea); si no se usa en 10 s se descarta.
// Canales: apenas llega la lista se pide también el segmento donde empieza el lector (liveStartSeg), a la vez que el
// reproductor se inicia; antes ese segmento (varios MB) se pedía recién con el reproductor listo.
import { UA } from '../lib/http';
import { liveStartSeg, parseList } from '../lib/hlslist';

export type ListGot = { code: number; url: string; text?: string; type?: string };
// lo mismo que LiveHls.get en modo 'seg': bytes, o el texto si llegó una página (motivo de XUI) o una lista
export type SegGot = { code: number; url: string; text?: string; data?: Uint8Array; type?: string };
export type RangeGot = { data: Uint8Array; size: number } | null;

const TTL = 10000;
let list: { url: string; p: Promise<ListGot>; at: number } | null = null;
let range: { url: string; off: number; len: number; p: Promise<RangeGot>; at: number } | null = null;
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

// [off, off + len) del archivo (cabecera del MKV, principio del MP4)
export function prefetchRange(url: string, off: number, len: number): void {
  const p = (async (): Promise<RangeGot> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=' + off + '-' + (off + len - 1) }, signal: ctrl.signal });
      if (r.status !== 206) {
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
  range = { url, off, len, p, at: Date.now() };
}

export function takeRange(url: string, off: number, len: number): Promise<RangeGot> | null {
  if (!range || range.url !== url || range.off !== off || range.len !== len || Date.now() - range.at > TTL) return null;
  const p = range.p;
  range = null;
  return p;
}
