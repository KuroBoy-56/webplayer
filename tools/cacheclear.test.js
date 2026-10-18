// Borrado de caché remoto (src/lib/cacheclear.ts): cuándo se guarda en silencio, cuándo se borra. `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');
const code = esbuild.buildSync({
  stdin: { contents: "export * from './src/lib/cacheclear';", resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  alias: { '@react-native-async-storage/async-storage': path.join(root, 'web/shims/async-storage.ts') },
  external: ['react', 'react-native'],
}).outputFiles[0].text;
const m = { exports: {} };
// theme.ts solo usa Dimensions de react-native
const req = id => (id === 'react-native' ? { Dimensions: { get: () => ({ width: 1920, height: 1080 }) } } : require(id));
new Function('module', 'exports', 'require', code)(m, m.exports, req);
const { cacheDecision, cacheSeen, takeCacheOrder } = m.exports;

test('nada guardado: silencio; mayor: borrar; igual o menor: nada', () => {
  assert.strictEqual(cacheDecision('', 5), 'save');
  assert.strictEqual(cacheDecision('', 0), 'save');
  assert.strictEqual(cacheDecision('3', 5), 'clear');
  assert.strictEqual(cacheDecision('5', 5), 'none');
  assert.strictEqual(cacheDecision('7', 5), 'none');
});

test('la orden se guarda antes de borrar y no se repite; sin el campo no se hace nada', () => {
  assert.strictEqual(takeCacheOrder(undefined), false);
  assert.strictEqual(cacheSeen(), 0);
  assert.strictEqual(takeCacheOrder(4), false);
  assert.strictEqual(cacheSeen(), 4);
  assert.strictEqual(takeCacheOrder(4), false);
  assert.strictEqual(takeCacheOrder(2), false);
  assert.strictEqual(takeCacheOrder(6), true);
  assert.strictEqual(cacheSeen(), 6);
  assert.strictEqual(takeCacheOrder(6), false);
});
