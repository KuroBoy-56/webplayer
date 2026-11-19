// Fondo de «¿Quién está viendo?»: weekHighlights (src/api/tmdb.ts) da 15 a 20 destacados de la semana con fondo, sin
// repetir, pidiendo la página 2 solo si en la 1 no llegan a 15. `node --test tools/test-highlights.cjs`
const { test, after } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const originalLoad = Module._load;
const previousTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const pages = [];
Module._load = function (request, parent, isMain) {
  if (request === '../data/catalog') return { catalog: {} };
  if (request === '../lib/http') return { http: async () => ({ code: 0, body: '' }), json: r => { try { return JSON.parse(r.body); } catch { return null; } } };
  if (request === './panel') return {
    panel: async (_f, _m, _b, _c, q) => {
      const page = Number((/[?&]page=(\d+)/.exec(q) || [])[1] || 1);
      pages.push(page);
      return { code: 200, ok: true, body: JSON.stringify(globalThis.__pages[page] || { results: [] }) };
    },
  };
  if (request === '../lib/i18n') return { tmdbLang: () => globalThis.__lang || 'es-MX' };
  if (request === '../lib/storage') return { read: () => '' };
  if (request === '../lib/tenant') return { APP_ID: 'vega', scoped: k => k, tenantCode: () => '' };
  if (request === '../lib/titles') return { buildTitleIndex: () => ({}), catalogYear: () => '', lookupTitle: () => null, titleKeys: () => [], yearsOk: () => true };
  if (request === '../lib/util') return { str: v => (v === undefined || v === null ? '' : String(v)) };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  Module._load = originalLoad;
  if (previousTs) require.extensions['.ts'] = previousTs; else delete require.extensions['.ts'];
});
const tmdb = require('../src/api/tmdb.ts');

const item = (id, extra = {}) => ({ id, media_type: 'movie', title: 'T' + id, backdrop_path: '/b' + id + '.jpg', vote_average: 7.25, release_date: '2026-01-01', ...extra });

test('20 de la página 1: no pide la 2, sin los que no tienen fondo y sin repetir', async () => {
  globalThis.__lang = 'es-MX';
  const res = [];
  for (let i = 1; i <= 24; i++) res.push(item(i));
  res.splice(2, 0, item(99, { backdrop_path: '' }), item(98, { media_type: 'person' }), item(1));
  globalThis.__pages = { 1: { results: res } };
  pages.length = 0;
  const l = await tmdb.weekHighlights();
  assert.strictEqual(l.length, 20);
  assert.deepStrictEqual(pages, [1]);
  assert.strictEqual(new Set(l.map(h => h.title)).size, 20);
  assert.ok(l.every(h => h.backdrop.startsWith('https://image.tmdb.org/t/p/w1280/b')));
  assert.strictEqual(l[0].rating, 7.3);
});

test('pocos en la página 1: completa con la 2 (hasta 20)', async () => {
  globalThis.__lang = 'en-US';
  const p1 = [];
  for (let i = 1; i <= 10; i++) p1.push(item(i));
  const p2 = [];
  for (let i = 11; i <= 40; i++) p2.push(item(i, { media_type: 'tv', title: undefined, release_date: undefined, name: 'S' + i, first_air_date: '2025-05-05' }));
  globalThis.__pages = { 1: { results: p1 }, 2: { results: p2 } };
  pages.length = 0;
  const l = await tmdb.weekHighlights();
  assert.deepStrictEqual(pages, [1, 2]);
  assert.strictEqual(l.length, 20);
  assert.strictEqual(l[10].kind, 'tv');
  assert.strictEqual(l[10].year, '2025');
  // guardado 6 h por idioma: no vuelve a pedir
  pages.length = 0;
  assert.strictEqual((await tmdb.weekHighlights()).length, 20);
  assert.deepStrictEqual(pages, []);
});
