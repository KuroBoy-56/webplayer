// Regresiones de guía, cierre de vistas previas y descargas canceladas.
// Ejecutar sin SDK Vega: npm run test:interface.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const originalLoad = Module._load;
const previousTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
let requests = 0;
let panelRequests = 0;
let respond;
let configured;
const fixture = () => ({ epg_listings: [{ title: Buffer.from('Programa de prueba').toString('base64'), description: '', start_timestamp: Math.floor(Date.now() / 1000) - 60, stop_timestamp: Math.floor(Date.now() / 1000) + 3600 }] });
class TestShaka {
  addEventListener() {}
  removeEventListener() {}
  configure(config) { configured = config; }
  getNetworkingEngine() { return { registerRequestFilter() {} }; }
  async attach() {}
  async load() {}
  async destroy() {}
}
Module._load = function(request, parent, isMain) {
  if (request === '../lib/http') return { UA: 'fixture', json: body => typeof body === 'string' ? JSON.parse(body) : body, http: async () => { requests++; return respond ? respond() : fixture(); } };
  if (request === './panel') return { cloud: async () => { panelRequests++; return {}; } };
  if (request === '../lib/i18n' || request === './i18n') return { t: key => key };
  if (request === '@amazon-devices/react-native-w3cmedia') return { MediaSource: { isTypeSupported: () => true }, get WebCrypto() { return global.__webcrypto; } };
  if (request === 'react-native') return { AppState: { currentState: 'active' } };
  if (request === './shaka-env') return { installShakaEnvironment() {} };
  if (request === './vendor/shaka-player.compiled') return { Player: TestShaka, polyfill: { installAll() {} }, net: { NetworkingEngine: { unregisterScheme() {}, registerScheme() {}, PluginPriority: { APPLICATION: 1 } }, HttpFetchPlugin: { parse() {} } } };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  Module._load = originalLoad;
  if (previousTs) require.extensions['.ts'] = previousTs; else delete require.extensions['.ts'];
});
const { channelEpg } = require('../src/api/xtream.ts');
const previews = require('../src/player/preview-session.ts');
const session = { base: 'https://fixture.invalid', user: 'prueba', pass: 'prueba' };
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('vista previa y reproductor comparten la misma consulta EPG', async () => {
  const before = requests;
  const channel = { id: '1', epg: '1', name: 'Canal 1' };
  let finish;
  respond = () => new Promise(resolve => { finish = resolve; });
  const first = channelEpg(session, channel);
  const second = channelEpg(session, channel);
  assert.equal(first, second);
  finish(fixture());
  assert.equal((await first)[0].t, 'Programa de prueba');
  await second;
  await channelEpg(session, channel);
  assert.equal(requests - before, 1);
  assert.equal(panelRequests, 0);
  respond = null;
});
test('la guía no se mezcla entre dos cuentas', async () => {
  const before = requests;
  await channelEpg({ ...session, user: 'otra' }, { id: '1', epg: '1', name: 'Canal 1' });
  assert.equal(requests - before, 1);
});
test('la caché EPG vence y tiene un límite de canales', async () => {
  const realNow = Date.now;
  try {
    const at = realNow();
    Date.now = () => at + 61000;
    const before = requests;
    await channelEpg(session, { id: '1', epg: '1', name: 'Canal 1' });
    assert.equal(requests - before, 1);
    for (let i = 0; i < 65; i++) await channelEpg(session, { id: 'cache-' + i, epg: '', name: 'Canal' });
    const after = requests;
    await channelEpg(session, { id: 'cache-0', epg: '', name: 'Canal' });
    assert.equal(requests - after, 1, 'la entrada más antigua debe haberse expulsado');
  } finally { Date.now = realNow; }
});
test('un cierre pendiente de la vista previa bloquea el inicio siguiente', async () => {
  let finish;
  let closes = 0;
  let ready = false;
  const release = new Promise(resolve => { finish = resolve; });
  const unregister = previews.registerLivePreview(() => { closes++; return release; });
  const stop = previews.stopLivePreview();
  previews.waitForLivePreview().then(() => { ready = true; });
  await tick();
  assert.equal(ready, false);
  assert.equal(closes, 1);
  assert.equal(previews.stopLivePreview(), stop);
  finish();
  await stop;
  assert.equal(ready, true);
  unregister();
});
test('limpiar una vista previa vieja no detiene la nueva', async () => {
  let old = 0;
  let fresh = 0;
  const oldCleanup = previews.registerLivePreview(async () => { old++; });
  const freshCleanup = previews.registerLivePreview(async () => { fresh++; });
  oldCleanup();
  assert.equal(fresh, 0);
  await previews.stopLivePreview();
  assert.equal(fresh, 1);
  assert.ok(old >= 1);
  freshCleanup();
});
test('salir del HLS anterior cancela las descargas de lista y segmentos', async () => {
  const { LiveHls } = require('../src/player/livehls.ts');
  const realFetch = global.fetch;
  let aborted = 0;
  global.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { aborted++; reject(new Error('cancelado')); }, { once: true });
  });
  try {
    const reader = new LiveHls({ removeEventListener() {} }, 'https://fixture.invalid/live.m3u8');
    const list = reader.get('https://fixture.invalid/live.m3u8', 10000, 'list');
    const segment = reader.get('https://fixture.invalid/seg.ts', 10000, 'seg');
    reader.destroy();
    await Promise.all([list, segment]);
    assert.equal(aborted, 2);
    await reader.get('https://fixture.invalid/stale.ts', 10000, 'seg');
    assert.equal(aborted, 2);
  } finally { global.fetch = realFetch; }
});
test('canal: si el servidor no da la lista a la primera (página vacía al salir de la vista previa) se vuelve a pedir', async () => {
  const { LiveHls } = require('../src/player/livehls.ts');
  const realFetch = global.fetch;
  const bodies = ['', '#EXTM3U\n#EXT-X-TARGETDURATION:6\n'];
  let calls = 0;
  const reply = (text, type) => ({ status: 200, url: 'http://fixture.invalid/live.m3u8', headers: { get: k => (k === 'content-type' ? type : null) }, text: async () => text });
  global.fetch = async () => { const b = bodies[Math.min(calls, bodies.length - 1)]; calls++; return reply(b, b ? 'application/vnd.apple.mpegurl' : 'text/html; charset=UTF-8'); };
  try {
    const reader = new LiveHls({ removeEventListener() {}, addEventListener() {} }, 'http://fixture.invalid/live.m3u8');
    // la segunda vez llega la lista (aquí sin segmentos): ya no es «el servidor no devolvió una lista HLS»
    assert.equal(await reader.start(), 'lista sin segmentos');
    assert.equal(calls, 2);
    assert.match(reader.diag(), /reintentos=1/);
    reader.destroy();
    // un motivo claro de XUI (canal que no existe) no se reintenta
    calls = 0;
    global.fetch = async () => { calls++; return reply('<html><body>XUI.ONE INVALID_STREAM_ID Stream ID doesn\'t exist.</body></html>', 'text/html'); };
    const bad = new LiveHls({ removeEventListener() {}, addEventListener() {} }, 'http://fixture.invalid/live.m3u8');
    assert.match(await bad.start(), /INVALID_STREAM_ID/);
    assert.equal(calls, 1);
    bad.destroy();
  } finally { global.fetch = realFetch; }
});
test('HLS libera la URL MSE al cerrar', () => {
  const { LiveHls } = require('../src/player/livehls.ts');
  const realRevoke = URL.revokeObjectURL;
  const revoked = [];
  URL.revokeObjectURL = url => revoked.push(url);
  try {
    const reader = new LiveHls({ removeEventListener() {} }, 'fixture');
    reader.objectUrl = 'blob:fixture';
    reader.destroy(); reader.destroy();
    assert.deepEqual(revoked, ['blob:fixture']);
  } finally { URL.revokeObjectURL = realRevoke; }
});
test('Shaka arranca con 1 s bajado (canales, películas y series) y guarda más margen en VOD', async () => {
  const { ShakaPlayback } = require('../src/player/shaka.ts');
  const video = { play: async () => {} };
  for (const live of [true, false]) {
    const adapter = new ShakaPlayback(video);
    adapter.onTracks = () => {};
    await adapter.start('https://fixture.invalid/live.m3u8', 0, '', live);
    assert.equal(configured.streaming.rebufferingGoal, 1);
    assert.equal(configured.streaming.bufferingGoal, live ? 12 : 18);
    assert.equal(configured.abr.enabled, true);
    await adapter.destroy();
  }
});

