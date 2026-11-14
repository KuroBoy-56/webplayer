// Datos del televisor Samsung (Tizen): id del equipo, modelo y versión. En un navegador (pruebas) no hay
// webapis/tizen y todo vuelve vacío.
import { sha256 } from '@noble/hashes/sha256';

const g = globalThis as any;

function duid(): string {
  try {
    return String(g.webapis?.productinfo?.getDuid?.() || '');
  } catch {
    return '';
  }
}

// MAC para el panel (AA:BB:CC:DD:EE:FF) armada con el DUID del televisor: la misma aunque se reinstale la app
export function tvMac(): string {
  const id = duid();
  if (!id) return '';
  const h = sha256(new TextEncoder().encode('tizen:' + id));
  // MAC "local" (bit 0x02) y no multicast: no choca con la de ningún fabricante
  h[0] = (h[0] & 0xfc) | 0x02;
  return Array.from(h.slice(0, 6), b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

// Segunda clave del televisor para el panel: el «Tizen ID» del sistema (tizen.systeminfo, capacidad
// http://tizen.org/system/tizenid, sin permisos). No se usa como número del equipo: solo ayuda al panel a reconocer el
// televisor después de reinstalar si el DUID no estuvo disponible. '' si el sistema no lo da.
export function tvAltKey(): string {
  let id = '';
  try {
    id = String(g.tizen?.systeminfo?.getCapability?.('http://tizen.org/system/tizenid') || '');
  } catch {
    id = '';
  }
  if (id.length < 8) return '';
  const h = sha256(new TextEncoder().encode('tizenid:' + id));
  return Array.from(h.slice(0, 8), b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

export function tvModel(): string {
  try {
    return 'Samsung ' + String(g.webapis?.productinfo?.getRealModel?.() || g.webapis?.productinfo?.getModel?.() || 'Smart TV');
  } catch {
    return 'Samsung Smart TV';
  }
}

export function tvOs(): string {
  try {
    const v = g.tizen?.systeminfo?.getCapability?.('http://tizen.org/feature/platform.version');
    return 'Tizen ' + String(v || '');
  } catch {
    return 'Tizen';
  }
}
