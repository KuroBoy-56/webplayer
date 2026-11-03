// Lectura del MKV (EBML) para mkvmse.ts: cabecera (Info, Tracks, SeekHead), índice Cues y las cabeceras de los cuadros
// de audio que MP4 necesita describir (AC-3 / E-AC-3 / MP3) y el códec H.265 para MSE.

export type MkvTrack = {
  num: number; type: number; codec: string; priv: Uint8Array | null; lang: string; name: string; def: boolean; forced: boolean;
  width: number; height: number; rate: number; channels: number; compressed: boolean;
};
// scale: nanosegundos por unidad de tiempo; duration en segundos; posiciones absolutas en el archivo
export type Mkv = { scale: number; duration: number; tracks: MkvTrack[]; segStart: number; firstCluster: number; cuesPos: number; cues: { t: number; pos: number }[] | null; vnum: number };
type Get = (off: number, len: number) => Promise<Uint8Array | null>;

export function ebmlId(b: Uint8Array, o: number): { id: number; len: number } | null {
  if (o >= b.length) return null;
  const c = b[o];
  const len = c & 0x80 ? 1 : c & 0x40 ? 2 : c & 0x20 ? 3 : c & 0x10 ? 4 : 0;
  if (!len || o + len > b.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[o + i];
  return { id, len };
}

// tamaño (size -1 = desconocido); raw = el valor sin la marca (para el lacing EBML)
export function ebmlSize(b: Uint8Array, o: number): { size: number; len: number; raw: number } | null {
  if (o >= b.length) return null;
  const c = b[o];
  let len = 1;
  while (len <= 8 && !(c & (0x80 >> (len - 1)))) len++;
  if (len > 8 || o + len > b.length) return null;
  let v = c & (0xff >> len);
  let ones = v === 0xff >> len;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[o + i];
    if (b[o + i] !== 0xff) ones = false;
  }
  return { size: ones ? -1 : v, len, raw: v };
}

export function ebmlUint(b: Uint8Array): number {
  let v = 0;
  for (let i = 0; i < b.length && i < 8; i++) v = v * 256 + b[i];
  return v;
}

export function ebmlFloat(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length === 4) return dv.getFloat32(0);
  if (b.length === 8) return dv.getFloat64(0);
  return 0;
}

// texto UTF-8 (nombres de pista con acentos)
const str = (b: Uint8Array) => {
  let s = '';
  for (let i = 0; i < b.length && b[i]; ) {
    const c = b[i];
    const n = c < 0x80 ? 1 : c >= 0xf0 ? 4 : c >= 0xe0 ? 3 : c >= 0xc0 ? 2 : 1;
    let cp = n === 1 ? c : c & (0xff >> (n + 1));
    for (let k = 1; k < n; k++) cp = (cp << 6) | ((b[i + k] ?? 0x80) & 0x3f);
    s += String.fromCodePoint(cp);
    i += n;
  }
  return s;
};

// hijos de un elemento ya leído entero
function kids(b: Uint8Array, s = 0, e = b.length): { id: number; body: Uint8Array }[] {
  const out = [];
  let p = s;
  while (p < e) {
    const id = ebmlId(b, p);
    const sz = id ? ebmlSize(b, p + id.len) : null;
    if (!id || !sz || sz.size < 0) break;
    const at = p + id.len + sz.len;
    if (at + sz.size > e) break;
    out.push({ id: id.id, body: b.subarray(at, at + sz.size) });
    p = at + sz.size;
  }
  return out;
}

