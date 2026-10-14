// Traducción (src/lib/i18n.ts): idioma automático, elegido en Cuenta, valores {x} y fechas. `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');
const code = esbuild.buildSync({
  stdin: {
    contents: "export * from './src/lib/i18n'; export { dateText, clock, demoLength } from './src/lib/util'; export { default as en } from './src/i18n/en'; export { default as pt } from './src/i18n/pt'; export { default as fr } from './src/i18n/fr'; export { loadStorage } from './src/lib/storage';",
    resolveDir: root,
    loader: 'ts',
  },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  alias: {
    '@react-native-async-storage/async-storage': path.join(root, 'web/shims/async-storage.ts'),
    '@amazon-devices/react-native-kepler': path.join(root, 'web/shims/kepler.ts'),
  },
  external: ['react'],
}).outputFiles[0].text;

function load(language) {
  Object.defineProperty(globalThis, 'navigator', { value: { language }, configurable: true });
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
  return mod.exports;
}

test('automático: idioma del equipo; otro idioma -> español', () => {
  assert.strictEqual(load('fr-FR').lang(), 'fr');
  assert.strictEqual(load('pt-BR').t('Cuenta'), 'Conta');
  assert.strictEqual(load('de-DE').t('Cuenta'), 'Cuenta');
});

test('elegido en Cuenta, valores {x} y aviso para volver a montar', () => {
  const m = load('es-MX');
  let changed = 0;
  m.onLangChange(() => changed++);
  m.setLang('en');
  assert.strictEqual(changed, 1);
  assert.strictEqual(m.t('Temporada {n}', { n: 2 }), 'Season 2');
  assert.strictEqual(m.clock(Math.floor(new Date(2026, 9, 13, 18, 5).getTime() / 1000)), '6:05 PM');
  assert.strictEqual(m.dateText(Math.floor(new Date(2026, 9, 13, 12).getTime() / 1000)), '10/13/2026');
  assert.strictEqual(m.demoLength(7200), '2 hours');
  m.setLang('auto');
  assert.strictEqual(m.lang(), 'es');
  assert.strictEqual(m.dateText(Math.floor(new Date(2026, 9, 13, 12).getTime() / 1000)), '13/10/2026');
});

test('los diccionarios conservan los {valores} de cada texto', () => {
  const m = load('es');
  for (const k of Object.keys(m.en)) {
    const want = (k.match(/\{\w+\}/g) || []).sort().join();
    for (const d of [m.en, m.pt, m.fr]) assert.strictEqual((d[k].match(/\{\w+\}/g) || []).sort().join(), want, k);
  }
});
