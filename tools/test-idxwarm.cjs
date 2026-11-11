// Índices de Continuar viendo en segundo plano (src/player/idxwarm.ts): de a uno, se detienen al abrir algo que usa la
// línea y siguen después, nunca en líneas de una conexión. Sin Vega ni red: los lectores son de prueba.
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

const saved = new Set();
const started = [];
const stopped = [];
let finish = null;
function job(url) {
  started.push(url);
  let res;
  const done = new Promise(r => (res = r));
  finish = r => { saved.add(url); res(r); };
  return { stop: () => { stopped.push(url); res(''); }, done };
}
Module._load = function (request, parent, isMain) {
  if (/\/indexstore$/.test(request)) return { hasIndex: u => saved.has(u) };
  if (/\/mkvmse$/.test(request)) return { mkvKnown: () => false, preloadMkv: job };
  if (/\/mp4mse$/.test(request)) return { mp4Known: () => false, preloadIndex: job };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => { Module._load = originalLoad; require.extensions['.ts'] = previousTs; });
const w = require('../src/player/idxwarm.ts');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const u = n => 'http://srv.test/movie/u/p/' + n + '.mp4';

test('línea de una conexión: no se lee nada en segundo plano', async () => {
  w.idxWarmList([u(1), u(2)], 1);
  await sleep(4300);
  assert.equal(started.length, 0);
});

test('de a uno, y al abrir un video se corta lo que estaba leyendo; sigue 3 s después de cerrarlo', async () => {
  w.idxWarmList([u(1), u(2), 'http://srv.test/live/u/p/9.m3u8'], 4);
  await sleep(4300);
  assert.deepEqual(started, [u(1)]);
  finish('ok');
  await sleep(1700);
  assert.deepEqual(started, [u(1), u(2)]);
  w.idxWarmHold(true);
  assert.deepEqual(stopped, [u(2)]);
  w.idxWarmHold(false);
  await sleep(3200);
  assert.deepEqual(started, [u(1), u(2), u(2)]);
  finish('ok');
  await sleep(1700);
  // los canales no se leen; los dos ya están
  assert.equal(started.length, 3);
});