test('canal en vivo: si el equipo lo pausa solo (al pasar de la miniatura a pantalla grande) sigue reproduciendo', () => {
  const { LiveHls } = require('../src/player/livehls.ts');
  let plays = 0;
  const v = { paused: true, currentTime: 5, addEventListener() {}, removeEventListener() {}, play() { plays++; this.paused = false; }, pause() { this.paused = true; } };
  const reader = new LiveHls(v, 'http://fixture.invalid/live.m3u8');
  Object.assign(reader, { started: true, lastAppend: Date.now(), sb: { buffered: { length: 1, start: () => 0, end: () => 30 } } });
  reader.tick();
  assert.equal(plays, 0); // un momento de gracia (salir del canal también pausa)
  reader.pausedAt = Date.now() - 2000;
  reader.tick();
  assert.equal(plays, 1);
  assert.equal(v.paused, false);
  reader.destroy();
});

test('canal en vivo: imagen congelada con video por delante (3 veces en 30 s) se avisa para volver a abrirlo', () => {
  const { LiveHls } = require('../src/player/livehls.ts');
  const v = { paused: false, currentTime: 8, addEventListener() {}, removeEventListener() {}, play() {}, pause() {} };
  const reader = new LiveHls(v, 'http://fixture.invalid/live.m3u8');
  const errors = [];
  reader.onError = why => errors.push(why);
  Object.assign(reader, { started: true, sb: { buffered: { length: 1, start: () => 0, end: () => 40 } } });
  for (let i = 0; i < 3; i++) {
    reader.lastT = v.currentTime;
    reader.lastMove = Date.now() - 4000;
    reader.unstick();
  }
  assert.equal(reader.frozen, true);
  assert.deepEqual(errors, ['la imagen se congeló']);
  reader.destroy();
});

