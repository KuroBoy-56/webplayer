// Identificador fijo del televisor con el panel (src/lib/deviceid.ts + src/api/panel.ts «device_id»), de punta a punta:
// almacenamiento, identificador del fabricante y un panel de mentira que hace lo mismo que includes/device_alias.php.
// Sin televisor ni red.
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

// ---- el televisor: lo guardado por la app (se borra al desinstalar) y su identificador de fábrica (no se borra) ----
let disk = new Map();
const TV = '4A:5B:6C:7D:8E:9F';
let tv = TV;
let tenant = '';
// ---- el panel: claves fijas → identificador, líneas registradas por identificador, pedidos recibidos ----
let alias = new Map();
let lines = new Map();
let asked = [];
let panelKnows = true; // false = panel viejo, sin la acción «device_id»
const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5,7}$/;
function fakePanel(action, data) {
  asked.push([action, data.mac_address, data.fresh ? 'fresh' : '']);
  if (action === 'device_id') {
    if (!panelKnows) return { code: 400, body: JSON.stringify({ error: 'Invalid action' }) };
    const t = data.tenant || '';
    let use = data.mac_address;
    if (data.fresh) for (const k of data.hw) if (alias.has(t + '|' + k)) { use = alias.get(t + '|' + k); break; }
    for (const k of data.hw) alias.set(t + '|' + k, use);
    return { code: 200, body: JSON.stringify({ status: 'ok', device_id: use }) };
  }
  if (action === 'check_mac') {
    const ln = lines.get(data.mac_address);
    return { code: 200, body: JSON.stringify(ln ? { exists: true, url: 'http://srv.test:80', username: ln, password: 'p' } : { exists: false }) };
  }
  if (action === 'submit_url') {
    lines.set(data.mac_address, data.username);
    return { code: 200, body: JSON.stringify({ status: 'ok' }) };
  }
  return { code: 400, body: '{}' };
}
Module._load = function (request, parent, isMain) {
  if (request === '@react-native-async-storage/async-storage') return { __esModule: true, default: {
    getAllKeys: async () => [...disk.keys()],
    multiGet: async ks => ks.map(k => [k, disk.get(k) ?? null]),
    setItem: async (k, v) => { disk.set(k, v); },
    removeItem: async k => { disk.delete(k); },
  } };
  if (request === './platform' || request === '../lib/platform') return { tvMac: () => tv, tvAltKey: () => '', tvModel: () => 'TV', tvOs: () => 'OS' };
  if (request === '../lib/aes') return { hasMasterKey: () => true, panelEncrypt: s => s, panelDecrypt: s => s };
  if (request === '../lib/crypto') return { decodePanelUrl: () => 'https://panel.test/api/', dnsDecode: s => s, mopeDecrypt: s => s, mopeEncrypt: s => s };
  if (request === '../lib/i18n' || request === './i18n') return { lang: () => 'es', t: k => k };
  if (request === '../lib/cacheclear') return { cacheSeen: () => 0, takeCacheOrder: () => false };
  if (request === '../lib/tenant') return { APP_ID: 'tv', parseConfig: () => null, reportTenantProblem() {}, scoped: k => k, TENANT_ERRORS: {}, TENANT_FATAL: [], tenantCode: () => tenant, tenantFields: () => (tenant ? { tenant, app: 'tv' } : {}) };
  if (request === '../lib/http') return {
    formBody: o => JSON.stringify(o),
    json: r => { try { return JSON.parse(r.body); } catch { return null; } },
    http: async (url, opts) => {
      const f = JSON.parse(opts.body);
      const r = fakePanel(f.action, JSON.parse(f.data));
      return { ...r, ok: r.code === 200 };
    },
  };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  Module._load = originalLoad;
  require.extensions['.ts'] = previousTs;
});
// abre la app: módulos nuevos (como un proceso nuevo) y lee lo guardado
async function open() {
  for (const f of ['../src/lib/storage.ts', '../src/lib/deviceid.ts', '../src/api/panel.ts']) delete require.cache[require.resolve(f)];
  const storage = require('../src/lib/storage.ts');
  const dev = require('../src/lib/deviceid.ts');
  const panel = require('../src/api/panel.ts');
  await storage.loadStorage();
  return { dev, panel };
}
const reset = () => { disk = new Map(); alias = new Map(); lines = new Map(); asked = []; tenant = ''; panelKnows = true; tv = TV; };

test('televisor nuevo: el número sale del identificador de fábrica y es el mismo después de reinstalar', async () => {
  reset();
  let { dev, panel } = await open();
  const id = dev.deviceId();
  assert.equal(id, TV);
  assert.equal(await panel.panelCheckMac(id), null);
  await panel.panelSubmit(id, 'cliente1', 'p', 'http://srv.test:80');
  dev.deviceRegistered();
  // desinstalar y volver a instalar: nada guardado
  disk = new Map();
  ({ dev, panel } = await open());
  assert.equal(dev.deviceId(), TV);
  const ln = await panel.panelCheckMac(dev.deviceId());
  assert.equal(ln && ln.user, 'cliente1', 'entra con su línea sin escribir usuario y contraseña');
});

