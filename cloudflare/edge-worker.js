// MPX Player · Worker de Cloudflare para un dominio propio de la web player.
//
// El cliente entra por TU dominio nuevo (en Cloudflare, nube naranja). Este Worker abre por dentro la web
// player original (Hostinger) y le manda el secreto; la web original rechaza (403) todo lo que llegue sin él.
// El video NUNCA pasa por aquí: va de la VPS / VDS al navegador (su registro DNS sigue con nube gris).
//
// En Cloudflare › Workers › este Worker › Settings › Variables and Secrets:
//   ORIGIN   (Text)    la dirección de la web player ORIGINAL, por ejemplo https://webplayer.mpx.work
//   EDGE_KEY (Secret)  el secreto (el mismo que pones en includes/panel_secret.php › 'edge_keys')
// TU dominio nuevo NO va en este código: se agrega en Settings › Domains & Routes › Custom Domain.
// Ver GUIA-WORKER.html.

export default {
  async fetch(request, env) {
    const origin = String(env.ORIGIN || '').trim().replace(/\/+$/, '');
    const key = String(env.EDGE_KEY || '').trim();
    if (!/^https?:\/\/[^/]+$/i.test(origin) || key.length < 32) {
      return new Response('Worker sin configurar: falta ORIGIN o EDGE_KEY (ver GUIA-WORKER.html)', { status: 500 });
    }
    const seen = new URL(request.url);           // lo que escribió el cliente (tu dominio)
    const to = new URL(seen.pathname + seen.search, origin + '/');
    const headers = new Headers(request.headers);
    headers.set('X-MPX-Edge', key);
    headers.set('X-Forwarded-Host', seen.host);
    headers.set('X-Forwarded-Proto', seen.protocol.replace(':', ''));
    headers.set('X-MPX-Client-IP', request.headers.get('CF-Connecting-IP') || '');
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
