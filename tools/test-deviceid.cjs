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
// la MAC de la tarjeta Wi-Fi como la da NetworkManager.getMacAddress(); macDenied = app sin firmar (sin el permiso)
let wifiMac = 'F0:27:2D:AA:BB:CC';
let macDenied = false;
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
      const reg = [...new Set([mac, al].filter(Boolean))].find(c => c !== base && lines.has(c)) || '';
      const hardReg = d => [...alias.entries()].some(([k, v]) => k.startsWith(t + '|m') && v === d);
      if (!base) use = reg || al || mac;
      else if (lines.has(base)) use = base;
      else if (reg && (data.hard || !hardReg(reg))) {
        lines.set(base, lines.get(reg));
        lines.delete(reg);
        for (const [k, v] of alias) if (v === reg) alias.set(k, base);
        use = base;
      } else use = reg || base;
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
  if (request === '@amazon-devices/kepler-identifiers') return { KeplerIdentifiers: { getVendorTrackingId: async () => { if (vendor instanceof Error) throw vendor; return vendor; } } };
  if (request === '@amazon-devices/keplerscript-netmgr-lib') return {
    Status: { SUCCESS: 0, PERMISSION_DENIED: 4 },
    NetworkInterfaceType: { NONE: 0, WIFI: 1, ETHERNET: 2 },
    NetworkManager: class {
      getNetworkInterfaces(type, list) { list.length = 0; if (type === 1) list.push({ id: 3, name: 'wlan0', type: 1, priority: 0 }); return 0; }
      getMacAddress(id) { return macDenied ? [4, ''] : id === 3 ? [0, wifiMac] : [2, '']; }
    },
  };
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
const reset = () => { disk = new Map(); alias = new Map(); lines = new Map(); asked = []; tenant = ''; panelKnows = true; panelFixed = true; storageBroken = false; vendor = UUID('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'); wifiMac = 'F0:27:2D:AA:BB:CC'; macDenied = false; };
const REAL = 'F0:27:2D:AA:BB:CC';
const V = () => require('../src/lib/deviceid.ts').idFromUuid(vendor);



test('2.6.0: el número es la MAC real del equipo; el mismo en cada inicio, al reinstalar y después de un cierre de golpe', async () => {
  reset();
  let { dev, panel } = await open();
  assert.equal(dev.deviceId(), REAL);
  await panel.panelSubmit(REAL, 'cliente1', 'p', 'http://srv.test:80');
  for (const step of ['inicio', 'cierre', 'reinstalar', 'cierre', 'inicio']) {
    if (step === 'reinstalar') disk = new Map();
    storageBroken = step === 'cierre';
    ({ dev, panel } = await open());
    assert.equal(dev.deviceId(), REAL, step);
    assert.equal((await panel.panelCheckMac(dev.deviceId()))?.user, 'cliente1', step);
  }
  assert.equal(lines.size, 1, 'una sola línea, un solo equipo');
});

test('2.6.0: un equipo registrado con un número al azar de antes pasa a su MAC real sin perder la línea', async () => {
  reset();
  const OLD = 'AB:CD:EF:01:23:45:67:89';
  disk.set('latmpx:device_id', OLD);
  disk.set('latmpx:device_id_src', 'r');
  lines.set(OLD, 'cliente1');
  const { dev, panel } = await open();
  assert.equal(dev.deviceId(), REAL);
  assert.equal(disk.get('latmpx:device_id'), REAL);
  assert.equal(disk.get('latmpx:device_id_src'), 'm');
  assert.equal((await panel.panelCheckMac(dev.deviceId()))?.user, 'cliente1');
  assert.equal(lines.has(OLD), false, 'el número inventado ya no existe');
  const sync = asked.find(a => a[0] === 'device_id');
  assert.ok(sync, JSON.stringify(asked));
});

test('2.6.0: sin el permiso de la MAC (app sin firmar): el identificador de Amazon; el número al azar registrado pasa a ese', async () => {
  reset();
  macDenied = true;
  const OLD = '3C:4D:5E:6F:70:81:92:A3';
  disk.set('latmpx:device_id', OLD);
  lines.set(OLD, 'cliente9');
  let { dev, panel } = await open();
  assert.equal(dev.deviceId(), V());
  assert.equal((await panel.panelCheckMac(dev.deviceId()))?.user, 'cliente9');
  for (const step of ['cierre', 'reinstalar']) {
    if (step === 'reinstalar') disk = new Map();
    storageBroken = step === 'cierre';
    ({ dev } = await open());
    assert.equal(dev.deviceId(), V(), step);
  }
  // la app pasa a estar firmada (tienda): una sola vez, del de Amazon a la MAC real
  storageBroken = false;
  macDenied = false;
  ({ dev, panel } = await open());
  assert.equal(dev.deviceId(), REAL);
  assert.equal((await panel.panelCheckMac(dev.deviceId()))?.user, 'cliente9');
});

