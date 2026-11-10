// Descarga adelantada (src/player/readahead.ts) contra un servidor local que se porta como un servidor IPTV lento:
// tarda en contestar cada pedido, entrega cada conexión al ritmo del video y limita las conexiones de la línea.
// El tiempo va 10 veces más rápido que en la realidad (640 ms = 6,4 s). No requiere red ni Vega.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const http = require('node:http');
const ts = require('typescript');
const originalLoad = Module._load;
const previousTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
Module._load = function (request, parent, isMain) {
  if (/lib\/http$/.test(request)) return { UA: 'test' };
  if (/\/prefetch$/.test(request)) return { takeRange: () => null, takeRangeFrom: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  Module._load = originalLoad;
  require.extensions['.ts'] = previousTs;
});
const { ReadAhead } = require('../src/player/readahead.ts');
const { rangeGet } = require('../src/player/rangeget.ts');

// pedidos a la vez vistos desde la app (el servidor de prueba tarda en dar por cerrada cada conexión)
let flying = 0;
let peak = 0;
const realFetch = global.fetch;
global.fetch = async (...args) => {
  flying++;
  peak = Math.max(peak, flying);
  let counted = true;
  const end = () => { if (counted) { counted = false; flying--; } };
  try {
    const r = await realFetch(...args);
    const body = r.arrayBuffer.bind(r);
    r.arrayBuffer = async () => { try { return await body(); } finally { end(); } };
    if (r.status !== 206) end();
    return r;
  } catch (e) {
    end();
    throw e;
  }
};
after(() => { global.fetch = realFetch; });

const SCALE = 10; // 10 veces más rápido que la realidad
const SIZE = 160 * 1024 * 1024;
const byteAt = i => (i * 31 + (i >> 8) * 7 + (i >> 16)) & 255;
function chunk(a, n) {
  const b = Buffer.allocUnsafe(n);
  for (let i = 0; i < n; i++) b[i] = byteAt(a + i);
  return b;
}

