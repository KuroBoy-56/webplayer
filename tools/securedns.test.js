// Botón DNS (src/lib/securedns.ts): pregunta y respuesta DNS sobre HTTPS. `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const esbuild = require('esbuild');
const path = require('path');

const code = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '../src/lib/securedns.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  alias: { '@react-native-async-storage/async-storage': path.join(__dirname, '../web/shims/async-storage.ts') },
}).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', 'require', code)(mod, mod.exports, require);
const { dnsQuery, firstA, viaDns } = mod.exports;

test('pregunta tipo A con el nombre en etiquetas', () => {
  const q = dnsQuery('latammx.net');
  assert.deepStrictEqual(Array.from(q.slice(12, 25)), [7, 108, 97, 116, 97, 109, 109, 120, 3, 110, 101, 116, 0]);
  assert.deepStrictEqual(Array.from(q.slice(-4)), [0, 1, 0, 1]);
});

test('primera respuesta A (con CNAME antes y nombre comprimido)', () => {
  const q = Array.from(dnsQuery('a.io'));
  const head = [0, 0, 0x81, 0x80, 0, 1, 0, 2, 0, 0, 0, 0];
  const cname = [0xc0, 12, 0, 5, 0, 1, 0, 0, 0, 60, 0, 4, 1, 98, 0xc0, 14];
  const a = [0xc0, 12, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 159, 198, 67, 192];
  const msg = new Uint8Array([...head, ...q.slice(12), ...cname, ...a]);
  assert.strictEqual(firstA(msg), '159.198.67.192');
  assert.strictEqual(firstA(new Uint8Array([1, 2, 3])), null);
});

test('https y DNS automático no cambian la dirección', async () => {
  assert.strictEqual(await viaDns('https://latammx.net/movie/u/p/1.mp4'), null);
  assert.strictEqual(await viaDns('http://latammx.net/movie/u/p/1.mp4'), null);
});