test('2.6.0: una apertura en la que el sistema no da la MAC no cambia el número (sigue la MAC)', async () => {
  reset();
  let { dev, panel } = await open();
  await panel.panelSubmit(dev.deviceId(), 'c', 'p', 'http://srv.test:80');
  macDenied = true;
  storageBroken = true;
  ({ dev } = await open());
  assert.equal(dev.deviceId(), REAL);
});

test('2.6.0: nunca un número inventado: sin MAC ni identificador de Amazon no hay número (se sigue intentando)', async () => {
  reset();
  macDenied = true;
  vendor = UUID('00000000-0000-0000-0000-000000000000');
  const { dev } = await open();
  assert.equal(dev.deviceId(), '');
  assert.equal(disk.has('latmpx:device_id'), false);
  // un número de una versión anterior que ya estaba guardado se sigue usando (el panel lo tiene registrado)
  reset();
  macDenied = true;
  vendor = UUID('00000000-0000-0000-0000-000000000000');
  disk.set('latmpx:device_id', 'AB:CD:EF:01:23:45:67:89');
  const again = await open();
  assert.equal(again.dev.deviceId(), 'AB:CD:EF:01:23:45:67:89');
});

test('2.6.1: MAC grabada de fábrica antes que el identificador de Amazon; una MAC local solo si no hay ninguna de las dos', async () => {
  reset();
  wifiMac = 'DA:A1:19:00:11:22'; // administrada localmente (máquina virtual / al azar)
  let { dev } = await open();
  assert.equal(dev.deviceId(), V(), 'con el de Amazon, la MAC local no se usa');
  // Vega Virtual Device: sin el identificador de Amazon, la MAC de su tarjeta virtual
  reset();
  wifiMac = '52:54:00:12:34:56';
  vendor = UUID('00000000-0000-0000-0000-000000000000');
  ({ dev } = await open());
  assert.equal(dev.deviceId(), '52:54:00:12:34:56');
  assert.equal(disk.get('latmpx:device_id_src'), 'a');
  assert.equal(dev.hardId(), false, 'una MAC local no es «hard»');
  assert.equal(dev.macId('00:FC:8B:12:34:56'), '10:FC:8B:12:34:56');
  assert.equal(dev.macId('f0-27-2d-aa-bb-cc'), REAL);
  assert.equal(dev.macRank('f0-27-2d-aa-bb-cc'), 2);
  assert.equal(dev.macRank('52:54:00:12:34:56'), 1);
  assert.equal(dev.macId('00:00:00:00:00:00'), '');
  assert.equal(dev.macId('01:00:5E:00:00:01'), '', 'multicast');
  assert.equal(dev.macId(undefined), '');
});

test('2.6.1: el identificador de Amazon se lee en cualquier forma en que llegue', async () => {
  reset();
  const { dev } = await open();
  const want = dev.idFromUuid('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b');
  const b = [0x6f,0x1c,0x2a,0x3b,0x4d,0x5e,0x4f,0x60,0x8a,0x7b,0x9c,0x0d,0x1e,0x2f,0x3a,0x4b];
  assert.equal(dev.idFromUuid({ bytes: b }), want);
  assert.equal(dev.idFromUuid({ bytes: Uint8Array.from(b) }), want, 'arreglo tipado');
  assert.equal(dev.idFromUuid(Object.fromEntries(b.map((v, i) => [String(i), v]))), want, 'objeto con índices');
  assert.equal(dev.idFromUuid({ bytes: Object.fromEntries(b.map((v, i) => [String(i), v])) }), want);
  assert.equal(dev.idFromUuid({ uuid: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }), want);
  assert.equal(dev.idFromUuid({ toString: () => '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b' }), want);
  assert.equal(dev.idFromUuid({ bytes: [1, 2, 3] }), '');
  assert.equal(dev.idFromUuid({}), '');
  assert.equal(dev.idFromUuid(String({ bytes: [] })), '');
});

