// Primer pedido del video adelantado: Player lo lanza mientras el reproductor de Vega se inicia (initialize tarda), así
// cuando el lector propio empieza ya tiene la lista del canal o la cabecera del MP4 / MKV. Es el mismo pedido que el
// lector iba a hacer (no suma conexiones a la línea); si no se usa en 10 s se descarta.
import { UA } from '../lib/http';

// navegador (la app de LG): ahí no hay document en Vega
const WEB = typeof (globalThis as any).document !== 'undefined';

export type ListGot = { code: number; url: string; text?: string; type?: string };
export type RangeGot = { data: Uint8Array; size: number } | null;

const TTL = 10000;
let list: { url: string; p: Promise<ListGot>; at: number } | null = null;
let range: { url: string; off: number; len: number; p: Promise<RangeGot>; at: number } | null = null;

const resolve = (base: string, loc: string) => {
  if (/^https?:\/\//i.test(loc)) return loc;
  const m = /^(https?:\/\/[^/]+)/i.exec(base);
  return loc.startsWith('/') && m ? m[1] + loc : base.replace(/[^/]*$/, '') + loc;
};

// lista HLS del canal (sigue las redirecciones del balanceador como livehls.ts)
export function prefetchList(url: string): void {
  const p = (async (): Promise<ListGot> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    let at = url;
    try {
      for (let hop = 0; hop < 6; hop++) {
        // en un navegador (LG) la redirección «manual» llega vacía: ahí la sigue el navegador (como livehls.ts)
        const res = await fetch(at, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: WEB ? 'follow' : 'manual' } as any);
        const loc = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && loc) {
          at = resolve(at, loc);
          continue;
        }
        const final = (res as any).url || at;
        const type = res.headers.get('content-type') || '';
        if (res.status !== 200) return { code: res.status, url: final, type };
        return { code: 200, url: final, text: await res.text(), type };
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
