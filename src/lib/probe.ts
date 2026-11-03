// Pistas de audio y subtítulos de un MP4 o MKV leyendo solo su cabecera (peticiones Range: 512 KB la primera,
// 256 KB las demás; el índice moov de un MP4 de una sola vez; cada video se lee una sola vez por sesión),
// igual que Probe.brs de Roku: cuántos audios y subtítulos trae el archivo, su idioma, su códec y su
// orden (el mismo que usa el motor del panel: 0:a:N y 0:s:N).
import { UA } from './http';

export type ProbeTrack = { id: string; lang: string; codec: string; name: string; def: boolean; forced: boolean };
// headOk: el archivo contestó (si no es MKV ni MP4 —AVI, TS— no hay pistas que leer y no se vuelve a intentar)
// video / moovEnd: solo para el reporte de un video que el equipo no abre (códec del video; índice MP4 al final)
export type Probe = { ok: boolean; container: '' | 'mp4' | 'mkv'; audio: ProbeTrack[]; subs: ProbeTrack[]; headOk?: boolean; video?: string; moovEnd?: boolean };

const CHUNK = 262144;
// la primera lectura de 256 KB: en un MKV las pistas están al principio y con el video sonando sale más rápido
const FIRST = 262144;
// el índice moov de un MP4 (o el final del archivo donde está) se trae entero si no pasa de esto
const MOOV_MAX = 4194304;
const MAX_REQ = 14;

type Reader = { url: string; chunks: { start: number; data: Uint8Array }[]; size: number; requests: number; failed: boolean };

// lecturas en curso por video: al abrir el video se cortan (en líneas de una sola conexión el reproductor no
// podía abrirlo mientras la lectura seguía y caía en «no abre el video directo»)
const running = new Map<string, Set<AbortController>>();

export function stopProbe(url: string): void {
  for (const c of running.get(url) || []) c.abort();
  running.delete(url);
}