test('televisor registrado con un número al azar (versión anterior): se respeta y, al reinstalar, el panel devuelve ese mismo número', async () => {
  reset();
  const OLD = 'AB:CD:EF:01:23:45:67:89';
  disk.set('latmpx:device_id', OLD);
  lines.set(OLD, 'cliente2');
  let { dev, panel } = await open();
  assert.equal(dev.deviceId(), OLD, 'el guardado no se cambia: el panel lo tiene registrado');
  let ln = await panel.panelCheckMac(dev.deviceId());
  assert.equal(ln && ln.user, 'cliente2');
  assert.deepEqual(asked.map(a => a.join(' ')), ['device_id ' + OLD + ' ', 'check_mac ' + OLD + ' ']);
  // otro inicio: ya no se consulta de nuevo
  asked = [];
  ({ dev, panel } = await open());
  await panel.panelCheckMac(dev.deviceId());
  assert.deepEqual(asked.map(a => a[0]), ['check_mac']);
  // se reinstala: la pantalla ya tiene en la mano el número de fábrica; el panel devuelve el registrado
  disk = new Map();
  asked = [];
  ({ dev, panel } = await open());
  const first = dev.deviceId();
  assert.equal(first, TV);
  ln = await panel.panelCheckMac(first);
  assert.equal(ln && ln.user, 'cliente2', 'entra con su línea sin escribir usuario y contraseña');
  assert.deepEqual(asked.map(a => a.join(' ')), ['device_id ' + TV + ' fresh', 'check_mac ' + OLD + ' ']);
  assert.equal(dev.deviceId(), OLD);
  // y queda así en los inicios siguientes
  ({ dev, panel } = await open());
  assert.equal(dev.deviceId(), OLD);
});

test('el televisor no da su identificador en la primera apertura: número al azar marcado; cuando lo da, se cambia por el fijo (si todavía no se inició sesión)', async () => {
  reset();
  tv = '';
  let { dev, panel } = await open();
  const rnd = dev.deviceId();
  assert.match(rnd, MAC);
  assert.equal(dev.deviceId(), rnd);
  assert.equal(disk.get('latmpx:device_id_src'), 'r');
  await panel.panelCheckMac(rnd);
  assert.deepEqual(asked.map(a => a[0]), ['check_mac'], 'sin clave fija no se consulta nada más');
  // siguiente apertura: el televisor contesta
  tv = TV;
  ({ dev, panel } = await open());
  assert.equal(dev.deviceId(), TV);
  assert.equal(disk.get('latmpx:device_id_src'), 'h');
  // otro televisor: igual, pero el cliente inició sesión con el número al azar antes de que el televisor contestara
  reset();
  tv = '';
  ({ dev, panel } = await open());
  const reg = dev.deviceId();
  await panel.panelSubmit(reg, 'cliente3', 'p', 'http://srv.test:80');
  dev.deviceRegistered();
  tv = TV;
  ({ dev, panel } = await open());
  assert.equal(dev.deviceId(), reg, 'ya registrado: no se cambia');
  let ln = await panel.panelCheckMac(dev.deviceId());
  assert.equal(ln && ln.user, 'cliente3');
  // y al reinstalar lo recupera por la clave fija
  disk = new Map();
  ({ dev, panel } = await open());
  ln = await panel.panelCheckMac(dev.deviceId());
  assert.equal(dev.deviceId(), reg);
  assert.equal(ln && ln.user, 'cliente3');
});

test('panel sin la función (viejo): todo sigue como antes y no se pregunta en cada pedido; cada distribuidor tiene sus claves', async () => {
  reset();
  panelKnows = false;
  let { dev, panel } = await open();
  const id = dev.deviceId();
  await panel.panelCheckMac(id);
  await panel.panelCheckMac(id);
  await panel.panelCheckMac(id);
  assert.equal(dev.deviceId(), TV);
  assert.equal(asked.filter(a => a[0] === 'device_id').length, 1);
  assert.equal(asked.filter(a => a[0] === 'check_mac').length, 3);
  // distribuidores
  reset();
  const OLD = '7A:11:22:33:44:55:66:77';
  disk.set('latmpx:device_id', OLD);
  tenant = '111111';
  ({ dev, panel } = await open());
  await panel.panelCheckMac(dev.deviceId());
  disk = new Map();
  tenant = '222222';
  ({ dev, panel } = await open());
  await panel.panelCheckMac(dev.deviceId());
  assert.equal(dev.deviceId(), TV, 'otro distribuidor no conoce el equipo');
  tenant = '111111';
  await panel.panelCheckMac(dev.deviceId());
  assert.equal(dev.deviceId(), OLD, 'con su distribuidor (todavía sin iniciar sesión) vuelve el de antes');
});
