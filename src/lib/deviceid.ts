// Número del equipo (el «MAC» que queda registrado en el panel). 2.6.0: SOLO números que da el propio equipo, nunca
// uno inventado por la app:
// 1. La MAC real de la tarjeta Wi-Fi (o de red por cable si no tiene Wi-Fi), con la función oficial de Amazon
//    NetworkManager.getMacAddress() (@amazon-devices/keplerscript-netmgr-lib, permiso
//    com.amazon.network.privilege.restricted-net-info en manifest.toml). Según Amazon ese permiso solo se da a apps
//    firmadas (las de la tienda). Una MAC grabada de fábrica.
// 2. Si el sistema no da la MAC: el identificador del equipo para nuestra app que da Amazon (Vendor Tracking ID,
//    @amazon-devices/kepler-identifiers): según Amazon solo cambia al restablecer el equipo de fábrica.
// 3. (2.6.1) Si tampoco: una MAC «administrada localmente» que dé el sistema (la tarjeta de red de una máquina virtual,
//    como el Vega Virtual Device).
// No hay número al azar: sin ninguno, la pantalla de inicio muestra qué contestó el sistema (deviceDiag) y se sigue
// intentando cada 3 s. Lo guardado solo se usa mientras el panel no contesta; en cada inicio el panel dice el número
// de este equipo (api/login.php «device_id» con "fixed"; con la MAC real, "hard": el panel pasa a la MAC la línea que
// el equipo tenía con un número anterior y desde entonces el número es la MAC).
import { read, storageLoaded, write } from './storage';

// MAC real de esta apertura (6 pares) y el número que sale del identificador de Amazon (8 pares); '' si no los dio.
// localMac: una MAC «administrada localmente» (máquina virtual): solo si no hay ninguna de las otras dos
let mac = '';
let vendor = '';
let localMac = '';
// rango de la última MAC leída (macRank): 2 = de fábrica, 1 = administrada localmente
let lastRank = 0;
// número que dio el panel sin poder guardarlo (lo guardado no se pudo leer): vale hasta cerrar la app
let temp = '';
// el número no salió de lo guardado en este inicio (instalación nueva o almacenamiento perdido)
let notSaved = false;
const SRC = 'device_id_src';

export function deviceId(): string {
  if (temp) return temp;
  return read('device_id') || mac || vendor || localMac;
}

// el número que da el equipo en esta apertura: la MAC real, el de Amazon o la MAC local ('' si todavía ninguno)
export function vendorId(): string {
  return mac || vendor || localMac;
}

// true = el número del equipo es su MAC real
export function hardId(): boolean {
  return !!mac;
}

// MAC → 12 hex. 2.6.2: la función de Amazon escribe los pares de 80 a FF con signo («02:15:FFFFFFB2:00:…» = 02:15:B2:00:…;
// visto en el Vega Virtual Device): de cada par «FFFFFFxx» se toman los dos últimos. '' si no es una MAC.
export function macHex(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const t = raw.trim().toUpperCase();
  const parts = t.split(/[:\-\s.]+/).filter(Boolean);
  if (parts.length === 6) {
    const out = parts.map(p => (/^[0-9A-F]{1,2}$/.test(p) ? p.padStart(2, '0') : /^F{6}[0-9A-F]{2}$/.test(p) ? p.slice(-2) : ''));
    return out.every(Boolean) ? out.join('') : '';
  }
  const hex = t.replace(/[^0-9A-F]/g, '');
  return hex.length === 12 ? hex : '';
}

// MAC → número: 6 pares en mayúsculas ('' si no sirve: ni en ceros, ni FF…, ni multicast). Una que empiece en "00"
// pasa a "10" (el panel quita un "00:" del principio de los números). 2.6.1: también una «administrada localmente»
// (la de una máquina virtual como el Vega Virtual Device), pero se prefiere la grabada de fábrica (macRank).
export function macId(raw: unknown): string {
  const hex = macHex(raw);
  if (hex.length !== 12 || /^0+$/.test(hex) || /^F+$/.test(hex)) return '';
  if (parseInt(hex.slice(0, 2), 16) & 1) return '';
  return (hex.startsWith('00') ? '10' + hex.slice(2) : hex).match(/.{2}/g)!.join(':');
}

// 2 = grabada de fábrica, 1 = administrada localmente, 0 = no sirve
export function macRank(raw: unknown): number {
  if (!macId(raw)) return 0;
  return parseInt(macHex(raw).slice(0, 2), 16) & 2 ? 1 : 2;
}

// qué contestó el sistema en esta apertura (se ve en pantalla cuando no hay número, para saber por qué)
const diag = { mac: '', amz: '' };
export function deviceDiag(): string {
  return 'MAC: ' + (diag.mac || '-') + '  ·  Amazon: ' + (diag.amz || '-');
}

