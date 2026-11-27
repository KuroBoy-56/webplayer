// Buscador de canales de Deportes (src/data/sports.ts): el canal de la lista del cliente para cada canal que transmite.
// Exacto sin calidad ni país, todas las palabras, pegadas y, como último recurso, el parecido de Levenshtein con los
// mismos números. «ESPN 2» nunca da «ESPN» ni «ESPN 3». `npm test`
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
Module._load = function (request, parent, isMain) {
  if (request === '../api/panel') return { cloud: async () => ({}), lineKey: () => 'k' };
  if (request === '../lib/http') return { json: () => null };
  if (request === './catalog') return { catalog: { k: {} }, toItem: () => ({}) };
  if (request === './i18n' || request === '../lib/i18n') return { lang: () => 'es', t: s => s };
  return originalLoad.apply(this, arguments);
};
const { findTvIn, similarity } = require('../src/data/sports.ts');
after(() => {
  Module._load = originalLoad;
  require.extensions['.ts'] = previousTs;
});

const cases = [
  [['ESPN', 'ESPN 2 HD', 'ESPN 3'], 'ESPN 2', 1, 'el número exacto'],
  [['ESPN', 'ESPN 3'], 'ESPN 2', -1, 'nunca otro número'],
  [['ESPN 3'], 'ESPN', -1, 'un nombre sin número no da el 3'],
  [['DAZN 1 HD', 'DAZN 2'], 'DAZN', 0, 'un nombre solo es su primer canal'],
  [['ESPN', 'ESPN+'], 'ESPN+', 1, 'el + es plus'],
  [['ESPN', 'ESPN+'], 'ESPN', 0, 'ESPN no es ESPN+'],
  [['MX: Movistar LaLiga FHD'], 'Movistar+ LaLiga', 0, 'sin el plus si la lista no lo tiene'],
  [['TyC Sports HD'], 'TyC Sport', 0, 'parecido: una letra'],
  [['Fox Sports Premium'], 'Fox Sport Premium', 0, 'parecido con varias palabras'],
  [['Fox Sports 1', 'Fox Sports 2'], 'Fox Sport', 0, 'parecido y primer canal'],
  [['ᴴᴰ ESPN 2 ᴴᴰ', 'ESPN'], 'ESPN 2', 0, 'letras decorativas'],
  [['ESPN Two'], 'ESPN 2', 0, 'número en palabra'],
  [['US: ESPN Deportes East'], 'ESPN Deportes', 0, 'país y Este no cuentan'],
  [['|ES| DAZN LaLiga 2160p HDR'], 'DAZN LaLiga', 0, 'calidades nuevas'],
  [['Sky Sports F1 UHD', 'Sky Sports Main Event'], 'Sky Sports F1', 0, 'F1 se mantiene'],
  [['Sky Sports F1 UHD'], 'Sky Sports 1', -1, 'F1 no es 1'],
  [['Telemundo'], 'TUDN', -1, 'nada parecido: ninguno'],
];
for (const [names, q, want, why] of cases) {
  test(`${q} en [${names.join(', ')}] -> ${want} (${why})`, () => assert.strictEqual(findTvIn(names, q), want));
}

test('similarity es el ratio normalizado de Levenshtein', () => {
  assert.strictEqual(similarity('abc', 'abc'), 1);
  assert.ok(Math.abs(similarity('sport tyc', 'sports tyc') - 0.9) < 1e-9);
  assert.strictEqual(similarity('', 'a'), 0);
});