function track(e: Uint8Array): MkvTrack {
  const t: MkvTrack = { num: 0, type: 0, codec: '', priv: null, lang: 'eng', name: '', def: true, forced: false, width: 0, height: 0, rate: 0, channels: 0, compressed: false };
  let ietf = '';
  for (const k of kids(e)) {
    if (k.id === 0xd7) t.num = ebmlUint(k.body);
    else if (k.id === 0x83) t.type = ebmlUint(k.body);
    else if (k.id === 0x86) t.codec = str(k.body);
    else if (k.id === 0x63a2) t.priv = k.body.slice();
    else if (k.id === 0x22b59c) t.lang = str(k.body);
    else if (k.id === 0x22b59d) ietf = str(k.body);
    else if (k.id === 0x536e) t.name = str(k.body);
    else if (k.id === 0x88) t.def = ebmlUint(k.body) !== 0;
    else if (k.id === 0x55aa) t.forced = ebmlUint(k.body) !== 0;
    else if (k.id === 0x6d80) t.compressed = true;
    else if (k.id === 0xe0) {
      for (const v of kids(k.body)) {
        if (v.id === 0xb0) t.width = ebmlUint(v.body);
        else if (v.id === 0xba) t.height = ebmlUint(v.body);
      }
    } else if (k.id === 0xe1) {
      for (const a of kids(k.body)) {
        if (a.id === 0xb5) t.rate = Math.round(ebmlFloat(a.body));
        else if (a.id === 0x9f) t.channels = ebmlUint(a.body);
      }
    }
  }
  if (ietf && (!t.lang || t.lang === 'und')) t.lang = ietf;
  return t;
}

// EBML + Segment hasta el primer Cluster: escala, duración, pistas y dónde está el índice
export async function readMkvHeader(get: Get): Promise<Mkv | null> {
  let base = 0;
  let b = await get(0, 524288);
  if (!b || b.length < 32) return null;
  const at = async (off: number, need: number): Promise<number> => {
    // posición de off dentro de b (lee de nuevo si hace falta)
    if (off >= base && off + need <= base + b!.length) return off - base;
    const d = await get(off, Math.max(need, 262144));
    if (!d) return -1;
    b = d;
    base = off;
    return d.length >= Math.min(need, 12) ? 0 : -1;
  };
  const head = ebmlId(b, 0);
  if (!head || head.id !== 0x1a45dfa3) return null;
  const hs = ebmlSize(b, head.len);
  if (!hs || hs.size < 0) return null;
  let p = head.len + hs.len + hs.size;
  const seg = ebmlId(b, p);
  const ss = seg ? ebmlSize(b, p + seg.len) : null;
  if (!seg || seg.id !== 0x18538067 || !ss) return null;
  const m: Mkv = { scale: 1000000, duration: 0, tracks: [], segStart: p + seg.len + ss.len, firstCluster: 0, cuesPos: 0, cues: null, vnum: 0 };
  p = m.segStart;
  let durRaw = 0;
  for (let n = 0; n < 64; n++) {
    let o = await at(p, 12);
    if (o < 0) return null;
    const id = ebmlId(b, o);
    const sz = id ? ebmlSize(b, o + id.len) : null;
    if (!id || !sz) return null;
    if (id.id === 0x1f43b675) {
      m.firstCluster = p;
      break;
    }
    if (sz.size < 0) return null;
    const hl = id.len + sz.len;
    if (id.id === 0x114d9b74 || id.id === 0x1549a966 || id.id === 0x1654ae6b) {
      if (sz.size > 8388608) return null;
      o = await at(p, hl + sz.size);
      if (o < 0 || o + hl + sz.size > b.length) return null;
      const body = b.subarray(o + hl, o + hl + sz.size);
      if (id.id === 0x114d9b74) {
        for (const s of kids(body)) {
          if (s.id !== 0x4dbb) continue;
          let sid = 0;
          let pos = -1;
          for (const k of kids(s.body)) {
            if (k.id === 0x53ab) sid = ebmlUint(k.body);
            else if (k.id === 0x53ac) pos = ebmlUint(k.body);
          }
          if (sid === 0x1c53bb6b && pos >= 0) m.cuesPos = m.segStart + pos;
        }
      } else if (id.id === 0x1549a966) {
        for (const k of kids(body)) {
          if (k.id === 0x2ad7b1) m.scale = ebmlUint(k.body) || 1000000;
          else if (k.id === 0x4489) durRaw = ebmlFloat(k.body);
        }
      } else {
        m.tracks = kids(body).filter(k => k.id === 0xae).map(k => track(k.body)).filter(t => t.num > 0 && t.codec);
      }
    } else if (id.id === 0x1c53bb6b) m.cuesPos = p;
    p += hl + sz.size;
  }
  if (!m.firstCluster || !m.tracks.length) return null;
  m.duration = (durRaw * m.scale) / 1e9;
  m.vnum = m.tracks.find(t => t.type === 1)?.num || 0;
  return m;
}

