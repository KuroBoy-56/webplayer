// Número del equipo (el «MAC» que queda registrado en el panel). 2.6.0: SOLO números que da el propio equipo, nunca
// uno inventado por la app:
// 1. La MAC real de la tarjeta Wi-Fi (o de red por cable si no tiene Wi-Fi), con la función oficial de Amazon
//    NetworkManager.getMacAddress() (@amazon-devices/keplerscript-netmgr-lib, permiso
//    com.amazon.network.privilege.restricted-net-info en manifest.toml). Según Amazon ese permiso solo se da a apps
//    firmadas (las de la tienda). Solo se usa una MAC grabada de fábrica: una «administrada localmente» (al azar,
//    por privacidad) puede cambiar y no sirve.
// 2. Si el sistema no da la MAC: el identificador del equipo para nuestra app que da Amazon (Vendor Tracking ID,
//    @amazon-devices/kepler-identifiers): según Amazon solo cambia al restablecer el equipo de fábrica.
// No hay número al azar. Lo guardado solo se usa mientras el panel no contesta; en cada inicio el panel dice el número
// de este equipo (api/login.php «device_id» con "fixed"; con la MAC real, "hard": el panel pasa a la MAC la línea que
// el equipo tenía con un número anterior y desde entonces el número es la MAC).
import { read, storageLoaded, write } from './storage';

// MAC real de esta apertura (6 pares) y el número que sale del identificador de Amazon (8 pares); '' si no los dio
let mac = '';
let vendor = '';
// número que dio el panel sin poder guardarlo (lo guardado no se pudo leer): vale hasta cerrar la app
let temp = '';
// el número no salió de lo guardado en este inicio (instalación nueva o almacenamiento perdido)
let notSaved = false;
const SRC = 'device_id_src';

export function deviceId(): string {
  if (temp) return temp;
  return read('device_id') || mac || vendor;
}

// el número que da el equipo en esta apertura: la MAC real o, sin ella, el de Amazon ('' si todavía ninguno)
export function vendorId(): string {
  return mac || vendor;
}

// true = el número del equipo es su MAC real
export function hardId(): boolean {
  return !!mac;
}

// MAC → número: 6 pares en mayúsculas. Solo una MAC grabada de fábrica (ni multicast ni administrada localmente, ni
// en ceros). Una que empiece en "00" pasa a "10" (el panel quita un "00:" del principio de los números).
export function macId(raw: unknown): string {
  const hex = typeof raw === 'string' ? raw.toUpperCase().replace(/[^0-9A-F]/g, '') : '';
  if (hex.length !== 12 || /^0+$/.test(hex) || /^F+$/.test(hex)) return '';
  if (parseInt(hex.slice(0, 2), 16) & 3) return '';
  return (hex.startsWith('00') ? '10' + hex.slice(2) : hex).match(/.{2}/g)!.join(':');
}

// La MAC de la tarjeta de red con la función oficial de Amazon: primero Wi-Fi (la tienen todos los Fire TV), luego
// cable. '' si el sistema no la da (app sin firmar / sin el permiso: PERMISSION_DENIED, o sistema sin la función)
export function systemMac(): string {
  let lib: any;
  try {
    lib = require('@amazon-devices/keplerscript-netmgr-lib');
  } catch {
    return '';
  }
  try {
    const nm = new lib.NetworkManager();
    const ok = lib.Status ? lib.Status.SUCCESS : 0;
    const types = lib.NetworkInterfaceType ? [lib.NetworkInterfaceType.WIFI, lib.NetworkInterfaceType.ETHERNET] : [1, 2];
    for (const ty of types) {
      const list: Array<{ id: number }> = [];
      if (nm.getNetworkInterfaces(ty, list) !== ok) continue;
      for (const it of [...list].sort((a, b) => a.id - b.id)) {
        const r = nm.getMacAddress(it.id);
        const id = Array.isArray(r) && r[0] === ok ? macId(r[1]) : '';
        if (id) return id;
      }
    }
  } catch {
    // sin el servicio de red o sin permiso
  }
  return '';
}

// Al iniciar, después de leer lo guardado (loadStorage): la MAC real y el identificador de Amazon. Sin nada guardado
// se espera lo que haga falta (hasta ~9 s, con el logo en pantalla) para arrancar con el número del equipo.
export async function prepareDeviceId(): Promise<void> {
  const saved = storageLoaded() ? read('device_id') : '';
  notSaved = !saved;
  mac = await readMacRetry(saved ? 1 : 3);
  const ask = vendorDeviceId();
  vendor = saved || mac ? await Promise.race([ask, new Promise<string>(r => setTimeout(() => r(''), 2500))]).catch(() => '') : await ask.catch(() => '');
  if (!vendor) ask.then(v => (vendor = v)).catch(() => {});
  if (!saved && storageLoaded() && (mac || vendor)) {
    write('device_id', mac || vendor);
    write(SRC, mac ? 'm' : 'v');
  }
  // si el sistema todavía no dio ninguno, se vuelve a intentar en segundo plano (nunca se inventa uno)
  if (!mac && !vendor) retryLater();
}

async function readMacRetry(times: number): Promise<string> {
  for (let i = 0; i < times; i++) {
    const m = systemMac();
    if (m) return m;
    if (i + 1 < times) await new Promise<void>(r => setTimeout(r, 700));
  }
  return '';
}

function retryLater(n = 0): void {
  if (n >= 20) return;
  setTimeout(async () => {
    mac = mac || systemMac();
    if (!vendor) vendor = await vendorDeviceId().catch(() => '');
    if (!mac && !vendor) return retryLater(n + 1);
    if (storageLoaded() && !read('device_id')) {
      write('device_id', mac || vendor);
      write(SRC, mac ? 'm' : 'v');
    }
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
    write(SRC, got === mac ? 'm' : got === vendor ? 'v' : 'p');
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

// UUID → 32 hex: el objeto Uuid de Vega ({ bytes: [16 números] }), una lista de 16 bytes o el texto «xxxxxxxx-…»
export function uuidHex(u: unknown): string {
  const bytes = Array.isArray(u) ? u : u && typeof u === 'object' && Array.isArray((u as any).bytes) ? (u as any).bytes : null;
  if (bytes) {
    if (bytes.length !== 16 || bytes.some((b: unknown) => typeof b !== 'number' || !Number.isFinite(b))) return '';
    return bytes.map((b: number) => ((b & 255) >>> 0).toString(16).padStart(2, '0')).join('');
  }
  return typeof u === 'string' ? u.toLowerCase().replace(/[^0-9a-f]/g, '') : '';
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
    return '';
  }
  for (const wait of [1500, 2000, 2500, 2500]) {
    try {
      const uuid = await Promise.race([ids.getVendorTrackingId(), new Promise<null>(r => setTimeout(() => r(null), wait))]);
      // (UUID en ceros: el usuario lo apagó; no hay más que pedir)
      if (uuid !== null) return idFromUuid(uuid);
    } catch {
      // error pasajero: otra vez
    }
    await new Promise<void>(r => setTimeout(r, 300));
  }
  return '';
}
