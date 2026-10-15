// Datos del televisor LG (webOS): id del equipo (LGUDID), modelo y versión, pedidos una vez al abrir por el
// bus de servicios de webOS (PalmServiceBridge, el mismo que usa webOSTV.js). En un navegador (pruebas) no hay
// servicios y todo vuelve vacío.
import { sha256 } from '@noble/hashes/sha256';

const g = globalThis as any;

let udid = '';
let model = '';
let os = '';

// llamada a un servicio luna:// ; null si no hay bus, no responde en 3 s o la respuesta no sirve
function luna(uri: string, params: object): Promise<any> {
  return new Promise(resolve => {
    let done = false;
    const end = (v: any) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    try {
      const Bridge = g.PalmServiceBridge;
      if (!Bridge) return end(null);
      const b = new Bridge();
      b.onservicecallback = (msg: string) => {
        try {
          const j = JSON.parse(msg);
          end(j && j.returnValue !== false ? j : null);
        } catch {
          end(null);
        }
      };
      b.call(uri, JSON.stringify(params));
      setTimeout(() => end(null), 3000);
    } catch {
      end(null);
    }
  });
}

// se llama una vez antes de mostrar la app (web/index.tsx)
export async function initTv(): Promise<void> {
  const [ids, info] = await Promise.all([
    luna('luna://com.webos.service.sm/deviceid/getIDs', { idType: ['LGUDID'] }),
    luna('luna://com.webos.service.tv.systemproperty/getSystemInfo', { keys: ['modelName', 'firmwareVersion', 'sdkVersion'] }),
  ]);
  const id = (ids?.idList || []).find((x: any) => x?.idType === 'LGUDID')?.idValue;
  udid = String(id || '');
  model = String(info?.modelName || '');
  os = String(info?.sdkVersion || info?.firmwareVersion || '');
}

// MAC para el panel (AA:BB:CC:DD:EE:FF) armada con el LGUDID del televisor: la misma aunque se reinstale la app
export function tvMac(): string {
  if (!udid) return '';
  const h = sha256(new TextEncoder().encode('webos:' + udid));
  // MAC "local" (bit 0x02) y no multicast: no choca con la de ningún fabricante
  h[0] = (h[0] & 0xfc) | 0x02;
  return Array.from(h.slice(0, 6), b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

export function tvModel(): string {
  return 'LG ' + (model || 'Smart TV');
}

export function tvOs(): string {
  return ('webOS ' + os).trim();
}
