// MP4 directo del servidor IPTV sin el panel. El modo directo del reproductor de Vega (src = dirección) da error 4 con
// los MP4 que traen su índice (moov) al final del archivo, lo normal en los servidores IPTV; con el MP4 de siempre
// (H.264 + AAC) por Media Source Extensions sí suena. Aquí se lee el índice con pedidos Range al mismo servidor, se
// bajan de a ~4 s las muestras de video y del audio predeterminado y se entregan como MP4 fragmentado (mp4box.ts).
// No pasa por la VPS: solo el cambio de idioma la usa. Saltos (◀▶, Continuar viendo) desde el cuadro clave anterior.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { rangeGet, RangeState } from './rangeget';
import { lineLimit, ReadAhead } from './readahead';
import { dropIndex, hasIndex, loadIndex, saveIndex, STALE_INDEX, fromBase64, toBase64 } from './indexstore';
import { bridgeAsk, shareIndex, sharedIndex, sharedKnown, sharedStale } from './sharedindex';
import { dropPrefetch, prefetchedAt } from './prefetch';
export { STALE_INDEX };
import { readJson, writeJson } from '../lib/storage';
import { AUDIO_ID, AudioCfg, concat, fragment, initSegment, mp4Mime, Sample, VIDEO_ID, VideoCfg, videoEntry } from '../lib/mp4box';
import { hevcCodec } from './mkvparse';
import { sameLang } from '../lib/lang';
import { StartWatch } from './startwatch';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const AHEAD = 40; // segundos bajados por adelantado
const CHUNK = 4; // segundos de video por pedido
const MOOV_MAX = 64 * 1048576;
// motivo cuando el archivo «.mp4» es un MKV (playback lo pasa al lector de MKV)
export const NOT_MP4_MKV = 'el archivo es MKV';

type Trk = {
  // shift: segundos que se le suman a la pista para que video y audio queden como los muestra el archivo (lista de
  // edición: el video suele empezar unas décimas después por los cuadros B) sin tiempos negativos
  // delay: tramos vacíos al principio de la lista de edición (la pista empieza más tarde), en la escala de la película
  kind: string; lang: string; ts: number; enabled: boolean; entry: Uint8Array | null; width: number; height: number; mediaTime: number; delay: number; shift: number;
  // tablas de muestras (fillTables): arreglos de tamaño fijo, no listas que crecen de a uno (2.0.12)
  off: Float64Array; size: Uint32Array; dts: Float64Array; cts: Int32Array; key: Set<number> | null;
  // dónde están sus tablas en el índice (se leen solo las de las pistas que se usan)
  tbl: { [t: string]: { s: number; e: number } | undefined } | null; filled: boolean;
};
const NO_F64 = new Float64Array(0);
const NO_U32 = new Uint32Array(0);
const NO_I32 = new Int32Array(0);

const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const u16 = (b: Uint8Array, o: number) => (b[o] << 8) + b[o + 1];
const u64 = (b: Uint8Array, o: number) => u32(b, o) * 4294967296 + u32(b, o + 4);
const typ = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

// cajas hijas de [s, e): tipo, inicio del contenido y fin
function kids(b: Uint8Array, s: number, e: number): { t: string; s: number; e: number }[] {
  const out = [];
  while (s + 8 <= e) {
    let size = u32(b, s);
    let hl = 8;
    if (size === 1) {
      size = u64(b, s + 8);
      hl = 16;
    } else if (size === 0) size = e - s;
    if (size < hl || s + size > e) break;
    out.push({ t: typ(b, s + 4), s: s + hl, e: s + size });
    s += size;
  }
  return out;
}
const kid = (b: Uint8Array, s: number, e: number, t: string) => kids(b, s, e).find(k => k.t === t) || null;

// Cabecera de una pista (tipo, idioma, escala, descripción, lista de edición) y dónde están sus tablas. Las tablas de
// muestras se leen aparte (fillTables) y solo las del video y el audio elegido: un MP4 de 2 h con 3 idiomas tiene ~1
// millón de muestras y leerlas todas, de a una en listas que crecen, tardaba varios segundos en el Fire TV (aviso
// «tardó en empezar»: índice=7.5MB en 2.4s, imagen recién a los 6.8s)
function parseTrak(b: Uint8Array, s: number, e: number): Trk | null {
  const tk: Trk = { kind: '', lang: '', ts: 0, enabled: false, entry: null, width: 0, height: 0, mediaTime: 0, delay: 0, shift: 0, off: NO_F64, size: NO_U32, dts: NO_F64, cts: NO_I32, key: null, tbl: null, filled: false };
  const tkhd = kid(b, s, e, 'tkhd');
  if (tkhd) tk.enabled = (b[tkhd.s + 3] & 1) === 1;
  const elst = kid(b, s, e, 'edts');
  const el = elst ? kid(b, elst.s, elst.e, 'elst') : null;
  if (el) {
    const v1 = b[el.s] === 1;
    for (let i = 0, n = u32(b, el.s + 4), o = el.s + 8; i < n; i++, o += v1 ? 20 : 12) {
      const mt = v1 ? u64(b, o + 8) : u32(b, o + 4);
      if (mt !== 0xffffffff && mt < 2 ** 52) {
        tk.mediaTime = mt;
        break;
      }
      // tramo vacío (media_time -1): la pista empieza esa duración después (p. ej. el audio 5 s más tarde que el video;
      // antes se ignoraba y ese audio sonaba 5 s adelantado)
      tk.delay += v1 ? u64(b, o) : u32(b, o);
    }
  }
  const mdia = kid(b, s, e, 'mdia');
  if (!mdia) return null;
  const mdhd = kid(b, mdia.s, mdia.e, 'mdhd');
  const hdlr = kid(b, mdia.s, mdia.e, 'hdlr');
  const minf = kid(b, mdia.s, mdia.e, 'minf');
  const stbl = minf ? kid(b, minf.s, minf.e, 'stbl') : null;
  if (!mdhd || !hdlr || !stbl) return null;
  tk.ts = u32(b, mdhd.s + (b[mdhd.s] === 1 ? 20 : 12));
  const language = u16(b, mdhd.s + (b[mdhd.s] === 1 ? 32 : 20));
  if (language) tk.lang = String.fromCharCode(96 + ((language >> 10) & 31), 96 + ((language >> 5) & 31), 96 + (language & 31));
  tk.kind = typ(b, hdlr.s + 8);
  const tbl: Trk['tbl'] = {};
  for (const k of kids(b, stbl.s, stbl.e)) if (!tbl[k.t]) tbl[k.t] = { s: k.s, e: k.e };
  const stsd = tbl.stsd;
  const ent = stsd ? kids(b, stsd.s + 8, stsd.e)[0] : null;
  if (ent) tk.entry = b.subarray(ent.s - 8, ent.e);
  if (!tk.ts) return null;
  const stsz = tbl.stsz;
  // sin tablas: una pista del índice guardado «adelgazado» (slimMoov), solo con su descripción (idioma y códec para el
  // menú); o un archivo dañado. fillTables da false y el que llama decide
  if (!stsz || !u32(b, stsz.s + 8) || !(tbl.stco || tbl.co64) || !tbl.stsc || !tbl.stts) return tk;
  tk.tbl = tbl;
  return tk;
}

