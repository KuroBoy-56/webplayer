// «Ver todo» (src/actions.ts openSpecial): como browse.php del web player, cada fila abre Explorar con su filtro (Top 10 =
// Mejor valorados, recientes = Agregados recientemente, plataforma, género, carpeta); Continuar viendo y Mi lista su
// cuadrícula; «Series / Películas para ti» su sección. `npm test`
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
const went = [];
Module._load = function (request, parent, isMain) {
  if (request === './lib/goto') return { goto: s => went.push(s) };
  if (request === './data/catalog') return { catalog: { k: { vod: { cats: [{ id: '7', name: 'Acción HD' }] }, series: { cats: [] } } } };
  if (request === './lib/i18n') return { t: s => s };
  if (request === './lib/util') return { serverDurationSec: () => 0 };
  if (request === './state') return { progressMovie: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  Module._load = originalLoad;
  if (previousTs) require.extensions['.ts'] = previousTs; else delete require.extensions['.ts'];
});
const { openSpecial } = require('../src/actions.ts');

const open = sp => {
  const pushed = [];
  openSpecial({ push: r => pushed.push(r) }, { label: 'Ver todo', color: '', ...sp });
  return pushed[0];
};

test('cada «Ver todo» abre Explorar con el filtro de su fila', () => {
  assert.deepStrictEqual(open({ kind: 'more', key: 'top', extra: 'top:all' }), { name: 'explore', init: { type: 'all', sort: 'rating' } });
  assert.deepStrictEqual(open({ kind: 'more', key: 'top', extra: 'top:series' }), { name: 'explore', init: { type: 'series', sort: 'rating' } });
  assert.deepStrictEqual(open({ kind: 'more', key: 'recent', extra: 'vod' }), { name: 'explore', init: { type: 'vod', sort: 'recent' } });
  assert.deepStrictEqual(open({ kind: 'more', key: 'netflix', extra: 'platform' }), { name: 'explore', init: { platform: 'netflix' } });
  assert.deepStrictEqual(open({ kind: 'platform', key: 'disney' }), { name: 'explore', init: { platform: 'disney' } });
  assert.deepStrictEqual(open({ kind: 'genre', key: 'terror', extra: 'series' }), { name: 'explore', init: { genre: 'terror', type: 'series' } });
  assert.deepStrictEqual(open({ kind: 'more', key: '7', extra: 'cat:vod' }), { name: 'explore', init: { cat: { id: '7', name: 'Acción HD', kind: 'vod' } } });
});

test('Continuar viendo y Mi lista: su cuadrícula; «para ti»: su sección', () => {
  assert.strictEqual(open({ kind: 'more', key: 'continue', extra: 'continue' }).mode, 'continue');
  assert.strictEqual(open({ kind: 'more', key: 'mylist', extra: 'mylist' }).mode, 'mylist');
  assert.strictEqual(open({ kind: 'more', key: 'recent', extra: 'for:series' }), undefined);
  assert.deepStrictEqual(went, ['series']);
});
