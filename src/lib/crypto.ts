// Cifrados que usa el panel (los mismos que Android, Windows y Roku):
//  - mope (api/auth.php): base64 con basura insertada
//  - atbash + base64 (api/dns.php)
//  - dirección del panel: hex -> base64 -> XOR "KURO"

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToB64(bytes: number[] | Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? B64[n & 63] : '=';
  }
  return out;
}

export function b64ToBytes(s: string): number[] {
  const clean = s.replace(/[^A-Za-z0-9+/_-]/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    buf = (buf << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 255);
    }
  }
  return out;
}

export function utf8Encode(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0) || 0;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

// UTF-8 tolerante: si los bytes no son UTF-8 válido se leen como latin-1
export function utf8Decode(b: number[]): string {
  let out = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    let cp = -1;
    let n = 0;
    if (c < 0x80) {
      cp = c;
      n = 1;
    } else if (c >= 0xc2 && c < 0xe0 && i + 1 < b.length && (b[i + 1] & 0xc0) === 0x80) {
      cp = ((c & 31) << 6) | (b[i + 1] & 63);
      n = 2;
    } else if (c >= 0xe0 && c < 0xf0 && i + 2 < b.length && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80) {
      cp = ((c & 15) << 12) | ((b[i + 1] & 63) << 6) | (b[i + 2] & 63);
      n = 3;
    } else if (c >= 0xf0 && c < 0xf5 && i + 3 < b.length && (b[i + 1] & 0xc0) === 0x80 && (b[i + 2] & 0xc0) === 0x80 && (b[i + 3] & 0xc0) === 0x80) {
      cp = ((c & 7) << 18) | ((b[i + 1] & 63) << 12) | ((b[i + 2] & 63) << 6) | (b[i + 3] & 63);
      n = 4;
    }
    if (cp < 0) {
      out += String.fromCharCode(c);
      i += 1;
    } else {
      out += String.fromCodePoint(cp);
      i += n;
    }
  }
  return out;
}

export function b64Encode(s: string): string {
  return bytesToB64(utf8Encode(s));
}

export function b64Decode(s: string): string {
  return utf8Decode(b64ToBytes(s));
}

const MOPE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890';

function rnd(n: number): number {
  return Math.floor(Math.random() * n);
}

export function mopeEncrypt(json: string): string {
  const b = b64Encode(json);
  const maxAt = Math.max(0, Math.min(40, b.length - 1));
  const at = rnd(maxAt + 1);
  const n = 9 + rnd(21);
  let junk = '';
  for (let i = 0; i < n; i++) junk += MOPE[rnd(62)];
  const cut = Math.min(at + 2, b.length);
  return b.slice(0, cut) + junk + b.slice(cut) + MOPE[at + 17] + MOPE[n];
}

export function mopeDecrypt(s: string): string {
  if (s.length < 2) return '';
  const p1 = MOPE.indexOf(s[s.length - 2]) - 15;
  const p2 = MOPE.indexOf(s[s.length - 1]);
  if (p1 < 0 || p2 < 0) return '';
  const core = s.slice(0, -2);
  return b64Decode(core.slice(0, p1) + core.slice(p1 + p2)).trim();
}

// atbash de dns.php (es su propio inverso)
export function atbash(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const o = s.charCodeAt(i);
    if (o >= 65 && o <= 90) out += String.fromCharCode(155 - o);
    else if (o >= 97 && o <= 122) out += String.fromCharCode(219 - o);
    else if (o >= 48 && o <= 57) out += String.fromCharCode(105 - o);
    else out += s[i];
  }
  return out;
}

// respuesta de dns.php -> texto JSON
export function dnsDecode(body: string): string {
  return atbash(b64Decode(atbash(body.trim())));
}

// dirección codificada igual que PanelUrl.kt (XOR "KURO" -> base64 -> hex)
export function decodePanelUrl(hex: string): string {
  let ascii = '';
  for (let i = 0; i + 1 < hex.length; i += 2) ascii += String.fromCharCode(parseInt(hex.substr(i, 2), 16));
  const raw = b64ToBytes(ascii);
  const k = [75, 85, 82, 79];
  return utf8Decode(raw.map((b, i) => b ^ k[i % 4]));
}
