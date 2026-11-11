// Servidor de prueba que se porta como un servidor IPTV XUI con películas y capítulos:
// - cada pedido tarda `wait` ms en empezar a contestar (lo que miden los avisos: espera_media=3487ms);
// - cada conexión entrega a `rate` bytes/s;
// - la línea admite `max` conexiones a la vez: la de más se rechaza (403, mode 'reject') o corta la más vieja ('kill');
// - una conexión terminada se sigue contando `linger` ms (XUI tarda en darla por cerrada);
// - con `redirect`, la primera vez manda a otra dirección con su token (el balanceador).
const http = require('node:http');

// tailWait: ms que tarda en contestar un pedido del último 10 % del archivo (disco que tarda en llegar al final, donde
// está el índice de casi todos los MP4 de IPTV; el aviso «sin índice en 120 s»)
function xui(file, { wait = 3500, rate = 2_000_000, max = 1, mode = 'reject', linger = 300, redirect = true, tailWait = 0 } = {}) {
  const live = new Set();
  const log = [];
  const stats = { requests: 0, rejected: 0, killed: 0, bytes: 0, peak: 0 };
  const srv = http.createServer((req, res) => {
    const t0 = Date.now();
    if (redirect && !req.url.includes('tok=')) {
      // el balanceador: contesta al toque con la dirección del servidor que entrega
      res.writeHead(302, { location: 'http://127.0.0.1:' + srv.address().port + req.url + '?tok=1' });
      return res.end();
    }
    stats.requests++;
    const range = req.headers.range || '';
    const conn = { res, dead: false };
    if (live.size >= max) {
      if (mode === 'reject') {
        stats.rejected++;
        log.push({ t: t0, range, code: 403 });
        setTimeout(() => { res.writeHead(403); res.end('MAX_CONNECTIONS'); }, 50);
        return;
      }
      const old = live.values().next().value;
      old.dead = true;
      stats.killed++;
      old.res.destroy();
      live.delete(old);
    }
    live.add(conn);
    stats.peak = Math.max(stats.peak, live.size);
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      setTimeout(() => live.delete(conn), linger);
    };
    res.on('close', done);
    const from = Number((/bytes=(\d+)-/.exec(range) || [])[1]);
    const slow = tailWait && (/bytes=-/.test(range) || from > file.size * 0.9);
    setTimeout(() => {
      if (conn.dead || res.destroyed) return;
      let a = 0;
      let b = file.size - 1;
      let m;
      if ((m = /bytes=(\d+)-(\d*)/.exec(range))) {
        a = +m[1];
        if (m[2] !== '') b = Math.min(+m[2], file.size - 1);
      } else if ((m = /bytes=-(\d+)/.exec(range))) {
        a = Math.max(0, file.size - +m[1]);
      }
      log.push({ t: t0, range, code: range ? 206 : 200, len: b - a + 1 });
      res.writeHead(range ? 206 : 200, { 'content-range': `bytes ${a}-${b}/${file.size}`, 'content-length': b - a + 1, 'content-type': 'video/mp4' });
      let at = a;
      const TICK = 20;
      const step = Math.max(2048, Math.round((rate * TICK) / 1000));
      const tick = () => {
        if (conn.dead || res.destroyed) return;
        if (at > b) return res.end();
        const n = Math.min(step, b - at + 1);
        res.write(file.read(at, at + n));
        stats.bytes += n;
        at += n;
        setTimeout(tick, TICK);
      };
      tick();
    }, slow ? tailWait : wait);
  });
  return new Promise(resolve =>
    srv.listen(0, '127.0.0.1', () =>
      resolve({
        url: 'http://127.0.0.1:' + srv.address().port + '/movie/user/pass/123.mp4',
        stats,
        log,
        close: () => new Promise(r => { for (const c of live) c.res.destroy(); srv.closeAllConnections?.(); srv.close(() => r()); }),
      }),
    ),
  );
}

module.exports = { xui };
