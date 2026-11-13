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
// Vega ('kepler') o el televisor LG ('web')
const rnPlatform = { OS: 'kepler' };
// tipos que acepta el MSE del equipo (todos, salvo en la prueba del simulador de LG)
let mse = () => true;
// almacenamiento de Vega (AsyncStorage) en memoria
const memStore = { getItem: async () => null, setItem: async () => {}, removeItem: async () => {}, getAllKeys: async () => [], multiGet: async () => [], multiSet: async () => {}, multiRemove: async () => {}, clear: async () => {} };
Module._load = function(request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') return { default: memStore, ...memStore };
  if (request === '../api/media') return { engineError: (_b, d) => d, markDenied() {} };
  if (request === '../lib/http') return { UA: 'fixture', json: body => typeof body === 'string' ? JSON.parse(body) : body, http: async () => { requests++; return respond ? respond() : fixture(); } };
  if (request === './panel') return { cloud: async () => { panelRequests++; return {}; } };
  if (request === '../lib/i18n' || request === './i18n') return { t: key => key };
  if (request === '@amazon-devices/react-native-w3cmedia') return { MediaSource: { isTypeSupported: mime => mse(mime) } };
  if (request === 'react-native') return { AppState: { currentState: 'active' }, Platform: rnPlatform };
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
test('LG: el lector del canal deja que el navegador siga la redirección (manual llega vacía); Vega la sigue a mano', async () => {
  const { LiveHls } = require('../src/player/livehls.ts');
  const realFetch = global.fetch;
  const seen = [];
  global.fetch = async (_url, opts) => { seen.push(opts.redirect); return { status: 200, url: 'http://lb.invalid/live.m3u8?token=1', headers: { get: k => (k === 'content-type' ? 'application/vnd.apple.mpegurl' : null) }, text: async () => '#EXTM3U' }; };
  try {
    for (const os of ['kepler', 'web']) {
      rnPlatform.OS = os;
      const reader = new LiveHls({ removeEventListener() {}, addEventListener() {} }, 'http://fixture.invalid/live.m3u8');
      const r = await reader.get('http://fixture.invalid/live.m3u8', 5000, 'list');
      assert.equal(r.code, 200);
      assert.equal(r.url, 'http://lb.invalid/live.m3u8?token=1');
      reader.destroy();
    }
    assert.deepEqual(seen, ['manual', 'follow']);
  } finally { global.fetch = realFetch; rnPlatform.OS = 'kepler'; }
});
test('lector de canales: basta con MP4 por MSE (Chrome y el simulador de LG no aceptan MPEG-TS)', () => {
  const { LiveHls } = require('../src/player/livehls.ts');
  try {
    mse = mime => mime.startsWith('video/mp4');
    assert.equal(LiveHls.supported(), true);
    assert.equal(LiveHls.tsSupported(), false);
    // el HLS que prepara el panel (audio o video convertido) también se convierte a MP4
    const { PanelHls } = require('../src/player/hls.ts');
    assert.equal(PanelHls.supported(), true);
    mse = () => false;
    assert.equal(LiveHls.supported(), false);
  } finally { mse = () => true; }
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

test('sesión: el panel «sin línea» solo cierra la sesión si antes dio la línea de este equipo (o lo bloqueó)', () => {
  const src = fs.readFileSync(require.resolve('../src/api/panel.ts'), 'utf8');
  const fn = /export function lineLost\([^)]*\): boolean \{\n([^}]*)\}/.exec(src);
  assert.ok(fn, 'lineLost en src/api/panel.ts');
  const lineLost = new Function('answered', 'line', 'seen', 'blocked', fn[1]);
  // se entró escribiendo usuario y contraseña y el panel nunca dio la línea de este equipo: no se saca al cliente
  assert.equal(lineLost(true, false, false, false), false);
  // el panel la daba y la quitó (o la demo venció): sí
  assert.equal(lineLost(true, false, true, false), true);
  // equipo bloqueado: siempre
  assert.equal(lineLost(true, false, false, true), true);
  // el panel no contestó, o sigue dando la línea: no
  assert.equal(lineLost(false, false, true, false), false);
  assert.equal(lineLost(true, true, true, false), false);
});

test('control parental como Roku: adultos visibles u ocultos, bloquear categorías y contenido protegido en esta sesión; mostrar adultos ya no desbloquea todo', () => {
  const acc = fs.readFileSync(require.resolve('../src/screens/Account.tsx'), 'utf8');
  for (const k of ['Canales y categorías para adultos', 'Bloquear categorías', 'Contenido protegido en esta sesión']) assert.ok(acc.includes("t('" + k + "')"), k);
  // el PIN de «adultos» solo cambia hide_adult; desbloquear la sesión es la otra opción
  assert.match(acc, /if \(p === 'adult'\) \{\s*setPref\('hide_adult', '0'\);\s*refreshCatalog\(\);\s*\}/);
  assert.match(acc, /p === 'unlock'\) \{\s*catalog\.unlocked = true;/);
  const pin = fs.readFileSync(require.resolve('../src/components/PinDialog.tsx'), 'utf8');
  assert.ok(!pin.includes('catalog.unlocked'), 'el diálogo no desbloquea por su cuenta');
  const lock = fs.readFileSync(require.resolve('../src/components/CategoryLock.tsx'), 'utf8');
  assert.ok(lock.includes("writeJson('blocked_cats'"), 'las bloqueadas se guardan donde las lee el catálogo');
  const cat = fs.readFileSync(require.resolve('../src/data/catalog.ts'), 'utf8');
  assert.ok(cat.includes("readJson<string[]>('blocked_cats')"));
});
