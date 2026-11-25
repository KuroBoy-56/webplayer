// Lector de MPEG-TS para películas y series (2.6.10).
//
// Hay proveedores que entregan capítulos «.mp4» que por dentro son MPEG-TS (el formato de los canales; los «DUAL», con
// dos audios). El lector de MP4 no los abre («no es MP4») y solo los abría el reproductor de Amazon, que en el simulador
// cerraba la app o cortaba el audio. Aquí se leen como los canales del lector propio (tsmux.ts: H.264 + AAC / MP3 / AC-3
// a MP4 fragmentado para MSE), pero de un archivo: por partes con pedidos Range (readahead.ts), saltando al segundo
// pedido por proporción del archivo (con dos ajustes) y con la línea de tiempo del archivo (timestampOffset). Audio que el
// equipo no acepta (E-AC-3, o el que MSE rechace): solo el video, sin sonido (noAudio), en vez de no verse nada.
//
// Los canales mandan segmentos que empiezan y terminan en un cuadro completo; un pedazo de archivo no: los paquetes del
// cuadro que queda a medias de cada pista se guardan y van con el pedazo siguiente (pack), así ningún cuadro se pierde.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { RangeState } from './rangeget';
import { ReadAhead } from './readahead';
import { aheadSecs, BEHIND_KEEP, BEHIND_MAX } from './membudget';
import { concat } from '../lib/mp4box';
import { demux, Pmt } from '../lib/tsdemux';
import { TsMux } from '../lib/tsmux';

export const NOT_MP4_TS = 'el archivo es MPEG-TS';
const PKT = 188;
// pedazos de ~1 MB (múltiplo de 188)
const CHUNK = PKT * 5577;
// lo que se guarda por delante (segundos)
// segundos entregados por adelantado: aheadSecs (membudget.ts, 2.8.0: como mucho ~40 MB; antes 40 s siempre)
const WRAP = 8589934592;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

