// VIDAA (src/lib/http.ts): la app es una página alojada en el panel. El panel se pide en la misma dirección que la
// página (sin CORS); player_api.php del servidor IPTV va primero directo y, si el navegador no lo deja (CORS), por
// api/xtream_relay.php del panel, y ese servidor sigue por el relevo. El video y lo demás nunca van por el relevo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const code = esbuild.buildSync({
  stdin: { contents: "export { http, samePage, xtreamHost } from './src/lib/http';", resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  alias: {
    'react-native': path.join(root, 'web/shims/react-native.tsx'),
    '@react-native-async-storage/async-storage': path.join(root, 'web/shims/async-storage.ts'),
  },
}).outputFiles[0].text;

const calls = [];
let cors = new Set(); // servidores que el navegador deja leer directo
globalThis.location = { protocol: 'http:', host: 'panel.test', hostname: 'panel.test', href: 'http://panel.test/vidaa/index.html' };
globalThis.fetch = async url => {
  calls.push(url);
  const host = url.match(/^https?:\/\/([^/?#]+)/)[1];
  if (host === 'panel.test') {
    if (url.includes('/api/xtream_relay.php')) {
      const u = decodeURIComponent(url.split('?u=')[1]);
      if (u.includes('nolist.test')) return new Response('{"relay_error":"server_not_allowed"}', { status: 502 });
      return new Response('{"via":"relay","u":' + JSON.stringify(u) + '}', { status: 200 });
    }
    return new Response('{"panel":true}', { status: 200 });
  }
  if (!cors.has(host)) throw new TypeError('Failed to fetch'); // CORS
  return new Response('{"via":"direct"}', { status: 200 });
};
const m = { exports: {} };
new Function('module', 'exports', 'require', code)(m, m.exports, require);
const { http, samePage, xtreamHost } = m.exports;

test('el panel se pide en la misma dirección que la página (esquema y puerto de la página)', async () => {
  assert.equal(samePage('https://panel.test/api/login.php?lang=es'), 'http://panel.test/api/login.php?lang=es');
  assert.equal(samePage('https://otro.test/api/login.php'), 'https://otro.test/api/login.php');
  calls.length = 0;
  const r = await http('https://panel.test/api/progress.php');
  assert.equal(r.ok, true);
  assert.deepEqual(calls, ['http://panel.test/api/progress.php']);
});

test('player_api.php sin CORS va por el relevo del panel, y ese servidor sigue por el relevo', async () => {
  assert.equal(xtreamHost('http://iptv.test:8080/player_api.php?username=u&password=p'), 'iptv.test:8080');
  assert.equal(xtreamHost('http://iptv.test:8080/live/u/p/1.m3u8'), '');
  calls.length = 0;
  const url = 'http://iptv.test:8080/player_api.php?username=u&password=p&action=get_live_streams';
  const r = await http(url);
  assert.equal(JSON.parse(r.body).via, 'relay');
  assert.equal(JSON.parse(r.body).u, url);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].startsWith('http://panel.test/api/xtream_relay.php?u='));
  calls.length = 0;
  await http(url);
  assert.equal(calls.length, 1, 'la segunda vez va directo al relevo');
});

test('un servidor con CORS va directo (sin relevo)', async () => {
  cors = new Set(['cors.test']);
  calls.length = 0;
  const r = await http('http://cors.test/player_api.php?username=u&password=p');
  assert.equal(JSON.parse(r.body).via, 'direct');
  assert.equal(calls.length, 1);
});

test('el video y otras direcciones nunca van por el relevo', async () => {
  calls.length = 0;
  const r = await http('http://iptv.test:8080/movie/u/p/5.mp4');
  assert.equal(r.code, 0);
  assert.ok(calls.every(c => !c.includes('xtream_relay')));
});

test('si el relevo no acepta el servidor, queda como sin conexión', async () => {
  calls.length = 0;
  const r = await http('http://nolist.test/player_api.php?username=u&password=p');
  assert.equal(r.code, 0);
  assert.equal(r.ok, false);
});
