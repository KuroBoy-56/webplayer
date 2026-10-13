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
