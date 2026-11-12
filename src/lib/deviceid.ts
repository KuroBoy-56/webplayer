// Identificador del equipo (el «MAC» que queda registrado en el panel): 8 pares hex en mayúsculas que nunca empiezan
// en "00". Vega OS no da a las apps ni serie ni MAC del equipo. Desde 2.1.6 sale del identificador que Vega da a las
// apps de un mismo vendedor (Vendor Tracking ID, @amazon-devices/kepler-identifiers): según Amazon no cambia al
// desinstalar y volver a instalar la app, solo al restablecer el equipo de fábrica. Se guarda en el equipo; el que ya
// estaba guardado se respeta (el panel lo tiene registrado). Sin él (sistema sin la función, el usuario lo apagó: UUID
// en ceros) se crea uno al azar como antes, que cambia si se desinstala la app.
import { read, storageLoaded, write } from './storage';

// creado sin poder leer lo guardado: vale solo hasta cerrar la app
let temp = '';
// se está pidiendo el identificador de Vega (prepareDeviceId): uno al azar no se guarda encima
let pending = false;

export function deviceId(): string {
  const saved = read('device_id');
  if (saved) return saved;
  if (temp) return temp;
  let hex = '';
  for (let i = 0; i < 16; i++) hex += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  if (hex.startsWith('00')) hex = '1' + hex.slice(1);
  const id = hex.match(/.{2}/g)!.join(':');
  // sin haber leído lo guardado (todavía cargando, o la lectura falló) no se escribe encima: el identificador que el
  // panel ya tiene registrado sigue en el equipo y vuelve en el próximo inicio
  if (storageLoaded() && !pending) write('device_id', id);
  else temp = id;
  return id;
}

// Al iniciar, después de leer lo guardado: sin identificador guardado (instalación nueva o reinstalada), el de Vega.
// 2.1.7: el que se creó al azar porque Vega no contestó en esa apertura queda marcado y en cada inicio se vuelve a pedir
// el de Vega; cuando contesta, se usa ese (el fijo). El guardado de antes de 2.1.6 se respeta: el panel lo tiene
// registrado con la línea del cliente
const SRC = 'device_id_src';
export async function prepareDeviceId(): Promise<void> {
  const saved = read('device_id');
  if (saved && read(SRC) !== 'r') return;
  pending = true;
  const id = await vendorDeviceId();
  pending = false;
  if (!storageLoaded()) {
    if (id) temp = id;
    return;
  }
  if (read('device_id') !== saved) return;
  if (id) {
    temp = '';
    write('device_id', id);
    write(SRC, 'v');
    return;
  }
  if (saved) return;
  // Vega no lo dio: al azar (el mismo que ya se usó en esta apertura, si hubo), marcado para intentar otra vez
  write('device_id', deviceId());
  write(SRC, 'r');
}

// UUID del vendedor → 8 pares hex (las dos mitades combinadas: el UUID no sale del equipo); '' si no sirve
export function idFromUuid(uuid: string): string {
  const h = (uuid || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (h.length !== 32 || /^0+$/.test(h)) return '';
  let out = '';
  for (let i = 0; i < 16; i++) out += (parseInt(h[i], 16) ^ parseInt(h[i + 16], 16)).toString(16);
  out = out.toUpperCase();
  if (out.startsWith('00')) out = '1' + out.slice(1);
  return out.match(/.{2}/g)!.join(':');
}

// hasta 3 intentos (el sistema recién encendido puede tardar en contestar); '' si no lo da (sin el módulo, UUID en ceros)
async function vendorDeviceId(): Promise<string> {
  let ids: { getVendorTrackingId: () => Promise<string> };
  try {
    // (cargado aquí: un sistema sin el módulo, o las pruebas en Node, siguen con el identificador al azar)
    ids = require('@amazon-devices/kepler-identifiers').KeplerIdentifiers;
  } catch {
    return '';
  }
  for (const wait of [1200, 2000, 2500]) {
    try {
      const uuid = await Promise.race([ids.getVendorTrackingId(), new Promise<null>(r => setTimeout(() => r(null), wait))]);
      if (uuid !== null) return idFromUuid(String(uuid || ''));
    } catch {
      // error pasajero: otra vez
    }
    await new Promise<void>(r => setTimeout(r, 300));
  }
  return '';
}
