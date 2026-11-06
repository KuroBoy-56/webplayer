// Descifrado AES-128-CBC de los segmentos de los canales con el módulo nativo de Vega (el WebCrypto de
// react-native-w3cmedia, el mismo que usa Shaka). En JavaScript (@noble) un segmento de 2-3 MB tardaba hasta 9 s en
// algunos Fire TV (reporte: descifrado=8991ms con segmentos de 13 s) y el canal se cortaba una y otra vez.
// null = el nativo no está en este equipo (el lector usa el de JavaScript y no lo vuelve a probar en la sesión).
import { WebCrypto } from '@amazon-devices/react-native-w3cmedia';

let off = false;
const imported = new WeakMap<Uint8Array, Promise<any>>();

// el módulo nativo toma el ArrayBuffer entero: una vista se copia a uno propio
const own = (d: Uint8Array): ArrayBuffer => (d.byteOffset === 0 && d.byteLength === d.buffer.byteLength ? d.buffer : d.slice().buffer) as ArrayBuffer;

export function disableNativeAes(): void {
  off = true;
}

// para el reporte del canal
export function nativeAesOn(): boolean {
  return !off;
}

export async function nativeCbc(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array | null> {
  // un largo que no es de AES lo informa el de JavaScript (sin apagar el nativo por un segmento malo)
  if (off || !data.length || data.length % 16) return null;
  try {
    const subtle = (WebCrypto as any)?.subtle;
    if (!subtle?.importKey || !subtle?.decrypt) throw new Error('sin WebCrypto');
    let k = imported.get(key);
    if (!k) {
      k = subtle.importKey('raw', key.slice().buffer, { name: 'AES-CBC' }, false, ['decrypt']);
      imported.set(key, k!);
    }
    let out = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: iv.slice().buffer }, await k, own(data)));
    // relleno PKCS#7: WebCrypto lo quita; si este equipo lo dejó, se quita aquí
    if (out.length === data.length && out.length) {
      const n = out[out.length - 1];
      if (n >= 1 && n <= 16 && out.subarray(out.length - n).every(b => b === n)) out = out.subarray(0, out.length - n);
    }
    return out;
  } catch {
    off = true;
    return null;
  }
}
