// Caja negra del reproductor (src/lib/blackbox.ts) y errores de JavaScript que ya no cierran la app (src/api/report.ts).
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

let disk = new Map();
const sent = [];
Module._load = function (request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
    getAllKeys: async () => [...disk.keys()],
    multiGet: async ks => ks.map(k => [k, disk.get(k) ?? null]),
    setItem: async (k, v) => { disk.set(k, v); },
    removeItem: async k => { disk.delete(k); },
  } };
  if (request === 'react-native') return { Platform: { constants: {} } };
  if (request === '../lib/osversion') return { osVersion: () => '2.0' };
  if (request === '../lib/aes') return { hasMasterKey: () => true, panelEncrypt: s => s };
  if (request === '../lib/http') return { formBody: o => JSON.stringify(o) };
  if (request === '../lib/tenant') return { APP_ID: 'vega', tenantCode: () => '' };
  if (request === './panel') return { panel: async (path, m, body) => { sent.push(JSON.parse(JSON.parse(body).data)); return {}; } };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  Module._load = originalLoad;
  require.extensions['.ts'] = previousTs;
});
const tick = () => new Promise(r => setTimeout(r, 5));
const fresh = async () => {
  for (const f of ['../src/lib/storage.ts', '../src/lib/blackbox.ts', '../src/api/report.ts']) delete require.cache[require.resolve(f)];
  const storage = require('../src/lib/storage.ts');
  await storage.loadStorage();
  return { bb: require('../src/lib/blackbox.ts'), report: require('../src/api/report.ts') };
};

test('la app se cierra sola durante una película: en la apertura siguiente queda lo último que hacía', async () => {
  disk = new Map();
  let { bb } = await fresh();
  bb.bbOpen('kind=movie titulo=Dune ext=mp4');
  bb.bbStep('reproduciendo modo=lector mp4', true);
  bb.bbStep('pos=120/9000s', true);
  await tick();
  // cierre de golpe: nada más se guarda; la app vuelve a abrir
  ({ bb } = await fresh());
  const got = bb.bbPending();
  assert.match(got, /kind=movie titulo=Dune/);
  assert.match(got, /reproduciendo modo=lector mp4/);
  assert.match(got, /pos=120\/9000s/);
  await tick();
  ({ bb } = await fresh());
  assert.equal(bb.bbPending(), '', 'se manda una sola vez');
});

test('un reproductor nuevo para el mismo video sigue en la misma caja (los pasos de antes no se pierden)', async () => {
  disk = new Map();
  let { bb } = await fresh();
  bb.bbOpen('kind=movie titulo=A');
  bb.bbStep('reproduciendo modo=lector', true);
  bb.bbStep('se cierra el reproductor', true);
  bb.bbOpen('kind=movie titulo=A continuar=300');
  await tick();
  ({ bb } = await fresh());
  const got = bb.bbPending();
  assert.match(got, /reproduciendo modo=lector/);
  assert.match(got, /se cierra el reproductor/);
  assert.match(got, /abrir kind=movie titulo=A continuar=300/);
});

test('salir del reproductor o pasar a segundo plano no cuenta como cierre', async () => {
  disk = new Map();
  let { bb } = await fresh();
  bb.bbOpen('kind=episode');
  bb.bbClose();
  await tick();
  ({ bb } = await fresh());
  assert.equal(bb.bbPending(), '');
  bb.bbOpen('kind=movie');
  bb.bbPause();
  await tick();
  assert.equal(disk.has('latmpx:bb_play'), false, 'en segundo plano el sistema puede cerrar la app sin que sea un error');
  bb.bbResume();
  await tick();
  assert.equal(disk.has('latmpx:bb_play'), true);
});

test('2.6.11: Inicio del control durante una película (el reproductor se cierra en segundo plano) y el sistema cierra la app: no llega como cierre', async () => {
  disk = new Map();
  let { bb } = await fresh();
  bb.bbOpen('kind=movie titulo=Maléfica');
  bb.bbStep('pos=80/5848s', true);
  // Player.tsx: AppState «background» -> bbPause y, después, la limpieza del reproductor (foreground = false)
  bb.bbPause();
  bb.bbStep('se cierra el reproductor', true);
  await tick();
  assert.equal(disk.has('latmpx:bb_play'), false, 'nada guardado en segundo plano');
  // el Fire TV cierra la app en segundo plano (normal): en la apertura siguiente no hay nada que mandar
  ({ bb } = await fresh());
  assert.equal(bb.bbPending(), '');
});

test('2.6.11: al volver del segundo plano se guarda otra vez, con los pasos de mientras tanto (un cierre ahí sí es un error)', async () => {
  disk = new Map();
  let { bb } = await fresh();
  bb.bbOpen('kind=episode titulo=El Señor de los Cielos');
  bb.bbStep('pos=2367/2582s', true);
  bb.bbPause();
  bb.bbStep('se cierra el reproductor', true);
  bb.bbResume();
  bb.bbOpen('kind=episode titulo=El Señor de los Cielos continuar=2367');
  await tick();
  ({ bb } = await fresh());
  const got = bb.bbPending();
  assert.match(got, /segundo plano/);
  assert.match(got, /se cierra el reproductor/);
  assert.match(got, /vuelve del segundo plano/);
  assert.match(got, /abrir kind=episode/);
  assert.ok(got.indexOf('segundo plano') < got.indexOf('se cierra el reproductor'), 'en el orden en que pasaron');
});

test('2.6.11: segundo plano y salir del reproductor: la caja queda lista para la próxima película', async () => {
  disk = new Map();
  let { bb } = await fresh();
  bb.bbOpen('kind=movie titulo=A');
  bb.bbPause();
  bb.bbClose();
  bb.bbOpen('kind=movie titulo=B');
  bb.bbStep('reproduciendo', true);
  await tick();
  ({ bb } = await fresh());
  assert.match(bb.bbPending(), /titulo=B/, 'después de cerrar, la caja guarda de nuevo');
});

test('error de JavaScript: va al panel y la app vuelve atrás en lugar de cerrarse; muchos seguidos, se cierra como antes', async () => {
  disk = new Map();
  sent.length = 0;
  const { report } = await fresh();
  let closed = 0;
  globalThis.ErrorUtils = { handler: null, getGlobalHandler() { return () => { closed++; }; }, setGlobalHandler(h) { this.handler = h; } };
  report.installCrashReporter();
  const recovered = [];
  report.setRecover(msg => recovered.push(msg));
  globalThis.ErrorUtils.handler(new Error('fallo A'), true);
  await tick();
  assert.deepEqual(recovered, ['fallo A']);
  assert.equal(closed, 0, 'la app no se cierra');
  assert.equal(sent[0].kind, 'crash');
  assert.equal(sent[0].message, 'fallo A');
  globalThis.ErrorUtils.handler(new Error('fallo B'), true);
  globalThis.ErrorUtils.handler(new Error('fallo C'), true);
  globalThis.ErrorUtils.handler(new Error('fallo D'), true);
  assert.equal(recovered.length, 3);
  assert.equal(closed, 1, 'el cuarto en 30 s: la app no puede seguir');
  // un error que no es fatal no hace nada más que avisar
  globalThis.ErrorUtils.handler(new Error('aviso'), false);
  assert.equal(closed, 1);
  delete globalThis.ErrorUtils;
});