// caja con su cabecera
function box(t: string, body: Uint8Array[]): Uint8Array {
  const n = body.reduce((a, x) => a + x.length, 8);
  const out = new Uint8Array(n);
  out[0] = n >>> 24; out[1] = (n >> 16) & 255; out[2] = (n >> 8) & 255; out[3] = n & 255;
  for (let i = 0; i < 4; i++) out[4 + i] = t.charCodeAt(i);
  let o = 8;
  for (const x of body) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

// Índice «adelgazado» para guardar en el equipo (indexstore.ts): la cabecera, el video y el audio keep completos; de
// las demás pistas (otros idiomas, subtítulos) solo la descripción, sin sus tablas de muestras (cada audio son ~1,3 MB
// en una película de 2 h). Elegir después otro idioma vuelve a leer el índice entero del servidor.
export function slimMoov(moov: Uint8Array, keep: number): Uint8Array {
  const out: Uint8Array[] = [];
  let audio = -1;
  // la caja entera, con su cabecera (8 bytes, o 16 si es de tamaño largo)
  const raw = (k: { s: number; e: number }) => {
    const h = k.s >= 16 && u32(moov, k.s - 16) === 1 ? 16 : 8;
    return moov.subarray(k.s - h, k.e);
  };
  // copia la caja k dejando de sus hijas path[0] → path[1]… solo lo que diga only al final
  const strip = (k: { t: string; s: number; e: number }, path: string[]): Uint8Array =>
    box(k.t, kids(moov, k.s, k.e).map(c => (c.t !== path[0] ? raw(c) : path.length > 1 ? strip(c, path.slice(1)) : box(c.t, kids(moov, c.s, c.e).filter(x => x.t === 'stsd').map(raw)))));
  for (const k of kids(moov, 0, moov.length)) {
    if (k.t === 'mvhd') out.push(raw(k));
    if (k.t !== 'trak') continue;
    const mdia = kid(moov, k.s, k.e, 'mdia');
    const hdlr = mdia ? kid(moov, mdia.s, mdia.e, 'hdlr') : null;
    const kind = hdlr ? typ(moov, hdlr.s + 8) : '';
    if (kind === 'soun') audio++;
    if (kind === 'vide' || (kind === 'soun' && audio === keep)) out.push(raw(k));
    else out.push(strip(k, ['mdia', 'minf', 'stbl']));
  }
  return concat(out);
}

// Tablas de muestras de una pista: tamaño, posición en el archivo, tiempo de decodificación, desfase de presentación y
// cuadros clave. false = no sirven (la pista no se puede usar)
function fillTables(b: Uint8Array, tk: Trk): boolean {
  if (tk.filled) return tk.size.length > 0;
  tk.filled = true;
  const tbl = tk.tbl;
  if (!tbl) return false;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  // tamaños
  const stsz = tbl.stsz!;
  const fixed = dv.getUint32(stsz.s + 4);
  const n = dv.getUint32(stsz.s + 8);
  const size = new Uint32Array(n);
  if (fixed) size.fill(fixed);
  else for (let i = 0, o = stsz.s + 12; i < n; i++, o += 4) size[i] = dv.getUint32(o);
  // posición de cada muestra: trozos (stco / co64) y muestras por trozo (stsc)
  const co = (tbl.stco || tbl.co64)!;
  const wide = !tbl.stco;
  const stsc = tbl.stsc!;
  const chunks = dv.getUint32(co.s + 4);
  const runs = dv.getUint32(stsc.s + 4);
  const off = new Float64Array(n);
  let smp = 0;
  for (let r = 0; r < runs && smp < n; r++) {
    const first = dv.getUint32(stsc.s + 8 + r * 12);
    const per = dv.getUint32(stsc.s + 12 + r * 12);
    const last = r + 1 < runs ? dv.getUint32(stsc.s + 8 + (r + 1) * 12) - 1 : chunks;
    for (let c = first; c <= last && smp < n; c++) {
      let o = wide ? dv.getUint32(co.s + 8 + (c - 1) * 8) * 4294967296 + dv.getUint32(co.s + 12 + (c - 1) * 8) : dv.getUint32(co.s + 8 + (c - 1) * 4);
      for (let k = 0; k < per && smp < n; k++, smp++) {
        off[smp] = o;
        o += size[smp];
      }
    }
  }
  // tiempos (stts), desfase de presentación (ctts) y cuadros clave (stss)
  const stts = tbl.stts!;
  const dts = new Float64Array(n);
  let nd = 0;
  let t = 0;
  for (let i = 0, m = dv.getUint32(stts.s + 4), o = stts.s + 8; i < m && nd < n; i++, o += 8) {
    const cnt = dv.getUint32(o);
    const d = dv.getUint32(o + 4);
    for (let k = 0; k < cnt && nd < n; k++, t += d) dts[nd++] = t;
  }
  let cts = NO_I32;
  const ctts = tbl.ctts;
  if (ctts) {
    cts = new Int32Array(n);
    let nc = 0;
    for (let i = 0, m = dv.getUint32(ctts.s + 4), o = ctts.s + 8; i < m && nc < n; i++, o += 8) {
      const cnt = dv.getUint32(o);
      const d = dv.getInt32(o + 4);
      cts.fill(d, nc, Math.min(n, nc + cnt));
      nc = Math.min(n, nc + cnt);
    }
    // (las muestras que la tabla no cubre quedan en 0; antes quedaban sin valor y daban NaN)
  }
  const stss = tbl.stss;
  if (stss) {
    tk.key = new Set();
    for (let i = 0, m = dv.getUint32(stss.s + 4), o = stss.s + 8; i < m; i++, o += 4) tk.key.add(dv.getUint32(o) - 1);
  }
  const len = Math.min(smp, nd, n);
  if (!len) return false;
  tk.size = len < n ? size.subarray(0, len) : size;
  tk.off = len < n ? off.subarray(0, len) : off;
  tk.dts = len < n ? dts.subarray(0, len) : dts;
  tk.cts = cts.length > len ? cts.subarray(0, len) : cts;
  return true;
}

// SPS / PPS del avcC (largo de los NAL de 4 bytes, como escribe mp4box)
function videoCfg(tk: Trk): VideoCfg | null {
  const b = tk.entry;
  if (!b || typ(b, 4) !== 'avc1' && typ(b, 4) !== 'avc3') return null;
  const avcc = kid(b, 8 + 78, b.length, 'avcC');
  if (!avcc || (b[avcc.s + 4] & 3) !== 3 || (b[avcc.s + 5] & 31) < 1) return null;
  const sl = u16(b, avcc.s + 6);
  const sps = b.slice(avcc.s + 8, avcc.s + 8 + sl);
  const p = avcc.s + 8 + sl;
  if (b[p] < 1) return null;
  const pl = u16(b, p + 1);
  return { sps, pps: b.slice(p + 3, p + 3 + pl), width: u16(b, 8 + 24), height: u16(b, 8 + 26) };
}

// H.265 (hev1 / hvc1): su hvcC va al reproductor como hvc1 y el códec se lee de él (como el lector de MKV). Antes solo
// H.264: un capítulo H.265 + AC-3 iba al modo directo y daba error 4 (lector MP4: códec v=hev1)
export function hevcCfg(tk: Trk): { cfg: VideoCfg; entry: Uint8Array; codec: string } | null {
  const b = tk.entry;
  if (!b || (typ(b, 4) !== 'hev1' && typ(b, 4) !== 'hvc1')) return null;
  const hv = kid(b, 8 + 78, b.length, 'hvcC');
  if (!hv || hv.e - hv.s < 23) return null;
  const p = b.slice(hv.s, hv.e);
  const width = u16(b, 8 + 24);
  const height = u16(b, 8 + 26);
  return { cfg: { sps: new Uint8Array(4), pps: new Uint8Array(0), width, height }, entry: videoEntry('hvc1', p, width, height), codec: hevcCodec(p) };
}

// Dolby (ec-3 / ac-3): la descripción del archivo va tal cual al reproductor (con su dec3 / dac3)
function dolbyCfg(tk: Trk): AudioCfg | null {
  const b = tk.entry;
  if (!b || (typ(b, 4) !== 'ec-3' && typ(b, 4) !== 'ac-3')) return null;
  return { config: new Uint8Array(2), channels: u16(b, 8 + 16) || 2, rate: tk.ts <= 65535 ? tk.ts : u16(b, 8 + 24) };
}

// AudioSpecificConfig del esds (solo AAC)
function audioCfg(tk: Trk): AudioCfg | null {
  const b = tk.entry;
  if (!b || typ(b, 4) !== 'mp4a') return null;
  const esds = kid(b, 8 + 28, b.length, 'esds');
  if (!esds) return null;
  let o = esds.s + 4;
  const desc = (): [number, number] => {
    const tag = b[o++];
    let len = 0;
    for (let i = 0; i < 4; i++) {
      const c = b[o++];
      len = (len << 7) | (c & 127);
      if (!(c & 128)) break;
    }
    return [tag, len];
  };
  if (desc()[0] !== 3) return null;
  const fl = b[o + 2];
  o += 3 + (fl & 0x80 ? 2 : 0);
  if (fl & 0x40) o += 1 + b[o];
  if (fl & 0x20) o += 2;
  if (desc()[0] !== 4) return null;
  const obj = b[o];
  if (obj !== 0x40 && obj !== 0x66 && obj !== 0x67 && obj !== 0x68) return null;
  o += 13;
  const [tag, len] = desc();
  if (tag !== 5 || !len) return null;
  // la escala de tiempo del archivo (mdhd: casi siempre la frecuencia del audio): los tiempos van tal cual, sin redondear
  const rate = tk.ts <= 65535 ? tk.ts : u16(b, 8 + 24) || 48000;
  return { config: b.slice(o, o + len), channels: u16(b, 8 + 16) || 2, rate };
}

// índices de los últimos MP4 abiertos (pueden ser varios MB: bajarlos de nuevo tarda en servidores lentos)
const MOOV_CACHE = new Map<string, Uint8Array>();
const cacheKey = (u: string) => u.replace(/^https?:\/\//i, '');
// Dónde está el índice de los últimos archivos abiertos (tamaño del archivo, posición y largo: unos bytes por archivo),
// guardado en el equipo: al volver a abrirlos se pide el índice sin buscarlo primero
type Spot = { size: number; off: number; len: number };
const SPOTS = 'mp4_spots';
let spots: Record<string, Spot & { t: number }> | null = null;
function spotOf(url: string): Spot | null {
  if (!spots) spots = readJson<Record<string, Spot & { t: number }>>(SPOTS) || {};
  return spots[cacheKey(url)] || null;
}
function rememberSpot(url: string, s: Spot): void {
  if (!spots) spots = readJson<Record<string, Spot & { t: number }>>(SPOTS) || {};
  const k = cacheKey(url);
  const old = spots[k];
  if (old && old.size === s.size && old.off === s.off && old.len === s.len) return;
  spots[k] = { ...s, t: Date.now() };
  const ks = Object.keys(spots);
  if (ks.length > 300) {
    ks.sort((a, b) => spots![a].t - spots![b].t);
    for (const x of ks.slice(0, ks.length - 300)) delete spots[x];
  }
  writeJson(SPOTS, spots);
}
// Índice leído a medias (2.0.15): se abrió con la pista del video y la del audio elegido y se salió (o se eligió otro
// idioma) antes de tener el resto. El lector siguiente del mismo archivo sigue desde ahí en lugar de pedirlo de nuevo
// tailAt: desde ahí (dentro del índice) ya está lo que llegó con el final del archivo
type MoovPart = { off: number; size: number; hl: number; buf: Uint8Array; got: number; file: number; tailAt?: number };
// el final del archivo (from: dónde empieza)
type Tail = { from: number; data: Uint8Array };
// el índice entero que empieza en off, si está dentro del final del archivo (es lo último del archivo)
function moovIn(tl: Tail, off: number): Uint8Array | null {
  if (off < tl.from || off + 16 > tl.from + tl.data.length) return null;
  const b = tl.data.subarray(off - tl.from);
  let n = u32(b, 0);
  if (n === 1) n = u64(b, 8);
  if (typ(b, 4) !== 'moov' || n < 16 || n > b.length || off + n !== tl.from + tl.data.length) return null;
  return b.slice(0, n);
}
// lo que se pide del final del archivo junto con el principio (líneas de varias conexiones): el índice entero si es de
// hasta ~3 MB (capítulos y películas con 1-3 idiomas) y, si es más grande, su final
const SUFFIX = 3 * 1048576;
const PARTIAL = new Map<string, MoovPart>();
function rememberMoov(url: string, moov: Uint8Array): void {
  const k = cacheKey(url);
  MOOV_CACHE.delete(k);
  MOOV_CACHE.set(k, moov);
  while (MOOV_CACHE.size > 3) MOOV_CACHE.delete(MOOV_CACHE.keys().next().value as string);
}

// tamaño de los archivos cuyo índice está en memoria
const SIZES = new Map<string, number>();

// ¿se sabe dónde está el índice de este archivo? (el lector lo pide directo, sin leer antes el principio)
export function mp4Spot(url: string): boolean {
  return !!spotOf(url);
}

// lo que el lector pide primero de un MP4: desde el principio, también el principio del video (Player lo pide por
// adelantado mientras se inicia el reproductor: el mismo pedido, no dos)
export const MP4_HEAD = 1572864;

// ¿ya se tiene (o se está leyendo) el índice de este archivo?
export function mp4Known(url: string): boolean {
  const k = cacheKey(url);
  return MOOV_CACHE.has(k) || WARM.has(k) || hasIndex(url);
}

// el índice ya está (memoria, equipo o panel): el lector de la app abre con un solo pedido al servidor IPTV (2.0.16)
export function mp4Ready(url: string): boolean {
  const k = cacheKey(url);
  return MOOV_CACHE.has(k) || hasIndex(url) || sharedKnown(url) || !!WARM.get(k)?.indexed;
}

// el video se abre con el reproductor nativo: lo que la ficha estaba preparando con el lector se corta (en una línea de
// una conexión, seguía bajando el índice a la vez que el nativo pedía el video y uno de los dos no abría)
export function dropWarm(url: string): void {
  WARM.get(cacheKey(url))?.release();
}

// Prepara un MP4 sin abrirlo (la ficha del título): lee su índice (queda en memoria y guardado en el equipo) y deja
// pedido el arranque del video en el segundo at. Al pulsar Reproducir, Playback se queda con este mismo lector
// (Mp4Mse.open) y solo falta entregarle el video al reproductor. done: 'ok', 'mkv' (un MKV con extensión mp4) o ''
const WARM = new Map<string, Mp4Mse>();
export function preloadMp4(url: string, at = 0, wantLang = ''): { stop: () => void; done: Promise<string> } {
  const k = cacheKey(url);
  const old = WARM.get(k);
  if (old) return { stop: () => old.release(), done: old.prepare(at).then(e => (e ? '' : 'ok')) };
  const m = new Mp4Mse(null as unknown as VideoPlayer, url, -1, null, wantLang);
  m.warm = true;
  WARM.set(k, m);
  const done = m.prepare(at).then(e => {
    if (e && WARM.get(k) === m) WARM.delete(k);
    return e ? (m.why === NOT_MP4_MKV ? 'mkv' : '') : 'ok';
  });
  return { stop: () => m.release(), done };
}

export class Mp4Mse {
  tracks: { lang: string; codec: string; def?: boolean }[] = [];
  audioIdx = -1;
  onTracks: () => void = () => {};
  // las pistas apenas se lee el índice (el menú de idiomas sin esperar al reproductor)
  onHeader: () => void = () => {};

  index: Uint8Array | null = null;
  private ms: any = null;
  private objectUrl = '';
  private requests = new Set<AbortController>();
  // pedidos al servidor: cierre de conexión, servidor que ignora el final del Range, tamaño y motivo (rangeget.ts)
  private rs: RangeState = { close: false, unbounded: false, size: 0, why: '' };
  private sb: any = null;
  private size = 0;
  private vt: Trk | null = null;
  private at: Trk | null = null;
  private arate = 0;
  private vi = 0;
  private ai = 0;
  private seq = 1;
  private gen = 0;
  private alive = true;
  private running = false;
  private watch: ReturnType<typeof setInterval> | null = null;
  private lastT = -1;
  private lastMove = Date.now();
  // ya leyó el índice y armó el video (si no, Player no le da más tiempo)
  get indexed(): boolean {
    return !!this.vt;
  }
  // la primera entrega después de abrir o saltar es corta (1,5 s): la imagen sale antes
  private firstOut = true;
  // segundo pedido al abrir o saltar: la primera entrega llega hasta 1,5 s después de él (no solo 1,5 s desde el cuadro
  // clave anterior, que podía quedar antes del minuto guardado y obligaba a otro pedido al servidor)
  private firstAt = 0;
  // descarga adelantada del video (readahead.ts): varias ventanas a la vez, por delante de lo que se ve. ra2: el audio
  // cuando el archivo lo trae lejos del video (sin intercalar)
  private ra: ReadAhead;
  private ra2: ReadAhead | null = null;
  // bytes por segundo del archivo (tamaño / duración); 0 hasta leer el índice
  private bps = 0;
  // el índice salió del guardado en el equipo (indexstore.ts): tamaño del archivo cuando se guardó
  private packed = false;
  // el índice vino del panel (otro equipo lo leyó antes)
  private shared = false;
  private packSize = 0;
  // MP4 con el índice al final, desde el principio: el comienzo del video ya se pidió junto con el índice
  private headAsked = false;
  private fromStart = true;
  // la línea no admite pedidos a la vez: todo de a uno
  private oneConn = false;
  // Índice al final del archivo, leído en orden (2.0.15): mra baja el índice por ventanas seguidas (varias a la vez si la
  // línea lo admite) y el video empieza apenas llegaron enteras la pista del video y la del audio elegido; el resto (los
  // otros idiomas) sigue por detrás sin quitarle la conexión al video. moovBox: lo leído; part: se empezó sin el resto
  private mra: ReadAhead;
  private moovBox: MoovPart | null = null;
  private part = false;
  private partAt = '';
  private moovMiss: Uint8Array | null = null;
  // pedido del final del archivo (junto con el principio) y para qué sirvió: 'entero' = traía el índice entero
  private sufReqs = new Set<AbortController>();
  private sufOff = false;
  private tailUsed = '';
  // por qué no siguió (para el reporte del panel)
  why = '';
  // el reproductor no acepta el audio del archivo (Dolby en Vega): suena solo el video; los idiomas quedan en el menú
  noAudio = false;
  onError: () => void = () => {};
  // video que el equipo no decodifica (Vega no avisa el error)
  private sw = new StartWatch();

  // wantLang: idioma con el que abrir si no se eligió una pista (el guardado para el título)
  constructor(private v: VideoPlayer, private url: string, private selectedAudio = -1, index: Uint8Array | null = null, private wantLang = '') {
    this.index = index;
    this.ra = new ReadAhead(url, this.rs, () => this.bps);
    // ventanas del índice: ~0,75, 1,5, 3 MB… (como si fuera video de 384 KB/s). Línea de 2 conexiones: una para el índice
    // y otra para el principio del video
    this.mra = new ReadAhead(url, this.rs, () => 393216);
    if (lineLimit() === 2) this.mra.par = 1;
  }

  // preparado desde la ficha, todavía sin reproductor
  warm = false;

  // El lector para abrir url: el que la ficha dejó preparado (mismo audio: el predeterminado) o uno nuevo
  static open(v: VideoPlayer, url: string, selectedAudio: number, index: Uint8Array | null, wantLang = ''): Mp4Mse {
    const k = cacheKey(url);
    const w = WARM.get(k);
    if (w) {
      WARM.delete(k);
      if (w.alive && selectedAudio < 0 && !index && w.wantLang === wantLang) {
        w.warm = false;
        w.v = v;
        return w;
      }
      w.destroy();
    }
    return new Mp4Mse(v, url, selectedAudio, index, wantLang);
  }

  // la ficha se cerró sin abrir el video: se corta lo que estaba en camino (el índice ya leído queda)
  release(): void {
    if (!this.warm) return;
    const k = cacheKey(this.url);
    if (WARM.get(k) === this) WARM.delete(k);
    this.destroy();
  }

  // '' = empezó en el segundo pedido; si no, el motivo (el que llama sigue con el modo directo de siempre)
  // para el aviso de apertura lenta: cuándo empezó, cuándo tuvo el índice y cuándo entregó el inicio al reproductor
  private t0 = 0;
  private tIdx = 0;
  private tInit = 0;
  private spotUsed = false;
  diag(): string {
    const s = (t: number) => (t ? ((t - this.t0) / 1000).toFixed(1) + 's' : '-');
    const n = this.rs.reqs || 0;
    return '[indice=' + (this.index ? (this.index.length / 1048576).toFixed(1) + 'MB' : this.moovBox ? (this.moovBox.got / 1048576).toFixed(1) + '/' + (this.moovBox.size / 1048576).toFixed(1) + 'MB' : 'no') + ' en ' + s(this.tIdx) + (this.partAt ? ' empezo_con=' + this.partAt : '') + (this.tailUsed ? ' indice_del_final=' + this.tailUsed : '') + ' inicio=' + s(this.tInit) + ' archivo=' + Math.round(this.size / 1048576) + 'MB unaConexion=' + (this.oneConn || this.ra.single) + ' indice_recordado=' + this.spotUsed + ' indice_guardado=' + this.packed + (this.shared ? ' indice_panel=true' : '') + ' ' + this.ra.diag() + ' pedidos=' + n + (this.rs.bridge ? ' puente=' + this.rs.bridge : '') + (n ? ' espera_media=' + Math.round((this.rs.waitMs || 0) / n) + 'ms' : '') + (this.why ? ' motivo=' + this.why : '') + ']';
  }

  // lo ya preparado (índice, pistas, códecs y el primer tramo pedido): desde la ficha (warm.ts) o al abrir
  private prep: Promise<string> | null = null;
  private cfg: { vt: Trk; at0: Trk | null; vc: VideoCfg; ac: AudioCfg | null; dolby: AudioCfg | null; hv: ReturnType<typeof hevcCfg>; mime: string; typeOk: boolean; vcodec: (m: string) => string } | null = null;
  prepare(at: number): Promise<string> {
    if (!this.prep) this.prep = this.doPrepare(at);
    return this.prep;
  }

  // Índice del archivo, pistas y el primer tramo del video pedido a la descarga adelantada. '' = listo
  private async doPrepare(at: number): Promise<string> {
    if (!this.t0) this.t0 = Date.now();
    // ¿hay puente con caché en la VPS / VDS? (antes del primer pedido: todo por el mismo camino)
    await bridgeAsk(this.url);
    if (!this.alive) return '';
    this.fromStart = at <= 5;
    // el índice ya leído de este archivo (volver a abrirlo, Continuar viendo, cambiar de audio): sin pedirlo otra vez.
    // Primero el de la memoria, después el guardado en el equipo (indexstore.ts) y recién después el servidor
    let moov = this.index || MOOV_CACHE.get(cacheKey(this.url)) || null;
    if (moov && !this.size) this.size = SIZES.get(cacheKey(this.url)) || 0;
    if (!moov) {
      const pk = await loadIndex(this.url);
      if (!this.alive) return '';
      if (pk) {
        moov = pk.moov;
        this.packed = true;
        this.packSize = pk.size;
        this.size = pk.size;
      }
    }
    // el índice que otro equipo ya leyó y dejó en el panel (2.0.16): al servidor IPTV solo se le pide el video
    if (!moov) {
      const sh = await sharedIndex(this.url, 'm');
      if (!this.alive) return '';
      if (sh) {
        try {
          moov = fromBase64(sh.text);
          this.packed = true;
          this.shared = true;
          this.packSize = sh.size;
          this.size = sh.size;
          await this.takeHead();
          if (!this.alive) return '';
        } catch {
          moov = null;
        }
      }
    }
    let vt: Trk | null = null;
    let at0: Trk | null = null;
    let vOk = false;
    let aOk = false;
    for (let pass = 0; pass < 2; pass++) {
      if (!moov) moov = await this.readMoov();
      this.tIdx = Date.now();
      if (!moov) return 'índice: ' + (this.why || 'no encontrado');
      if (!this.alive) return '';
      const m = moov;
      const traks = kids(m, 0, m.length).filter(k => k.t === 'trak').map(k => parseTrak(m, k.s, k.e)).filter((x): x is Trk => !!x);
      vt = traks.find(x => x.kind === 'vide') || null;
      const auds = traks.filter(x => x.kind === 'soun');
      this.tracks = auds.map(x => ({ lang: x.lang, codec: x.entry ? typ(x.entry, 4) : '', def: !!x.enabled }));
      const byLang = this.selectedAudio < 0 && this.wantLang ? auds.find(x => sameLang(x.lang, this.wantLang)) : undefined;
      at0 = auds[this.selectedAudio] || byLang || auds.find(x => x.enabled) || auds[0] || null;
      this.audioIdx = at0 ? auds.indexOf(at0) : -1;
      // solo las tablas de muestras del video y del audio elegido (los demás idiomas, cuando se elijan)
      vOk = !!vt && fillTables(m, vt);
      aOk = !at0 || fillTables(m, at0);
      // el índice adelgazado (guardado en el equipo o en memoria) no trae las tablas de este idioma: el entero, del servidor
      if (pass === 0 && vt && (!vOk || !aOk) && (!vt.tbl || (at0 && !at0.tbl))) {
        this.packed = false;
        this.ra.park();
        moov = null;
        continue;
      }
      break;
    }
    if (!moov) return 'índice: ' + (this.why || 'no encontrado');
    // lo leído a medias no queda como índice del archivo (otro idioma necesitaría lo que falta): al terminar (moovDone)
    if (!this.part) {
      rememberMoov(this.url, moov);
      if (this.size > 0) SIZES.set(cacheKey(this.url), this.size);
      this.index = moov;
    }
    const hv = vt && !videoCfg(vt) ? hevcCfg(vt) : null;
    const vc = vt ? videoCfg(vt) || hv?.cfg || null : null;
    // con H.265 el códec del video es el de su hvcC (mp4Mime lo arma de H.264)
    const vcodec = (m: string) => (hv ? m.replace(/avc1\.[0-9a-fA-F]{6}/, hv.codec) : m);
    const aac = at0 ? audioCfg(at0) : null;
    const dolby = at0 && !aac ? dolbyCfg(at0) : null;
    const ac = aac || dolby;
    if (!vt || !vOk || !vc || (at0 && (!ac || !aOk))) return 'códec v=' + (vt?.entry ? typ(vt.entry, 4) : '-') + ' a=' + (at0?.entry ? typ(at0.entry, 4) : '-');
    const mime = vcodec(dolby ? mp4Mime(vc, null).replace(/"$/, ',' + typ(at0!.entry!, 4) + '"') : mp4Mime(vc, ac));
    // la consulta no manda: algunos equipos dicen que no y lo aceptan; manda addSourceBuffer
    let typeOk = true;
    try {
      typeOk = MediaSource.isTypeSupported(mime);
    } catch {
      typeOk = false;
    }
    this.vt = vt;
    this.at = ac ? at0 : null;
    // dónde empieza cada pista según la lista de edición (tramos vacíos y comienzo dentro de la pista), todo corrido para
    // que nada quede antes de 0
    const mv = moov;
    const mvhd = kid(mv, 0, mv.length, 'mvhd');
    const mts = mvhd ? u32(mv, mvhd.s + (mv[mvhd.s] === 1 ? 20 : 12)) || 1 : 1;
    const offOf = (x: Trk) => x.delay / mts - x.mediaTime / x.ts;
    const base = Math.min(offOf(vt), this.at ? offOf(this.at) : Infinity);
    vt.shift = offOf(vt) - base;
    if (this.at) this.at.shift = offOf(this.at) - base;
    this.arate = ac ? ac.rate : 0;
    if (!this.alive) return '';
    // ritmo del archivo y hasta dónde llega el video dentro de él (después solo queda el índice): la descarga adelantada
    // arma sus ventanas con eso
    const dur = this.secs(vt, vt.dts[vt.dts.length - 1]);
    const lastEnd = (x: Trk) => x.off[x.off.length - 1] + x.size[x.size.length - 1];
    const mediaEnd = Math.max(lastEnd(vt), this.at ? lastEnd(this.at) : 0);
    if (this.size > 0 && dur > 1) this.bps = this.size / dur;
    else if (dur > 1) this.bps = mediaEnd / dur;
    this.ra.hold = false;
    this.ra.end = mediaEnd;
    if (this.warm) {
      // desde la ficha: solo el arranque (~6 s de video) y el índice al equipo ya (no hay reproductor que esperar)
      this.ra.limit = Math.max(1048576, Math.min(6 * 1048576, Math.round(this.bps * 6)));
      this.keepIndex(0);
    }
    // El primer tramo se pide ya, mientras se abre el reproductor (cada pedido al servidor IPTV tarda 1,5-6 s en
    // contestar: avisos «tardó en empezar»). Con el índice guardado en el equipo esto pasa apenas se abre el video
    this.place(at);
    this.prime();
    this.cfg = { vt, at0, vc, ac, dolby, hv, mime, typeOk, vcodec };
    return '';
  }

  // '' = empezó en el segundo pedido; si no, el motivo (el que llama sigue con el modo directo de siempre)
  async start(at: number): Promise<string> {
    this.t0 = Date.now();
    const err = await this.prepare(at);
    if (this.tIdx < this.t0) this.tIdx = this.t0;
    if (err || !this.alive || !this.cfg) return err;
    const { vt, at0, vc, ac, dolby, hv, mime, typeOk, vcodec } = this.cfg;
    this.onHeader();
    // lo preparado desde la ficha pudo ser para otro segundo (Reiniciar): se pide desde este; y sin tope desde ahora
    this.place(at);
    this.prime();
    this.ra.go();
    this.ra2?.go();
    const ms: any = new MediaSource();
    this.ms = ms;
    const opened = new Promise<void>(res => ms.addEventListener('sourceopen', () => res()));
    try {
      this.objectUrl = (URL as any).createObjectURL(ms);
      this.v.src = this.objectUrl;
    } catch {
      (this.v as any).srcObject = ms;
    }
    await Promise.race([opened, sleep(10000)]);
    if (ms.readyState !== 'open') return 'MSE sin abrir';
    let init: Uint8Array;
    try {
      this.sb = ms.addSourceBuffer(mime);
      init = initSegment(vc, ac, dolby ? at0!.entry! : undefined, vt.ts, hv?.entry);
    } catch (e: any) {
      // el audio no lo acepta (Vega no trae E-AC-3 por MSE): solo el video, sin sonido
      const vOnly = vcodec(mp4Mime(vc, null));
      try {
        if (!this.at) throw e;
        this.sb = ms.addSourceBuffer(vOnly);
        init = initSegment(vc, null, undefined, vt.ts, hv?.entry);
        this.at = null;
        this.noAudio = true;
      } catch {
        return 'MSE ' + mime + (typeOk ? '' : ' (no soportado)') + ': ' + String(e?.message || e).slice(0, 60);
      }
    }
    // la duración total (para la barra); si el equipo no deja ponerla, se sigue igual
    try {
      ms.duration = this.secs(vt, vt.dts[vt.dts.length - 1]);
    } catch {
      // sin duración
    }
    if (!(await this.append(init))) return 'inicio no aceptado: ' + this.why;
    this.tInit = Date.now();
    this.place(at);
    if (at > 0) this.v.currentTime = at;
    this.pump();
    this.watch = setInterval(() => this.alive && this.unstick(), 300);
    this.v.play();
    this.onTracks();
    this.keepIndex();
    return '';
  }

  fileSize(): number {
    return this.size;
  }

  // Player pidió por adelantado el principio del archivo (no sabía que el índice llegaría del panel): desde el principio
  // esos bytes son el comienzo del video y se usan; si no, se cortan para que no ocupen la conexión de la línea
  private async takeHead(): Promise<void> {
    const pf = prefetchedAt(this.url, 0);
    if (!pf) return;
    if (!this.fromStart) {
      dropPrefetch(this.url);
      return;
    }
    const win = await this.get(0, pf);
    if (win && win.length === pf) this.ra.seed(0, win);
  }

  // pide ya el próximo tramo (el de place) a la descarga adelantada
  private prime(): void {
    const pl = this.chunkPlan();
    if (pl.lo >= pl.hi) return;
    if (pl.hi - pl.lo <= pl.need * 1.5 + 2097152) {
      if (!this.ra.covers(pl.lo)) this.ra.seek(pl.lo, pl.hi - pl.lo);
    } else {
      // video y audio lejos uno del otro en el archivo: cada uno con su lectura, de a un pedido
      if (!this.ra2) this.ra2 = new ReadAhead(this.url, this.rs, () => this.bps * 0.15);
      this.ra.par = 2;
      this.ra2.par = 1;
      if (pl.vs && !this.ra.covers(pl.vs[0])) this.ra.seek(pl.vs[0], pl.vs[1] - pl.vs[0]);
      if (pl.as && !this.ra2.covers(pl.as[0])) this.ra2.seek(pl.as[0], pl.as[1] - pl.as[0]);
    }
  }

  // el índice de este archivo, al equipo (adelgazado: video + el audio que suena), cuando ya lleva unos segundos abierto
  private kept = false;
  private keepIndex(wait = 8000): void {
    if ((this.packed && !this.shared) || !this.index || this.kept) return;
    this.kept = true;
    const moov = this.index;
    const keep = this.noAudio ? -1 : this.audioIdx;
    setTimeout(() => {
      // (el tamaño del archivo se sabe con la primera respuesta del servidor)
      if (!this.alive || !this.size) {
        this.kept = false;
        return;
      }
      try {
        saveIndex(this.url, this.size, slimMoov(moov, keep));
      } catch {
        // índice raro: no se guarda
      }
      // entero (con todos los idiomas) al panel para los demás equipos, si el panel no lo tenía
      if (!this.shared) shareIndex(this.url, 'm', this.size, () => toBase64(moov));
    }, wait);
  }

  destroy(): void {
    this.alive = false;
    this.gen++;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.ra.stop();
    this.ra2?.stop();
    this.mra.stop();
    for (const c of this.sufReqs) c.abort();
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    try {
      if (this.sb?.updating) this.sb.abort();
    } catch {
      // ya cerrado
    }
    if (this.objectUrl) {
      try { (URL as any).revokeObjectURL?.(this.objectUrl); } catch { /* API opcional en Vega */ }
      this.objectUrl = '';
    }
  }

  // ◀▶ o un salto: lo ya bajado al momento; si no, desde el cuadro clave anterior
  async seekTo(t: number): Promise<void> {
    if (!this.sb || !this.vt) return;
    if (this.isBuffered(t)) {
      this.v.currentTime = t;
      return;
    }
    this.gen++;
    await this.idle();
    try {
      this.sb.abort();
      const end = this.bufEnd();
      if (end > 0) {
        this.sb.remove(0, end + 1);
        await this.idle();
      }
    } catch {
      // se sigue igual
    }
    this.place(t);
    // lo que venía en camino ya no sirve: se pide desde el lugar nuevo
    this.prime();
    this.v.currentTime = t;
    if (!this.running) this.pump();
  }

  // tiempo de presentación de la muestra i del video (decodificación + desfase de los cuadros B)
  private ptsU(i: number): number {
    const vt = this.vt!;
    return vt.dts[i] + (vt.cts.length ? vt.cts[i] : 0);
  }

  private secs(tk: Trk, units: number): number {
    return units / tk.ts + tk.shift;
  }

  // muestras desde el cuadro clave en o antes de t
  private place(t: number): void {
    this.firstOut = true;
    this.firstAt = t;
    const vt = this.vt!;
    let lo = 0;
    let hi = vt.dts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.secs(vt, vt.dts[mid]) <= t) lo = mid;
      else hi = mid - 1;
    }
    while (lo > 0 && vt.key && !vt.key.has(lo)) lo--;
    this.vi = lo;
    const from = this.secs(vt, vt.dts[lo]);
    const a = this.at;
    this.ai = 0;
    if (a) while (this.ai < a.dts.length && this.secs(a, a.dts[this.ai]) < from) this.ai++;
  }

  // el índice: al principio o (lo normal en IPTV) al final, después del video. Pocos pedidos: el principio del archivo
  // de una vez (64 KB: ftyp y, si está al principio, el moov) y, al saltar al final, 1 MB desde la cabecera del moov
  // (casi siempre entra entero); antes eran 16 bytes por caja y otro pedido para el moov
  private async readMoov(): Promise<Uint8Array | null> {
    // índice de este archivo ya ubicado antes (otra vez la misma película o episodio, Continuar viendo): se lee ya, por
    // partes, sin pedir antes el principio del archivo (el tamaño se comprueba con la primera respuesta). El servidor
    // IPTV tarda ~6 s en contestar cada pedido (avisos «tardó en empezar»): es una espera menos
    const spot = spotOf(this.url);
    // desde el principio y con varias conexiones: el principio del video (1,5 MB desde el byte 0) va ya, a la vez que la
    // cabecera y el índice (de a una ventana mientras baja el índice)
    if (this.fromStart && !(this.ra.single || this.oneConn) && !this.headAsked) {
      this.headAsked = true;
      this.ra.hold = true;
      // solo ese principio mientras se lee el índice (sin tope cuando el video se abre: start → ra.go)
      this.ra.limit = MP4_HEAD;
      this.ra.seek(0, MP4_HEAD);
    }
    if (spot) {
      const m = await this.moovFrom(spot.off, spot.len, spot.size);
      if (m) {
        this.spotUsed = true;
        return m;
      }
      if (!this.alive) return null;
      // el archivo cambió en el servidor: se busca el índice otra vez
      this.mra.park();
    }
    let off = 0;
    // Desde el principio, el primer pedido trae también el principio del video (1,5 MB): en una línea de una sola conexión
    // son dos esperas del servidor (esto y el índice) en lugar de tres (cabecera, índice y después el video). Con varias
    // conexiones, a la vez se pide el final del archivo (donde está el índice): si el índice cabe ahí, todo llega en UNA
    // espera del servidor; si no, ya se tiene su final y falta solo el principio (2.0.15)
    const single = this.ra.single || this.oneConn;
    const headLen = this.fromStart && single ? MP4_HEAD : 65536;
    const srs: RangeState = { close: false, unbounded: false, size: 0, why: '' };
    const sufReqs = this.sufReqs;
    this.sufOff = false;
    // (líneas de 2 o 3 conexiones: no; ocuparía el lugar de la cabecera o del índice)
    const lim = lineLimit();
    const suffix = single || (lim > 0 && lim < 4) ? null : rangeGet(this.url, -1, SUFFIX, srs, sufReqs, () => this.alive && !this.sufOff).catch(() => null);
    let win = await this.get(0, headLen);
    let wOff = 0;
    if (win && headLen > 65536 && win.length > 65536) {
      this.ra.seed(0, win);
      this.headAsked = true;
    }
    // lo que llegó del final del archivo (si el servidor lo dio bien); stop: ya no hace falta
    const stopSuffix = () => {
      this.sufOff = true;
      for (const c of sufReqs) c.abort();
    };
    // (una promesa: el índice por partes no la espera; la usa si llega antes)
    const tailP: Promise<Tail | null> = (async () => {
      if (!suffix) return null;
      const d = await suffix;
      if (!d || !srs.size || srs.from === undefined || srs.from + d.length !== srs.size) return null;
      if (this.size && srs.size !== this.size) return null;
      return { from: srs.from, data: d };
    })();
    if (!win || win.length < 8 || win[0] === 0x1a || !/^[a-z0-9 ]{4}$/i.test(typ(win, 4))) stopSuffix();
    // no es MP4 aunque diga .mp4: un MKV (los servidores IPTV entregan remuxes MKV con extensión mp4) lo abre el lector
    // de MKV; otra cosa (cabecera sin una caja MP4) al modo directo. Antes se hacían hasta 12 lecturas al azar del
    // archivo buscando un índice que no existe (segundos perdidos) y la película no abría
    if (win && win.length >= 8) {
      if (win[0] === 0x1a && win[1] === 0x45 && win[2] === 0xdf && win[3] === 0xa3) {
        this.why = NOT_MP4_MKV;
        return null;
      }
      if (!/^[a-z0-9 ]{4}$/i.test(typ(win, 4))) {
        this.why = 'no es MP4';
        return null;
      }
    }
    for (let i = 0; i < 12 && win; i++) {
      if (off + 16 > wOff + win.length) {
        if (this.size && off >= this.size) return null;
        // después del video (mdat) solo queda el índice: se lee en orden desde su principio y el video empieza apenas
        // están enteras su pista y la del audio elegido (2.0.15; antes se esperaba el índice entero: 10,9 MB en 20 s)
        const tail = this.size - off;
        if (this.size && tail > 1048576 && tail <= MOOV_MAX) {
          this.moovMiss = null;
          const m = await this.moovFrom(off, 0, this.size, null, suffix ? tailP : null);
          if (m || !this.alive) return m;
          win = this.moovMiss;
          this.moovMiss = null;
        } else win = null;
        // si no se pudo así, como antes: 1 MB para leer su tamaño y el resto en partes
        if (!win) win = await this.get(off, 1048576);
        wOff = off;
        if (!win || win.length < 8) return null;
      }
      const h = win.subarray(off - wOff);
      let size = u32(h, 0);
      if (size === 1) size = u64(h, 8);
      else if (size === 0) size = this.size - off;
      if (typ(h, 4) === 'moov') {
        if (size > MOOV_MAX) return null;
        // dónde está, para la próxima vez (Continuar viendo): se pide sin buscarlo
        rememberSpot(this.url, { size: this.size, off, len: size });
        const have = win.slice(off - wOff, Math.min(win.length, off - wOff + size));
        if (have.length >= size) {
          stopSuffix();
          return kidsBody(have);
        }
        const m = await this.moovFrom(off, size, this.size, have, suffix ? tailP : null);
        if (m || !this.alive) return m;
        const rest = await this.getParts(off + have.length, size - have.length);
        return rest ? kidsBody(concat([have, rest])) : null;
      }
      if (size < 8) return null;
      // el video (mdat) va antes del índice: su principio se pide ya, a la vez que el índice (lo primero que se va a ver).
      // Con una sola conexión no: primero el índice
      if (typ(h, 4) === 'mdat' && !this.headAsked && this.fromStart && size > 4194304 && !this.ra.single && !this.oneConn) {
        this.headAsked = true;
        // de a un pedido mientras baja el índice (va primero); después, hasta 3 a la vez
        this.ra.hold = true;
        this.ra.seek(off + (u32(h, 0) === 1 ? 16 : 8));
      }
      off += size;
      if (this.size && off >= this.size) return null;
    }
    stopSuffix();
    return null;
  }

  // El índice (moov) desde el byte off, en orden. len: su tamaño (0 = se lee de su cabecera); file: tamaño del archivo
  // esperado; have: lo que ya llegó. Devuelve el contenido del índice apenas alcanza para empezar (la pista del video y
  // la del audio elegido enteras) o entero; el resto sigue por detrás (moovRest) y al terminar queda como el índice
  // completo (moovDone). null = no es el índice o no llegó
  private async moovFrom(off: number, len: number, file: number, have: Uint8Array | null = null, tailP: Promise<Tail | null> | null = null): Promise<Uint8Array | null> {
    const key = cacheKey(this.url);
    const old = PARTIAL.get(key);
    // el final del archivo, cuando llegue (undefined = todavía no)
    let tl: Tail | null | undefined = tailP ? undefined : null;
    let st: MoovPart | null = old && old.off === off && old.file === file && (!len || old.size === len) ? old : null;
    if (st) PARTIAL.delete(key);
    else {
      let first = have;
      if (!first || first.length < 16) {
        // primer tramo: la cabecera del índice y la pista del video. Tamaño del índice (es lo último del archivo)
        const total = len || file - off;
        const single = this.ra.single || this.mra.single || this.oneConn;
        // lo que suele ocupar el video y el primer audio: ~40 % del índice (1,5-6 MB). Con varias conexiones, en 3 partes
        // iguales a la vez (llegan juntas); con una, de una vez (cada pedido más es otra espera del servidor)
        const need = Math.max(1572864, Math.min(6291456, Math.round(total * 0.4)));
        const want = Math.min(total, single ? need : Math.ceil(need / 3));
        // una sola conexión: solo lo que se lee, nada por adelantado (otro pedido a la vez lo rechaza el servidor)
        if (single) {
          this.mra.goSingle();
          this.mra.lazy = true;
        } else this.mra.startLen = want;
        this.mra.end = off + total;
        const firstP = this.moovRead(off, want);
        // carrera: si el final del archivo llega antes y trae el índice entero, se usa ya (una sola espera del servidor)
        const won = tailP
          ? await Promise.race([
            firstP.then(d => ({ d, w: null as Uint8Array | null })),
            tailP.then(t => {
              tl = t;
              const w = t ? moovIn(t, off) : null;
              return w ? { d: null as Uint8Array | null, w } : firstP.then(d => ({ d, w: null as Uint8Array | null }));
            }),
          ])
          : { d: await firstP, w: null };
        if (won.w) {
          this.mra.park();
          this.tailUsed = 'entero';
          rememberSpot(this.url, { size: file || this.size, off, len: won.w.length });
          return kidsBody(won.w);
        }
        first = won.d;
        if (!first || first.length < 16) return null;
        if (file && this.rs.size && this.rs.size !== file) return null;
        if (typ(first, 4) !== 'moov') {
          // otra caja antes del índice: el que llama sigue buscando con lo que llegó (lo demás que venía, se corta)
          this.moovMiss = first;
          this.mra.park();
          return null;
        }
      }
      let size = u32(first, 0);
      let hl = 8;
      if (size === 1) {
        size = u64(first, 8);
        hl = 16;
      } else if (size === 0) size = file - off;
      if (size > MOOV_MAX || size < hl || (len && size !== len)) return null;
      rememberSpot(this.url, { size: file || this.size, off, len: size });
      const buf = new Uint8Array(size);
      const n = Math.min(size, first.length);
      buf.set(first.subarray(0, n), 0);
      st = { off, size, hl, buf, got: n, file: file || this.size };
    }
    this.moovBox = st;
    if (!this.size) this.size = st.file;
    this.mra.end = st.off + (st.tailAt ?? st.size);
    const box = st;
    let started = false;
    let give: (m: Uint8Array | null) => void = () => {};
    const startP = new Promise<Uint8Array | null>(r => (give = r));
    const begin = (m: Uint8Array | null) => {
      if (started) return;
      started = true;
      this.part = !!m && box.got < box.size;
      if (this.part) this.partAt = (box.got / 1048576).toFixed(1) + '/' + (box.size / 1048576).toFixed(1) + 'MB';
      // desde ahora el resto del índice va de a una ventana y solo cuando se pide (moovGate). Línea de una sola conexión:
      // lo que quedaba en camino del índice se corta ya (si no, le peleaba la única conexión al principio del video)
      this.mra.lazy = true;
      this.mra.par = 1;
      this.mra.startLen = 0;
      if (this.ra.single || this.mra.single || this.oneConn) this.mra.park();
      give(m);
    };
    // el final del índice llegó con el final del archivo: lo que falta leer termina donde empieza ese final; si ya se
    // leyó hasta ahí (o el final lo trae entero), el índice está completo
    const useTail = () => {
      if (!tl || box.got >= box.size || box.off + box.size !== tl.from + tl.data.length) return;
      if (tl.from <= box.off) {
        box.buf.set(tl.data.subarray(box.off - tl.from, box.off - tl.from + box.size), 0);
        box.got = box.size;
      } else {
        const at = tl.from - box.off;
        box.buf.set(tl.data, at);
        box.tailAt = at;
        if (box.got >= at) box.got = box.size;
        else this.mra.end = box.off + at;
      }
      this.tailUsed = box.got >= box.size ? 'entero' : 'final';
      if (box.got >= box.size) {
        this.mra.park();
        if (!started) begin(box.buf.subarray(box.hl));
        else if (this.part) this.moovDone(box.buf.subarray(box.hl));
      }
    };
    if (tailP && tl === undefined) {
      tailP.then(t => {
        tl = t;
        if (this.alive) useTail();
      });
    } else useTail();
    if (box.got >= box.size) begin(box.buf.subarray(box.hl));
    else if (this.enough(box)) begin(box.buf.subarray(box.hl, box.got));
    void (async () => {
      const CH = 262144;
      while (this.alive && box.got < box.size) {
        if (started) await this.moovGate();
        if (!this.alive || box.got >= box.size) break;
        const stopAt = box.tailAt ?? box.size;
        const d = await this.moovRead(box.off + box.got, Math.min(CH, stopAt - box.got));
        if (!d || !d.length || !this.alive) break;
        if (box.got >= box.size) break;
        const upto = box.tailAt ?? box.size;
        box.buf.set(d.subarray(0, Math.min(d.length, upto - box.got)), box.got);
        box.got += Math.min(d.length, upto - box.got);
        if (box.got >= upto) box.got = box.size;
        if (!started && (box.got >= box.size || this.enough(box))) begin(box.buf.subarray(box.hl, box.got));
      }
      if (box.got >= box.size) {
        const body = box.buf.subarray(box.hl);
        if (!started) begin(body);
        else if (this.part) this.moovDone(body);
        return;
      }
      if (!started) begin(null);
      // se salió antes de tenerlo entero: el próximo lector de este archivo sigue desde aquí
      else if (box.size <= 32 * 1048576) {
        PARTIAL.clear();
        PARTIAL.set(key, box);
      }
    })();
    return startP;
  }

  // ¿alcanza lo leído del índice para empezar? La pista del video y la del audio que va a sonar, enteras
  private enough(box: MoovPart): boolean {
    const traks = kids(box.buf, box.hl, box.got)
      .filter(k => k.t === 'trak')
      .map(k => parseTrak(box.buf, k.s, k.e))
      .filter((x): x is Trk => !!x);
    if (!traks.some(x => x.kind === 'vide' && x.tbl)) return false;
    const auds = traks.filter(x => x.kind === 'soun');
    // elegido a mano (su número), el idioma guardado para el título o el audio predeterminado (el primero activado)
    if (this.selectedAudio >= 0) return !!auds[this.selectedAudio]?.tbl;
    const want = this.wantLang ? auds.find(x => sameLang(x.lang, this.wantLang)) : auds.find(x => x.enabled);
    return !!want?.tbl;
  }

  // un tramo del índice (descarga adelantada del índice). Línea de una sola conexión: el principio del video espera
  private async moovRead(off: number, len: number): Promise<Uint8Array | null> {
    const d = await this.mra.read(off, len);
    if (this.mra.single && !this.oneConn && this.ra.active > 0) {
      this.oneConn = true;
      this.ra.goSingle();
      this.ra.park();
      this.headAsked = false;
    }
    if (this.rs.size > 0) this.size = this.rs.size;
    if (!d) this.why = this.mra.why || this.rs.why || this.why;
    return d;
  }

  // el resto del índice, sin quitarle la conexión al video: con varias conexiones cuando ya hay 12 s de video por delante;
  // con una sola, cuando el video no está pidiendo nada y tiene 40 s por delante. Desde la ficha (sin reproductor), cuando
  // el arranque ya bajó
  private async moovGate(): Promise<void> {
    for (;;) {
      if (!this.alive) return;
      const single = this.ra.single || this.mra.single || this.oneConn;
      let ahead = 0;
      try {
        ahead = this.sb ? Math.max(0, this.bufEnd() - (this.v?.currentTime || 0)) : 0;
      } catch {
        ahead = 0;
      }
      // (el video «quieto» = sin ventanas pendientes, ni siquiera esperando su turno tras un rechazo)
      if (this.warm ? this.ra.pending === 0 : single ? this.ra.pending === 0 && ahead >= 40 : ahead >= 12) return;
      await sleep(500);
    }
  }

  // el índice ya está entero: queda como el de siempre (memoria, guardado en el equipo y los idiomas que faltaban en el menú)
  private moovDone(body: Uint8Array): void {
    if (!this.alive) return;
    this.part = false;
    this.moovBox = null;
    rememberMoov(this.url, body);
    if (this.size > 0) SIZES.set(cacheKey(this.url), this.size);
    this.index = body;
    const auds = kids(body, 0, body.length)
      .filter(k => k.t === 'trak')
      .map(k => parseTrak(body, k.s, k.e))
      .filter((x): x is Trk => !!x && x.kind === 'soun');
    this.tracks = auds.map(x => ({ lang: x.lang, codec: x.entry ? typ(x.entry, 4) : '', def: !!x.enabled }));
    this.onHeader();
    if (this.warm || this.tInit) this.keepIndex(3000);
  }

  // un tramo grande (el índice al final del archivo) en 3 partes a la vez (de 1 MB como mínimo): una sola vuelta de
  // pedidos; una parte que falla se pide otra vez sola (líneas de una sola conexión)
  private async getParts(off: number, len: number): Promise<Uint8Array | null> {
    const PART = Math.max(1048576, Math.ceil(len / 3));
    const n = Math.ceil(len / PART);
    const parts: (Uint8Array | null)[] = new Array(n).fill(null);
    let next = 0;
    let running = 0;
    const worker = async () => {
      running++;
      try {
        await work();
      } finally {
        running--;
      }
    };
    const work = async () => {
      while (this.alive && next < n) {
        // un pedido rechazado por pedir a la vez: solo sigue un trabajador
        if (this.oneConn && running > 1) break;
        const i = next++;
        const o = off + i * PART;
        parts[i] = await this.get(o, Math.min(PART, off + len - o));
      }
    };
    // 3 a la vez (más el principio del video, si se está bajando); de a uno si la línea rechaza pedidos a la vez
    const k = this.oneConn ? 1 : Math.min(3, n);
    await Promise.all(Array.from({ length: k }, () => worker()));
    for (let i = 0; i < n && this.alive; i++) {
      if (!parts[i] || parts[i]!.length < Math.min(PART, len - i * PART)) {
        const o = off + i * PART;
        parts[i] = await this.get(o, Math.min(PART, off + len - o));
        if (!parts[i]) return null;
      }
    }
    if (!this.alive) return null;
    const out = concat(parts as Uint8Array[]);
    return out.length >= len ? out.subarray(0, len) : null;
  }

  // espera a que terminen los pedidos en curso (antes de pedir otra vez en una línea de una sola conexión)
  private async idleRequests(): Promise<void> {
    for (let i = 0; i < 100 && this.requests.size > 0 && this.alive; i++) await sleep(100);
  }

  // el servidor sigue entregando (hay pedidos en curso o llegó algo hace poco): vale la pena esperar
  busy(): boolean {
    return this.requests.size > 0 || this.ra.active > 0 || this.mra.active > 0 || Date.now() - (this.rs.lastData || 0) < 10000;
  }

  // [off, off + len) del archivo en el servidor IPTV (el índice; el video lo baja la descarga adelantada)
  private async get(off: number, len: number): Promise<Uint8Array | null> {
    let d = await rangeGet(this.url, off, len, this.rs, this.requests, () => this.alive);
    // rechazado mientras se baja el principio del video u otra parte del índice: la línea admite una sola conexión. Se
    // corta ese adelanto (el índice va primero), todo sigue de a un pedido y se pide otra vez
    if (!d && this.alive && !this.rs.unbounded && (this.ra.active > 0 || this.mra.active > 0 || this.requests.size > 0 || this.sufReqs.size > 0)) {
      this.oneConn = true;
      // el final del archivo pedido a la vez también se deja (la línea no admite dos)
      this.sufOff = true;
      for (const c of this.sufReqs) c.abort();
      this.ra.goSingle();
      this.ra.park();
      this.headAsked = false;
      await this.idleRequests();
      for (let i = 0; i < 2 && !d && this.alive && !this.rs.unbounded; i++) {
        if (i) await sleep(700);
        d = await rangeGet(this.url, off, len, this.rs, this.requests, () => this.alive);
      }
    }
    if (this.rs.size > 0) this.size = this.rs.size;
    if (!d) this.why = this.rs.why || this.why;
    return d;
  }

  private async idle(): Promise<void> {
    for (let i = 0; i < 100 && this.sb?.updating; i++) await sleep(100);
  }

  private async append(data: Uint8Array): Promise<boolean> {
    await this.idle();
    try {
      this.sb.appendBuffer(data);
    } catch (e: any) {
      this.why = 'append: ' + String(e?.message || e).slice(0, 60);
      return false;
    }
    await this.idle();
    return true;
  }

  private isBuffered(t: number): boolean {
    try {
      const b = this.sb.buffered;
      for (let i = 0; i < b.length; i++) if (t >= b.start(i) && t < b.end(i) - 0.5) return true;
    } catch {
      // sin datos
    }
    return false;
  }

  private bufEnd(): number {
    try {
      const b = this.sb.buffered;
      return b.length ? b.end(b.length - 1) : 0;
    } catch {
      return 0;
    }
  }

  // muestras [from, to) de una pista como fragmento; buf empieza en el byte base del archivo
  private frag(tk: Trk, id: number, scale: number, from: number, to: number, buf: Uint8Array, base: number): Uint8Array {
    const conv = (x: number) => Math.round((x * scale) / tk.ts);
    const samples: Sample[] = [];
    const parts: Uint8Array[] = [];
    for (let i = from; i < to; i++) {
      const next = i + 1 < tk.dts.length ? tk.dts[i + 1] : tk.dts[i] + (i > 0 ? tk.dts[i] - tk.dts[i - 1] : 0);
      const c = tk.cts.length ? tk.cts[i] : 0;
      samples.push({ size: tk.size[i], duration: conv(next) - conv(tk.dts[i]), cts: Math.max(0, conv(tk.dts[i] + c) - conv(tk.dts[i])), key: !tk.key || tk.key.has(i) });
      parts.push(buf.subarray(tk.off[i] - base, tk.off[i] - base + tk.size[i]));
    }
    return fragment(this.seq++, id, conv(tk.dts[from]) + Math.round(tk.shift * scale), samples, concat(parts));
  }

  // bytes que ocupan las muestras [from, to)
  private span(tk: Trk, from: number, to: number): [number, number, number] {
    let lo = Infinity;
    let hi = 0;
    let sum = 0;
    for (let i = from; i < to; i++) {
      lo = Math.min(lo, tk.off[i]);
      hi = Math.max(hi, tk.off[i] + tk.size[i]);
      sum += tk.size[i];
    }
    return [lo, hi, sum];
  }

  // el próximo tramo: muestras de video [vi, vj) y de audio [ai, aj), y los bytes que ocupan en el archivo
  private chunkPlan(): { vj: number; aj: number; vs: [number, number, number] | null; as: [number, number, number] | null; lo: number; hi: number; need: number } {
    // ~4 s de video (el primero 1,5 s: empieza a verse apenas llega lo mínimo) y el audio de ese mismo tramo
    const vt = this.vt!;
    const a = this.at;
    const t0 = this.secs(vt, vt.dts[Math.min(this.vi, vt.dts.length - 1)]);
    const n = vt.dts.length;
    const target = this.firstOut ? Math.max(1.5, this.firstAt - t0 + 1.5) : CHUNK;
    // el corte va donde todo lo anterior se muestra antes que todo lo siguiente (no parte un grupo de cuadros B: eso
    // dejaba huecos de milésimas entre tramos y micro cortes); antes se esperaba al cuadro clave siguiente (hasta 15 s
    // de video, varios MB antes de la primera imagen)
    let vj = this.vi + 1;
    let maxP = this.ptsU(this.vi);
    const closed = (j: number) => {
      for (let k = j; k < Math.min(n, j + 16); k++) if (this.ptsU(k) <= maxP) return false;
      return true;
    };
    while (vj < n) {
      const t = this.secs(vt, vt.dts[vj]);
      if (t >= t0 + target && closed(vj)) break;
      if (t >= t0 + 15 && (!vt.key || vt.key.has(vj))) break;
      maxP = Math.max(maxP, this.ptsU(vj));
      vj++;
    }
    let nextP = Infinity;
    for (let k = vj; k < Math.min(n, vj + 16); k++) nextP = Math.min(nextP, this.ptsU(k));
    const tEnd = vj < n ? this.secs(vt, nextP) : Infinity;
    let aj = this.ai;
    if (a) while (aj < a.dts.length && this.secs(a, a.dts[aj]) < tEnd) aj++;
    const vs = this.vi < vj ? this.span(vt, this.vi, vj) : null;
    const as = a && this.ai < aj ? this.span(a, this.ai, aj) : null;
    // video y audio van intercalados en el archivo: un solo pedido si casi todo lo de en medio es de ellos
    const lo = Math.min(vs ? vs[0] : Infinity, as ? as[0] : Infinity);
    const hi = Math.max(vs ? vs[1] : 0, as ? as[1] : 0);
    const need = (vs ? vs[2] : 0) + (as ? as[2] : 0);
    return { vj, aj, vs, as, lo, hi, need };
  }

  private async pump(): Promise<void> {
    this.running = true;
    try {
      while (this.alive) {
        const g = this.gen;
        const vt = this.vt!;
        const a = this.at;
        if (this.vi >= vt.dts.length && (!a || this.ai >= a.dts.length)) {
          await this.idle();
          try {
            if (this.ms.readyState === 'open') this.ms.endOfStream();
          } catch {
            // ya terminado
          }
          return;
        }
        if (this.bufEnd() - (this.v.currentTime || 0) > AHEAD) {
          await sleep(1000);
          continue;
        }
        const { vj, aj, vs, as, lo, hi, need } = this.chunkPlan();
        let vb: Uint8Array | null = null;
        let ab: Uint8Array | null = null;
        let vbase = 0;
        let abase = 0;
        if (hi - lo <= need * 1.5 + 2097152 && !this.ra2) {
          // de la descarga adelantada (ya en camino desde que se abrió o se saltó)
          const all = await this.ra.read(lo, hi - lo);
          vb = ab = all;
          vbase = abase = lo;
        } else {
          if (!this.ra2) this.prime();
          if (vs) vb = await this.ra.read(vs[0], vs[1] - vs[0]);
          if (as && this.ra2) ab = await this.ra2.read(as[0], as[1] - as[0]);
          vbase = vs ? vs[0] : 0;
          abase = as ? as[0] : 0;
        }
        if (!this.alive || g !== this.gen) continue;
        if (this.rs.size > 0) this.size = this.rs.size;
        // el índice guardado en el equipo era de otro archivo (el servidor lo cambió: otro tamaño): se olvida y playback
        // abre de nuevo leyendo el índice del servidor
        if (this.packed && this.rs.size > 0 && this.rs.size !== this.packSize) {
          if (this.shared) sharedStale(this.url);
          dropIndex(this.url);
          MOOV_CACHE.delete(cacheKey(this.url));
          this.index = null;
          this.why = STALE_INDEX;
          this.onError();
          return;
        }
        if (!vb && !this.why) this.why = this.ra.why;
        if ((vs && (!vb || vb.length < vs[1] - vbase)) || (as && (!ab || ab.length < as[1] - abase))) {
          this.why = 'bajada: ' + (this.why || 'incompleta');
          this.onError();
          return;
        }
        const out: Uint8Array[] = [];
        // la escala de tiempo del archivo: duraciones exactas (antes a 90 kHz, con redondeos de ±1 en cada cuadro)
        if (vs) out.push(this.frag(vt, VIDEO_ID, vt.ts, this.vi, vj, vb!, vbase));
        if (a && as) out.push(this.frag(a, AUDIO_ID, this.arate, this.ai, aj, ab!, abase));
        await this.trim();
        if (g !== this.gen) continue;
        this.firstOut = false;
        if (!(await this.append(concat(out)))) {
          this.onError();
          return;
        }
        this.vi = vj;
        this.ai = aj;
      }
    } finally {
      this.running = false;
    }
  }

  // lo ya visto se borra para no llenar la memoria
  private async trim(): Promise<void> {
    try {
      const b = this.sb.buffered;
      const t = this.v.currentTime || 0;
      if (b.length && b.start(0) < t - 30) {
        this.sb.remove(b.start(0), t - 15);
        await this.idle();
      }
    } catch {
      // nada que borrar
    }
  }

  // como hls.ts: el reproductor de Vega no empieza si lo bajado no arranca en el segundo actual y se queda quieto en
  // los huecos; cada 300 ms se salta al tramo con datos
  private unstick(): void {
    try {
      const b = this.sb.buffered;
      const t = this.v.currentTime || 0;
      if (this.sw.stuck(t, this.bufEnd() - t, this.v.paused)) {
        this.why = 'con video bajado y sin imagen en 8 s (el equipo no decodifica este video)';
        this.onError();
        return;
      }
      if (t !== this.lastT) {
        this.lastT = t;
        this.lastMove = Date.now();
      }
      const still = this.v.paused ? 0 : Date.now() - this.lastMove;
      const stalled = still > 3000;
      for (let i = 0; i < b.length; i++) {
        const st = b.start(i);
        const en = b.end(i);
        const next = i + 1 < b.length ? b.start(i + 1) : -1;
        if (t < st - 0.05) {
          if (en - st > 0.5) this.jump(st + 0.02);
          return;
        }
        if (t <= en) {
          // un hueco: solo si de verdad se quedó quieto en él (1 s: el tiempo del reproductor avanza a saltos), y justo al otro lado (antes saltaba 0,5 s antes de cada
          // final de tramo, +0,1 s: un «grumito» en el audio)
          if (next > 0 && ((en - t < 0.3 && still > 1000) || stalled)) this.jump(next + 0.02);
          else if (stalled && en - t > 1) this.jump(t + 0.5);
          return;
        }
      }
    } catch {
      // sin datos todavía
    }
  }

  private jump(to: number): void {
    this.sw.moved(to);
    this.v.currentTime = to;
    this.lastMove = Date.now();
    if (this.v.paused) this.v.play();
  }
}

// contenido de la caja moov (sin su cabecera)
function kidsBody(m: Uint8Array): Uint8Array {
  return m.subarray(u32(m, 0) === 1 ? 16 : 8);
}