test('2.6.1: sin ningún número, la pantalla muestra qué contestó el sistema', async () => {
  reset();
  macDenied = true;
  vendor = UUID('00000000-0000-0000-0000-000000000000');
  const { dev } = await open();
  assert.equal(dev.deviceId(), '');
  assert.match(dev.deviceDiag(), /MAC: .*sin permiso/);
  assert.match(dev.deviceDiag(), /Amazon: en ceros/);
  reset();
  vendor = { weird: true };
  macDenied = true;
  const again = await open();
  assert.match(again.dev.deviceDiag(), /Amazon: forma object \{"weird":true\}/);
});

test('2.6.2: Vega Virtual Device: la MAC llega con los pares altos con signo («FFFFFFB2») y no hay identificador de Amazon', async () => {
  reset();
  wifiMac = '02:15:FFFFFFB2:00:5A:FFFFFF9C';
  vendor = new Error('[com.amazon.apmf.NotSupportedError]: Not supported');
  let { dev, panel } = await open();
  assert.equal(dev.deviceId(), '02:15:B2:00:5A:9C');
  await panel.panelSubmit(dev.deviceId(), 'vvd', 'p', 'http://srv.test:80');
  for (const step of ['cierre', 'reinstalar', 'inicio']) {
    if (step === 'reinstalar') disk = new Map();
    storageBroken = step === 'cierre';
    ({ dev, panel } = await open());
    assert.equal(dev.deviceId(), '02:15:B2:00:5A:9C', step);
    assert.equal((await panel.panelCheckMac(dev.deviceId()))?.user, 'vvd', step);
  }
  assert.match(dev.deviceDiag(), /Amazon: error .*NotSupportedError/);
  // un Fire TV real con un par alto en su MAC de fábrica: se lee bien
  assert.equal(dev.macId('F0:27:FFFFFF9D:AA:FFFFFFBB:0C'), 'F0:27:9D:AA:BB:0C');
  assert.equal(dev.macRank('F0:27:FFFFFF9D:AA:FFFFFFBB:0C'), 2);
  assert.equal(dev.macId('F0:27:1FFFFF9D:AA:BB:0C'), '', 'un par raro no es una MAC');
  assert.equal(dev.macId('2:15:b2:0:5a:9c'), '02:15:B2:00:5A:9C');
});

test('panel sin la función (viejo): el número guardado o la MAC real, sin preguntar en cada pedido', async () => {
  reset();
  panelKnows = false;
  let { dev, panel } = await open();
  assert.equal(dev.deviceId(), REAL);
  await panel.panelCheckMac(REAL);
  await panel.panelCheckMac(REAL);
  assert.equal(asked.filter(a => a[0] === 'device_id').length, 1);
  storageBroken = true;
  ({ dev } = await open());
  assert.equal(dev.deviceId(), REAL);
});

test('panel del 14 de noviembre (sin «fixed»): con lo guardado perdido le devuelve el número de antes', async () => {
  reset();
  panelFixed = false;
  macDenied = true;
  const OLD = '7A:11:22:33:44:55:66:77';
  disk.set('latmpx:device_id', OLD);
  lines.set(OLD, 'c');
  await open();
  storageBroken = true;
  const { dev } = await open();
  assert.equal(dev.deviceId(), OLD);
});

test('cada distribuidor tiene sus claves', async () => {
  reset();
  macDenied = true;
  const OLD = '7A:11:22:33:44:55:66:77';
  disk.set('latmpx:device_id', OLD);
  lines.set(OLD, 'c');
  tenant = '111111';
  await open();
  assert.deepEqual([...new Set([...alias.keys()].map(k => k.split('|')[0]))], ['111111']);
});

test('el objeto Uuid de Vega se lee por sus bytes', async () => {
  reset();
  const { dev } = await open();
  assert.equal(dev.idFromUuid({ bytes: [0x6f,0x1c,0x2a,0x3b,0x4d,0x5e,0x4f,0x60,0x8a,0x7b,0x9c,0x0d,0x1e,0x2f,0x3a,0x4b] }), dev.idFromUuid('6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'));
  assert.equal(dev.idFromUuid({ bytes: [1, 2, 3] }), '');
  assert.equal(dev.idFromUuid({}), '');
  assert.equal(dev.idFromUuid(String({ bytes: [] })), '');
});
