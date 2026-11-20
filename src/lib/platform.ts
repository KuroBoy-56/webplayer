// Datos del televisor Hisense (VIDAA OS): id del equipo, modelo y versión, con las funciones Hisense_* que el navegador
// de VIDAA pone en la página (Hisense_GetDeviceID, Hisense_GetModelName, Hisense_GetFirmWareVersion,
// Hisense_GetOSVersion). Se piden una vez al abrir. En un navegador común (pruebas) no existen y todo vuelve vacío.
import { sha256 } from '@noble/hashes/sha256';

const g = globalThis as any;

let udid = '';
let model = '';
let os = '';

// ¿la app corre en un televisor VIDAA? (las funciones Hisense_* o el navegador del televisor)
export function onVidaa(): boolean {
  if (typeof g.Hisense_GetOSVersion === 'function' || typeof g.Hisense_GetDeviceID === 'function') return true;
  try {
    return /VIDAA|Hisense/i.test(String(g.navigator?.userAgent || ''));
  } catch {
    return false;
  }
}

// una función Hisense_*: su texto ('' si no existe, falla o no contesta en 3 s). Algunas versiones devuelven una promesa
function hisense(name: string): Promise<string> {
  return new Promise(resolve => {
    let done = false;
    const end = (v: any) => {
      if (!done) {
        done = true;
        resolve(v === undefined || v === null ? '' : String(v).trim());
      }
    };
    try {
      const fn = g[name];
      if (typeof fn !== 'function') return end('');
      const r = fn.call(g);
      if (r && typeof r.then === 'function') r.then(end, () => end(''));
      else end(r);
      setTimeout(() => end(''), 3000);
    } catch {
      end('');
    }
  });
}

// se llama una vez antes de mostrar la app (web/index.tsx)
export async function initTv(): Promise<void> {
  const [id, name, fw, ver] = await Promise.all([
    hisense('Hisense_GetDeviceID'),
    hisense('Hisense_GetModelName'),
    hisense('Hisense_GetFirmWareVersion'),
    hisense('Hisense_GetOSVersion'),
  ]);
  udid = id;
  model = name;
  os = ver || fw;
  // el televisor no dio su id esta vez: se le pide otra vez sin demorar la app (3 intentos más, cada 4 s). Con él, el
  // número al azar de esta apertura se cambia por el fijo (lib/deviceid.ts)
  if (!udid && typeof g.Hisense_GetDeviceID === 'function') retryUdid(3);
}

function retryUdid(left: number): void {
  setTimeout(async () => {
    if (udid) return;
    udid = await hisense('Hisense_GetDeviceID');
    if (!udid && left > 1) retryUdid(left - 1);
  }, 4000);
}

// MAC para el panel (AA:BB:CC:DD:EE:FF) armada con el id del televisor: la misma aunque se borren los datos de la app
export function tvMac(): string {
  if (!udid) return '';
  const h = sha256(new TextEncoder().encode('vidaa:' + udid));
  // MAC "local" (bit 0x02) y no multicast: no choca con la de ningún fabricante
  h[0] = (h[0] & 0xfc) | 0x02;
  return Array.from(h.slice(0, 6), b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

export function tvModel(): string {
  return 'Hisense ' + (model || 'Smart TV');
}

export function tvOs(): string {
  return ('VIDAA ' + os).trim();
}
