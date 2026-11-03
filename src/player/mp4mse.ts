// MP4 directo del servidor IPTV sin el panel. El modo directo del reproductor de Vega (src = dirección) da error 4 con
// los MP4 que traen su índice (moov) al final del archivo, lo normal en los servidores IPTV; con el MP4 de siempre
// (H.264 + AAC) por Media Source Extensions sí suena. Aquí se lee el índice con pedidos Range al mismo servidor, se
// bajan de a ~4 s las muestras de video y del audio predeterminado y se entregan como MP4 fragmentado (mp4box.ts).
// No pasa por la VPS: solo el cambio de idioma la usa. Saltos (◀▶, Continuar viendo) desde el cuadro clave anterior.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { rangeGet, RangeState } from './rangeget';
import { AUDIO_ID, AudioCfg, concat, fragment, initSegment, mp4Mime, Sample, VIDEO_ID, VideoCfg } from '../lib/mp4box';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const AHEAD = 40; // segundos bajados por adelantado
const CHUNK = 4; // segundos de video por pedido
const MOOV_MAX = 64 * 1048576;

type Trk = {
  // shift: segundos que se le suman a la pista para que video y audio queden como los muestra el archivo (lista de
  // edición: el video suele empezar unas décimas después por los cuadros B) sin tiempos negativos
  // delay: tramos vacíos al principio de la lista de edición (la pista empieza más tarde), en la escala de la película
  kind: string; lang: string; ts: number; enabled: boolean; entry: Uint8Array | null; width: number; height: number; mediaTime: number; delay: number; shift: number;
  off: number[]; size: number[]; dts: number[]; cts: number[]; key: Set<number> | null;
};

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

