// MP4 directo del servidor IPTV sin el panel. El modo directo del reproductor de Vega (src = dirección) da error 4 con
// los MP4 que traen su índice (moov) al final del archivo, lo normal en los servidores IPTV; con el MP4 de siempre
// (H.264 + AAC) por Media Source Extensions sí suena. Aquí se lee el índice con pedidos Range al mismo servidor, se
// bajan de a ~4 s las muestras de video y del audio predeterminado y se entregan como MP4 fragmentado (mp4box.ts).
// No pasa por la VPS: solo el cambio de idioma la usa. Saltos (◀▶, Continuar viendo) desde el cuadro clave anterior.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { UA } from '../lib/http';
import { AUDIO_ID, AudioCfg, concat, fragment, initSegment, mp4Mime, Sample, VIDEO_ID, VideoCfg } from '../lib/mp4box';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const AHEAD = 40; // segundos bajados por adelantado
const CHUNK = 4; // segundos de video por pedido
const MOOV_MAX = 64 * 1048576;

type Trk = {
  // shift: segundos que se le suman a la pista para que video y audio queden como los muestra el archivo (lista de
  // edición: el video suele empezar unas décimas después por los cuadros B) sin tiempos negativos
  kind: string; ts: number; enabled: boolean; entry: Uint8Array | null; width: number; height: number; mediaTime: number; shift: number;
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
  const tk: Trk = { kind: '', ts: 0, enabled: false, entry: null, width: 0, height: 0, mediaTime: 0, shift: 0, off: [], size: [], dts: [], cts: [], key: null };
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
  return { config: new Uint8Array(2), channels: u16(b, 8 + 16) || 2, rate: u16(b, 8 + 24) || tk.ts };
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
  const rate = u16(b, 8 + 24) || tk.ts;
  return { config: b.slice(o, o + len), channels: u16(b, 8 + 16) || 2, rate };
}

export class Mp4Mse {
  private ms: any = null;
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
  // por qué no siguió (para el reporte del panel)
  why = '';
  // el reproductor no acepta el audio del archivo (Dolby en Vega): suena solo el video; los idiomas quedan en el menú
  noAudio = false;
  onError: () => void = () => {};

  constructor(private v: VideoPlayer, private url: string) {}

  // '' = empezó en el segundo pedido; si no, el motivo (el que llama sigue con el modo directo de siempre)
  async start(at: number): Promise<string> {
    const moov = await this.readMoov();
    if (!moov) return 'índice: ' + (this.why || 'no encontrado');
    const traks = kids(moov, 0, moov.length).filter(k => k.t === 'trak').map(k => parseTrak(moov, k.s, k.e)).filter((x): x is Trk => !!x);
    const vt = traks.find(x => x.kind === 'vide') || null;
    const auds = traks.filter(x => x.kind === 'soun');
    const at0 = auds.find(x => x.enabled) || auds[0] || null;
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
    const lead = Math.max(vt.mediaTime / vt.ts, this.at ? this.at.mediaTime / this.at.ts : 0);
    vt.shift = lead - vt.mediaTime / vt.ts;
    if (this.at) this.at.shift = lead - this.at.mediaTime / this.at.ts;
    this.arate = ac ? ac.rate : 0;
    if (!this.alive) return '';
    const ms: any = new MediaSource();
    this.ms = ms;
    const opened = new Promise<void>(res => ms.addEventListener('sourceopen', () => res()));
    try {
      this.v.src = (URL as any).createObjectURL(ms);
    } catch {
      (this.v as any).srcObject = ms;
    }
    await Promise.race([opened, sleep(10000)]);
    if (ms.readyState !== 'open') return 'MSE sin abrir';
    let init: Uint8Array;
    try {
      this.sb = ms.addSourceBuffer(mime);
      init = initSegment(vc, ac, dolby ? at0!.entry! : undefined);
    } catch (e: any) {
      // el audio no lo acepta (Vega no trae E-AC-3 por MSE): solo el video, sin sonido
      const vOnly = mp4Mime(vc, null);
      try {
        if (!this.at) throw e;
        this.sb = ms.addSourceBuffer(vOnly);
        init = initSegment(vc, null);
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
    return '';
  }

  destroy(): void {
    this.alive = false;
    this.gen++;
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    try {
      if (this.sb?.updating) this.sb.abort();
    } catch {
      // ya cerrado
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

  private secs(tk: Trk, units: number): number {
    return units / tk.ts + tk.shift;
  }

  // muestras desde el cuadro clave en o antes de t
  private place(t: number): void {
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

  // el índice: al principio o (lo normal en IPTV) al final, después del video
  private async readMoov(): Promise<Uint8Array | null> {
    let off = 0;
    for (let i = 0; i < 12; i++) {
      const h = await this.get(off, 16);
      if (!h || h.length < 8) return null;
      let size = u32(h, 0);
      if (size === 1) size = u64(h, 8);
      else if (size === 0) size = this.size - off;
      if (typ(h, 4) === 'moov') {
        if (size > MOOV_MAX) return null;
        const m = await this.get(off, size);
        return m && m.length === size ? kidsBody(m) : null;
      }
      if (size < 8) return null;
      off += size;
      if (this.size && off >= this.size) return null;
    }
    return null;
  }

  // [off, off + len) del archivo en el servidor IPTV
  private async get(off: number, len: number): Promise<Uint8Array | null> {
    for (let tries = 0; tries < 3 && this.alive; tries++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 30000);
      try {
        const r = await fetch(this.url, { headers: { 'User-Agent': UA, Range: 'bytes=' + off + '-' + (off + len - 1) }, signal: ctrl.signal });
        if (r.status !== 206) {
          this.why = 'pedido ' + r.status;
          ctrl.abort();
          return null;
        }
        const tot = Number((r.headers.get('content-range') || '').split('/')[1]);
        if (tot > 0) this.size = tot;
        return new Uint8Array(await r.arrayBuffer());
      } catch (e: any) {
        this.why = 'red: ' + String(e?.message || e).slice(0, 60);
        await sleep(1000);
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
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
        // ~4 s de video y el audio de ese mismo tramo
        const t0 = this.secs(vt, vt.dts[Math.min(this.vi, vt.dts.length - 1)]);
        let vj = this.vi;
        // hasta el cuadro clave siguiente (como mucho 15 s): cortar a mitad de un grupo con cuadros B dejaba huecos de
        // milésimas entre tramos y el reproductor se frenaba en cada uno (micro cortes del audio)
        while (vj < vt.dts.length && (vj === this.vi || this.secs(vt, vt.dts[vj]) < t0 + CHUNK || (vt.key && !vt.key.has(vj) && this.secs(vt, vt.dts[vj]) < t0 + 15))) vj++;
        const tEnd = vj < vt.dts.length ? this.secs(vt, vt.dts[vj]) : Infinity;
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
          const all = await this.get(lo, hi - lo);
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
        if (vs) out.push(this.frag(vt, VIDEO_ID, 90000, this.vi, vj, vb!, vbase));
        if (a && as) out.push(this.frag(a, AUDIO_ID, this.arate, this.ai, aj, ab!, abase));
        await this.trim();
        if (g !== this.gen) continue;
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
          // un hueco: solo si de verdad se quedó quieto en él, y justo al otro lado (antes saltaba 0,5 s antes de cada
          // final de tramo, +0,1 s: un «grumito» en el audio)
          if (next > 0 && ((en - t < 0.3 && still > 400) || stalled)) this.jump(next + 0.02);
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
