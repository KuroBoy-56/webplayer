// Identificador fijo del equipo con el panel (src/lib/deviceid.ts + src/api/panel.ts «device_id»), de punta a punta:
// almacenamiento, identificador de Vega y un panel de mentira que hace lo mismo que includes/device_alias.php.
// Sin Vega ni red.
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

// ---- el equipo: lo guardado por la app (se borra al desinstalar) y el identificador de Vega (no se borra) ----
let disk = new Map();
// el identificador de vendedor de Vega, como lo entrega el sistema: un objeto Uuid con 16 bytes
const UUID = (hex) => ({ bytes: hex.replace(/-/g, '').match(/../g).map(h => parseInt(h, 16)) });
let vendor = UUID('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');
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
  if (request === '@amazon-devices/kepler-identifiers') return { KeplerIdentifiers: { getVendorTrackingId: async () => vendor } };
  if (request === '../lib/aes') return { hasMasterKey: () => true, panelEncrypt: s => s, panelDecrypt: s => s };
  if (request === '../lib/crypto') return { decodePanelUrl: () => 'https://panel.test/api/', dnsDecode: s => s, mopeDecrypt: s => s, mopeEncrypt: s => s };
  if (request === '../lib/i18n' || request === './i18n') return { lang: () => 'es', t: k => k };
  if (request === '../lib/cacheclear') return { cacheSeen: () => 0, takeCacheOrder: () => false };
  if (request === '../lib/tenant') return { APP_ID: 'vega', parseConfig: () => null, reportTenantProblem() {}, scoped: k => k, TENANT_ERRORS: {}, TENANT_FATAL: [], tenantCode: () => tenant, tenantFields: () => (tenant ? { tenant, app: 'vega' } : {}) };
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
const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
// abre la app: módulos nuevos (como un proceso nuevo), lee lo guardado y prepara el identificador
async function open() {
  for (const f of ['../src/lib/storage.ts', '../src/lib/deviceid.ts', '../src/api/panel.ts']) delete require.cache[require.resolve(f)];
  const storage = require('../src/lib/storage.ts');
  const dev = require('../src/lib/deviceid.ts');
  const panel = require('../src/api/panel.ts');
  await storage.loadStorage();
  await dev.prepareDeviceId();
  await tick();
  return { dev, panel };
}
const reset = () => { disk = new Map(); alias = new Map(); lines = new Map(); asked = []; tenant = ''; panelKnows = true; vendor = UUID('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'); };

test('equipo registrado con un número al azar (antes de la 2.1.6): al reinstalar, el panel le devuelve ese mismo número y entra con su línea', async () => {
  reset();
  const OLD = 'AB:CD:EF:01:23:45:67:89';
  disk.set('latmpx:device_id', OLD);
  lines.set(OLD, 'cliente1');
  // la app se actualiza: sigue con su número y deja anotada su clave fija
  let { dev, panel } = await open();
  assert.equal(dev.deviceId(), OLD);
  let ln = await panel.panelCheckMac(dev.deviceId());
  assert.equal(ln && ln.user, 'cliente1');
  assert.deepEqual(asked.map(a => a.join(' ')), ['device_id ' + OLD + ' ', 'check_mac ' + OLD + ' ']);
  assert.equal(alias.size, 1);
  // otro pedido y otro inicio: ya no se vuelve a consultar
  asked = [];
  await panel.panelCheckMac(dev.deviceId());
  ({ dev, panel } = await open());
  await panel.panelCheckMac(dev.deviceId());
  assert.ok(asked.every(a => a[0] === 'check_mac'), JSON.stringify(asked));
  // se desinstala y se vuelve a instalar: nada guardado; la pantalla ya tiene en la mano el identificador de Vega
  disk = new Map();
  asked = [];
  ({ dev, panel } = await open());
  const fromVega = dev.deviceId();
  assert.notEqual(fromVega, OLD);
  assert.equal(fromVega, dev.idFromUuid(vendor));
  ln = await panel.panelCheckMac(fromVega);
  assert.equal(ln && ln.user, 'cliente1', 'entra con su línea sin escribir usuario y contraseña');
  assert.deepEqual(asked.map(a => a.join(' ')), ['device_id ' + fromVega + ' fresh', 'check_mac ' + OLD + ' ']);
  assert.equal(dev.deviceId(), OLD, 'el número del equipo vuelve a ser el registrado');
  assert.equal(disk.get('latmpx:device_id'), OLD);
  // y queda así en los inicios siguientes, sin más consultas
  asked = [];
  ({ dev, panel } = await open());
  assert.equal(dev.deviceId(), OLD);
  await panel.panelCheckMac(dev.deviceId());
  assert.deepEqual(asked.map(a => a[0]), ['check_mac']);
});