function parseTrak(b: Uint8Array, s: number, e: number): Trk | null {
  const tk: Trk = { kind: '', lang: '', ts: 0, enabled: false, entry: null, width: 0, height: 0, mediaTime: 0, delay: 0, shift: 0, off: [], size: [], dts: [], cts: [], key: null };
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
  const box = (t: string) => kid(b, stbl.s, stbl.e, t);
  const stsd = box('stsd');
  const ent = stsd ? kids(b, stsd.s + 8, stsd.e)[0] : null;
  if (ent) tk.entry = b.subarray(ent.s - 8, ent.e);
  // tamaños
  const stsz = box('stsz');
  if (!stsz || !tk.ts) return null;
  const fixed = u32(b, stsz.s + 4);
  const n = u32(b, stsz.s + 8);
  for (let i = 0; i < n; i++) tk.size.push(fixed || u32(b, stsz.s + 12 + i * 4));
  // posición de cada muestra: trozos (stco / co64) y muestras por trozo (stsc)
  const co = box('stco') || box('co64');
  const stsc = box('stsc');
  if (!co || !stsc) return null;
  const wide = co.t === 'co64';
  const chunks = u32(b, co.s + 4);
  const runs = u32(b, stsc.s + 4);
  let smp = 0;
  for (let r = 0; r < runs && smp < n; r++) {
    const first = u32(b, stsc.s + 8 + r * 12);
    const per = u32(b, stsc.s + 12 + r * 12);
    const last = r + 1 < runs ? u32(b, stsc.s + 8 + (r + 1) * 12) - 1 : chunks;
    for (let c = first; c <= last && smp < n; c++) {
      let o = wide ? u64(b, co.s + 8 + (c - 1) * 8) : u32(b, co.s + 8 + (c - 1) * 4);
      for (let k = 0; k < per && smp < n; k++, smp++) {
        tk.off.push(o);
        o += tk.size[smp];
      }
    }
  }
  // tiempos (stts), desfase de presentación (ctts) y cuadros clave (stss)
  const stts = box('stts');
  if (!stts) return null;
  let t = 0;
  for (let i = 0, m = u32(b, stts.s + 4); i < m; i++) {
    const cnt = u32(b, stts.s + 8 + i * 8);
    const d = u32(b, stts.s + 12 + i * 8);
    for (let k = 0; k < cnt && tk.dts.length < n; k++, t += d) tk.dts.push(t);
  }
  const ctts = box('ctts');
  if (ctts) {
    for (let i = 0, m = u32(b, ctts.s + 4); i < m; i++) {
      const cnt = u32(b, ctts.s + 8 + i * 8);
      let d = u32(b, ctts.s + 12 + i * 8);
      if (d > 0x7fffffff) d -= 4294967296;
      for (let k = 0; k < cnt && tk.cts.length < n; k++) tk.cts.push(d);
    }
  }
  const stss = box('stss');
  if (stss) {
    tk.key = new Set();
    for (let i = 0, m = u32(b, stss.s + 4); i < m; i++) tk.key.add(u32(b, stss.s + 8 + i * 4) - 1);
  }
  const len = Math.min(tk.off.length, tk.dts.length, tk.size.length);
  if (!len) return null;
  tk.off.length = tk.size.length = tk.dts.length = len;
  return tk;
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
function rememberMoov(url: string, moov: Uint8Array): void {
  const k = cacheKey(url);
  MOOV_CACHE.delete(k);
  MOOV_CACHE.set(k, moov);
  while (MOOV_CACHE.size > 3) MOOV_CACHE.delete(MOOV_CACHE.keys().next().value as string);
}

export class Mp4Mse {
  tracks: { lang: string; codec: string }[] = [];
  audioIdx = -1;
  onTracks: () => void = () => {};
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
  // MP4 con el índice al final: el principio del video (2 MB) se pide a la vez que el índice
  private head: { off: number; p: Promise<Uint8Array | null> } | null = null;
  private headBusy = false;
  private headReqs = new Set<AbortController>();
  private headOff = false;
  // la línea no admite pedidos a la vez: todo de a uno
  private oneConn = false;
  // por qué no siguió (para el reporte del panel)
  why = '';
  // el reproductor no acepta el audio del archivo (Dolby en Vega): suena solo el video; los idiomas quedan en el menú
  noAudio = false;
  onError: () => void = () => {};

  constructor(private v: VideoPlayer, private url: string, private selectedAudio = -1, index: Uint8Array | null = null) {
    this.index = index;
  }

  // '' = empezó en el segundo pedido; si no, el motivo (el que llama sigue con el modo directo de siempre)
  async start(at: number): Promise<string> {
    // el índice ya leído de este archivo (volver a abrirlo, Continuar viendo, cambiar de audio): sin pedirlo otra vez
    const moov = this.index || MOOV_CACHE.get(cacheKey(this.url)) || await this.readMoov();
    if (moov) rememberMoov(this.url, moov);
    if (!moov) return 'índice: ' + (this.why || 'no encontrado');
    if (!this.alive) return '';
    this.index = moov;
    const traks = kids(moov, 0, moov.length).filter(k => k.t === 'trak').map(k => parseTrak(moov, k.s, k.e)).filter((x): x is Trk => !!x);
    const vt = traks.find(x => x.kind === 'vide') || null;
    const auds = traks.filter(x => x.kind === 'soun');
    this.tracks = auds.map(x => ({ lang: x.lang, codec: x.entry ? typ(x.entry, 4) : '' }));
    const at0 = auds[this.selectedAudio] || auds.find(x => x.enabled) || auds[0] || null;
    this.audioIdx = at0 ? auds.indexOf(at0) : -1;
    const vc = vt ? videoCfg(vt) : null;
    const aac = at0 ? audioCfg(at0) : null;
    const dolby = at0 && !aac ? dolbyCfg(at0) : null;
    const ac = aac || dolby;
    if (!vt || !vc || (at0 && !ac)) return 'códec v=' + (vt?.entry ? typ(vt.entry, 4) : '-') + ' a=' + (at0?.entry ? typ(at0.entry, 4) : '-');
    const mime = dolby ? mp4Mime(vc, null).replace(/"$/, ',' + typ(at0!.entry!, 4) + '"') : mp4Mime(vc, ac);
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
    const mvhd = kid(moov, 0, moov.length, 'mvhd');
    const mts = mvhd ? u32(moov, mvhd.s + (moov[mvhd.s] === 1 ? 20 : 12)) || 1 : 1;
    const offOf = (x: Trk) => x.delay / mts - x.mediaTime / x.ts;
    const base = Math.min(offOf(vt), this.at ? offOf(this.at) : Infinity);
    vt.shift = offOf(vt) - base;
    if (this.at) this.at.shift = offOf(this.at) - base;
    this.arate = ac ? ac.rate : 0;
    if (!this.alive) return '';
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
      init = initSegment(vc, ac, dolby ? at0!.entry! : undefined, vt.ts);
    } catch (e: any) {
      // el audio no lo acepta (Vega no trae E-AC-3 por MSE): solo el video, sin sonido
      const vOnly = mp4Mime(vc, null);
      try {
        if (!this.at) throw e;
        this.sb = ms.addSourceBuffer(vOnly);
        init = initSegment(vc, null, undefined, vt.ts);
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
    this.place(at);
    if (at > 0) this.v.currentTime = at;
    this.pump();
    this.watch = setInterval(() => this.alive && this.unstick(), 300);
    this.v.play();
    this.onTracks();
    return '';
  }

  destroy(): void {
    this.alive = false;
    this.gen++;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    for (const request of this.headReqs) request.abort();
    this.headReqs.clear();
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
    this.v.currentTime = t;
    if (!this.running) this.pump();
  }

  // tiempo de presentación de la muestra i del video (decodificación + desfase de los cuadros B)
  private ptsU(i: number): number {
    const vt = this.vt!;
    return vt.dts[i] + (vt.cts.length ? vt.cts[i] : 0);
  }

  // [lo, hi) del principio del video si ya llegó con el índice; si no, null (se pide como siempre)
  private async fromHead(lo: number, hi: number): Promise<Uint8Array | null> {
    const h = this.head;
    if (!h || lo < h.off) return null;
    const d = await h.p;
    if (!d || hi > h.off + d.length) {
      if (!d || lo >= h.off + d.length) this.head = null;
      return null;
    }
    return d.subarray(lo - h.off, hi - h.off);
  }

  private secs(tk: Trk, units: number): number {
    return units / tk.ts + tk.shift;
  }

  // muestras desde el cuadro clave en o antes de t
  private place(t: number): void {
    this.firstOut = true;
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
    let off = 0;
    let win = await this.get(0, 65536);
    let wOff = 0;
    for (let i = 0; i < 12 && win; i++) {
      if (off + 16 > wOff + win.length) {
        if (this.size && off >= this.size) return null;
        win = await this.get(off, 1048576);
        wOff = off;
        if (!win || win.length < 8) return null;
      }
      const h = win.subarray(off - wOff);
      let size = u32(h, 0);
      if (size === 1) size = u64(h, 8);
      else if (size === 0) size = this.size - off;
      if (typ(h, 4) === 'moov') {
        if (size > MOOV_MAX) return null;
        // lo ya leído del índice y el resto en partes a la vez (cada conexión la limita el servidor por separado)
        const have = win.slice(off - wOff, Math.min(win.length, off - wOff + size));
        if (have.length >= size) return kidsBody(have);
        const rest = await this.getParts(off + have.length, size - have.length);
        return rest ? kidsBody(concat([have, rest])) : null;
      }
      if (size < 8) return null;
      // el video (mdat) va antes del índice: su principio se pide ya, a la vez que el índice (lo primero que se va a ver)
      if (typ(h, 4) === 'mdat' && !this.head && size > 4194304) {
        const at = off + (u32(h, 0) === 1 ? 16 : 8);
        this.headBusy = true;
        const p = this.get(at, 2097152, true);
        this.head = { off: at, p };
        p.then(() => (this.headBusy = false), () => (this.headBusy = false));
      }
      off += size;
      if (this.size && off >= this.size) return null;
    }
    return null;
  }

  // un tramo grande (el índice al final del archivo) en partes de 1 MB, de a 3 a la vez; una parte que falla se pide
  // otra vez sola (líneas de una sola conexión)
  private async getParts(off: number, len: number): Promise<Uint8Array | null> {
    const PART = 1048576;
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
    return this.requests.size > 0 || Date.now() - (this.rs.lastData || 0) < 10000;
  }

  // [off, off + len) del archivo en el servidor IPTV
  private async get(off: number, len: number, head = false): Promise<Uint8Array | null> {
    // el adelanto cancelado no se vuelve a pedir (rangeGet reintenta mientras alive)
    let d = await rangeGet(this.url, off, len, this.rs, head ? this.headReqs : this.requests, head ? () => this.alive && !this.headOff : () => this.alive);
    // rechazado mientras se baja el principio del video: la línea admite una sola conexión. Se cancela ese adelanto (el
    // índice va primero), todo sigue de a un pedido y se pide otra vez
    if (!d && !head && this.alive && !this.rs.unbounded && (this.headBusy || this.requests.size > 0)) {
      this.oneConn = true;
      this.headOff = true;
      const hp = this.head?.p;
      for (const c of this.headReqs) c.abort();
      this.headReqs.clear();
      this.head = null;
      this.headBusy = false;
      // que la conexión cancelada termine de cerrarse (como mucho 3 s) y lo demás en curso
      if (hp) await Promise.race([hp, sleep(3000)]);
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
        // ~4 s de video (el primero 1,5 s: empieza a verse apenas llega lo mínimo) y el audio de ese mismo tramo
        const t0 = this.secs(vt, vt.dts[Math.min(this.vi, vt.dts.length - 1)]);
        const n = vt.dts.length;
        const target = this.firstOut ? 1.5 : CHUNK;
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
        let vb: Uint8Array | null = null;
        let ab: Uint8Array | null = null;
        let vbase = 0;
        let abase = 0;
        if (hi - lo <= need * 1.5 + 2097152) {
          // el principio del video ya pedido junto con el índice (MP4 con el índice al final)
          const all = (await this.fromHead(lo, hi)) || (await this.get(lo, hi - lo));
          vb = ab = all;
          vbase = abase = lo;
        } else {
          if (vs) vb = await this.get(vs[0], vs[1] - vs[0]);
          if (as) ab = await this.get(as[0], as[1] - as[0]);
          vbase = vs ? vs[0] : 0;
          abase = as ? as[0] : 0;
        }
        if (!this.alive || g !== this.gen) continue;
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
    this.v.currentTime = to;
    this.lastMove = Date.now();
    if (this.v.paused) this.v.play();
  }
}

// contenido de la caja moov (sin su cabecera)
function kidsBody(m: Uint8Array): Uint8Array {
  return m.subarray(u32(m, 0) === 1 ? 16 : 8);
}
