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
let panelFixed = true; // false = panel del 14 de noviembre (sin «fixed»)
let storageBroken = false; // true = el almacenamiento no se puede leer (recién cerrada la app de golpe)
const MAC = /^[0-9A-F]{2}(:[0-9A-F]{2}){5,7}$/;
function fakePanel(action, data) {
  asked.push([action, data.mac_address, data.fresh ? 'fresh' : '']);
  if (action === 'device_id') {
    if (!panelKnows) return { code: 400, body: JSON.stringify({ error: 'Invalid action' }) };
    const t = data.tenant || '';
    let use = data.mac_address;
    if (data.fixed && panelFixed) {
      const base = MAC.test(data.base || '') ? data.base : '';
      const mac = MAC.test(use) ? use : base;
      let al = '';
      for (const k of data.hw) if (alias.has(t + '|' + k)) { al = alias.get(t + '|' + k); break; }
      use = [...new Set([mac, al, base].filter(Boolean))].find(c => lines.has(c)) || base || al || mac;
    } else if (data.fresh) for (const k of data.hw) if (alias.has(t + '|' + k)) { use = alias.get(t + '|' + k); break; }
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
    getAllKeys: async () => { if (storageBroken) throw new Error('ocupado'); return [...disk.keys()]; },
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
  if (request === './util' || request === '../lib/util') return { normalizeBase: s => s, str: v => (v == null ? '' : String(v)) };
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
// (como App.tsx: lo guardado, el identificador y el número que dice el panel, antes de la primera pantalla)
async function open() {
  for (const f of ['../src/lib/storage.ts', '../src/lib/deviceid.ts', '../src/api/panel.ts']) delete require.cache[require.resolve(f)];
  const storage = require('../src/lib/storage.ts');
  const dev = require('../src/lib/deviceid.ts');
  const panel = require('../src/api/panel.ts');
  await storage.loadStorage();
  await dev.prepareDeviceId();
  await panel.deviceSync();
  await tick();
  return { dev, panel, storage };
}
const reset = () => { disk = new Map(); alias = new Map(); lines = new Map(); asked = []; tenant = ''; panelKnows = true; panelFixed = true; storageBroken = false; vendor = UUID('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'); };
const V = () => require('../src/lib/deviceid.ts').idFromUuid(vendor);


test('2.5.0: la app se cierra de golpe y al volver a abrir no puede leer lo guardado: el número sigue siendo el registrado (no uno nuevo)', async () => {
  reset();
  const OLD = 'AB:CD:EF:01:23:45:67:89'; // registrado con un número al azar de una versión anterior
  disk.set('latmpx:device_id', OLD);
  disk.set('latmpx:device_id_src', 'r');
  lines.set(OLD, 'cliente1');
  let { dev, panel } = await open();
  assert.equal(dev.deviceId(), OLD);
  assert.equal((await panel.panelCheckMac(dev.deviceId()))?.user, 'cliente1');
  // cierre de golpe: el almacenamiento no contesta al volver a abrir
  storageBroken = true;
  ({ dev, panel } = await open());
  assert.equal(dev.deviceId(), OLD, 'el panel devuelve el número registrado');
  assert.equal((await panel.panelCheckMac(dev.deviceId()))?.user, 'cliente1', 'entra con su línea');
  assert.equal(disk.get('latmpx:device_id'), OLD, 'no se escribió nada encima');
  // vuelve a funcionar el almacenamiento: igual
  storageBroken = false;
  ({ dev } = await open());
  assert.equal(dev.deviceId(), OLD);
});

test('2.5.0: equipo nuevo: el número es el de Amazon y es el mismo en cada inicio, al reinstalar y tras un cierre de golpe', async () => {
  reset();
  let { dev, panel } = await open();
  const id = dev.deviceId();
  assert.equal(id, V());
  await panel.panelSubmit(id, 'cliente2', 'p', 'http://srv.test:80');
  for (const step of ['inicio', 'reinstalar', 'cierre', 'inicio']) {
    if (step === 'reinstalar') disk = new Map();
    storageBroken = step === 'cierre';
    ({ dev, panel } = await open());
    assert.equal(dev.deviceId(), id, step);
    assert.equal((await panel.panelCheckMac(dev.deviceId()))?.user, 'cliente2', step);
  }
});

test('2.5.0: equipo registrado con número al azar se reinstala: recupera ese número (una línea, no dos)', async () => {
  reset();
  const OLD = '3C:4D:5E:6F:70:81:92:A3';
  disk.set('latmpx:device_id', OLD);
  disk.set('latmpx:device_id_src', 'r');
  lines.set(OLD, 'cliente9');
  await open();
  disk = new Map();
  const { dev, panel } = await open();
  assert.equal(dev.deviceId(), OLD);
  assert.equal(disk.get('latmpx:device_id'), OLD, 'queda guardado');
  assert.equal((await panel.panelCheckMac(dev.deviceId()))?.user, 'cliente9');
  assert.equal(lines.size, 1);
});

test('2.5.0: número al azar guardado que nunca se registró: pasa al de Amazon (ya no depende de nada guardado)', async () => {
  reset();
  disk.set('latmpx:device_id', '5E:5E:5E:5E:5E:5E:5E:5E');
  disk.set('latmpx:device_id_src', 'r');
  const { dev } = await open();
  assert.equal(dev.deviceId(), V());
  assert.equal(disk.get('latmpx:device_id'), V());
});

test('2.5.0: panel del 14 de noviembre (sin «fixed»): con lo guardado perdido igual le devuelve el número de antes', async () => {
  reset();
  panelFixed = false;
  const OLD = '7A:11:22:33:44:55:66:77';
  disk.set('latmpx:device_id', OLD);
  lines.set(OLD, 'c');
  await open();
  storageBroken = true;
  const { dev } = await open();
  assert.equal(dev.deviceId(), OLD);
});

test('panel sin la función (viejo): el número guardado o el de Amazon, sin preguntar en cada pedido', async () => {
  reset();
  panelKnows = false;
  let { dev, panel } = await open();
  const id = dev.deviceId();
  assert.equal(id, V());
  await panel.panelCheckMac(id);
  await panel.panelCheckMac(id);
  assert.equal(asked.filter(a => a[0] === 'device_id').length, 1);
  storageBroken = true;
  ({ dev } = await open());
  assert.equal(dev.deviceId(), id, 'cierre de golpe: el mismo (sale de Amazon)');
});

test('cada distribuidor tiene sus claves', async () => {
  reset();
  const OLD = '7A:11:22:33:44:55:66:77';
  disk.set('latmpx:device_id', OLD);
  lines.set(OLD, 'c');
  tenant = '111111';
  await open();
  assert.deepEqual([...alias.keys()].map(k => k.split('|')[0]), ['111111']);
  disk = new Map();
  tenant = '222222';
  let { dev, panel } = await open();
  assert.equal(dev.deviceId(), V(), 'otro distribuidor no conoce el equipo');
  tenant = '111111';
  await panel.panelCheckMac(dev.deviceId());
  assert.equal(dev.deviceId(), OLD, 'con el distribuidor correcto vuelve el de antes');
});

test('sin identificador de Amazon: uno al azar guardado que no cambia entre inicios; uno armado antes de leer lo guardado no se guarda', async () => {
  reset();
  vendor = UUID('00000000-0000-0000-0000-000000000000');
  for (const f of ['../src/lib/storage.ts', '../src/lib/deviceid.ts']) delete require.cache[require.resolve(f)];
  const early = require('../src/lib/deviceid.ts').deviceId();
  assert.equal(disk.size, 0, 'nada guardado antes de leer lo guardado');
  let { dev } = await open();
  const r = dev.deviceId();
  assert.match(r, MAC);
  assert.notEqual(r, early);
  for (let i = 0; i < 3; i++) {
    ({ dev } = await open());
    assert.equal(dev.deviceId(), r);
  }
  // con identificador de Amazon y un número guardado: el guardado no le gana a uno armado antes de tiempo
  reset();
  disk.set('latmpx:device_id', 'AB:CD:EF:01:23:45:67:89');
  lines.set('AB:CD:EF:01:23:45:67:89', 'c');
  for (const f of ['../src/lib/storage.ts', '../src/lib/deviceid.ts', '../src/api/panel.ts']) delete require.cache[require.resolve(f)];
  const storage = require('../src/lib/storage.ts');
  const d2 = require('../src/lib/deviceid.ts');
  d2.deviceId();
  await storage.loadStorage();
  await d2.prepareDeviceId();
  assert.equal(d2.deviceId(), 'AB:CD:EF:01:23:45:67:89');
});

test('el objeto Uuid de Vega se lee por sus bytes', async () => {
  reset();
  const { dev } = await open();
  assert.equal(dev.deviceId(), dev.idFromUuid('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'));
  assert.equal(dev.idFromUuid({ bytes: [1, 2, 3] }), '');
  assert.equal(dev.idFromUuid({}), '');
  assert.equal(dev.idFromUuid(String({ bytes: [] })), '');
});
