// Índice guardado en el equipo (src/player/indexstore.ts): ida y vuelta de base64, los 12 más recientes, archivo que
// cambió y almacenamiento lento. Sin Vega ni red: AsyncStorage es un mapa en memoria.
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
const disk = new Map();
let hang = false;
const AsyncStorage = {
  getItem: k => (hang ? new Promise(() => {}) : Promise.resolve(disk.has(k) ? disk.get(k) : null)),
  setItem: (k, v) => { disk.set(k, v); return Promise.resolve(); },
  removeItem: k => { disk.delete(k); return Promise.resolve(); },
  getAllKeys: () => Promise.resolve([...disk.keys()]),
  multiGet: ks => Promise.resolve(ks.map(k => [k, disk.get(k) ?? null])),
};
Module._load = function (request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') return { __esModule: true, default: AsyncStorage };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  Module._load = originalLoad;
  require.extensions['.ts'] = previousTs;
});
const ix = require('../src/player/indexstore.ts');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const bytes = (n, seed = 1) => {
  const d = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; d[i] = x >> 16; }
  return d;
};
// espera a que termine la escritura en segundo plano
const settled = async url => { for (let i = 0; i < 200 && !ix.hasIndex(url); i++) await sleep(10); await sleep(20); };

test('base64 ida y vuelta, igual que el de Node, en todos los largos de borde', async () => {
  for (const n of [0, 1, 2, 3, 4, 5, 3071, 3072, 3073, 3074, 6145, 100000, 5 * 1048576 + 1]) {
    const d = bytes(n, n + 7);
    const a = await ix.toBase64(d);
    assert.equal(a, Buffer.from(d).toString('base64'), 'toBase64 n=' + n);
    if (n <= 100000) assert.equal(ix.b64(d), a, 'b64 n=' + n);
    assert.deepEqual(Buffer.from(ix.fromBase64(a)), Buffer.from(d), 'fromBase64 n=' + n);
  }
});

test('guarda y lee el índice de un archivo; http y https son el mismo archivo', async () => {
  const moov = bytes(700000, 3);
  ix.saveIndex('http://srv.test/movie/u/p/10.mp4', 343000000, moov);
  await settled('http://srv.test/movie/u/p/10.mp4');
  const got = await ix.loadIndex('https://srv.test/movie/u/p/10.mp4');
  assert.ok(got);
  assert.equal(got.size, 343000000);
  assert.deepEqual(Buffer.from(got.moov), Buffer.from(moov));
  assert.equal(await ix.loadIndex('http://srv.test/movie/u/p/11.mp4'), null);
  // nada de esto entra en lo que la app carga al iniciar (storage.ts solo lee «latmpx:»)
  for (const k of disk.keys()) if (!k.startsWith('latmpx:')) assert.ok(k.startsWith('latmpxidx:'), k);
});

test('quedan los 12 más recientes (2.1.0: también los de Continuar viendo); lo más viejo se borra del equipo', async () => {
  for (let i = 0; i < 15; i++) {
    ix.saveIndex('http://srv.test/movie/u/p/' + (100 + i) + '.mp4', 1000 + i, bytes(50000, i));
    await settled('http://srv.test/movie/u/p/' + (100 + i) + '.mp4');
  }
  await sleep(50);
  assert.equal(ix.hasIndex('http://srv.test/movie/u/p/114.mp4'), true);
  assert.equal(ix.hasIndex('http://srv.test/movie/u/p/103.mp4'), true);
  assert.equal(ix.hasIndex('http://srv.test/movie/u/p/102.mp4'), false);
  assert.equal(ix.hasIndex('http://srv.test/movie/u/p/10.mp4'), false);
  assert.equal([...disk.keys()].filter(k => k.startsWith('latmpxidx:')).length, 12);
});

test('texto guardado a medias (se cortó la escritura) no se usa', async () => {
  const url = 'http://srv.test/movie/u/p/114.mp4';
  assert.ok(await ix.loadIndex(url));
  for (const k of disk.keys()) if (k.startsWith('latmpxidx:')) disk.set(k, disk.get(k).slice(0, -8));
  assert.equal(await ix.loadIndex(url), null);
});

test('almacenamiento que no contesta: a los 2,5 s se sigue sin lo guardado (el índice se lee del servidor)', async () => {
  const url = 'http://srv.test/movie/u/p/200.mp4';
  ix.saveIndex(url, 5000, bytes(40000, 9));
  await settled(url);
  hang = true;
  const t0 = Date.now();
  const got = await ix.loadIndex(url);
  hang = false;
  assert.equal(got, null);
  assert.ok(Date.now() - t0 >= 2400 && Date.now() - t0 < 4000, 'esperó ' + (Date.now() - t0) + ' ms');
});

test('borrar caché (panel) y archivo que cambió', async () => {
  const url = 'http://srv.test/movie/u/p/200.mp4';
  assert.equal(ix.hasIndex(url), true);
  ix.dropIndex(url);
  assert.equal(ix.hasIndex(url), false);
  ix.clearIndexes();
  await sleep(30);
  assert.equal([...disk.keys()].filter(k => k.startsWith('latmpxidx:')).length, 0);
});