test('canal en vivo: imagen trabada con video por delante salta al cuadro clave siguiente (no unas décimas)', () => {
  const { LiveHls } = require('../src/player/livehls.ts');
  const v = { paused: false, currentTime: 8, addEventListener() {}, removeEventListener() {}, play() {}, pause() {} };
  const reader = new LiveHls(v, 'http://fixture.invalid/live.m3u8');
  Object.assign(reader, { started: true, mode: 'mp4', mux: { keys: [0, 4, 12, 20], otherAudio: () => false }, sb: { buffered: { length: 1, start: () => 0, end: () => 40 } } });
  reader.lastT = 8;
  reader.lastMove = Date.now() - 4000;
  reader.unstick();
  assert.equal(v.currentTime, 12.15);
  reader.destroy();
});

test('canal: los cortes del video (NAL) se encuentran igual que recorriendo byte por byte', () => {
  const { splitNals } = require('../src/lib/tsdemux.ts');
  // la forma anterior (byte por byte), de referencia
  const slow = d => {
    const out = []; let start = -1; let i = 0;
    while (i + 2 < d.length) {
      const c = d[i + 2];
      if (c > 1) i += 3;
      else if (c === 1 && d[i + 1] === 0 && d[i] === 0) {
        if (start >= 0) { let e = i; while (e > start && d[e - 1] === 0) e--; if (e > start) out.push([start, e]); }
        i += 3; start = i;
      } else i++;
    }
    if (start >= 0 && start < d.length) out.push([start, d.length]);
    return out;
  };
  const spans = d => splitNals(d).map(n => [n.byteOffset - d.byteOffset, n.byteOffset - d.byteOffset + n.length]);
  const fixed = [[0, 0, 0, 1, 9, 0xf0, 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x65, 0, 0, 3, 1, 0, 0], [0, 0, 1], [1, 2, 3], [0, 0, 0, 0, 1, 5, 0, 0, 1]];
  for (const f of fixed) assert.deepEqual(spans(new Uint8Array(f)), slow(new Uint8Array(f)));
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  for (let k = 0; k < 3000; k++) {
    const d = new Uint8Array(Math.floor(rnd() * 80));
    for (let i = 0; i < d.length; i++) { const x = rnd(); d[i] = x < 0.45 ? 0 : x < 0.65 ? 1 : x < 0.7 ? 3 : Math.floor(rnd() * 256); }
    assert.deepEqual(spans(d), slow(d));
  }
});

