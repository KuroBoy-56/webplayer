// AES-256-GCM de login.php: base64(salt16 + iv12 + cifrado + tag16),
// llave = HMAC(HMAC(salt, maestra), 0x01) (igual que hkdf() del panel, Android, Windows y Roku).
import { gcm } from '@noble/ciphers/aes';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { PANEL_KEY } from '../generated/panelKey';
import { b64ToBytes, bytesToB64, utf8Decode, utf8Encode } from './crypto';

export function hasMasterKey(): boolean {
  return PANEL_KEY.length === 64;
}

function hexBytes(h: string): Uint8Array {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as any).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    try {
      c.getRandomValues(out);
      return out;
    } catch {
      // sin crypto del sistema se usa Math.random
    }
  }
  for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

function derive(salt: Uint8Array): Uint8Array {
  const prk = hmac(sha256, salt, hexBytes(PANEL_KEY));
  return hmac(sha256, prk, new Uint8Array([1]));
}

// "" si la app se compiló sin llave
export function panelEncrypt(plain: string): string {
  if (!hasMasterKey()) return '';
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const ct = gcm(derive(salt), iv).encrypt(new Uint8Array(utf8Encode(plain)));
  const all = new Uint8Array(28 + ct.length);
  all.set(salt, 0);
  all.set(iv, 16);
  all.set(ct, 28);
  return bytesToB64(all);
}

// null si no hay llave o el tag no coincide
export function panelDecrypt(b64: string): string | null {
  if (!hasMasterKey()) return null;
  const bin = new Uint8Array(b64ToBytes(b64.trim()));
  if (bin.length < 44) return null;
  try {
    const plain = gcm(derive(bin.slice(0, 16)), bin.slice(16, 28)).decrypt(bin.slice(28));
    return utf8Decode(Array.from(plain));
  } catch {
    return null;
  }
}
