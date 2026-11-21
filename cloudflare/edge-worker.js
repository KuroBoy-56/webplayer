// MPX Player · Worker de Cloudflare para un dominio propio de la web player.
//
// El cliente entra por TU dominio nuevo (en Cloudflare, nube naranja). Este Worker abre por dentro la web
// player original (Hostinger) y le manda el secreto; la web original rechaza (403) todo lo que llegue sin él.
// El video NUNCA pasa por aquí: va de la VPS / VDS al navegador (su registro DNS sigue con nube gris).
//
// Puente para servidores IPTV sin SSL (web player 2.9.0): con la web en https el navegador no deja pedir nada a un
// servidor http (y uno con certificado vencido o casero tampoco). La web le da al navegador direcciones
// /xtr/<firma>/http/<servidor>/player_api.php: este Worker las pide al servidor IPTV y devuelve la respuesta. Solo
// player_api.php (inicio de sesión, catálogo, cuenta) y, desde la 2.9.1, las imágenes de las carátulas y fondos
// (.jpg .png .webp .gif .bmp, guardadas una semana en Cloudflare); solo GET, solo servidores que la web firmó con este
// mismo secreto y por pocos días: nunca video ni otra cosa. El servidor IPTV ve la IP de Cloudflare, no la del hosting.
//
// En Cloudflare › Workers › este Worker › Settings › Variables and Secrets:
//   ORIGIN   (Text)    la dirección de la web player ORIGINAL, por ejemplo https://webplayer.mpx.work
//   EDGE_KEY (Secret)  el secreto (el mismo que pones en includes/panel_secret.php › 'edge_keys')
// TU dominio nuevo NO va en este código: se agrega en Settings › Domains & Routes › Custom Domain.
// Ver GUIA-WORKER.html.

const enc = new TextEncoder();

// firma de la web (includes/xt_relay.php): HMAC-SHA256 con EDGE_KEY, base64url, 22 caracteres
async function sign(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const s = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
  let b = '';
  for (const c of s) b += String.fromCharCode(c);
  return btoa(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 22);
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// /xtr/<firma>.<vence>/<http|https>/<servidor[:puerto]>/player_api.php?…   (o /ruta/de/la/imagen.jpg)
async function relay(request, seen, key) {
  const m = seen.pathname.match(/^\/xtr\/([A-Za-z0-9_-]{22})\.(\d{9,11})\/(https?)\/([A-Za-z0-9.-]{1,253}:\d{1,5})(\/player_api\.php|\/[^?#]{1,400}\.(?:jpe?g|png|webp|gif|bmp))$/i);
  if (!m || (request.method !== 'GET' && request.method !== 'HEAD')) return new Response('Not found', { status: 404 });
  const [, sig, exp, scheme, hostport, path] = m;
  if (+exp < Date.now() / 1000 || !same(sig, await sign(key, 'xtr|' + scheme.toLowerCase() + '|' + hostport.toLowerCase() + '|' + exp))) {
    return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (path.toLowerCase() !== '/player_api.php') return image(scheme.toLowerCase() + '://' + hostport + path);
  if (request.method !== 'GET') return new Response('Not found', { status: 404 });
  let up;
  try {
    up = await fetch(scheme + '://' + hostport + '/player_api.php' + seen.search, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
        'Accept': 'application/json, text/plain, */*',
        'X-Forwarded-For': request.headers.get('CF-Connecting-IP') || '',
      },
    });
  } catch (e) {
    return new Response('{"error":"relay"}', { status: 502, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  return new Response(up.body, {
    status: up.status,
    headers: {
      'Content-Type': up.headers.get('Content-Type') || 'application/json',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

// carátula o fondo del servidor IPTV: solo si de verdad es una imagen (y de hasta 10 MB); Cloudflare la guarda una
// semana, así el servidor IPTV casi no recibe pedidos
async function image(url) {
  const none = () => new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=3600' } });
  let up;
  try {
    up = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8' },
      cf: { cacheEverything: true, cacheTtl: 604800, cacheTtlByStatus: { '200-299': 604800, '404': 3600, '500-599': 0 } },
    });
  } catch (e) {
    return none();
  }
  let type = (up.headers.get('Content-Type') || '').toLowerCase().split(';')[0].trim();
  const size = +(up.headers.get('Content-Length') || 0);
  // algunos servidores mandan las imágenes sin tipo: el de su extensión
  if (type === '' || type.endsWith('/octet-stream')) {
    const ext = (url.match(/\.([a-z]+)$/i) || ['', ''])[1].toLowerCase();
    type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp' }[ext] || '';
  }
  if (!up.ok || !type.startsWith('image/') || type.includes('svg') || size > 10485760) return none();
  return new Response(up.body, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'public, max-age=604800, immutable',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export default {
  async fetch(request, env) {
    const origin = String(env.ORIGIN || '').trim().replace(/\/+$/, '');
    const key = String(env.EDGE_KEY || '').trim();
    if (!/^https?:\/\/[^/]+$/i.test(origin) || key.length < 32) {
      return new Response('Worker sin configurar: falta ORIGIN o EDGE_KEY (ver GUIA-WORKER.html)', { status: 500 });
    }
    const seen = new URL(request.url);           // lo que escribió el cliente (tu dominio)
    if (seen.pathname.startsWith('/xtr/')) return relay(request, seen, key);
    const to = new URL(seen.pathname + seen.search, origin + '/');
    const headers = new Headers(request.headers);
    headers.set('X-MPX-Edge', key);
    headers.set('X-Forwarded-Host', seen.host);
    headers.set('X-Forwarded-Proto', seen.protocol.replace(':', ''));
    headers.set('X-MPX-Client-IP', request.headers.get('CF-Connecting-IP') || '');
    // este Worker sabe hacer de puente (la web lo usa solo si lo ve)
    headers.set('X-MPX-Relay', '1');
    const init = { method: request.method, headers, redirect: 'manual' };
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = request.body;

    let res;
    try {
      res = await fetch(to.toString(), init);
    } catch (e) {
      return new Response('No se pudo abrir la web player original (' + origin + ')', { status: 502 });
    }
    // una redirección hacia el dominio original se cambia a tu dominio (nunca se ve el original)
    const loc = res.headers.get('Location');
    if (loc) {
      try {
        const l = new URL(loc, to);
        if (l.host === new URL(origin).host) {
          l.protocol = seen.protocol;
          l.host = seen.host;
          res = new Response(res.body, res);
          res.headers.set('Location', l.toString());
        }
      } catch (e) { /* Location rara: se deja igual */ }
    }
    return res;
  },
};
