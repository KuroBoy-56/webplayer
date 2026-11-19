// Perfil infantil (src/lib/kids.ts, docs/PERFILES.md del panel, sección 5) e inicio de sesión de a una DNS
// (loginAll en src/api/xtream.ts, docs/LOGIN-SERVIDORES.md del panel). `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');
// los módulos del equipo (almacenamiento, idioma del sistema, red) se cambian por piezas de prueba
const STUBS = {
  '@react-native-async-storage/async-storage': 'const m = new Map(); export default { getAllKeys: async () => [...m.keys()], multiGet: async k => k.map(x => [x, m.get(x) ?? null]), setItem: async (k, v) => void m.set(k, v), removeItem: async k => void m.delete(k) };',
  '@amazon-devices/react-native-kepler': 'export const I18nManager = {};',
  'react-native': 'export const Platform = { OS: "web" }; export const Dimensions = { get: () => ({ width: 1920, height: 1080 }), addEventListener() { return { remove() {} }; } }; export const PixelRatio = { get: () => 1 }; export const StyleSheet = { create: s => s }; export const AppState = { currentState: "active", addEventListener() { return { remove() {} }; } };',
  react: 'export const useSyncExternalStore = () => 0; export default {};',
};
async function load(file) {
  const code = (await esbuild.build({
    stdin: { contents: "export * from './" + file + "';", resolveDir: root, loader: 'ts' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          b.onResolve({ filter: /.*/ }, a => (STUBS[a.path] !== undefined ? { path: a.path, namespace: 'stub' } : /lib\/http$/.test(a.path) ? { path: 'http', namespace: 'stub' } : undefined));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({
            contents: a.path === 'http' ? 'export const UA = "test"; export const http = (...x) => globalThis.__http(...x); export const json = r => { try { return JSON.parse(r.body); } catch { return null; } }; export const formBody = f => new URLSearchParams(f).toString();' : STUBS[a.path],
            loader: 'ts',
          }));
        },
      },
    ],
  })).outputFiles[0].text;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  return m.exports;
}

let kids;
const { before } = require('node:test');
before(async () => {
  kids = await load('src/lib/kids');
});

test('perfil infantil: clase de cada categoría por su nombre', () => {
  assert.strictEqual(kids.catClass('INFANTILES'), 'kids');
  assert.strictEqual(kids.catClass('ANIMADAS'), 'kids');
  assert.strictEqual(kids.catClass('DISNEY+'), 'disney');
  assert.strictEqual(kids.catClass('PELÍCULAS DE FAMILIA'), 'family');
  assert.strictEqual(kids.catClass('TERROR'), 'block');
  assert.strictEqual(kids.catClass('MARVEL'), 'block');
  assert.strictEqual(kids.catClass('ADULTOS +18'), 'block');
  assert.strictEqual(kids.catClass('ESTRENOS 2024'), '');
  // «para niños» salva una categoría bloqueada
  assert.strictEqual(kids.catClass('ANIME INFANTIL'), 'kids');
  // TV en vivo: solo las de niños (familia no cuenta)
  assert.strictEqual(kids.catClass('INFANTILES', true), 'kids');
  assert.strictEqual(kids.catClass('DEPORTES', true), '');
});

test('perfil infantil: nivel de cada título (tabla de ejemplos del panel)', () => {
  const L = (name, genre, cats) => kids.itemLevel(name, genre, cats.map(c => kids.catClass(c)));
  assert.strictEqual(L('Toy Story 4', '', ['INFANTILES']), 'strong');
  assert.strictEqual(L('Shrek', 'Animación, Comedia', ['ANIMADAS']), 'strong');
  assert.strictEqual(L('Moana 2', 'Animación, Familia', ['DISNEY+']), 'strong');
  assert.strictEqual(L('Frozen II', '', ['DISNEY+']), 'weak');
  assert.strictEqual(L('Mírame así, el camino de Noa', 'Comedia, Familia, Telenovela', ['SERIES NUEVAS']), 'weak');
  assert.strictEqual(L('Rick y Morty: la película', 'Animación, Comedia', ['ANIMADAS']), '');
  assert.strictEqual(L('Deadpool & Wolverine', 'Acción, Comedia', ['ESTRENOS 2024']), '');
  assert.strictEqual(L('Thor: amor y trueno', '', ['MARVEL']), '');
  assert.strictEqual(L('Loki', '', ['DISNEY+']), '');
  // lo dudoso solo con el «ok» de TMDB; lo seguro salvo que TMDB diga «no»
  assert.strictEqual(kids.ratePass('weak', ''), false);
  assert.strictEqual(kids.ratePass('weak', 'ok'), true);
  assert.strictEqual(kids.ratePass('strong', ''), true);
  assert.strictEqual(kids.ratePass('strong', 'no'), false);
  assert.strictEqual(kids.blockedName('Canal XXX'), true);
  assert.strictEqual(kids.blockedName('Disney Channel'), false);
});

test('perfil infantil: clave para TMDB por id o por nombre y año, de hasta 64 caracteres', () => {
  assert.strictEqual(kids.rateKey('vod', 'Toy Story 4', '2019', '301528'), 'm:301528');
  const k = kids.rateKey('series', 'Bluey', '2018', '');
  assert.match(k, /^sn:[0-9a-f]{16}$/);
  assert.strictEqual(kids.rateKey('series', 'BLUEY', '2018', ''), k);
});

test('inicio de sesión: de a una DNS, sin repetir servidor, https solo si http no contestó, la última buena primero', async () => {
  const xt = await load('src/api/xtream');
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const ok = JSON.stringify({ user_info: { auth: 1, status: 'Active', exp_date: '0', max_connections: '2' } });
  const no = JSON.stringify({ user_info: { auth: 0 } });
  globalThis.__http = async url => {
    const host = url.replace(/^([a-z]+:\/\/[^/]+).*$/, '$1');
    calls.push(host);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise(r => setTimeout(r, 5));
    inFlight--;
    if (host === 'http://caido.com') return { code: 0, body: '', ok: false };
    if (host === 'https://caido.com') return { code: 0, body: '', ok: false };
    if (host === 'http://otro.com') return { code: 200, body: no, ok: true };
    if (host === 'http://bueno.com') return { code: 200, body: ok, ok: true };
    return { code: 0, body: '', ok: false };
  };
  const list = [
    { name: 'A', base: 'http://caido.com' },
    { name: 'B', base: 'https://otro.com' },
    { name: 'B2', base: 'http://otro.com' },
    { name: 'C', base: 'http://bueno.com' },
    { name: 'D', base: 'http://nunca.com' },
  ];
  const r = await xt.loginAll(list, 'Juan', 'clave');
  assert.ok(r.session, 'entra con el que acepta');
  assert.deepStrictEqual(calls, ['http://caido.com', 'https://caido.com', 'http://otro.com', 'http://bueno.com']);
  assert.strictEqual(maxInFlight, 1, 'nunca dos a la vez');
  calls.length = 0;
  const again = await xt.loginAll(list, 'juan', 'clave');
  assert.ok(again.session);
  assert.deepStrictEqual(calls, ['http://bueno.com'], 'la próxima vez, primero la que funcionó');
  calls.length = 0;
  const bad = await xt.loginAll(list.slice(0, 3), 'otro', 'x');
  assert.strictEqual(bad.session, undefined);
  assert.match(bad.error, /incorrect|wrong/i);
});
