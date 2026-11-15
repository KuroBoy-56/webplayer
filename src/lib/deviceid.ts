// Identificador del equipo (el «MAC» que queda registrado en el panel): 8 pares hex en mayúsculas que nunca empiezan
// en "00". Vega OS no da a las apps ni serie ni MAC (Amazon, foro de desarrolladores: «no public SDK API to retrieve
// the DSN»). Lo que sí da es el Vendor Tracking ID (@amazon-devices/kepler-identifiers): según Amazon no cambia al
// desinstalar y volver a instalar la app; solo al restablecer el equipo de fábrica. Se lee en CADA inicio, no hace
// falta guardarlo.
//
// 2.5.0: el número ya no depende de lo guardado en el equipo. Hasta la 2.1.12 se respetaba el guardado y, si la app
// no lo podía leer al volver a abrir (un cierre de golpe mientras cargaba un video, el almacenamiento todavía ocupado),
// armaba otro número: el panel no lo conocía y sacaba al cliente al inicio de sesión. Ahora:
// - El número sale del identificador de Amazon (siempre el mismo en ese equipo), salvo que el panel diga otro.
// - En cada inicio, con el identificador de Amazon como clave fija, se le pregunta al panel cuál es el número de este
//   equipo (api/login.php «device_id» con "fixed": includes/device_alias.php da_resolve_fixed). El panel contesta el que
//   tiene registrado (línea, demo o lista negra): el guardado, el que tenía anotado para esa clave o el de Amazon; si no
//   hay ninguno registrado, el de Amazon. Así un equipo registrado con un número al azar de una versión anterior lo
//   conserva, y lo recupera aunque se borre todo lo guardado.
// - Sin poder leer lo guardado no se escribe nada encima ni se arma un número al azar si Amazon lo da.
// - Solo si Amazon no lo da (sistema sin la función) se usa uno al azar guardado, como antes.
import { read, storageLoaded, write } from './storage';

// identificador de Amazon de esta apertura (8 pares), '' si no lo dio (todavía)
let vendor = '';
// número a usar cuando lo guardado no se pudo leer o el panel dio otro sin poder guardarlo: vale hasta cerrar la app
let temp = '';
// mientras se prepara el identificador (inicio de la app): un número al azar no se guarda
let pending = true;
// el número no salió de lo guardado en este inicio (instalación nueva o almacenamiento perdido)
let notSaved = false;
const SRC = 'device_id_src';
const HW = 'device_hw';

function randomId(): string {
  let hex = '';
  for (let i = 0; i < 16; i++) hex += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  if (hex.startsWith('00')) hex = '1' + hex.slice(1);
  return hex.match(/.{2}/g)!.join(':');
}

export function deviceId(): string {
  if (temp) return temp;
  const saved = read('device_id');
  if (saved) return saved;
  if (vendor) return vendor;
  // sin identificador de Amazon: al azar, guardado solo una vez preparado y con lo guardado leído
  const id = randomId();
  if (storageLoaded() && !pending) {
    write('device_id', id);
    write(SRC, 'r');
  } else temp = id;
  return id;
}

// el número que arma la app con el identificador de Amazon ('' si no lo dio)
export function vendorId(): string {
  return vendor;
}

function setVendor(id: string): void {
  if (!id) return;
  vendor = id;
  const k = 'v' + id.replace(/:/g, '');
  if (storageLoaded() && read(HW) !== k) write(HW, k);
}

// Al iniciar, después de leer lo guardado (loadStorage). Pide el identificador de Amazon; sin número guardado espera
// lo que haga falta (hasta ~9 s, con el logo en pantalla) para no arrancar con uno al azar.
export async function prepareDeviceId(): Promise<void> {
  const saved = storageLoaded() ? read('device_id') : '';
  notSaved = !saved;
  const ask = vendorDeviceId();
  const v = saved ? await Promise.race([ask, new Promise<string>(r => setTimeout(() => r(''), 2500))]).catch(() => '') : await ask.catch(() => '');
  if (v) setVendor(v);
  else if (saved) ask.then(setVendor).catch(() => {});
  // un número al azar armado antes de leer lo guardado (un aviso de error muy temprano) no le gana a nada
  if (saved || vendor) temp = '';
  if (!saved && storageLoaded()) {
    if (vendor) {
      write('device_id', vendor);
      write(SRC, 'v');
    } else {
      // sin identificador de Amazon: al azar (el mismo que ya se mostró en esta apertura, si hubo) y guardado
      write('device_id', temp || randomId());
      write(SRC, 'r');
      temp = '';
    }
  }
  pending = false;
}

// ---------- con el panel (api/login.php «device_id») ----------

// distribuidores ya consultados en esta apertura (una vez por inicio y distribuidor)
const asked = new Set<string>();
// número que se cambió por el que devolvió el panel (lo que ya lo tenía en la mano lo cambia)
let replaced: { from: string; to: string } | null = null;

// claves fijas del equipo para el panel (una letra de tipo + hex): el identificador de Amazon
export function hwKeys(): string[] {
  const k = vendor ? 'v' + vendor.replace(/:/g, '') : read(HW);
  return /^[a-z][0-9A-F]{12,32}$/.test(k) ? [k] : [];
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
    write(SRC, 'p');
    temp = '';
  } else temp = got;
  replaced = { from: sent, to: got };
}

// el número vigente para un pedido que se armó con id (pudo cambiar por el del panel mientras tanto)
export function currentId(id: string): string {
  return replaced && id === replaced.from ? replaced.to : id;
}

// (se inició sesión: nada que hacer, el panel ya decide el número en cada inicio)
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
    // (cargado aquí: un sistema sin el módulo, o las pruebas en Node, siguen con el identificador al azar)
    ids = require('@amazon-devices/kepler-identifiers').KeplerIdentifiers;
  } catch {
    return '';
  }
  for (const wait of [1500, 2000, 2500, 2500]) {
    try {
      const uuid = await Promise.race([ids.getVendorTrackingId(), new Promise<null>(r => setTimeout(() => r(null), wait))]);
      if (uuid !== null) {
        const id = idFromUuid(uuid);
        // UUID en ceros (el usuario lo apagó): no hay más que pedir
        return id;
      }
    } catch {
      // error pasajero: otra vez
    }
    await new Promise<void>(r => setTimeout(r, 300));
  }
  return '';
}
