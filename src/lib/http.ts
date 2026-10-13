// Peticiones HTTP con tiempo límite.
import { viaDns } from './securedns';

export type HttpResult = { code: number; body: string; ok: boolean };

export const UA = 'LatMpxVega/1.0 (Fire TV; Vega OS)';

type HttpOpts = { method?: string; body?: string; type?: string; timeout?: number; signal?: AbortSignal };

// sin conexión con el DNS de la red y con un DNS elegido (botón DNS): se prueba la IP que da ese DNS
export async function http(url: string, opts: HttpOpts = {}): Promise<HttpResult> {
  const r = await send(url, opts);
  if (r.code !== 0 || opts.signal?.aborted) return r;
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