async function fetchRange(r: Reader, off: number, len: number): Promise<Uint8Array | null> {
  if (r.failed) return null;
  r.requests++;
  const ctrl = new AbortController();
  let set = running.get(r.url);
  if (!set) running.set(r.url, (set = new Set()));
  set.add(ctrl);
  // un servidor lento no detiene la detección: 5 s por pedido (9 s el índice grande de un MP4)
  const timer = setTimeout(() => ctrl.abort(), len > FIRST ? 9000 : 5000);
  try {
    const res = await fetch(r.url, { headers: { 'User-Agent': UA, Range: 'bytes=' + off + '-' + (off + len - 1) }, signal: ctrl.signal });
    if (res.status !== 206 && !(res.status === 200 && off === 0)) {
      ctrl.abort(); // la conexión no queda abierta
      return null;
    }
    const cr = res.headers.get('content-range') || '';
    const total = Number(cr.slice(cr.indexOf('/') + 1));
    if (cr.includes('/') && Number.isFinite(total) && total > 0) r.size = total;
    // un 200 sin Range traería el archivo entero: solo se acepta si es pequeño
    // (sin content-length tampoco: bajaría el video completo a la memoria y la app se cerraba)
    const cl = Number(res.headers.get('content-length') || 0);
    if (res.status === 200 && (!(cl > 0) || cl > len * 4)) {
      ctrl.abort();
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.length ? (buf.length > len * 4 ? buf.slice(0, len) : buf) : null;
  } catch {
    // cortada (stopProbe o tiempo agotado): no se pide nada más de este video
    if (ctrl.signal.aborted) r.failed = true;
    return null;
  } finally {
    clearTimeout(timer);
    set.delete(ctrl);
  }
}

async function read(r: Reader, off: number, len: number): Promise<Uint8Array | null> {
  for (const c of r.chunks) if (off >= c.start && off + len <= c.start + c.data.length) return c.data.subarray(off - c.start, off - c.start + len);
  if (r.requests >= MAX_REQ || r.failed) {
    r.failed = true;
    return null;
  }
  const data = await fetchRange(r, off, Math.max(len, off === 0 ? FIRST : CHUNK));
  if (!data) {
    r.failed = true;
    return null;
  }
  r.chunks.push({ start: off, data });
  return data.subarray(0, Math.min(len, data.length));
}

function u(b: Uint8Array, at: number, n: number): number {
  let v = 0;
  for (let i = 0; i < n; i++) v = v * 256 + (b[at + i] || 0);
  return v;
}

function fourcc(b: Uint8Array, at: number): string {
  let s = '';
  for (let i = 0; i < 4 && at + i < b.length; i++) s += String.fromCharCode(b[at + i]);
  return s;
}

function ascii(b: Uint8Array, from = 0): string {
  let s = '';
  for (let i = from; i < b.length; i++) {
    if (b[i] === 0) break;
    if (b[i] >= 32 && b[i] < 127) s += String.fromCharCode(b[i]);
  }
  return s;
}

// ---------- MP4 ----------

async function box(r: Reader, off: number, end: number): Promise<{ size: number; type: string; hl: number } | null> {
  const h = await read(r, off, 16);
  if (!h || h.length < 8) return null;
  let size = u(h, 0, 4);
  const type = fourcc(h, 4);
  let hl = 8;
  if (size === 1) {
    if (h.length < 16) return null;
    size = u(h, 8, 8);
    hl = 16;
  } else if (size === 0) size = end - off;
  return size < hl ? null : { size, type, hl };
}

// [off, off + len) en un solo pedido si no está ya leído
async function prefetch(r: Reader, off: number, len: number): Promise<void> {
  if (r.chunks.some(c => off >= c.start && off + len <= c.start + c.data.length) || r.requests >= MAX_REQ) return;
  const data = await fetchRange(r, off, len);
  if (data) r.chunks.push({ start: off, data });
}

async function mp4(r: Reader): Promise<{ audio: ProbeTrack[]; subs: ProbeTrack[]; video?: string; moovEnd?: boolean }> {
  let off = 0;
  let mdat = false;
  for (let i = 0; i < 20; i++) {
    const lim = r.size > 0 ? r.size : Number.MAX_SAFE_INTEGER;
    // moov al final del archivo (después del video): el final entero en un solo pedido
    if (off > 0 && r.size > 0 && r.size - off <= MOOV_MAX) await prefetch(r, off, r.size - off);
    const b = await box(r, off, lim);
    if (!b) break;
    if (b.type === 'moov') {
      if (b.size <= MOOV_MAX) await prefetch(r, off, b.size);
      return { ...(await moov(r, off + b.hl, off + b.size)), moovEnd: mdat };
    }
    if (b.type === 'mdat') mdat = true;
    off += b.size;
    if (r.size > 0 && off >= r.size) break;
  }
  return { audio: [], subs: [] };
}

// subtítulos de MP4: texto 3GPP (sbtl/text), WebVTT y TTML (subt), CEA-608 (clcp)
const SUB_HANDLERS = ['sbtl', 'text', 'subt', 'clcp'];

async function moov(r: Reader, off: number, end: number) {
  const out = { audio: [] as ProbeTrack[], subs: [] as ProbeTrack[], video: '' };
  let n = 0;
  while (off < end && n < 32) {
    const b = await box(r, off, end);
    if (!b) break;
    if (b.type === 'trak') {
      n++;
      const t = await trak(r, off + b.hl, off + b.size);
      const e = { id: t.id, lang: t.lang, codec: t.codec, name: t.name, def: t.enabled, forced: false };
      if (t.handler === 'soun') out.audio.push(e);
      else if (t.handler === 'vide' && !out.video) out.video = t.codec;
      else if (SUB_HANDLERS.includes(t.handler)) out.subs.push(e);
    }
    off += b.size;
  }
  return out;
}

async function trak(r: Reader, off: number, end: number) {
  const t = { id: '', handler: '', lang: '', codec: '', name: '', enabled: false };
  let guard = 0;
  while (off < end && guard++ < 60) {
    const b = await box(r, off, end);
    if (!b) break;
    const body = off + b.hl;
    if (b.type === 'mdia' || b.type === 'minf' || b.type === 'stbl') {
      off = body;
      continue;
    }
    if (b.type === 'tkhd') {
      const h = await read(r, body, 32);
      if (h && h.length >= 32) {
        t.enabled = (h[3] & 1) === 1;
        t.id = String(h[0] === 1 ? u(h, 20, 4) : u(h, 12, 4));
      }
    } else if (b.type === 'mdhd') {
      const h = await read(r, body, 36);
      if (h && h.length >= 36) {
        const code = u(h, h[0] === 1 ? 32 : 20, 2);
        const lang = String.fromCharCode(((code >> 10) & 31) + 96, ((code >> 5) & 31) + 96, (code & 31) + 96);
        if (code !== 0 && lang !== 'und') t.lang = lang;
      }
    } else if (b.type === 'hdlr') {
      const h = await read(r, body, Math.min(80, b.size - b.hl));
      if (h && h.length >= 12) {
        t.handler = fourcc(h, 8);
        t.name = ascii(h, 24).trim();
        // nombres genéricos que pone el programa que armó el archivo
        if (/handler|core media|gpac/i.test(t.name)) t.name = '';
      }
    } else if (b.type === 'stsd') {
      const h = await read(r, body, 16);
      if (h && h.length >= 16) t.codec = fourcc(h, 12);
    }
    off += b.size;
  }
  return t;
}

// ---------- MKV / WebM ----------

async function vint(r: Reader, off: number, keep: boolean): Promise<{ v: number; n: number } | null> {
  const h = await read(r, off, 8);
  if (!h || !h.length) return null;
  const first = h[0];
  let n = 1;
  while (n <= 8 && (first & (128 >> (n - 1))) === 0) n++;
  if (n > 8 || h.length < n) return null;
  const mask = 255 >> n;
  let v = keep ? first : first & mask;
  let allOnes = (first & mask) === mask;
  for (let i = 1; i < n; i++) {
    v = v * 256 + h[i];
    if (h[i] !== 255) allOnes = false;
  }
  if (!keep && allOnes) v = -1;
  return { v, n };
}

// elemento EBML: {id, data, size} (size -1 = desconocido)
async function el(r: Reader, off: number): Promise<{ id: number; data: number; size: number } | null> {
  const id = await vint(r, off, true);
  if (!id) return null;
  const sz = await vint(r, off + id.n, false);
  if (!sz) return null;
  return { id: id.v, data: off + id.n + sz.n, size: sz.v };
}

async function mkv(r: Reader) {
  const none = { audio: [] as ProbeTrack[], subs: [] as ProbeTrack[] };
  const e = await el(r, 0);
  if (!e || e.size < 0) return none;
  const seg = await el(r, e.data + e.size);
  if (!seg || seg.id !== 0x18538067) return none;
  let off = seg.data;
  const segEnd = seg.size >= 0 ? seg.data + seg.size : Number.MAX_SAFE_INTEGER;
  for (let i = 0; i < 40 && off < segEnd; i++) {
    const x = await el(r, off);
    if (!x || x.size < 0) return none;
    if (x.id === 0x1654ae6b) return mkvTracks(r, x.data, x.data + x.size);
    if (x.id === 0x1f43b675) return none; // Cluster: ya empezó el video sin Tracks
    off = x.data + x.size;
  }
  return none;
}

// TrackEntry: TrackNumber D7, TrackType 83 (2 audio, 17 subtítulos), Language 22B59C, CodecID 86,
// Name 536E, FlagDefault 88 (vale 1 si no viene), FlagForced 55AA
async function mkvTracks(r: Reader, off: number, end: number) {
  const out = { audio: [] as ProbeTrack[], subs: [] as ProbeTrack[], video: '' };
  for (let i = 0; i < 64 && off < end; i++) {
    const x = await el(r, off);
    if (!x || x.size < 0) break;
    if (x.id === 0xae) {
      const t = { num: '', type: 0, lang: '', codec: '', name: '', def: true, forced: false };
      let o = x.data;
      const eEnd = x.data + x.size;
      for (let j = 0; j < 40 && o < eEnd; j++) {
        const c = await el(r, o);
        if (!c || c.size < 0) break;
        const n = Math.min(64, c.size);
        if (c.id === 0xd7 || c.id === 0x83 || c.id === 0x88 || c.id === 0x55aa) {
          const v = await read(r, c.data, n);
          if (v) {
            const val = u(v, 0, v.length);
            if (c.id === 0xd7) t.num = String(val);
            else if (c.id === 0x83) t.type = val;
            else if (c.id === 0x88) t.def = val !== 0;
            else t.forced = val !== 0;
          }
        } else if (c.id === 0x22b59c || c.id === 0x86 || c.id === 0x536e) {
          const v = await read(r, c.data, n);
          const s = v ? ascii(v) : '';
          if (c.id === 0x22b59c) t.lang = s;
          if (c.id === 0x86) t.codec = s;
          if (c.id === 0x536e) t.name = s;
        }
        o = c.data + c.size;
      }
      const e = { id: t.num, lang: t.lang, codec: t.codec, name: t.name, def: t.def, forced: t.forced };
      if (t.type === 1 && !out.video) out.video = t.codec;
      if (t.type === 2) out.audio.push(e);
      if (t.type === 17) out.subs.push(e);
    }
    off = x.data + x.size;
  }
  return out;
}

// una lectura por video: la que arranca al abrirlo (load) la reutilizan "playing" y el error del reproductor
const cache = new Map<string, Promise<Probe>>();

export function probeTracks(url: string): Promise<Probe> {
  const hit = cache.get(url);
  if (hit) return hit;
  const p = readTracks(url).then(res => {
    if (!res.ok) cache.delete(url); // otra oportunidad la próxima vez
    return res;
  });
  cache.set(url, p);
  if (cache.size > 40) cache.delete(cache.keys().next().value as string);
  return p;
}

async function readTracks(url: string): Promise<Probe> {
  const r: Reader = { url, chunks: [], size: 0, requests: 0, failed: false };
  const out: Probe = { ok: false, container: '', audio: [], subs: [] };
  try {
    const head = await read(r, 0, 16);
    if (!head || head.length < 8) return out;
    out.headOk = true;
    let res: { audio: ProbeTrack[]; subs: ProbeTrack[]; video?: string; moovEnd?: boolean } = { audio: [], subs: [] };
    if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) {
      out.container = 'mkv';
      res = await mkv(r);
    } else if (['ftyp', 'moov', 'free', 'mdat', 'skip', 'wide', 'pdin'].includes(fourcc(head, 4))) {
      out.container = 'mp4';
      res = await mp4(r);
    }
    out.audio = res.audio;
    out.subs = res.subs;
    out.video = res.video;
    out.moovEnd = res.moovEnd;
    out.ok = !r.failed && (out.audio.length > 0 || out.subs.length > 0);
  } catch {
    out.ok = false;
  }
  return out;
}
