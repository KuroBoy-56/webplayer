// Traspaso del reproductor entre la miniatura de TV en vivo y la pantalla grande (src/player/preview-session.ts):
// `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const esbuild = require('esbuild');

function load() {
  const code = esbuild.buildSync({ entryPoints: [__dirname + '/../src/player/preview-session.ts'], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

// reproductor y Playback de prueba: anotan pausa, cierre del motor y cierre del reproductor
function player(log, name) {
  const v = { pause: () => log.push(name + ':pause'), deinitialize: async () => log.push(name + ':deinit') };
  const c = { destroy: async () => log.push(name + ':destroy') };
  return { v, c };
}

test('OK otra vez en la miniatura: la pantalla grande hereda el mismo reproductor sin cerrarlo', async () => {
  const ps = load();
  const log = [];
  const a = player(log, 'a');
  let stopped = false;
  ps.registerLivePreview(
    async () => { stopped = true; },
    () => { ps.offerPreview({ url: 'http://x/live/u/p/1.m3u8', v: a.v, c: a.c, at: Date.now() }); return true; },
  );
  assert.equal(ps.handPreview(), true);
  const got = ps.takePreview('http://x/live/u/p/1.m3u8');
  assert.ok(got);
  assert.equal(got.v, a.v);
  assert.equal(got.c, a.c);
  await ps.waitForLivePreview();
  assert.equal(stopped, false);
  assert.deepEqual(log, []);
  // ya se tomó: otra pantalla grande no lo recibe
  assert.equal(ps.takePreview('http://x/live/u/p/1.m3u8'), null);
});

test('miniatura que todavía no tenía reproductor: se cierra como siempre y la pantalla grande abre el canal', async () => {
  const ps = load();
  let stopped = false;
  ps.registerLivePreview(async () => { stopped = true; }, () => false);
  assert.equal(ps.handPreview(), false);
  await ps.waitForLivePreview();
  assert.equal(stopped, true);
  assert.equal(ps.takePreview('http://x/live/u/p/1.m3u8'), null);
});

test('entregado para otro canal: se cierra (sin quedar abierto con su conexión) antes de abrir el nuevo', async () => {
  const ps = load();
  const log = [];
  const a = player(log, 'a');
  ps.offerPreview({ url: 'http://x/live/u/p/1.m3u8', v: a.v, c: a.c, at: Date.now() });
  assert.equal(ps.takePreview('http://x/live/u/p/2.m3u8'), null);
  await ps.waitForLivePreview();
  assert.deepEqual(log, ['a:pause', 'a:destroy', 'a:deinit']);
});

test('al salir de la pantalla grande el reproductor vuelve a la miniatura del mismo canal', async () => {
  const ps = load();
  const log = [];
  const a = player(log, 'a');
  ps.offerReturn('7', a.v, a.c);
  // la miniatura de otro canal no lo toma (y no lo cierra: puede llegar enseguida la del canal que sonaba)
  assert.equal(ps.takeReturn('8'), null);
  const back = ps.takeReturn('7');
  assert.ok(back);
  assert.equal(back.v, a.v);
  assert.equal(back.c, a.c);
  assert.deepEqual(log, []);
  assert.equal(ps.takeReturn('7'), null);
});

test('nadie lo tomó: se cierra al abrir otro reproductor (dropReturn) y waitForLivePreview espera ese cierre', async () => {
  const ps = load();
  const log = [];
  const a = player(log, 'a');
  ps.offerReturn('7', a.v, a.c);
  ps.dropReturn();
  await ps.waitForLivePreview();
  assert.deepEqual(log, ['a:pause', 'a:destroy', 'a:deinit']);
  assert.equal(ps.takeReturn('7'), null);
});

test('nadie lo tomó en 4 s: se cierra solo', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const ps = load();
  const log = [];
  const a = player(log, 'a');
  ps.offerReturn('7', a.v, a.c);
  t.mock.timers.tick(3900);
  assert.deepEqual(log, []);
  t.mock.timers.tick(200);
  assert.deepEqual(log, ['a:pause', 'a:destroy']);
  t.mock.timers.reset();
  await ps.waitForLivePreview();
  assert.deepEqual(log, ['a:pause', 'a:destroy', 'a:deinit']);
  assert.equal(ps.takeReturn('7'), null);
});

test('la pantalla grande abierta desde TV en vivo lo sabe una sola vez', () => {
  const ps = load();
  assert.equal(ps.takeLiveOrigin(), false);
  ps.markLiveOrigin();
  assert.equal(ps.takeLiveOrigin(), true);
  assert.equal(ps.takeLiveOrigin(), false);
});