test('equipo nuevo: se queda con el identificador de Vega; reinstalar da el mismo; con sesión iniciada no se cambia por otro', async () => {
  reset();
  let { dev, panel } = await open();
  const id = dev.deviceId();
  assert.equal(id, dev.idFromUuid(vendor));
  assert.equal(await panel.panelCheckMac(id), null);
  assert.equal(dev.deviceId(), id);
  assert.equal(dev.deviceFresh(), true);
  await panel.panelSubmit(id, 'cliente2', 'p', 'http://srv.test:80');
  dev.deviceRegistered();
  assert.equal(dev.deviceFresh(), false);
  assert.equal(lines.get(id), 'cliente2');
  disk = new Map();
  ({ dev, panel } = await open());
  const ln = await panel.panelCheckMac(dev.deviceId());
  assert.equal(dev.deviceId(), id);
  assert.equal(ln && ln.user, 'cliente2');
});

test('panel sin la función (viejo) o que no contesta: todo sigue como antes y no se pregunta en cada pedido', async () => {
  reset();
  panelKnows = false;
  const { dev, panel } = await open();
  const id = dev.deviceId();
  await panel.panelCheckMac(id);
  await panel.panelCheckMac(id);
  await panel.panelCheckMac(id);
  assert.equal(dev.deviceId(), id);
  assert.equal(asked.filter(a => a[0] === 'device_id').length, 1);
  assert.equal(asked.filter(a => a[0] === 'check_mac').length, 3);
  // cuando el panel se actualiza, en el inicio siguiente se consulta
  panelKnows = true;
  asked = [];
  const again = await open();
  await again.panel.panelCheckMac(again.dev.deviceId());
  assert.equal(asked[0][0], 'device_id');
});

test('cada distribuidor tiene sus claves; sin identificador de Vega (apagado por el usuario) no se consulta nada', async () => {
  reset();
  const OLD = '7A:11:22:33:44:55:66:77';
  disk.set('latmpx:device_id', OLD);
  tenant = '111111';
  let { dev, panel } = await open();
  await panel.panelCheckMac(dev.deviceId());
  assert.deepEqual([...alias.keys()].map(k => k.split('|')[0]), ['111111']);
  // reinstala y escribe OTRO distribuidor: ese no conoce el equipo, se queda con el de Vega
  disk = new Map();
  tenant = '222222';
  ({ dev, panel } = await open());
  const v = dev.deviceId();
  await panel.panelCheckMac(v);
  assert.equal(dev.deviceId(), v);
  // corrige el número de distribuidor (todavía sin iniciar sesión): ahora sí vuelve el de antes
  tenant = '111111';
  await panel.panelCheckMac(dev.deviceId());
  assert.equal(dev.deviceId(), OLD);
  // sin el identificador de Vega: al azar como antes, sin consultar al panel
  reset();
  vendor = UUID('00000000-0000-0000-0000-000000000000');
  ({ dev, panel } = await open());
  const r = dev.deviceId();
  assert.match(r, MAC);
  await panel.panelCheckMac(r);
  assert.deepEqual(asked.map(a => a[0]), ['check_mac']);
});

test('2.1.12: el objeto Uuid de Vega se lee por sus bytes (antes salía «[object Object]» y cada instalación tenía otro número al azar)', async () => {
  reset();
  let { dev } = await open();
  const a = dev.deviceId();
  assert.equal(a, dev.idFromUuid('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'), 'mismo número que el texto del mismo UUID');
  assert.equal(disk.get('latmpx:device_id_src'), 'v');
  // reinstalar 3 veces: siempre el mismo número (un solo registro en el panel)
  for (let i = 0; i < 3; i++) {
    disk = new Map();
    ({ dev } = await open());
    assert.equal(dev.deviceId(), a);
  }
  assert.equal(dev.idFromUuid({ bytes: [1, 2, 3] }), '', 'bytes que no son 16: no sirve');
  assert.equal(dev.idFromUuid({}), '');
  assert.equal(dev.idFromUuid(String({ bytes: [] })), '', 'lo que hacía la 2.1.11');
});

test('2.1.12: un equipo de una versión anterior con número al azar lo conserva (el panel lo tiene registrado) y deja anotada su clave fija; al reinstalar el panel le devuelve ese número', async () => {
  reset();
  const OLD = '3C:4D:5E:6F:70:81:92:A3';
  disk.set('latmpx:device_id', OLD);
  disk.set('latmpx:device_id_src', 'r'); // así lo dejaban la 2.1.6 a 2.1.11 (sin la marca de «nuevo»)
  lines.set(OLD, 'cliente9');
  let { dev, panel } = await open();
  assert.equal(dev.deviceId(), OLD, 'no se cambia: la sesión del cliente sigue');
  assert.deepEqual(dev.hwKeys(), ['v' + dev.idFromUuid(vendor).replace(/:/g, '')]);
  await panel.panelCheckMac(dev.deviceId());
  disk = new Map();
  ({ dev, panel } = await open());
  const ln = await panel.panelCheckMac(dev.deviceId());
  assert.equal(dev.deviceId(), OLD);
  assert.equal(ln && ln.user, 'cliente9');
});