// La MAC de la tarjeta de red con la función oficial de Amazon: Wi-Fi (la tienen todos los Fire TV), cable, cualquier
// otra, la activa y la predeterminada (id 0). Se prefiere una grabada de fábrica. '' si el sistema no la da (app sin
// firmar / sin el permiso: PERMISSION_DENIED, o sistema sin la función); el motivo queda en deviceDiag()
export function systemMac(): string {
  let lib: any;
  try {
    lib = require('@amazon-devices/keplerscript-netmgr-lib');
  } catch (e) {
    diag.mac = 'sin módulo';
    return '';
  }
  const seen: string[] = [];
  let best = '';
  let bestRank = 0;
  try {
    const nm = new lib.NetworkManager();
    const ok = lib.Status ? lib.Status.SUCCESS : 0;
    const T = lib.NetworkInterfaceType || { NONE: 0, WIFI: 1, ETHERNET: 2 };
    const ids: number[] = [];
    for (const ty of [T.WIFI, T.ETHERNET, T.NONE]) {
      const list: Array<{ id: number }> = [];
      try {
        if (nm.getNetworkInterfaces(ty, list) === ok) for (const it of list) if (!ids.includes(it.id)) ids.push(it.id);
      } catch {
        // tipo no soportado
      }
    }
    try {
      const act: any = { id: -1 };
      if (nm.getActiveNetworkInterface(act) === ok && act.id >= 0 && !ids.includes(act.id)) ids.push(act.id);
    } catch {
      // sin interfaz activa
    }
    if (!ids.includes(0)) ids.push(0);
    for (const id of ids) {
      let r: any;
      try {
        r = nm.getMacAddress(id);
      } catch (e: any) {
        seen.push(id + ':error');
        continue;
      }
      const st = Array.isArray(r) ? r[0] : r?.status;
      const val = Array.isArray(r) ? r[1] : r?.address;
      const rank = st === ok ? macRank(val) : 0;
      seen.push(id + ':' + (st === ok ? (rank ? (rank === 2 ? 'ok' : 'local') : 'vacía ' + String(val).slice(0, 40)) : st === 4 ? 'sin permiso' : 'estado ' + st));
      if (rank > bestRank) {
        best = macId(val);
        bestRank = rank;
      }
    }
  } catch (e: any) {
    seen.push('error ' + String(e?.message || e).slice(0, 40));
  }
  diag.mac = seen.join(' ') || 'sin interfaces';
  lastRank = bestRank;
  return best;
}

// lee la MAC y la deja como de fábrica (mac) o local (localMac)
function takeMac(): void {
  const m = systemMac();
  if (lastRank === 2) mac = m;
  else if (lastRank === 1 && !localMac) localMac = m;
}

// Al iniciar, después de leer lo guardado (loadStorage): la MAC real y el identificador de Amazon. Sin nada guardado
// se espera lo que haga falta (hasta ~9 s, con el logo en pantalla) para arrancar con el número del equipo.
export async function prepareDeviceId(): Promise<void> {
  const saved = storageLoaded() ? read('device_id') : '';
  notSaved = !saved;
  for (let i = 0, n = saved ? 1 : 3; i < n && !mac; i++) {
    if (i) await new Promise<void>(r => setTimeout(r, 700));
    takeMac();
  }
  const ask = vendorDeviceId();
  vendor = saved || mac ? await Promise.race([ask, new Promise<string>(r => setTimeout(() => r(''), 2500))]).catch(() => '') : await ask.catch(() => '');
  if (!vendor) ask.then(v => (vendor = v)).catch(() => {});
  saveFirst();
  // si el sistema todavía no dio ninguno, se vuelve a intentar en segundo plano (nunca se inventa uno)
  if (!mac && !vendor) retryLater();
}

// sin número guardado: el del equipo queda guardado
function saveFirst(): void {
  const id = mac || vendor || localMac;
  if (id && storageLoaded() && !read('device_id')) {
    write('device_id', id);
    write(SRC, mac ? 'm' : vendor ? 'v' : 'a');
  }
}

function retryLater(n = 0): void {
  if (n >= 20) return;
  setTimeout(async () => {
    if (!mac) takeMac();
    if (!vendor) vendor = await vendorDeviceId().catch(() => '');
    saveFirst();
    if (!mac && !vendor) retryLater(n + 1);
  }, 3000);
}

// ---------- con el panel (api/login.php «device_id») ----------

// distribuidores ya consultados en esta apertura (una vez por inicio y distribuidor)
const asked = new Set<string>();
// número que se cambió por el que devolvió el panel (lo que ya lo tenía en la mano lo cambia)
let replaced: { from: string; to: string } | null = null;

// claves fijas del equipo para el panel (una letra de tipo + hex): la MAC real y el identificador de Amazon
export function hwKeys(): string[] {
  const out: string[] = [];
  if (mac) out.push('m' + mac.replace(/:/g, ''));
  if (vendor) out.push('v' + vendor.replace(/:/g, ''));
  if (localMac) out.push('a' + localMac.replace(/:/g, ''));
  return out;
}

