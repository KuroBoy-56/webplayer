// Peticiones HTTP con tiempo límite.
import { viaDns } from './securedns';

export type HttpResult = { code: number; body: string; ok: boolean };

export const UA = 'LatMpxVidaa/1.0 (Hisense Smart TV; VIDAA)';

type HttpOpts = { method?: string; body?: string; type?: string; timeout?: number; signal?: AbortSignal };

// VIDAA: la app es una página alojada en el panel (carpeta vidaa/, junto a api/) y el navegador del televisor aplica
// CORS. El panel se pide en la misma dirección que la página (mismo esquema y puerto: sin CORS). player_api.php del
// servidor IPTV (casi ninguno manda CORS) primero directo y, si el navegador no lo deja, por api/xtream_relay.php del
// panel: solo esos datos, el video nunca (lo abre el <video> del televisor directo). El servidor que necesitó el
// relevo va directo a él el resto de la sesión.
const relayHosts = new Set<string>();

function pageOrigin(): string {
  try {
    const l = (globalThis as any).location;
    return l && /^https?:$/.test(l.protocol) ? l.protocol + '//' + l.host : '';
  } catch {
    return '';
  }
}

// la dirección del panel con el esquema y el puerto de la página (si es el mismo nombre de servidor)
export function samePage(url: string): string {
  const o = pageOrigin();
  const m = o ? url.match(/^https?:\/\/([^/?#]+)(.*)$/i) : null;
  if (!m) return url;
  const host = m[1].replace(/:\d+$/, '').toLowerCase();
  return host === String((globalThis as any).location.hostname).toLowerCase() ? o + m[2] : url;
}

// servidor de un pedido a player_api.php ('' = no lo es)
export function xtreamHost(url: string): string {
  const m = url.match(/^https?:\/\/([^/?#]+)\/(?:[^?#]*\/)?player_api\.php(?:[?#]|$)/i);
  return m ? m[1].toLowerCase() : '';
}

function relayUrl(url: string): string {
  return new URL('../api/xtream_relay.php', (globalThis as any).location.href).href + '?u=' + encodeURIComponent(url);
}

// el relevo no está (app fuera del panel) o no aceptó ese servidor: cuenta como sin conexión
const relayFailed = (r: HttpResult) => r.code === 0 || r.code === 404 || r.body.indexOf('"relay_error"') >= 0;

// sin conexión con el DNS de la red y con un DNS elegido (botón DNS): se prueba la IP que da ese DNS
export async function http(url: string, opts: HttpOpts = {}): Promise<HttpResult> {
  url = samePage(url);
  const xh = pageOrigin() ? xtreamHost(url) : '';
  if (xh && relayHosts.has(xh)) {
    const v = await send(relayUrl(url), opts);
    if (!relayFailed(v) || opts.signal?.aborted) return v;
  }
  const r = await send(url, opts);
  if (r.code !== 0 || opts.signal?.aborted) return r;
  if (xh && !relayHosts.has(xh)) {
    const v = await send(relayUrl(url), opts);
    if (!relayFailed(v)) {
      relayHosts.add(xh);
      return v;
    }
  }
  const alt = await viaDns(url);
  return alt ? send(alt, opts) : r;
}

async function send(url: string, opts: HttpOpts): Promise<HttpResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener('abort', onAbort);
  try {
    const headers: Record<string, string> = { Accept: 'application/json, text/plain, */*', 'User-Agent': UA };
    if (opts.type) headers['Content-Type'] = opts.type;
    const r = await fetch(url, { method: opts.method || 'GET', body: opts.body, headers, signal: ctrl.signal });
    const body = await r.text();
    return { code: r.status, body, ok: r.status >= 200 && r.status < 300 };
  } catch {
    return { code: 0, body: '', ok: false };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

export function json<T = any>(r: HttpResult): T | null {
  if (!r.body) return null;
  try {
    return JSON.parse(r.body) as T;
  } catch {
    return null;
  }
}

export function formBody(fields: Record<string, string>): string {
  return Object.keys(fields)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(fields[k]))
    .join('&');
}