const files = new Set<string>();
const keyOf = (u: string) => u.replace(/^https?:\/\//i, '');
// el archivo resultó ser MPEG-TS (en esta sesión): el lector de MPEG-TS directo
export function tsKnown(url: string): boolean {
  return files.has(keyOf(url));
}
export function noteTs(url: string): void {
  files.add(keyOf(url));
}

// ¿MPEG-TS? (byte de sincronía 0x47 cada 188 bytes)
export function looksTs(d: Uint8Array): boolean {
  if (!d.length || d[0] !== 0x47) return false;
  for (let o = PKT; o < Math.min(d.length, PKT * 5); o += PKT) if (d[o] !== 0x47) return false;
  return true;
}

// marca (90 kHz) del primer o del último PES de video de un pedazo; -1 si no hay
function videoPts(d: Uint8Array, pmt: Pmt, last: boolean): number {
  if (pmt.video < 0) return -1;
  const list = demux(d, [pmt.video], pmt).pes.get(pmt.video) || [];
  const withPts = list.filter(p => p.pts >= 0);
  if (!withPts.length) return -1;
  return (last ? withPts[withPts.length - 1] : withPts[0]).pts;
}

// La tabla de programas (PAT y PMT: el primer paquete de cada una) del principio del archivo: va delante del primer
// pedazo de cada conversor nuevo (un salto, solo el video), que sin ella no sabe qué pista es cuál
function psiOf(d: Uint8Array): Uint8Array | null {
  let pat: Uint8Array | null = null;
  let pmtPid = -1;
  for (let i = 0; i + PKT <= d.length; i += PKT) {
    if (d[i] !== 0x47 || !(d[i + 1] & 0x40)) continue;
    const pid = ((d[i + 1] & 0x1f) << 8) | d[i + 2];
    const afc = (d[i + 3] >> 4) & 3;
    const p = i + 4 + (afc === 3 ? 1 + d[i + 4] : 0);
    if (pid === 0 && !pat) {
      const s = p + 1 + d[p];
      for (let j = s + 8; j + 4 <= i + PKT; j += 4) {
        if ((d[j] << 8) | d[j + 1]) {
          pmtPid = ((d[j + 2] & 0x1f) << 8) | d[j + 3];
          break;
        }
      }
      pat = d.slice(i, i + PKT);
    } else if (pat && pid === pmtPid) {
      return concat([pat, d.slice(i, i + PKT)]);
    }
  }
  return null;
}

// b - a en 90 kHz con la vuelta de las marcas de 33 bits
function span(a: number, b: number): number {
  let d = b - a;
  while (d < -WRAP / 2) d += WRAP;
  while (d > WRAP / 2) d -= WRAP;
  return d;
}

export class TsVodMse {
  tracks: { lang: string; codec: string; def?: boolean }[] = [];
  audioIdx: number;
  noAudio = false;
  why = '';
  // (como los otros lectores: este no tiene índice que guardar)
  readonly index = null;
  onHeader: () => void = () => {};
  onTracks: () => void = () => {};
  onError: () => void = () => {};
  private alive = true;
  private gen = 0;
  private rs: RangeState = { close: false, unbounded: false, size: 0, why: '' };
  private ra: ReadAhead;
  private size = 0;
  private dur = 0;
  private pts0 = -1;
  private pmt: Pmt | null = null;
  private ms: any = null;
  private sb: any = null;
  private objectUrl = '';
  private mux: TsMux | null = null;
  private videoOnly = false;
  private next = 0;
  private carry: Uint8Array[] = [];
  private eof = false;
  private running = false;
  private offsetSet = false;
  private realStart = 0;
  private wantAt = 0;
  private fixes = 0;
  private watch: ReturnType<typeof setInterval> | null = null;
  private noPlay = false;
  // PAT + PMT del principio del archivo y si el próximo pedazo los lleva delante (conversor nuevo)
  private psi: Uint8Array | null = null;
  private needPsi = false;
  private t0 = Date.now();
  private tFirst = 0;

  constructor(private v: VideoPlayer, private url: string, audioIdx = -1) {
    this.audioIdx = Math.max(0, audioIdx);
    this.ra = new ReadAhead(url, this.rs, () => (this.size > 0 && this.dur > 1 ? this.size / this.dur : 0));
  }

  private bps(): number {
    return this.size > 0 && this.dur > 1 ? this.size / this.dur : 500000;
  }

  // '' = abrió; si no, por qué no
  async start(at: number): Promise<string> {
    // principio del archivo: la tabla de programas, la primera marca de tiempo y el tamaño
    const head = await this.ra.read(0, CHUNK);
    if (!this.alive) return '';
    if (!head) return 'cabecera: ' + (this.ra.why || this.rs.why || 'no se pudo leer');
    if (!looksTs(head)) return 'no es MPEG-TS';
    this.size = this.rs.size || 0;
    this.pmt = demux(head, [], null).pmt;
    if (!this.pmt) return 'MPEG-TS sin tabla de programas';
    if (this.pmt.video < 0) return 'MPEG-TS sin video';
    if (this.pmt.videoType !== 0x1b) return 'MPEG-TS con video ' + this.pmt.videoType.toString(16) + ' (solo H.264)';
    this.pts0 = videoPts(head, this.pmt, false);
    this.psi = psiOf(head);
    // los idiomas en el mismo orden en que los elige TsMux (AAC; si no hay, MP3 / MP2; si no, AC-3): el número del menú
    // es el mismo que usa el conversor. Sin ninguno de esos (E-AC-3, LATM): se muestran, pero va solo el video
    const all = this.pmt.audio;
    const aac = all.filter(a => a.type === 0x0f);
    const mpa = all.filter(a => a.type === 0x03 || a.type === 0x04);
    const ac3 = all.filter(a => a.type === 0x81 || a.type === 0x06);
    const usable = aac.length ? aac : mpa.length ? mpa : ac3;
    const codec = (t: number) => (t === 0x0f ? 'aac' : t === 0x81 || t === 0x06 ? 'ac-3' : t === 0x87 ? 'ec-3' : t === 0x11 ? 'latm' : 'mp3');
    this.tracks = (usable.length ? usable : all).map((a, i) => ({ lang: a.lang, codec: codec(a.type), def: i === 0 }));
    if (!usable.length && all.length) {
      this.videoOnly = true;
      this.noAudio = true;
    }
    if (this.audioIdx >= this.tracks.length) this.audioIdx = 0;
    // final del archivo: la última marca (la duración)
    if (this.size > CHUNK * 2) {
      const from = Math.floor((this.size - CHUNK) / PKT) * PKT;
      const tail = await this.ra.read(from, this.size - from);
      if (!this.alive) return '';
      const last = tail && this.pts0 >= 0 ? videoPts(tail.subarray(this.align(tail)), this.pmt, true) : -1;
      if (last >= 0) this.dur = Math.max(0, span(this.pts0, last) / 90000);
    }
    this.onHeader();
    // MSE
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
    if (!this.alive) return '';
    if (ms.readyState !== 'open') return 'MSE sin abrir';
    try {
      if (this.dur > 0) ms.duration = this.dur;
    } catch {
      // sin duración
    }
    this.wantAt = Math.max(0, at);
    this.place(this.wantAt, at <= 1 ? head : null);
    this.watch = setInterval(() => this.alive && this.unstick(), 500);
    void this.pump();
    // espera la primera imagen entregada (o el error)
    for (let i = 0; i < 900 && this.alive && !this.sb && !this.why; i++) await sleep(100);
    if (!this.alive) return '';
    if (!this.sb) return this.why || 'sin imagen';
    return '';
  }

  // primer paquete alineado de un pedazo leído desde un lugar cualquiera
  private align(d: Uint8Array): number {
    for (let i = 0; i < Math.min(d.length, PKT * 3); i++) if (d[i] === 0x47 && (i + PKT >= d.length || d[i + PKT] === 0x47)) return i;
    return 0;
  }

  // empieza a leer en el byte que corresponde a t (por proporción, unos segundos antes); seed: el principio ya leído
  private place(t: number, seed: Uint8Array | null): void {
    let off = 0;
    if (t > 1 && this.dur > 0 && this.size > 0) off = (t / this.dur) * this.size - this.bps() * 3;
    this.restartAt(off, seed);
  }

  // la lectura vuelve a empezar en el byte off (alineado a un paquete), con un conversor nuevo
  private restartAt(off: number, seed: Uint8Array | null = null): void {
    this.gen++;
    this.mux = new TsMux(this.videoOnly ? -1 : this.audioIdx, false, 60);
    this.needPsi = true;
    this.carry = [];
    this.eof = false;
    this.offsetSet = false;
    off = Math.max(0, Math.min(Math.floor(off / PKT) * PKT, this.size > PKT ? Math.floor((this.size - PKT) / PKT) * PKT : 0));
    this.next = off;
    this.startOff = off;
    if (seed && off === 0) this.ra.seed(0, seed);
    else this.ra.seek(off, CHUNK);
  }
  private startOff = 0;

  // Lo que se le da a TsMux: los paquetes de cada pista hasta su último inicio de cuadro; desde ahí se guardan para el
  // pedazo siguiente (al final del archivo, todo)
  private pack(d: Uint8Array, last: boolean): Uint8Array {
    const pkts: Uint8Array[] = this.carry.slice();
    const a = this.align(d);
    for (let i = a; i + PKT <= d.length; i += PKT) if (d[i] === 0x47) pkts.push(d.subarray(i, i + PKT));
    if (last) {
      this.carry = [];
      return concat(pkts);
    }
    const lastStart = new Map<number, number>();
    pkts.forEach((p, i) => {
      if (p[1] & 0x40) lastStart.set(((p[1] & 0x1f) << 8) | p[2], i);
    });
    const out: Uint8Array[] = [];
    const keep: Uint8Array[] = [];
    pkts.forEach((p, i) => {
      const pid = ((p[1] & 0x1f) << 8) | p[2];
      const ls = lastStart.get(pid);
      // la tabla de programas (PAT, pid 0) siempre; de cada pista (y de la PMT), lo que va desde su último inicio queda
      // para el pedazo siguiente
      if (pid !== 0 && ls !== undefined && i >= ls) keep.push(p.slice());
      else out.push(p);
    });
    this.carry = keep;
    return concat(out);
  }

  private bufEnd(): number {
    try {
      const b = this.sb?.buffered;
      return b && b.length ? b.end(b.length - 1) : 0;
    } catch {
      return 0;
    }
  }

  private async idle(): Promise<void> {
    for (let i = 0; i < 100 && this.sb?.updating; i++) await sleep(50);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.alive) {
        const g = this.gen;
        if (this.sb && this.bufEnd() - (this.v.currentTime || 0) > aheadSecs(this.bps())) {
          // 2.8.0: mientras espera también se borra lo ya visto (antes solo antes de entregar: quedaban 30 s o más detrás)
          await this.trim();
          await sleep(1000);
          continue;
        }
        if (this.eof) {
          await this.idle();
          try {
            if (this.ms?.readyState === 'open') this.ms.endOfStream();
          } catch {
            // ya terminado
          }
          return;
        }
        const len = this.size > 0 ? Math.min(CHUNK, this.size - this.next) : CHUNK;
        if (len <= 0) {
          this.eof = true;
          continue;
        }
        const d = await this.ra.read(this.next, len);
        if (g !== this.gen || !this.alive) continue;
        if (!d) {
          this.why = 'bajada: ' + (this.ra.why || this.rs.why || 'sin datos');
          this.onError();
          return;
        }
        this.next += d.length;
        const last = (this.size > 0 && this.next >= this.size) || d.length < len;
        if (last) this.eof = true;
        if (!(await this.deliver(this.pack(d, last), g))) return;
      }
    } finally {
      this.running = false;
    }
  }

  // convierte y entrega; false = error (onError ya avisado)
  private async deliver(seg: Uint8Array, g: number): Promise<boolean> {
    // conversor nuevo: con la tabla de programas delante
    if (this.needPsi && this.psi) seg = concat([this.psi, seg]);
    this.needPsi = false;
    let r = this.mux!.push(seg);
    if (!r.ok) {
      this.why = 'MPEG-TS: ' + r.why;
      this.onError();
      return false;
    }
    if (!r.data) return true;
    // primera entrega: el SourceBuffer (si el equipo no acepta el audio, solo el video)
    if (!this.sb) {
      const mime = r.mime;
      const ok = (m: string) => {
        try {
          return !(MediaSource as any).isTypeSupported || (MediaSource as any).isTypeSupported(m);
        } catch {
          return true;
        }
      };
      if (!this.videoOnly && (!ok(mime) || this.mux!.why)) {
        this.videoOnly = true;
        this.noAudio = this.tracks.length > 0;
        this.mux = new TsMux(-1, false, 60);
        r = this.mux.push(seg);
        if (!r.ok || !r.data) {
          if (!r.ok) {
            this.why = 'MPEG-TS: ' + r.why;
            this.onError();
            return false;
          }
          return true;
        }
      }
      try {
        this.sb = this.ms.addSourceBuffer(r.mime);
      } catch (e: any) {
        // el equipo no aceptó el audio: solo el video
        if (!this.videoOnly && this.mux!.hasVideo()) {
          this.videoOnly = true;
          this.mux = new TsMux(-1, false, 60);
          r = this.mux.push(seg);
          if (!r.ok || !r.data) {
            if (!r.ok) {
              this.why = 'MPEG-TS: ' + r.why;
              this.onError();
              return false;
            }
            return true;
          }
          try {
            this.sb = this.ms.addSourceBuffer(r.mime);
          } catch (e2: any) {
            this.why = 'MSE ' + r.mime + ': ' + String(e2?.message || e2).slice(0, 60);
            this.onError();
            return false;
          }
        } else {
          this.why = 'MSE ' + r.mime + ': ' + String(e?.message || e).slice(0, 60);
          this.onError();
          return false;
        }
      }
      if (this.videoOnly) this.noAudio = this.tracks.length > 0;
    }
    // la línea de tiempo del archivo: lo entregado empieza en 0; va en el segundo real de su primer cuadro
    if (!this.offsetSet) {
      const f = this.mux!.firstDts();
      if (f === null) return true;
      this.realStart = this.pts0 >= 0 ? Math.max(0, span(this.pts0, f) / 90000) : 0;
      // el salto por proporción cayó lejos del segundo pedido (el archivo no tiene el mismo ritmo en todo): otra vez, con
      // el ritmo real (como mucho dos veces); hasta 40 s antes, se empieza ahí y se adelanta
      const miss = this.wantAt - this.realStart;
      if (this.wantAt > 1 && this.dur > 0 && this.fixes < 2 && (miss < -2 || miss > 40)) {
        this.fixes++;
        // ritmo real hasta aquí (bytes por segundo); sin él, el promedio del archivo
        const rate = this.realStart > 5 ? this.startOff / this.realStart : this.bps();
        this.restartAt(this.startOff + (miss - 3) * rate);
        return true;
      }
      await this.idle();
      if (g !== this.gen) return true;
      try {
        this.sb.timestampOffset = this.realStart;
      } catch {
        // sin desplazamiento: se ve desde 0
      }
      this.offsetSet = true;
    }
    await this.idle();
    if (g !== this.gen || !this.alive) return true;
    await this.trim();
    try {
      this.sb.appendBuffer(r.data);
    } catch (e: any) {
      this.why = 'append: ' + String(e?.message || e).slice(0, 60);
      this.onError();
      return false;
    }
    await this.idle();
    if (!this.tFirst) {
      this.tFirst = Date.now();
      // al segundo pedido (si quedó hasta 40 s más atrás, se adelanta) o, si quedó un poco después, al primer cuadro
      const to = this.wantAt > this.realStart + 0.5 && this.wantAt - this.realStart <= 45 ? this.wantAt : this.realStart;
      if (to > 0.05) {
        try {
          this.v.currentTime = to;
        } catch {
          // sigue desde donde empieza
        }
      }
      this.onTracks();
      if (!this.noPlay) void this.v.play();
    }
    return true;
  }

  // lo ya visto se borra (memoria)
  private async trim(): Promise<void> {
    try {
      const b = this.sb.buffered;
      const t = this.v.currentTime || 0;
      if (b.length && b.start(0) < t - BEHIND_MAX) {
        this.sb.remove(b.start(0), t - BEHIND_KEEP);
        await this.idle();
      }
    } catch {
      // nada que borrar
    }
  }

  // el reproductor de Vega se queda quieto en un hueco: al tramo con datos
  private unstick(): void {
    try {
      const b = this.sb?.buffered;
      const t = this.v.currentTime || 0;
      if (!b || !b.length) return;
      for (let i = 0; i < b.length; i++) {
        if (t >= b.start(i) - 0.05 && t < b.end(i)) return;
        if (b.start(i) > t && b.start(i) - t < 3) {
          this.v.currentTime = b.start(i) + 0.05;
          return;
        }
      }
    } catch {
      // sin datos
    }
  }

  async seekTo(t: number): Promise<void> {
    if (!this.sb) return;
    try {
      const b = this.sb.buffered;
      for (let i = 0; i < b.length; i++) {
        if (t >= b.start(i) && t < b.end(i) - 0.5) {
          this.v.currentTime = t;
          return;
        }
      }
    } catch {
      // se lee de nuevo
    }
    this.ra.park();
    await this.idle();
    try {
      this.sb.abort();
      const end = this.bufEnd();
      if (end > 0) {
        this.sb.remove(0, end + 1);
        await this.idle();
      }
    } catch {
      // sigue igual
    }
    this.wantAt = Math.max(0, t);
    this.fixes = 0;
    this.tFirst = 0;
    this.noPlay = this.v.paused;
    this.place(this.wantAt, null);
    void this.pump();
  }

  cancelPlay(): void {
    this.noPlay = true;
  }

  busy(): boolean {
    return this.ra.active > 0 || Date.now() - (this.rs.lastData || 0) < 10000;
  }

  // (sin subtítulos propios)
  subCues(): null {
    return null;
  }

  subList(): [] {
    return [];
  }

  diag(): string {
    const n = this.rs.reqs || 0;
    return '[mpeg-ts archivo=' + Math.round(this.size / 1048576) + 'MB duracion=' + Math.round(this.dur) + 's inicio=' + (this.tFirst ? ((this.tFirst - this.t0) / 1000).toFixed(1) + 's' : '-') + ' desde=' + Math.round(this.realStart) + 's solo_video=' + this.videoOnly + ' ' + this.ra.diag() + ' pedidos=' + n + (n ? ' espera_media=' + Math.round((this.rs.waitMs || 0) / n) + 'ms' : '') + (this.why ? ' motivo=' + this.why : '') + ']';
  }

  destroy(): void {
    this.alive = false;
    this.gen++;
    this.ra.stop();
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    try {
      if (this.sb?.updating) this.sb.abort();
    } catch {
      // ya cerrado
    }
    if (this.objectUrl) {
      try { (URL as any).revokeObjectURL?.(this.objectUrl); } catch { /* opcional en Vega */ }
      this.objectUrl = '';
    }
  }
}
