// Índice compartido por el panel (api/vidx.php, 2.0.16).
//
// Abrir una película o capítulo por primera vez obliga a leer su índice (moov, 3-10 MB al final del archivo) del
// servidor IPTV: con servidores que tardan ~5 s en contestar cada pedido y líneas de una sola conexión eran 15-35 s
// (avisos «tardó en empezar»: indice=8.4MB en 14.3s unaConexion=true). El primer equipo que lo lee lo deja en el panel
// (comprimido); los demás lo reciben del panel —otro servidor, no ocupa la conexión de la línea— mientras al servidor
// IPTV solo se le pide el video. Lo recibido es un atajo como lo guardado en el equipo (indexstore.ts): si el archivo
// tiene otro tamaño en el servidor se descarta (sharedStale) y el equipo que lo nota deja el índice correcto.
import type { HttpResult } from '../lib/http';
import { b64Encode } from '../lib/crypto';

// (el cliente del panel se carga al usarlo: el lector de MP4 se prueba sin la app entera)
function cloud(file: string, method: 'GET' | 'POST', payload: Record<string, any>): Promise<HttpResult> {
  return require('../api/panel').cloud(file, method, payload);
}
const b64u = (s: string) => b64Encode(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export type Shared = { kind: string; size: number; text: string };

// lo que dijo el panel de cada archivo: 'none' = no lo tiene (este equipo lo sube al leerlo), 'has' = lo tiene,
// 'up' = ya se subió (o se está subiendo) desde aquí
const said = new Map<string, 'none' | 'has' | 'up'>();
const asking = new Map<string, Promise<Shared | null>>();
const HEAD_MS = 2500; // ¿lo tiene? (respuesta chica)
const BODY_MS = 25000; // el índice (hasta ~6 MB comprimido)
const PART = 1536000; // partes de la subida (el panel acepta hasta 2 MB; hostings con post_max_size de 8 MB)
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

// El índice de este archivo si el panel lo tiene (kind 'm' = MP4, 'k' = MKV); null si no lo tiene, no contesta o tarda
export function sharedIndex(url: string, kind: string): Promise<Shared | null> {
  if (!vod(url)) return Promise.resolve(null);
  const k = keyOf(url);
  let p = asking.get(k);
  if (!p) {
    p = (async () => {
      const h = await within(cloud('vidx.php', 'GET', { u: b64u(url), head: 1 }), HEAD_MS);
      const j = h?.ok ? parsed(h.body) : null;
      if (!j) return null;
      if (j.ok !== true) {
        if (j.ok === false && !said.has(k)) said.set(k, 'none');
        return null;
      }
      said.set(k, 'has');
      const r = await within(cloud('vidx.php', 'GET', { u: b64u(url) }), BODY_MS);
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

// El índice completo leído del servidor IPTV, al panel: solo si el panel dijo que no lo tenía (sin respuesta del panel
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
    for (let i = 0; i < n; i++) {
      const r = await cloud('vidx.php', 'POST', { u: b64u(url), kind, size, len: text.length, i, n, part: text.slice(i * PART, (i + 1) * PART) });
      const j = r.ok ? parsed(r.body) : null;
      // el panel no lo aceptó, o ya lo tiene (otro equipo lo subió mientras tanto)
      if (!j || j.ok !== true || j.have || j.saved) return;
      await sleep(400);
    }
  })().catch(() => {});
}