// wait: ms reales que tarda en contestar; rate: bytes/s reales por conexión; max: conexiones a la vez;
// mode 'reject' = la conexión de más se rechaza (403), 'kill' = la conexión más vieja se corta
function server({ wait, rate, max = 99, mode = 'reject' }) {
  const live = new Set();
  const stats = { requests: 0, peak: 0, rejected: 0, killed: 0 };
  const srv = http.createServer((req, res) => {
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    stats.requests++;
    const conn = { res, dead: false };
    if (live.size >= max) {
      if (mode === 'reject') {
        stats.rejected++;
        setTimeout(() => { res.writeHead(403); res.end('MAX_CONNECTIONS'); }, 20);
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
    const done = () => live.delete(conn);
    res.on('close', done);
    setTimeout(() => {
      if (conn.dead || !m) return res.destroy();
      const a = +m[1];
      const b = Math.min(+m[2], SIZE - 1);
      res.writeHead(206, { 'content-range': `bytes ${a}-${b}/${SIZE}`, 'content-length': b - a + 1 });
      let at = a;
      const step = Math.max(4096, Math.round(rate / 50));
      const tick = () => {
        if (conn.dead || res.destroyed) return;
        if (at > b) { done(); return res.end(); }
        const n = Math.min(step, b - at + 1);
        res.write(chunk(at, n));
        at += n;
        setTimeout(tick, 20);
      };
      tick();
    }, wait);
  });
  return new Promise(resolve => srv.listen(0, () => resolve({ url: 'http://127.0.0.1:' + srv.address().port + '/movie.mp4', stats, close: () => new Promise(r => { for (const c of live) c.res.destroy(); srv.close(() => r()); }) })));
}

// «reproduce» el archivo: pide tramos de 4 s seguidos y los va gastando a la velocidad del video. Devuelve cuándo llegó
// la primera imagen, cuánto estuvo detenido después (segundos de la vida real) y si los bytes llegaron bien
async function play(read, bps, secs, from = 0) {
  const t0 = Date.now();
  let buffered = 0; // segundos de video bajados
  let first = -1;
  let stalled = 0;
  let ok = true;
  let off = from;
  let done = false;
  const pump = (async () => {
    while (!done) {
      // como los lectores: no baja más de 40 s por delante
      const played = first < 0 ? 0 : Math.max(0, (Date.now() - first) * SCALE / 1000 - stalled);
      if (buffered - played > 40) { await new Promise(r => setTimeout(r, 20)); continue; }
      const len = Math.round((buffered === 0 ? 1.5 : 4) * bps);
      const d = await read(off, len);
      if (done) return;
      if (!d || d.length !== len) { ok = false; done = true; return; }
      for (const i of [0, len >> 1, len - 1]) if (d[i] !== byteAt(off + i)) ok = false;
      off += len;
      buffered += len / bps;
      if (first < 0) first = Date.now();
    }
  })();
  // reloj de la «pantalla»: si no hay video bajado para el segundo actual, está detenido
  let last = Date.now();
  while (!done) {
    await new Promise(r => setTimeout(r, 10));
    const now = Date.now();
    if (first >= 0) {
      const played = (now - first) * SCALE / 1000 - stalled;
      if (played > buffered) stalled += (now - last) * SCALE / 1000;
      if (played >= secs) done = true;
    }
    if (now - t0 > 60000) done = true;
    last = now;
  }
  await Promise.race([pump, new Promise(r => setTimeout(r, 200))]);
  return { firstAt: first < 0 ? -1 : (first - t0) * SCALE / 1000, stalled, ok };
}

const BPS = 160 * 1024; // bytes por segundo de video: ~1,3 Mb/s (un capítulo de 343 MB)

// estado de los pedidos (rangeget.ts) con la espera contada en el tiempo acelerado: el tamaño de las ventanas depende
// de cuánto tarda el servidor en contestar
function state() {
  let acc = 0;
  const rs = { close: false, unbounded: false, size: 0, why: '' };
  Object.defineProperty(rs, 'waitMs', { get: () => acc * SCALE, set: v => { acc += v - acc * SCALE; } });
  return rs;
}

function oldReader(url) {
  // como antes de la 2.0.14: un pedido por tramo, uno después del otro
  const rs = { close: false, unbounded: false, size: 0, why: '' };
  const reqs = new Set();
  return { read: (off, len) => rangeGet(url, off, len, rs, reqs, () => true), stop: () => { for (const c of reqs) c.abort(); } };
}

test('servidor lento (6,4 s por pedido, entrega al ritmo del video): antes se detenía todo el tiempo; ahora no', async () => {
  const s = await server({ wait: 640, rate: BPS * 1.2 * SCALE });
  const old = oldReader(s.url);
  const before = await play(old.read, BPS, 60);
  old.stop();
  const rs = state();
  const ra = new ReadAhead(s.url, rs, () => BPS);
  ra.seek(5 * 1048576, Math.round(1.5 * BPS));
  const now = await play((o, l) => ra.read(o, l), BPS, 60, 5 * 1048576);
  ra.stop();
  await s.close();
  console.log('   antes: primera imagen a los ' + before.firstAt.toFixed(1) + ' s, detenido ' + before.stalled.toFixed(1) + ' s de 60 · ahora: primera imagen a los ' + now.firstAt.toFixed(1) + ' s, detenido ' + now.stalled.toFixed(1) + ' s (' + ra.diag() + ')');
  assert.ok(now.ok, 'bytes correctos');
  assert.ok(before.stalled > 20, 'el lector anterior se detiene (' + before.stalled.toFixed(1) + ' s)');
  assert.ok(now.stalled < 3, 'el nuevo casi no se detiene (' + now.stalled.toFixed(1) + ' s)');
  assert.ok(now.firstAt < 9, 'primera imagen en ~1 espera (' + now.firstAt.toFixed(1) + ' s)');
});

test('servidor normal (1,5 s por pedido, rápido): abre enseguida y no baja de más', async () => {
  const s = await server({ wait: 150, rate: 8 * 1048576 * SCALE });
  peak = 0;
  const rs = state();
  const ra = new ReadAhead(s.url, rs, () => BPS);
  ra.seek(0, Math.round(1.5 * BPS));
  const r = await play((o, l) => ra.read(o, l), BPS, 40);
  ra.stop();
  await s.close();
  console.log('   primera imagen a los ' + r.firstAt.toFixed(1) + ' s, detenido ' + r.stalled.toFixed(1) + ' s (' + ra.diag() + ', ' + peak + ' pedidos a la vez)');
  assert.ok(r.ok && r.stalled < 0.5 && r.firstAt < 2.5);
  // 40 s vistos + 40 s por delante + lo que guarda en memoria (20 MB): no medio archivo
  assert.ok(ra.bytes < (40 + 40) * BPS + 21 * 1048576, 'no baja de más: ' + (ra.bytes / 1048576).toFixed(0) + ' MB');
  assert.ok(peak <= 3, 'como mucho 3 pedidos a la vez');
});

test('línea de una sola conexión que rechaza la segunda: sigue de a un pedido y no se corta', async () => {
  const s = await server({ wait: 150, rate: BPS * 4 * SCALE, max: 1, mode: 'reject' });
  const rs = state();
  const ra = new ReadAhead(s.url, rs, () => BPS);
  ra.seek(0, Math.round(1.5 * BPS));
  const r = await play((o, l) => ra.read(o, l), BPS, 40);
  ra.stop();
  await s.close();
  console.log('   primera imagen a los ' + r.firstAt.toFixed(1) + ' s, detenido ' + r.stalled.toFixed(1) + ' s (' + ra.diag() + ', rechazados ' + s.stats.rejected + ')');
  assert.ok(r.ok, 'bytes correctos');
  assert.equal(ra.single, true);
  // las pausas antes de reintentar (0,7 s) no van aceleradas: se mide en segundos de verdad
  assert.ok(r.stalled / SCALE < 3, 'detenido ' + (r.stalled / SCALE).toFixed(1) + ' s reales');
});

test('línea de una sola conexión que corta la más vieja: sigue de a un pedido con los bytes bien', async () => {
  const s = await server({ wait: 150, rate: BPS * 4 * SCALE, max: 1, mode: 'kill' });
  const rs = state();
  const ra = new ReadAhead(s.url, rs, () => BPS);
  ra.seek(0, Math.round(1.5 * BPS));
  const r = await play((o, l) => ra.read(o, l), BPS, 40);
  ra.stop();
  await s.close();
  console.log('   primera imagen a los ' + r.firstAt.toFixed(1) + ' s, detenido ' + r.stalled.toFixed(1) + ' s (' + ra.diag() + ', cortadas ' + s.stats.killed + ')');
  assert.ok(r.ok, 'bytes correctos');
  assert.equal(ra.single, true);
  assert.ok(r.stalled / SCALE < 3, 'detenido ' + (r.stalled / SCALE).toFixed(1) + ' s reales');
});

test('salto (◀▶): corta lo que venía en camino y entrega desde el byte nuevo; el final del archivo llega entero', async () => {
  const s = await server({ wait: 50, rate: 20 * 1048576 * SCALE });
  const rs = state();
  const ra = new ReadAhead(s.url, rs, () => BPS);
  ra.seek(0, 1000);
  const a = await ra.read(0, 300000);
  const b = await ra.read(90 * 1048576 + 5, 500000); // salto
  const c = await ra.read(90 * 1048576 + 400000, 700000); // un poco atrás de donde terminó el anterior (audio y video intercalados)
  const tail = await ra.read(SIZE - 1000, 5000); // pasa del final
  ra.stop();
  await s.close();
  assert.ok(a && a.length === 300000 && a[1234] === byteAt(1234));
  assert.ok(b && b.length === 500000 && b[0] === byteAt(90 * 1048576 + 5) && b[499999] === byteAt(90 * 1048576 + 5 + 499999));
  assert.ok(c && c.length === 700000 && c[0] === byteAt(90 * 1048576 + 400000));
  assert.ok(tail && tail.length === 1000 && tail[999] === byteAt(SIZE - 1));
});