// el número no salió de lo guardado: para un panel del 14 de noviembre (sin «fixed») pide el de antes
export function deviceFresh(): boolean {
  return notSaved;
}

// ¿falta preguntarle al panel en esta apertura con este distribuidor?
export function syncNeeded(tenant: string): boolean {
  return hwKeys().length > 0 && !asked.has(tenant);
}

// El panel contestó: got es el número de este equipo. Si es otro, se usa ese (y se guarda si se puede).
export function syncDone(tenant: string, sent: string, got: string): void {
  asked.add(tenant);
  if (got === sent || !/^[0-9A-F]{2}(:[0-9A-F]{2}){5,7}$/.test(got)) return;
  if (storageLoaded()) {
    write('device_id', got);
    write(SRC, got === mac ? 'm' : got === vendor ? 'v' : got === localMac ? 'a' : 'p');
    temp = '';
  } else temp = got;
  replaced = { from: sent, to: got };
}

// el número vigente para un pedido que se armó con id (pudo cambiar por el del panel mientras tanto)
export function currentId(id: string): string {
  return replaced && id === replaced.from ? replaced.to : id;
}

// (se inició sesión: nada que hacer, el panel decide el número en cada inicio)
export function deviceRegistered(): void {}

// UUID → 32 hex: el objeto Uuid de Vega ({ bytes: [16 números] }), una lista o arreglo tipado de 16 bytes, un objeto
// con índices, o el texto «xxxxxxxx-…» (2.6.1: cualquiera de esas formas, por si el sistema lo entrega distinto)
export function uuidHex(u: unknown): string {
  if (typeof u === 'string') return u.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (!u || typeof u !== 'object') return '';
  const o = u as any;
  if (o.bytes !== undefined && o.bytes !== o) return uuidHex(o.bytes);
  if (o.uuid !== undefined) return uuidHex(o.uuid);
  if (o.id !== undefined && typeof o.id !== 'number') return uuidHex(o.id);
  let bytes: unknown[] | null = null;
  if (Array.isArray(o)) bytes = o;
  else if (ArrayBuffer.isView(o)) bytes = Array.from(o as unknown as ArrayLike<number>);
  else if (typeof o.length === 'number') bytes = Array.from(o as ArrayLike<unknown>);
  else if (Object.keys(o).length === 16 && Object.keys(o).every(k => /^\d+$/.test(k))) bytes = Array.from({ length: 16 }, (_, i) => o[i]);
  if (bytes) {
    if (bytes.length === 16 && bytes.every(b => typeof b === 'number' && Number.isFinite(b))) {
      return (bytes as number[]).map(b => ((b & 255) >>> 0).toString(16).padStart(2, '0')).join('');
    }
    if (bytes.every(b => typeof b === 'string')) return uuidHex(bytes.join(''));
    return '';
  }
  if (typeof o.toString === 'function' && o.toString !== Object.prototype.toString) return uuidHex(String(o));
  return '';
}

// UUID del vendedor → 8 pares hex (las dos mitades combinadas: el UUID no sale del equipo); '' si no sirve
export function idFromUuid(uuid: unknown): string {
  const h = uuidHex(uuid);
  if (h.length !== 32 || /^0+$/.test(h)) return '';
  let out = '';
  for (let i = 0; i < 16; i++) out += (parseInt(h[i], 16) ^ parseInt(h[i + 16], 16)).toString(16);
  out = out.toUpperCase();
  if (out.startsWith('00')) out = '1' + out.slice(1);
  return out.match(/.{2}/g)!.join(':');
}

// hasta 4 intentos (el sistema recién encendido o recién cerrada la app puede tardar en contestar); '' si no lo da
async function vendorDeviceId(): Promise<string> {
  let ids: { getVendorTrackingId: () => Promise<unknown> };
  try {
    ids = require('@amazon-devices/kepler-identifiers').KeplerIdentifiers;
  } catch {
    diag.amz = 'sin módulo';
    return '';
  }
  for (const wait of [1500, 2000, 2500, 2500]) {
    try {
      const uuid = await Promise.race([ids.getVendorTrackingId(), new Promise<null>(r => setTimeout(() => r(null), wait))]);
      if (uuid !== null) {
        const id = idFromUuid(uuid);
        const h = uuidHex(uuid);
        diag.amz = id ? 'ok' : h.length === 32 ? 'en ceros' : 'forma ' + shape(uuid);
        return id;
      }
      diag.amz = 'sin respuesta';
    } catch (e: any) {
      diag.amz = 'error ' + String(e?.message || e).slice(0, 40);
    }
    await new Promise<void>(r => setTimeout(r, 300));
  }
  return '';
}

// cómo llegó un valor (para el diagnóstico): tipo y un pedazo
function shape(v: unknown): string {
  try {
    const t = v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
    return t + ' ' + (typeof v === 'string' ? v : JSON.stringify(v) || String(v)).slice(0, 40);
  } catch {
    return typeof v;
  }
}
