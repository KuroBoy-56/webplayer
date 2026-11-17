// Filas de Inicio, Series y Películas (src/data/catalog.ts, 2.6.11): se arman una vez por catálogo y el orden «los n
// primeros» da exactamente lo mismo que ordenar todo y cortar. `node --test tools/test-catalog.cjs`
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
const store = new Map();
let week = null;
let appLang = 'es';
Module._load = function (request, parent, isMain) {
  if (request === '../api/xtream') return { imgPath: x => x || '' };
  if (request === '../lib/storage') return { pref: (k, d) => (store.has(k) ? store.get(k) : d), readJson: k => (store.has(k) ? JSON.parse(store.get(k)) : null), read: () => '', write() {} };
  if (request === '../lib/i18n' || request === './i18n') return { t: k => k, lang: () => appLang };
  if (request === './top10') return { weekTop: () => week, weekShuffle: a => a };
  if (/\.png$/.test(request)) return 1;
  if (request === 'react-native') return { Platform: { OS: 'kepler', constants: {} } };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  Module._load = originalLoad;
  require.extensions['.ts'] = previousTs;
});
const { catalog } = require('../src/data/catalog.ts');

function fill(nv, ns) {
  const NM = ['Netflix', 'Disney+', 'HBO Max', 'Accion', 'Comedia', 'Terror', 'Drama', 'Estrenos', 'Adultos XXX'];
  const cats = n => Array.from({ length: n }, (_, c) => ({ category_id: String(c), category_name: NM[c % NM.length] + ' ' + c }));
  // fechas y notas repetidas a propósito (empates)
  const vod = Array.from({ length: nv }, (_, i) => ({ stream_id: String(i), name: 'P' + i, stream_icon: 'x', category_id: String(i % 20), added: String(1000 + (i * 7919) % 50), rating: String((i * 31) % 11) }));
  const ser = Array.from({ length: ns }, (_, i) => ({ series_id: String(i), name: 'S' + i, cover: 'x', category_id: String(i % 12), last_modified: String(2000 + (i * 104729) % 40), rating: String((i * 17) % 9) }));
  catalog.set('vod', cats(20), vod);
  catalog.set('series', cats(12), ser);
}

test('los n primeros: lo mismo que ordenar toda la lista y cortar (con empates, en su orden)', () => {
  fill(5000, 2000);
  const d = catalog.k.vod;
  const all = catalog.allIdx('vod');
  for (const by of ['added', 'rating']) {
    for (const n of [1, 10, 30, 40, 150, 300, 3000, 6000]) {
      const want = all.map(i => ({ i, v: catalog.sortKey('vod', d.items[i], by) })).sort((a, b) => b.v - a.v).slice(0, n).map(p => p.i);
      assert.deepEqual(catalog.top('vod', all, by, n), want, by + ' n=' + n);
    }
  }
  assert.deepEqual(catalog.top('vod', all, 'added', 0), []);
  assert.deepEqual(catalog.top('vod', [], 'added', 5), []);
});

test('volver a Inicio, Series o Películas no vuelve a armar las filas', () => {
  fill(3000, 1500);
  const h1 = catalog.home(true);
  assert.equal(catalog.home(true), h1, 'mismas filas al volver');
  assert.notEqual(catalog.home(false), h1, 'sin plataformas son otras filas');
  const s1 = catalog.browse('series');
  assert.equal(catalog.browse('series'), s1);
  assert.notEqual(catalog.browse('vod'), s1);
});

test('las filas se rehacen si cambia lo que las arma (listas, control parental, lista de la semana, idioma)', () => {
  fill(3000, 1500);
  let h = catalog.home(true);
  fill(3000, 1500);
  assert.notEqual(catalog.home(true), h, 'listas nuevas del servidor');
  h = catalog.home(true);
  catalog.unlocked = true;
  assert.notEqual(catalog.home(true), h, 'desbloqueado con el PIN');
  catalog.unlocked = false;
  h = catalog.home(true);
  store.set('blocked_cats', JSON.stringify(['vod:3']));
  const blocked = catalog.home(true);
  assert.notEqual(blocked, h, 'una categoría bloqueada');
  assert.ok(blocked.rows.every(r => r.items.every(x => !x.cat || x.kind !== 'vod' || x.cat !== '3')), 'sin la bloqueada');
  store.set('hide_adult', '0');
  assert.notEqual(catalog.home(true), blocked, 'adultos visibles');
  h = catalog.home(true);
  week = { week: 'w', movies: [], series: [], all: [] };
  assert.notEqual(catalog.home(true), h, 'llegó la lista de la semana');
  h = catalog.home(true);
  appLang = 'en';
  assert.notEqual(catalog.home(true), h, 'otro idioma');
  h = catalog.home(true);
  catalog.clear();
  assert.equal(catalog.home(true).rows.length, 0, 'sin catálogo (otra cuenta): nada de la anterior');
  store.clear();
  week = null;
  appLang = 'es';
});
