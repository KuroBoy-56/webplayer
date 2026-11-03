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
  if (request === '@amazon-devices/react-native-w3cmedia') return { MediaSource: { isTypeSupported: () => true } };
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
