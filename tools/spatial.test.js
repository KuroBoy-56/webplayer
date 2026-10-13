// Navegación con las flechas del control (web/spatial.ts): `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const esbuild = require('esbuild');

const code = esbuild.buildSync({ entryPoints: [__dirname + '/../web/spatial.ts'], bundle: true, format: 'cjs', platform: 'node', write: false }).outputFiles[0].text;
const mod = { exports: {} };
new Function('module', 'exports', code)(mod, mod.exports);
const { score } = mod.exports;
const R = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });

test('derecha: el de la misma fila', () => {
  const from = R(640, 453, 204, 76);
  assert.ok(score('right', from, R(858, 453, 204, 76)) < score('right', from, R(858, 543, 204, 76)));
});

test('derecha: sin saltos en diagonal (Omitir no va a ⌫)', () => {
  assert.equal(score('right', R(862, 835, 152, 56), R(1076, 723, 204, 76)), Infinity);
});

test('abajo: de una tecla a la de abajo, no a la de al lado', () => {
  const from = R(858, 453, 204, 76);
  assert.ok(score('down', from, R(858, 543, 204, 76)) < score('down', from, R(1076, 543, 204, 76)));
});

test('nunca hacia atrás', () => {
  assert.equal(score('left', R(858, 453, 204, 76), R(1076, 453, 204, 76)), Infinity);
  assert.equal(score('up', R(858, 543, 204, 76), R(858, 723, 204, 76)), Infinity);
});

test('del menú de arriba a la fila de abajo aunque no estén alineados', () => {
  assert.ok(Number.isFinite(score('down', R(204, 30, 76, 50), R(80, 500, 260, 56))));
});