test('canal: el primer segmento se baja solo (sin repartir la red) y los dos siguientes empiezan apenas llega', async () => {
  const { LiveHls } = require('../src/player/livehls.ts');
  const realFetch = global.fetch;
  const asked = [];
  let first;
  global.fetch = (url, { signal }) => {
    asked.push(url);
    if (url.endsWith('/s10.ts')) return new Promise(res => { first = res; });
    return new Promise((_res, rej) => signal.addEventListener('abort', () => rej(new Error('cancelado')), { once: true }));
  };
  try {
    const reader = new LiveHls({ currentTime: 0, removeEventListener() {} }, 'http://fixture.invalid/live.m3u8');
    reader.segs = [10, 11, 12, 13].map(seq => ({ seq, url: 'http://fixture.invalid/s' + seq + '.ts', dur: 6 }));
    reader.next = 10;
    const errors = [];
    reader.onError = why => errors.push(why);
    const run = reader.pump();
    await tick();
    assert.deepEqual(asked, ['http://fixture.invalid/s10.ts']);
    // llega (aquí no es MPEG-TS: el lector se detiene), y ya se pidieron los dos siguientes
    first({ status: 200, url: 'http://fixture.invalid/s10.ts', headers: { get: k => (k === 'content-type' ? 'video/mp2t' : null) }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
    await run;
    assert.deepEqual(asked.slice(1).sort(), ['http://fixture.invalid/s11.ts', 'http://fixture.invalid/s12.ts']);
    assert.deepEqual(errors, ['el canal no viene en MPEG-TS']);
    reader.destroy();
  } finally { global.fetch = realFetch; }
});

test('canal: el primer segmento se pide junto con la lista (mientras se inicia el reproductor) y se usa una sola vez', async () => {
  const { prefetchList, takeList, takeSeg, dropPrefetch } = require('../src/player/prefetch.ts');
  const { LiveHls } = require('../src/player/livehls.ts');
  const realFetch = global.fetch;
  const asked = [];
  let aborted = 0;
  const list = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:20\n' + [20, 21, 22, 23, 24, 25, 26].map(n => '#EXTINF:6,\nseg' + n + '.ts\n').join('');
  const head = type => ({ get: k => (k === 'content-type' ? type : null) });
  global.fetch = (url, { signal }) => {
    asked.push(url);
    if (url.endsWith('.m3u8')) return Promise.resolve({ status: 200, url, headers: head('application/vnd.apple.mpegurl'), text: async () => list });
    if (url.includes('seg22')) return Promise.resolve({ status: 200, url, headers: head('video/mp2t'), arrayBuffer: async () => new Uint8Array([0x47]).buffer });
    return new Promise((_res, rej) => signal.addEventListener('abort', () => { aborted++; rej(new Error('cancelado')); }, { once: true }));
  };
  try {
    // 7 segmentos: el lector empieza 5 antes del final (seg22) y ese es el que se pide con la lista
    prefetchList('http://fixture.invalid/live.m3u8');
    const reader = new LiveHls({ currentTime: 0, removeEventListener() {} }, 'http://fixture.invalid/live.m3u8');
    assert.equal(await reader.refresh(), '');
    assert.equal(require('../src/lib/hlslist.ts').liveStartSeg(reader.segs).url, 'http://fixture.invalid/seg22.ts');
    const got = await reader.get('http://fixture.invalid/seg22.ts', 10000, 'seg');
    assert.equal(got.data.length, 1);
    assert.deepEqual(asked, ['http://fixture.invalid/live.m3u8', 'http://fixture.invalid/seg22.ts']);
    assert.equal(takeSeg('http://fixture.invalid/seg22.ts'), null);
    reader.destroy();
    // sin usar: la miniatura de otro canal no lo corta; el que lo pidió, sí
    const other = list.replace(/seg22/g, 'slow22');
    global.fetch = (url, { signal }) => {
      asked.push(url);
      if (url.endsWith('.m3u8')) return Promise.resolve({ status: 200, url, headers: head('application/vnd.apple.mpegurl'), text: async () => other });
      return new Promise((_res, rej) => signal.addEventListener('abort', () => { aborted++; rej(new Error('cancelado')); }, { once: true }));
    };
    prefetchList('http://fixture.invalid/b.m3u8');
    await takeList('http://fixture.invalid/b.m3u8');
    dropPrefetch('http://fixture.invalid/a.m3u8');
    await tick();
    assert.equal(aborted, 0);
    dropPrefetch('http://fixture.invalid/b.m3u8');
    await tick();
    assert.equal(aborted, 1);
    assert.equal(takeSeg('http://fixture.invalid/slow22.ts'), null);
  } finally { global.fetch = realFetch; }
});

test('canal: si el reproductor se cierra antes de que llegue la lista, no se pide el primer segmento', async () => {
  const { prefetchList, dropPrefetch, takeList } = require('../src/player/prefetch.ts');
  const realFetch = global.fetch;
  const asked = [];
  let give;
  const list = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n' + [1, 2, 3].map(n => '#EXTINF:6,\nlate' + n + '.ts\n').join('');
  global.fetch = url => {
    asked.push(url);
    return new Promise(res => { give = () => res({ status: 200, url, headers: { get: () => 'application/vnd.apple.mpegurl' }, text: async () => list }); });
  };
  try {
    prefetchList('http://fixture.invalid/late.m3u8');
    await tick();
    dropPrefetch('http://fixture.invalid/late.m3u8');
    give();
    await takeList('http://fixture.invalid/late.m3u8');
    await tick();
    assert.deepEqual(asked, ['http://fixture.invalid/late.m3u8']);
  } finally { global.fetch = realFetch; }
});

test('canal: la pantalla grande arranca con la lista y los segmentos de la miniatura, sin pedir nada', async () => {
  const { LiveHls, hasHandoff } = require('../src/player/livehls.ts');
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = () => { calls++; return new Promise(() => {}); };
  try {
    const url = 'http://fixture.invalid/live/u/p/7.m3u8';
    const segs = [30, 31, 32, 33, 34, 35, 36, 37].map(seq => ({ seq, url: 'http://lb.invalid/hls/tok/' + seq + '.ts', dur: 6, key: { uri: 'http://lb.invalid/key', iv: '' } }));
    const mini = new LiveHls({ removeEventListener() {} }, url);
    mini.keep = true;
    Object.assign(mini, { segs, list: 'http://lb.invalid/hls/tok/index.m3u8', target: 6 });
    mini.keys.set('http://lb.invalid/key', new Uint8Array(16));
    // guarda solo los 6 más nuevos
    for (const seq of [30, 31, 32, 33, 34, 35, 36]) mini.remember(seq, new Uint8Array([0x47, seq]));
    assert.deepEqual([...mini.kept.keys()], [31, 32, 33, 34, 35, 36]);
    mini.handOff();
    assert.equal(mini.kept.size, 0);
    assert.equal(hasHandoff(url), true);
    assert.equal(hasHandoff('http://fixture.invalid/live/u/p/8.m3u8'), false);
    const big = new LiveHls({ removeEventListener() {} }, url);
    assert.equal(big.adopt(), true);
    assert.equal(big.list, 'http://lb.invalid/hls/tok/index.m3u8');
    assert.equal(big.keys.size, 1);
    // empieza donde siempre (5 antes del final: 33) con lo que ya tiene; el segmento sale sin red y ya descifrado
    assert.equal(big.handedStart(), 33);
    const got = await big.fetchSeg(segs[3]);
    assert.equal(got.plain, true);
    assert.deepEqual(Array.from(got.data), [0x47, 33]);
    big.prefetch(33);
    assert.equal(big.inflight.size, 0);
    assert.equal(calls, 0);
    assert.match(big.diag(), /miniatura=1/);
    // se usa una sola vez; otro canal no la toma
    assert.equal(hasHandoff(url), false);
    assert.equal(new LiveHls({ removeEventListener() {} }, url).adopt(), false);
    big.destroy();
  } finally { global.fetch = realFetch; }
});

test('canal: una miniatura sin segmentos entregados no deja nada para la pantalla grande', () => {
  const { LiveHls, hasHandoff } = require('../src/player/livehls.ts');
  const mini = new LiveHls({ removeEventListener() {} }, 'http://fixture.invalid/empty.m3u8');
  mini.keep = true;
  Object.assign(mini, { segs: [{ seq: 1, url: 'http://fixture.invalid/1.ts', dur: 6 }] });
  mini.handOff();
  assert.equal(hasHandoff('http://fixture.invalid/empty.m3u8'), false);
});

test('inicio: al bajar las filas de abajo ya están montadas (se montan quieto, nunca al apretar)', () => {
  const { onFocusWin, idleStep, MAX_ROWS } = require('../src/lib/rowwindow.ts');
  const n = 30;
  // quieto en la fila 0: se van montando de a una hasta 5 abajo y nada más
  let w = { lo: 0, hi: 3 };
  const settle = r => { for (let k = 0; k < 40; k++) { const x = idleStep(w, r, n); if (!x) return; w = x; } };
  settle(0);
  assert.deepEqual(w, { lo: 0, hi: 5 });
  // bajar fila por fila con pausas: la fila a la que se llega y la siguiente ya estaban montadas antes de apretar
  for (let r = 1; r < 20; r++) {
    assert.ok(w.hi >= r + 1, 'fila ' + (r + 1) + ' montada antes de llegar a ' + r);
    const after = onFocusWin(w, r, n);
    assert.equal(after, w, 'apretar no monta nada si hubo pausa');
    settle(r);
    // quedan 3 arriba (más una de margen que se suelta después) y 5 abajo
    assert.deepEqual(w, { lo: Math.max(0, r - 4), hi: Math.min(n - 1, r + 5) });
  }
  // subir con pausas: las de arriba también están antes de llegar
  for (let r = 18; r > 0; r--) {
    assert.ok(w.lo <= r - 1, 'fila ' + (r - 1) + ' montada antes de subir');
    assert.equal(onFocusWin(w, r, n), w);
    settle(r);
  }
  // recorriendo seguido sin pausas: las cercanas se montan al llegar y nunca más de MAX_ROWS a la vez
  w = { lo: 0, hi: 5 };
  for (let r = 1; r < n; r++) {
    w = onFocusWin(w, r, n);
    assert.ok(w.lo <= r - 2 || w.lo === 0);
    assert.ok(w.hi >= Math.min(n - 1, r + 2));
    assert.ok(w.hi - w.lo + 1 <= MAX_ROWS);
  }
  // al final de la lista no se pasa del último
  settle(n - 1);
  assert.equal(w.hi, n - 1);
});

test('carátulas: se recuerda la dirección que cargó y la que dio error (no la que solo tardó)', () => {
  const { firstSource, sourceLoaded, sourceFailed } = require('../src/lib/imagememory.ts');
  const a = ['https://panel/imgc/a.jpg', 'https://panel/img.php?a', 'http://iptv/a.jpg'];
  assert.equal(firstSource(a), 0);
  sourceLoaded(a, a[1]);
  assert.equal(firstSource(a), 1);
  const b = ['https://panel/imgc/b.jpg', 'https://panel/img.php?b', 'http://iptv/b.jpg'];
  sourceFailed(b[0]);
  assert.equal(firstSource(b), 1);
  sourceFailed(b[1]);
  sourceFailed(b[2]);
  // todas fallaron: la última (la original) igual se intenta
  assert.equal(firstSource(b), 2);
});

// lo que cubre cada fragmento de audio convertido (en muestras): [inicio, fin]
function audioCover(frags) {
  const u32 = (d, p) => ((d[p] << 24) >>> 0) + (d[p + 1] << 16) + (d[p + 2] << 8) + d[p + 3];
  const out = [];
  for (const d of frags) {
    // moof(8) mfhd(16) traf(8) tfhd(16) tfdt(20) trun
    const base = u32(d, 8 + 16 + 8 + 16 + 12) * 4294967296 + u32(d, 8 + 16 + 8 + 16 + 16);
    const trun = 8 + 16 + 8 + 16 + 20;
    const n = u32(d, trun + 12);
    let dur = 0;
    for (let i = 0; i < n; i++) dur += u32(d, trun + 20 + i * 16);
    out.push([base, base + dur]);
  }
  return out;
}

test('canal: el audio sigue de corrido aunque sus marcas salten distinto que las del video (sin huecos)', () => {
  const { TsMux } = require('../src/lib/tsmux.ts');
  const make = () => Object.assign(new TsMux(0), { audio: { config: new Uint8Array([0x11, 0x90]), channels: 2, rate: 48000 }, obj: 2, kind: 'aac', off: 0, ref: 0 });
  const step = 1920; // 1024 muestras a 48 kHz en 90 kHz
  const frames = (from, n, shift) => Array.from({ length: n }, (_, i) => ({ pts: (from + i) * step + shift, data: new Uint8Array([1, 2, 3]) }));
  const contiguous = cover => cover.every((c, i) => !i || c[0] === cover[i - 1][1]);
  // salto de 3 s hacia adelante (HBO MUNDI): se rellena con silencio, sin hueco
  let m = make();
  let cover = audioCover(m.audioFrags([...frames(0, 10, 0), ...frames(10, 10, 3 * 90000)]));
  assert.ok(contiguous(cover), JSON.stringify(cover));
  assert.ok(m.filled >= 140 && m.filled <= 141, 'silencio=' + m.filled);
  // salto de 4 s hacia atrás: se descarta lo que sobra, sin encimarse
  m = make();
  cover = audioCover(m.audioFrags([...frames(0, 200, 0), ...frames(200, 300, -4 * 90000)]));
  assert.ok(contiguous(cover), JSON.stringify(cover));
  // 4 s = 187,5 cuadros, menos el margen de 4 cuadros
  assert.ok(m.dropped >= 182 && m.dropped <= 188, 'descartados=' + m.dropped);
  // salto absurdo (1 hora): se cose, el audio sigue justo donde iba
  m = make();
  cover = audioCover(m.audioFrags([...frames(0, 10, 0), ...frames(10, 10, 3600 * 90000)]));
  assert.ok(contiguous(cover), JSON.stringify(cover));
  assert.equal(cover[cover.length - 1][1], 20 * 1024);
  assert.equal(m.joins, 1);
});

test('canal cifrado: se descifra con el AES nativo de Vega y, si no da MPEG-TS, con el de JavaScript', async () => {
  const nodeCrypto = require('node:crypto');
  const { LiveHls } = require('../src/player/livehls.ts');
  const { nativeAesOn } = require('../src/lib/aesnative.ts');
  const { segIv } = require('../src/lib/hlslist.ts');
  let calls = 0;
  let broken = false;
  global.__webcrypto = { subtle: {
    importKey: async (_f, raw, alg) => ({ raw: Buffer.from(raw), algorithm: alg }),
    decrypt: async (alg, key, data) => {
      calls++;
      if (broken) return new Uint8Array(data.byteLength).buffer;
      const d = nodeCrypto.createDecipheriv('aes-128-cbc', key.raw, Buffer.from(alg.iv));
      return new Uint8Array(Buffer.concat([d.update(Buffer.from(data)), d.final()])).slice().buffer;
    },
  } };
  try {
    const plain = new Uint8Array(188 * 20);
    for (let i = 0; i < plain.length; i++) plain[i] = i % 188 === 0 ? 0x47 : (i * 7) & 255;
    const key = new Uint8Array(16).map((_, i) => i * 11);
    const seg = { seq: 77, url: 'http://fixture.invalid/77.ts', dur: 6, key: { uri: 'http://fixture.invalid/key', iv: '' } };
    const c = nodeCrypto.createCipheriv('aes-128-cbc', Buffer.from(key), Buffer.from(segIv(seg)));
    const enc = new Uint8Array(Buffer.concat([c.update(Buffer.from(plain)), c.final()]));
    const reader = new LiveHls({ removeEventListener() {} }, 'http://fixture.invalid/c.m3u8');
    reader.keys.set(seg.key.uri, key);
    assert.deepEqual(await reader.decrypt(seg, enc), plain);
    assert.equal(calls, 1);
    assert.equal(nativeAesOn(), true);
    // el nativo devuelve otra cosa: vale el de JavaScript y el nativo no se vuelve a usar
    broken = true;
    assert.deepEqual(await reader.decrypt(seg, enc), plain);
    assert.equal(nativeAesOn(), false);
    broken = false;
    assert.deepEqual(await reader.decrypt(seg, enc), plain);
    assert.equal(calls, 2);
    reader.destroy();
  } finally { delete global.__webcrypto; }
});

test('películas: el principio del archivo se pide en dos partes (cabecera y video) y cualquier lectura dentro sale de ahí', async () => {
  const { prefetchRange, takeRange, takeRangeFrom } = require('../src/player/prefetch.ts');
  const realFetch = global.fetch;
  const asked = [];
  const file = new Uint8Array(1000).map((_, i) => i & 255);
  const gates = [];
  global.fetch = (url, { headers }) => {
    const m = /bytes=(\d+)-(\d+)/.exec(headers.Range);
    const a = +m[1];
    const b = +m[2] + 1;
    asked.push(a + '-' + b);
    return new Promise(res => gates.push(() => res({ status: 206, headers: { get: k => (k === 'content-range' ? 'bytes ' + a + '-' + (b - 1) + '/1000' : k === 'content-length' ? String(b - a) : null) }, arrayBuffer: async () => file.slice(a, b).buffer })));
  };
  try {
    prefetchRange('http://fixture.invalid/m.mkv', 0, 100, 300);
    await tick();
    // de a un pedido: la segunda parte recién cuando llega la primera
    assert.deepEqual(asked, ['0-100']);
    const head = takeRange('http://fixture.invalid/m.mkv', 0, 100);
    gates.shift()();
    assert.deepEqual(Array.from((await head).data.slice(0, 3)), [0, 1, 2]);
    await tick();
    assert.deepEqual(asked, ['0-100', '100-400']);
    gates.shift()();
    // una lectura que cruza las dos partes, sin pedir nada más
    const mid = await takeRange('http://fixture.invalid/m.mkv', 50, 200);
    assert.equal(mid.data.length, 200);
    assert.equal(mid.data[0], 50);
    assert.equal(mid.size, 1000);
    // fuera de lo pedido: no
    assert.equal(takeRange('http://fixture.invalid/m.mkv', 350, 100), null);
    assert.equal(takeRange('http://fixture.invalid/otro.mkv', 0, 10), null);
    // el lector de MKV toma lo que haya desde un punto aunque no llegue al final que pidió
    const part = await takeRangeFrom('http://fixture.invalid/m.mkv', 380, 1000);
    assert.equal(part.data.length, 20);
    assert.equal(part.data[0], 380 & 255);
    assert.deepEqual(asked, ['0-100', '100-400']);
  } finally { global.fetch = realFetch; }
});

test('películas: al cerrar el reproductor se corta lo que se estaba bajando del principio del archivo', async () => {
  const { prefetchRange, takeRange, dropPrefetch } = require('../src/player/prefetch.ts');
  const realFetch = global.fetch;
  let aborted = 0;
  global.fetch = (_url, { signal }) => new Promise((_res, rej) => signal.addEventListener('abort', () => { aborted++; rej(new Error('cancelado')); }, { once: true }));
  try {
    prefetchRange('http://fixture.invalid/p.mp4', 0, 100, 900);
    const p = takeRange('http://fixture.invalid/p.mp4', 0, 100);
    dropPrefetch('http://fixture.invalid/otra.mp4');
    await tick();
    assert.equal(aborted, 0);
    dropPrefetch('http://fixture.invalid/p.mp4');
    assert.equal(await p, null);
    assert.equal(aborted, 1);
    assert.equal(takeRange('http://fixture.invalid/p.mp4', 0, 100), null);
  } finally { global.fetch = realFetch; }
});

test('películas MKV: la cabecera y el principio del video salen de lo pedido al abrir (sin pedirlos otra vez)', async () => {
  const { prefetchRange } = require('../src/player/prefetch.ts');
  const { MkvMse } = require('../src/player/mkvmse.ts');
  const realFetch = global.fetch;
  const asked = [];
  const file = new Uint8Array(2000).map((_, i) => (i * 3) & 255);
  global.fetch = async (url, { headers }) => {
    const m = /bytes=(\d+)-(\d+)/.exec(headers.Range);
    const a = +m[1];
    const b = Math.min(file.length, +m[2] + 1);
    asked.push(a + '-' + b);
    return { status: 206, headers: { get: k => (k === 'content-range' ? 'bytes ' + a + '-' + (b - 1) + '/2000' : k === 'content-length' ? String(b - a) : null) }, arrayBuffer: async () => file.slice(a, b).buffer };
  };
  try {
    const url = 'http://fixture.invalid/serie.mkv';
    prefetchRange(url, 0, 256, 744);
    const r = new MkvMse({ removeEventListener() {} }, url);
    const head = await r.get(0, 256);
    assert.equal(head.length, 256);
    // el primer tramo de los Cluster: lo que haya hasta donde se pidió al abrir (el resto lo pide ensure)
    const first = await r.get(300, 4194304, true);
    assert.equal(first.length, 700);
    assert.equal(first[0], (300 * 3) & 255);
    assert.deepEqual(asked, ['0-256', '256-1000']);
    // lo que sigue, ya del servidor
    const more = await r.get(1000, 500, true);
    assert.equal(more.length, 500);
    assert.deepEqual(asked, ['0-256', '256-1000', '1000-1500']);
    r.destroy();
  } finally { global.fetch = realFetch; }
});

test('películas MP4 en H.265 (hev1 / hvc1): el lector de la app las abre (antes iban al modo directo y daban error 4)', () => {
  const { hevcCfg } = require('../src/player/mp4mse.ts');
  const { videoEntry } = require('../src/lib/mp4box.ts');
  // hvcC de un capítulo hev1 1280x720 Main 3.1 hecho con ffmpeg (solo la cabecera, sin VPS/SPS/PPS)
  const hvcc = Uint8Array.from(Buffer.from('0101600000009000000000005df000fcfdf8f800000f00', 'hex'));
  for (const type of ['hvc1', 'hev1']) {
    const entry = videoEntry('hvc1', hvcc, 1280, 720);
    entry.set(Buffer.from(type), 4);
    const r = hevcCfg({ entry });
    assert.equal(r.codec, 'hvc1.1.6.L93.90');
    assert.equal(r.cfg.width, 1280);
    assert.equal(r.cfg.height, 720);
    // al reproductor va como hvc1 con el mismo hvcC
    assert.equal(Buffer.from(r.entry.slice(4, 8)).toString(), 'hvc1');
  }
  assert.equal(hevcCfg({ entry: videoEntry('avc1', new Uint8Array(8), 1280, 720) }), null);
});
