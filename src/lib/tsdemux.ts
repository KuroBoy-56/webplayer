// Lectura de un segmento MPEG-TS para el lector de canales (tsmux.ts): tabla de programas, video H.264 en cuadros
// (con su PTS/DTS y si es clave) y audio AAC (ADTS) en cuadros de 1024 muestras. Las marcas de tiempo van en 90 kHz.

export type Pes = { pts: number; dts: number; data: Uint8Array };
export type Au = { pts: number; dts: number; nals: Uint8Array[]; key: boolean };
export type AacFrame = { pts: number; data: Uint8Array };
export type AacInfo = { obj: number; sfi: number; channels: number; rate: number };
export type Pmt = { video: number; videoType: number; audio: { pid: number; type: number; lang: string }[] };

export const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

function readTs(d: Uint8Array, p: number): number {
  return (d[p] & 0x0e) * 536870912 + d[p + 1] * 4194304 + (d[p + 2] & 0xfe) * 16384 + d[p + 3] * 128 + (d[p + 4] >> 1);
}

function joinParts(parts: Uint8Array[], size: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function parsePes(d: Uint8Array): Pes | null {
  if (d.length < 9 || d[0] !== 0 || d[1] !== 0 || d[2] !== 1) return null;
  const flags = d[7];
  const start = 9 + d[8];
  if (start > d.length) return null;
  const pts = flags & 0x80 ? readTs(d, 9) : -1;
  const dts = (flags & 0xc0) === 0xc0 ? readTs(d, 14) : pts;
  return { pts, dts, data: d.subarray(start) };
}

// PMT de un paquete: el primer video y los audios (con su idioma, descriptor ISO 639)
function parsePmt(d: Uint8Array, p: number, end: number): Pmt | null {
  p += 1 + d[p];
  if (d[p] !== 0x02) return null;
  const secEnd = Math.min(end, p + 3 + (((d[p + 1] & 0x0f) << 8) | d[p + 2]) - 4);
  let i = p + 12 + (((d[p + 10] & 0x0f) << 8) | d[p + 11]);
  const out: Pmt = { video: -1, videoType: 0, audio: [] };
  while (i + 5 <= secEnd) {
    const type = d[i];
    const pid = ((d[i + 1] & 0x1f) << 8) | d[i + 2];
    const esLen = ((d[i + 3] & 0x0f) << 8) | d[i + 4];
    let lang = '';
    let ac3 = false;
    for (let j = i + 5; j + 2 <= i + 5 + esLen && j + 2 <= secEnd; j += 2 + d[j + 1]) {
      if (d[j] === 0x0a && d[j + 1] >= 3) lang = String.fromCharCode(d[j + 2], d[j + 3], d[j + 4]).replace(/[^a-z]/gi, '');
      // privado con AC-3, E-AC-3 o DTS (DVB)
      if (d[j] === 0x6a || d[j] === 0x7a || d[j] === 0x7b) ac3 = true;
    }
    // video: H.264 (0x1b), H.265 (0x24), MPEG-2 (0x02); audio: AAC (0x0f), LATM (0x11), MP3 (0x03/0x04), AC-3 (0x81/0x06)
    if (out.video < 0 && (type === 0x1b || type === 0x24 || type === 0x02 || type === 0x01)) {
      out.video = pid;
      out.videoType = type;
    } else if (type === 0x0f || type === 0x11 || type === 0x03 || type === 0x04 || type === 0x81 || type === 0x87 || (type === 0x06 && ac3)) {
      out.audio.push({ pid, type, lang });
    }
    i += 5 + esLen;
  }
  return out;
}

// Un segmento: la PMT (si viene) y los PES de los pid pedidos, en orden
export function demux(d: Uint8Array, pids: number[], known: Pmt | null): { pmt: Pmt | null; pes: Map<number, Pes[]> } {
  let pmtPid = -1;
  let pmt = known;
  const open = new Map<number, { parts: Uint8Array[]; size: number }>();
  const pes = new Map<number, Pes[]>();
  const flush = (pid: number) => {
    const o = open.get(pid);
    if (!o || !o.size) return;
    const p = parsePes(joinParts(o.parts, o.size));
    if (p) pes.get(pid)!.push(p);
    o.parts = [];
    o.size = 0;
  };
  for (const pid of pids) {
    pes.set(pid, []);
    open.set(pid, { parts: [], size: 0 });
  }
  for (let i = 0; i + 188 <= d.length; i += 188) {
    if (d[i] !== 0x47) continue;
    const unit = (d[i + 1] & 0x40) !== 0;
    const pid = ((d[i + 1] & 0x1f) << 8) | d[i + 2];
    const afc = (d[i + 3] >> 4) & 3;
    if (afc === 0 || afc === 2) continue;
    const p = i + 4 + (afc === 3 ? 1 + d[i + 4] : 0);
    if (p >= i + 188) continue;
    if (pid === 0) {
      if (unit) {
        const s = p + 1 + d[p];
        // primer programa (no la red: número 0)
        for (let j = s + 8; j + 4 <= s + 3 + (((d[s + 1] & 0x0f) << 8) | d[s + 2]) - 4 && j + 4 <= i + 188; j += 4) {
          if ((d[j] << 8) | d[j + 1]) {
            pmtPid = ((d[j + 2] & 0x1f) << 8) | d[j + 3];
            break;
          }
        }
      }
      continue;
    }
    if (pid === pmtPid) {
      if (unit) pmt = parsePmt(d, p, i + 188) || pmt;
      continue;
    }
    const o = open.get(pid);
    if (!o) continue;
    if (unit) flush(pid);
    if (unit || o.size) {
      o.parts.push(d.subarray(p, i + 188));
      o.size += i + 188 - p;
    }
  }
  for (const pid of pids) flush(pid);
  return { pmt, pes };
}

// NAL de un bloque Annex B (separados por 00 00 01 / 00 00 00 01)
export function splitNals(d: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const n = d.length;
  let start = -1;
  let i = 0;
  while (i + 2 < n) {
    const c = d[i + 2];
    if (c > 1) {
      i += 3;
    } else if (c === 1 && d[i + 1] === 0 && d[i] === 0) {
      if (start >= 0) {
        let e = i;
        while (e > start && d[e - 1] === 0) e--;
        if (e > start) out.push(d.subarray(start, e));
      }
      i += 3;
      start = i;
    } else {
      i++;
    }
  }
  if (start >= 0 && start < n) out.push(d.subarray(start));
  return out;
}

// cuadro de video con imagen completa (IDR, o un corte I en canales sin IDR)
function isKey(nals: Uint8Array[]): boolean {
  for (const nal of nals) {
    const type = nal[0] & 0x1f;
    if (type === 5) return true;
    if (type === 1 && nal.length > 2) {
      // primer_mb (ue) y tipo de corte (ue): I = 2 o 7 (también SI = 4 o 9)
      const r = new Bits(nal.subarray(1, 8));
      r.ue();
      const st = r.ue();
      return st === 2 || st === 7 || st === 4 || st === 9;
    }
  }
  return false;
}

const hasPicture = (nals: Uint8Array[]) => nals.some(n => {
  const t = n[0] & 0x1f;
  return t >= 1 && t <= 5;
});

// PES de video → cuadros (un PES sin PTS sigue al cuadro anterior; NAL sueltos sin imagen pasan al siguiente)
export function videoAus(list: Pes[], carry: Au | null): { aus: Au[]; carry: Au | null } {
  const aus: Au[] = [];
  let cur = carry;
  for (const p of list) {
    const nals = splitNals(p.data).filter(n => (n[0] & 0x1f) !== 9);
    if (p.pts < 0 || (cur && !hasPicture(cur.nals))) {
      if (cur) {
        cur.nals.push(...nals);
        if (p.pts >= 0 && cur.pts < 0) {
          cur.pts = p.pts;
          cur.dts = p.dts;
        }
      }
      continue;
    }
    if (cur) aus.push(cur);
    cur = { pts: p.pts, dts: p.dts, nals, key: false };
  }
  for (const a of aus) a.key = isKey(a.nals);
  return { aus, carry: cur };
}

// PES de audio AAC (ADTS) → cuadros; lo que queda partido al final pasa al siguiente PES (rest)
export function aacFrames(list: Pes[], rest: { data: Uint8Array; pts: number } | null): { frames: AacFrame[]; info: AacInfo | null; rest: { data: Uint8Array; pts: number } | null } {
  const frames: AacFrame[] = [];
  let info: AacInfo | null = null;
  let left = rest;
  for (const p of list) {
    let d = p.data;
    let pts = p.pts;
    if (left) {
      const j = new Uint8Array(left.data.length + d.length);
      j.set(left.data, 0);
      j.set(d, left.data.length);
      d = j;
      if (left.pts >= 0) pts = left.pts;
      left = null;
    }
    let i = 0;
    let k = 0;
    while (i + 7 <= d.length) {
      if (d[i] !== 0xff || (d[i + 1] & 0xf6) !== 0xf0) {
        i++;
        continue;
      }
      const head = d[i + 1] & 1 ? 7 : 9;
      const len = ((d[i + 3] & 3) << 11) | (d[i + 4] << 3) | (d[i + 5] >> 5);
      if (len < head) {
        i++;
        continue;
      }
      const sfi = (d[i + 2] >> 2) & 15;
      const rate = AAC_RATES[sfi] || 48000;
      if (i + len > d.length) break;
      if (!info) info = { obj: ((d[i + 2] >> 6) & 3) + 1, sfi, channels: ((d[i + 2] & 1) << 2) | (d[i + 3] >> 6), rate };
      frames.push({ pts: pts < 0 ? -1 : pts + Math.round((k * 1024 * 90000) / rate), data: d.subarray(i + head, i + len) });
      k++;
      i += len;
    }
    if (i < d.length && d.length - i < 8192) left = { data: d.slice(i), pts: pts < 0 || !info ? -1 : pts + Math.round((k * 1024 * 90000) / info.rate) };
  }
  return { frames, info, rest: left };
}

// Lector de bits (Exp-Golomb) sobre los datos de un NAL sin los bytes de escape 00 00 03
export class Bits {
  private d: Uint8Array;
  private p = 0;
  constructor(raw: Uint8Array) {
    const out: number[] = [];
    for (let i = 0; i < raw.length; i++) {
      if (i >= 2 && raw[i] === 3 && raw[i - 1] === 0 && raw[i - 2] === 0 && out.length >= 2 && out[out.length - 1] === 0 && out[out.length - 2] === 0) continue;
      out.push(raw[i]);
    }
    this.d = new Uint8Array(out);
  }
  u(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++) {
      const byte = this.d[this.p >> 3];
      if (byte === undefined) throw new Error('fin');
      v = v * 2 + ((byte >> (7 - (this.p & 7))) & 1);
      this.p++;
    }
    return v;
  }
  ue(): number {
    let z = 0;
    while (this.u(1) === 0) if (++z > 31) throw new Error('ue');
    return z ? Math.pow(2, z) - 1 + this.u(z) : 0;
  }
  se(): number {
    const k = this.ue();
    return k & 1 ? (k + 1) / 2 : -k / 2;
  }
}