// índice Cues: segundo y Cluster de cada punto (los del video)
export async function readCues(get: Get, m: Mkv): Promise<{ t: number; pos: number }[] | null> {
  const h = await get(m.cuesPos, 16);
  const id = h ? ebmlId(h, 0) : null;
  const sz = id ? ebmlSize(h!, id.len) : null;
  if (!id || id.id !== 0x1c53bb6b || !sz || sz.size < 0 || sz.size > 16777216) return null;
  const b = await get(m.cuesPos + id.len + sz.len, sz.size);
  if (!b) return null;
  const out: { t: number; pos: number }[] = [];
  for (const cp of kids(b)) {
    if (cp.id !== 0xbb) continue;
    let t = -1;
    for (const k of kids(cp.body)) {
      if (k.id === 0xb3) t = ebmlUint(k.body);
      else if (k.id === 0xb7 && t >= 0) {
        let tr = 0;
        let pos = -1;
        for (const x of kids(k.body)) {
          if (x.id === 0xf7) tr = ebmlUint(x.body);
          else if (x.id === 0xf1) pos = ebmlUint(x.body);
        }
        if (pos >= 0 && (!m.vnum || tr === m.vnum)) out.push({ t: (t * m.scale) / 1e9, pos: m.segStart + pos });
      }
    }
  }
  out.sort((a, c) => a.t - c.t);
  return out;
}

// frecuencia del AAC según su AudioSpecificConfig (la del núcleo en HE-AAC: 1024 muestras por cuadro)
export function aacRate(cfg: Uint8Array): { rate: number } {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const fi = ((cfg[0] & 7) << 1) | (cfg[1] >> 7);
  if (fi === 15 && cfg.length >= 5) return { rate: ((cfg[1] & 0x7f) << 17) | (cfg[2] << 9) | (cfg[3] << 1) | (cfg[4] >> 7) };
  return { rate: rates[fi] || 48000 };
}

class Bits {
  private p = 0;
  constructor(private b: Uint8Array, start: number) {
    this.p = start * 8;
  }
  read(n: number): number {
    let v = 0;
    for (let i = 0; i < n; i++, this.p++) v = (v << 1) | ((this.b[this.p >> 3] >> (7 - (this.p & 7))) & 1);
    return v;
  }
}
class BitWriter {
  bits: number[] = [];
  put(v: number, n: number): void {
    for (let i = n - 1; i >= 0; i--) this.bits.push((v >> i) & 1);
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(Math.ceil(this.bits.length / 8));
    this.bits.forEach((bit, i) => (out[i >> 3] |= bit << (7 - (i & 7))));
    return out;
  }
}

const AC3_CH = [2, 1, 2, 3, 3, 4, 4, 5];

