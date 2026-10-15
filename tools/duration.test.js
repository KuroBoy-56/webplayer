// Duración del servidor IPTV para el progreso (src/lib/util.ts › serverDurationSec). `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');
const code = esbuild.buildSync({
  stdin: { contents: "export { serverDurationSec } from './src/lib/util';", resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  alias: {
    '@react-native-async-storage/async-storage': path.join(root, 'web/shims/async-storage.ts'),
    '@amazon-devices/react-native-kepler': path.join(root, 'web/shims/kepler.ts'),
  },
}).outputFiles[0].text;
const m = { exports: {} };
new Function('module', 'exports', 'require', code)(m, m.exports, require);
const { serverDurationSec } = m.exports;

test('hh:mm:ss y mm:ss', () => {
  assert.strictEqual(serverDurationSec('01:52:13'), 6733);
  assert.strictEqual(serverDurationSec('45:00'), 2700);
});

test('minutos y segundos sueltos', () => {
  assert.strictEqual(serverDurationSec('112 min'), 6720);
  assert.strictEqual(serverDurationSec('6720'), 6720);
});

test('lo que no se entiende es 0', () => {
  assert.strictEqual(serverDurationSec(''), 0);
  assert.strictEqual(serverDurationSec('N/A'), 0);
  assert.strictEqual(serverDurationSec(undefined), 0);
});