// ancho y alto de la imagen desde el SPS (con el recorte)
export function spsSize(sps: Uint8Array): { width: number; height: number } {
  try {
    const r = new Bits(sps.subarray(1));
    const profile = r.u(8);
    r.u(16);
    r.ue();
    let chroma = 1;
    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile)) {
      chroma = r.ue();
      if (chroma === 3) r.u(1);
      r.ue();
      r.ue();
      r.u(1);
      if (r.u(1)) {
        for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
          if (!r.u(1)) continue;
          let last = 8;
          let next = 8;
          for (let j = 0; j < (i < 6 ? 16 : 64); j++) {
            if (next !== 0) next = (last + r.se() + 256) % 256;
            last = next === 0 ? last : next;
          }
        }
      }
    }
    r.ue();
    const poc = r.ue();
    if (poc === 0) r.ue();
    else if (poc === 1) {
      r.u(1);
      r.se();
      r.se();
      const k = r.ue();
      for (let i = 0; i < k; i++) r.se();
    }
    r.ue();
    r.u(1);
    const wmb = r.ue() + 1;
    const hmu = r.ue() + 1;
    const frameMbs = r.u(1);
    if (!frameMbs) r.u(1);
    r.u(1);
    let cl = 0, cr = 0, ct = 0, cb = 0;
    if (r.u(1)) {
      cl = r.ue();
      cr = r.ue();
      ct = r.ue();
      cb = r.ue();
    }
    const cx = chroma === 0 || chroma === 3 ? 1 : 2;
    const cy = (chroma === 1 ? 2 : 1) * (2 - frameMbs);
    return { width: wmb * 16 - (cl + cr) * cx, height: (2 - frameMbs) * hmu * 16 - (ct + cb) * cy };
  } catch {
    return { width: 1920, height: 1080 };
  }
}
