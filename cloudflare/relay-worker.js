/*
 * Relay HTTPS para el web player (Cloudflare Workers, plan gratuito).
 *
 * Entrega por https el video http del servidor IPTV, para que la web pueda estar en https
 * sin que el navegador bloquee el video. El video va servidor IPTV → Cloudflare → navegador:
 * nunca pasa por tu hosting.
 *
 * Formato:  https://TU-RELAY.workers.dev/http/host:puerto/movie/usuario/clave/123.mp4
 *
 * Variables del Worker (Settings → Variables), opcionales:
 *   ALLOWED_HOSTS  hosts permitidos separados por coma (p. ej. "latammx.net,1.2.3.4").
 *                  Vacío = cualquier host, pero solo rutas de IPTV (/movie, /series, /live, /hls...).
 *   ALLOWED_ORIGINS  dominios de tu web separados por coma (p. ej. "https://miweb.com"). Vacío = todos.
 */
const IPTV_PATH = /^\/(movie|series|live|hls|timeshift|streaming|play|auth|[a-z0-9_-]+\.(m3u8|ts|mp4|mkv|m4s|aac|vtt))\b/i;

function cors(h, origin) {
  h.set('Access-Control-Allow-Origin', origin || '*');
  h.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Range, Content-Type');
  h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type');
  h.set('Vary', 'Origin');
  return h;
}

function list(v) { return String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean); }

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const origins = list(env.ALLOWED_ORIGINS);
    if (origins.length && origin && !origins.includes(origin.toLowerCase())) return new Response('origin', { status: 403 });
    const allowOrigin = origins.length ? origin : '*';

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(new Headers({ 'Access-Control-Max-Age': '86400' }), allowOrigin) });
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method', { status: 405 });

    // /http/host:puerto/ruta?query
    const m = url.pathname.match(/^\/(https?)\/([^/]+)(\/.*)$/i);
    if (!m) return new Response('relay ok', { status: 200, headers: cors(new Headers(), allowOrigin) });
    const scheme = m[1].toLowerCase(), hostPort = m[2], path = m[3];
    const host = hostPort.split(':')[0].toLowerCase();
    const hosts = list(env.ALLOWED_HOSTS);
    if (hosts.length ? !hosts.includes(host) : !IPTV_PATH.test(path)) return new Response('host', { status: 403 });

    const target = scheme + '://' + hostPort + path + url.search;
    const h = new Headers();
    for (const k of ['range', 'user-agent', 'accept', 'if-range']) { const v = req.headers.get(k); if (v) h.set(k, v); }
    if (!h.has('user-agent')) h.set('user-agent', 'Mozilla/5.0');

    let up;
    try {
      up = await fetch(target, { method: req.method, headers: h, redirect: 'manual', cf: { cacheEverything: false } });
    } catch (e) {
      return new Response('upstream', { status: 502, headers: cors(new Headers(), allowOrigin) });
    }
    const base = url.origin;
    const wrap = (abs) => {
      try { const u = new URL(abs, target); return base + '/' + u.protocol.replace(':', '') + '/' + u.host + u.pathname + u.search; } catch (e) { return abs; }
    };
    // películas y series: el balanceador del servidor IPTV suele mandar a otro host (a veces una IP).
    // Se sigue aquí mismo, así ALLOWED_HOSTS no lo bloquea y el navegador sigue usando la misma dirección.
    if (up.status >= 300 && up.status < 400 && up.headers.get('location') && !/\.m3u8$/i.test(path)) {
      try {
        up = await fetch(new URL(up.headers.get('location'), target).toString(), { method: req.method, headers: h, redirect: 'follow', cf: { cacheEverything: false } });
      } catch (e) {
        return new Response('upstream', { status: 502, headers: cors(new Headers(), allowOrigin) });
      }
    }
    const out = new Headers();
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control', 'last-modified', 'etag']) { const v = up.headers.get(k); if (v) out.set(k, v); }
    cors(out, allowOrigin);

    // redirecciones de listas HLS: se siguen también por el relay
    if (up.status >= 300 && up.status < 400 && up.headers.get('location')) {
      out.set('Location', wrap(up.headers.get('location')));
      return new Response(null, { status: up.status, headers: out });
    }

    // listas HLS: los enlaces absolutos http se reescriben para que también pasen por el relay
    const ct = (up.headers.get('content-type') || '').toLowerCase();
    if (req.method === 'GET' && up.ok && (ct.includes('mpegurl') || /\.m3u8$/i.test(path))) {
      const text = await up.text();
      const body = text.split('\n').map((line) => {
        const t = line.trim();
        if (/^https?:\/\//i.test(t)) return wrap(t);
        return line.replace(/URI="(https?:\/\/[^"]+)"/gi, (all, u) => 'URI="' + wrap(u) + '"');
      }).join('\n');
      out.delete('content-length');
      out.set('content-type', 'application/vnd.apple.mpegurl');
      out.set('cache-control', 'no-store');
      return new Response(body, { status: up.status, headers: out });
    }
    return new Response(up.body, { status: up.status, headers: out });
  }
};
