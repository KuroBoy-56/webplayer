// Índice compartido entre los equipos (el mismo que leen y dejan Vega OS, Roku, Android y la web player).
//
// Abrir una película o capítulo MP4 con el índice (moov) al final obliga a leerlo del servidor IPTV (3-10 MB al final
// del archivo): con servidores que tardan ~5 s en contestar cada pedido y líneas de una sola conexión son 15-35 s. El
// primer equipo que lo lee lo deja en la VPS del dueño o en la VDS propia de su distribuidor; los demás lo reciben de
// esa máquina mientras al servidor IPTV solo se le pide el video. El panel (api/vidx.php) solo revisa la línea y
// entrega dos enlaces firmados («¿lo tiene?» y bajar / subir): nada pasa por su hosting. Sin VPS / VDS (o un
// distribuidor sin VDS propia) el panel dice que no y todo sigue como antes. En el televisor lo usan el lector de la
// app (mp4mse.ts: cambio de audio y subtítulos) y la lectura de los idiomas (probe.ts); el reproductor del televisor
// lee el archivo él mismo. Si el archivo tiene otro tamaño en el servidor se descarta (sharedStale) y el equipo que lo
// nota deja el índice correcto.
import type { HttpResult } from '../lib/http';
import { http } from '../lib/http';
import { b64Encode } from '../lib/crypto';

// (el cliente del panel se carga al usarlo: el lector de MP4 se prueba sin la app entera)
function cloud(file: string, method: 'GET' | 'POST', payload: Record<string, any>): Promise<HttpResult> {
  return require('../api/panel').cloud(file, method, payload);
}
const b64u = (s: string) => b64Encode(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type Shared = { kind: string; size: number; text: string };

// lo que dijo la VPS / VDS de cada archivo: 'none' = no lo tiene (este equipo lo sube al leerlo), 'has' = lo tiene,
// 'up' = ya se subió (o se está subiendo) desde aquí
const said = new Map<string, 'none' | 'has' | 'up'>();
// enlaces firmados de la máquina para cada archivo (el panel los firma por 6 h; se piden otra vez pasada 1 h)
const links = new Map<string, { head: string; url: string; at: number }>();
async function linksFor(url: string): Promise<{ head: string; url: string } | null> {
  const k = keyOf(url);
  const l = links.get(k);
  if (l && Date.now() - l.at < 3600000) return l;
  const r = await within(cloud('vidx.php', 'GET', { u: b64u(url) }), HEAD_MS);
  const j = r?.ok ? parsed(r.body) : null;
  if (!j || j.ok !== true || typeof j.head !== 'string' || typeof j.url !== 'string') return null;
  const got = { head: j.head, url: j.url, at: Date.now() };
  links.set(k, got);
  if (links.size > 50) links.delete(links.keys().next().value as string);
  return got;
}
const asking = new Map<string, Promise<Shared | null>>();
const HEAD_MS = 2500; // ¿lo tiene? (respuesta chica)
const BODY_MS = 25000; // el índice (hasta ~6 MB comprimido)
const PART = 1536000; // partes de la subida (la máquina acepta hasta 2 MB por parte)
const MAX_TEXT = 16 * 1048576;

const keyOf = (url: string) => url.replace(/^https?:\/\//i, '');
// solo películas y episodios de la línea (lo único que el panel acepta)
const vod = (url: string) => /\/(movie|series)\/[^/]+\/[^/]+\/\d+\.[A-Za-z0-9]{2,5}(\?|$)/i.test(url);
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function parsed(body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>(r => setTimeout(() => r(null), ms))]);
}

// «VIDX1 <kind> <size> <len>\n<texto>»
export function parseShared(body: string): Shared | null {
  const nl = body.indexOf('\n');
  if (nl < 0 || nl > 80) return null;
  const m = /^VIDX1 ([mk]) (\d+) (\d+)$/.exec(body.slice(0, nl));
  if (!m) return null;
  const text = body.slice(nl + 1);
  if (text.length !== Number(m[3]) || !(Number(m[2]) > 0)) return null;
  return { kind: m[1], size: Number(m[2]), text };
}

// el panel ya dijo que tiene el índice de este archivo (Player no pide la cabecera por adelantado)
export function sharedKnown(url: string): boolean {
  return said.get(keyOf(url)) === 'has';
}

// El índice de este archivo si la VPS / VDS lo tiene (kind 'm' = MP4, 'k' = MKV); null si no lo tiene, no contesta o tarda
export function sharedIndex(url: string, kind: string): Promise<Shared | null> {
  if (!vod(url)) return Promise.resolve(null);
  const k = keyOf(url);
  let p = asking.get(k);
  if (!p) {
    p = (async () => {
      // sin VPS / VDS (o el distribuidor no tiene la suya) el panel dice que no: nada que pedir ni que subir
      const ln = await linksFor(url);
      if (!ln) return null;
      const h = await within(http(ln.head, { timeout: HEAD_MS }), HEAD_MS);
      const j = h?.ok ? parsed(h.body) : null;
      if (!j) return null;
      if (j.ok !== true) {
        if (j.ok === false && !said.has(k)) said.set(k, 'none');
        return null;
      }
      said.set(k, 'has');
      const r = await within(http(ln.url, { timeout: BODY_MS }), BODY_MS);
      return r?.ok ? parseShared(r.body) : null;
    })();
    asking.set(k, p);
    // (el texto pesa varios MB: no queda guardado aquí; el lector lo deja en su memoria)
    p.finally(() => setTimeout(() => asking.get(k) === p && asking.delete(k), 1000));
  }
  return p.then(s => (s && s.kind === kind ? s : null));
}

// lo del panel no era de este archivo (otro tamaño en el servidor): no se vuelve a usar y el índice que lea este equipo
// lo reemplaza
export function sharedStale(url: string): void {
  const k = keyOf(url);
  asking.delete(k);
  said.set(k, 'none');
}

// El índice completo leído del servidor IPTV, a la VPS / VDS: solo si dijo que no lo tenía (sin respuesta
// no se sube nada), una vez por archivo, de a partes y sin apuro (después de que el video ya empezó)
export function shareIndex(url: string, kind: string, size: number, make: () => Promise<string> | string): void {
  const k = keyOf(url);
  if (!vod(url) || size <= 0 || said.get(k) !== 'none') return;
  said.set(k, 'up');
  (async () => {
    const text = await make();
    if (!text || text.length > MAX_TEXT) return;
    const n = Math.ceil(text.length / PART);
    if (n > 12) return;
    const ln = links.get(k);
    if (!ln) return;
    for (let i = 0; i < n; i++) {
      const body = JSON.stringify({ kind, size, len: text.length, i, n, part: text.slice(i * PART, (i + 1) * PART) });
      const r = await http(ln.url, { method: 'POST', body, type: 'application/json', timeout: 60000 });
      const j = r.ok ? parsed(r.body) : null;
      // el panel no lo aceptó, o ya lo tiene (otro equipo lo subió mientras tanto)
      if (!j || j.ok !== true || j.have || j.saved) return;
      await sleep(400);
    }
  })().catch(() => {});
}

// base64 del navegador del televisor (el índice pesa varios MB: las funciones de crypto.ts son para textos cortos)
export function fromB64(s: string): Uint8Array {
  const bin: string = (globalThis as any).atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toB64(d: Uint8Array): string {
  let s = '';
  for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000) as unknown as number[]);
  return (globalThis as any).btoa(s);
}