// AC-3 / E-AC-3: frecuencia, canales, muestras por cuadro y el contenido de la caja dac3 / dec3
export function ac3Info(f: Uint8Array): { rate: number; channels: number; samples: number; box: Uint8Array } | null {
  if (f.length < 8 || f[0] !== 0x0b || f[1] !== 0x77) return null;
  const bsid = f[5] >> 3;
  if (bsid <= 10) {
    const r = new Bits(f, 4);
    const fscod = r.read(2);
    const frmsizecod = r.read(6);
    r.read(5);
    const bsmod = r.read(3);
    const acmod = r.read(3);
    if ((acmod & 1) && acmod !== 1) r.read(2);
    if (acmod & 4) r.read(2);
    if (acmod === 2) r.read(2);
    const lfeon = r.read(1);
    if (fscod > 2) return null;
    const w = new BitWriter();
    w.put(fscod, 2); w.put(bsid, 5); w.put(bsmod, 3); w.put(acmod, 3); w.put(lfeon, 1); w.put(frmsizecod >> 1, 5); w.put(0, 5);
    return { rate: [48000, 44100, 32000][fscod], channels: AC3_CH[acmod] + lfeon, samples: 1536, box: w.bytes() };
  }
  const r = new Bits(f, 2);
  r.read(2); // strmtyp
  r.read(3); // substreamid
  const frmsiz = r.read(11);
  const fscod = r.read(2);
  let blocks = 6;
  let rate: number;
  if (fscod === 3) {
    rate = [24000, 22050, 16000][r.read(2)] || 24000;
  } else {
    blocks = [1, 2, 3, 6][r.read(2)];
    rate = [48000, 44100, 32000][fscod];
  }
  const acmod = r.read(3);
  const lfeon = r.read(1);
  const eb = r.read(5);
  const samples = blocks * 256;
  const kbps = Math.round(((frmsiz + 1) * 2 * 8 * rate) / samples / 1000);
  const w = new BitWriter();
  w.put(kbps & 0x1fff, 13); w.put(0, 3);
  w.put(fscod, 2); w.put(eb, 5); w.put(0, 1); w.put(0, 1); w.put(0, 3); w.put(acmod, 3); w.put(lfeon, 1); w.put(0, 3); w.put(0, 4); w.put(0, 1);
  return { rate, channels: AC3_CH[acmod] + lfeon, samples, box: w.bytes() };
}

// MP3 / MP2: frecuencia, canales y muestras por cuadro
export function mpaInfo(f: Uint8Array): { rate: number; channels: number; samples: number } | null {
  if (f.length < 4 || f[0] !== 0xff || (f[1] & 0xe0) !== 0xe0) return null;
  const ver = (f[1] >> 3) & 3; // 3 MPEG-1, 2 MPEG-2, 0 MPEG-2.5
  const layer = (f[1] >> 1) & 3; // 1 = III, 2 = II
  const si = (f[2] >> 2) & 3;
  if (ver === 1 || si === 3) return null;
  const table = ver === 3 ? [44100, 48000, 32000] : ver === 2 ? [22050, 24000, 16000] : [11025, 12000, 8000];
  const samples = layer === 1 ? (ver === 3 ? 1152 : 576) : 1152;
  return { rate: table[si], channels: (f[3] >> 6) === 3 ? 1 : 2, samples };
}

// códec H.265 para MSE desde el hvcC (hvc1.<perfil>.<compatibilidad>.<nivel>.<restricciones>)
export function hevcCodec(h: Uint8Array): string {
  const space = h[1] >> 6;
  const tier = (h[1] >> 5) & 1;
  const profile = h[1] & 31;
  let compat = ((h[2] << 24) >>> 0) + (h[3] << 16) + (h[4] << 8) + h[5];
  let rev = 0;
  for (let i = 0; i < 32; i++) {
    rev = (rev * 2) + (compat & 1);
    compat >>>= 1;
  }
  const cons: string[] = [];
  for (let i = 6; i < 12; i++) cons.push(h[i].toString(16).toUpperCase());
  while (cons.length && cons[cons.length - 1] === '0') cons.pop();
  return 'hvc1.' + ['', 'A', 'B', 'C'][space] + profile + '.' + rev.toString(16).toUpperCase() + '.' + (tier ? 'H' : 'L') + h[12] + (cons.length ? '.' + cons.join('.') : '');
}
