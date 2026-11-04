// MPEG-TS → MP4 fragmentado para el lector de canales (livehls.ts). En Vega el lector MPEG-TS del equipo dejaba
// huecos de décimas entre segmentos (audio y video no terminan juntos) y saltarlos era un corte. Aquí cada segmento
// se convierte a fMP4 con la duración exacta de cada cuadro: el video va de corrido (cada cuadro dura hasta el
// siguiente, aunque esté en el segmento que viene) y el audio también (cuadros AAC de 1024 muestras uno tras otro;
// si al canal le falta audio se rellena con silencio y si le sobra se descarta, así nunca se desincroniza). Un salto
// de marcas de tiempo (el servidor reinició, se saltó un segmento) se cose: lo nuevo sigue justo donde iba.
// Video H.264; audio AAC, MPEG (MP3 / MP2) o AC-3. Otro audio (E-AC-3, LATM) o audioIdx < 0: solo el video (se ve
// sin sonido en vez de quedar en negro). Con otro video el lector entrega el MPEG-TS como antes.
import { ac3Info } from '../player/mkvparse';
import { AudioCfg, AUDIO_ID, audioEntry, concat, esdsFor, fragment, initSegment, mp4Mime, rawBox, Sample, VideoCfg, VIDEO_ID } from './mp4box';
import { aacFrames, AacFrame, Au, demux, otherFrames, OtherInfo, Pmt, spsSize, videoAus } from './tsdemux';

const HZ = 90000;
const WRAP = 8589934592;

export type MuxResult = { ok: true; mime: string; data: Uint8Array | null } | { ok: false; why: string };

// cuadros AAC-LC de silencio (1 a 6 canales)
const SILENCE: Record<number, number[]> = {
  1: [0x00, 0xc8, 0x00, 0x80, 0x23, 0x80],
  2: [0x21, 0x00, 0x49, 0x90, 0x02, 0x19, 0x00, 0x23, 0x80],
  3: [0x00, 0xc8, 0x00, 0x80, 0x20, 0x84, 0x01, 0x26, 0x40, 0x08, 0x64, 0x00, 0x8e],
  4: [0x00, 0xc8, 0x00, 0x80, 0x20, 0x84, 0x01, 0x26, 0x40, 0x08, 0x64, 0x00, 0x80, 0x2c, 0x80, 0x08, 0x02, 0x38],
  5: [0x00, 0xc8, 0x00, 0x80, 0x20, 0x84, 0x01, 0x26, 0x40, 0x08, 0x64, 0x00, 0x82, 0x30, 0x04, 0x99, 0x00, 0x21, 0x90, 0x02, 0x38],
  6: [0x00, 0xc8, 0x00, 0x80, 0x20, 0x84, 0x01, 0x26, 0x40, 0x08, 0x64, 0x00, 0x82, 0x30, 0x04, 0x99, 0x00, 0x21, 0x90, 0x02, 0x00, 0xb2, 0x00, 0x20, 0x08, 0xe0],
};

// SEI con subtítulos ocultos (CC, CEA-608/708: tipo 4): no se entregan. Con ellos Vega mostraba una pista de
// subtítulos y algunos canales (HBO, Warner…) se congelaban en pantalla grande con el audio sonando; el video no los
// necesita para decodificarse
function ccSei(n: Uint8Array): boolean {
  if ((n[0] & 0x1f) !== 6) return false;
  let p = 1;
  let type = 0;
  while (p < n.length && n[p] === 0xff) {
    type += 255;
    p++;
  }
  return type + (n[p] ?? 0) === 4;
}

const same = (a: Uint8Array | null, b: Uint8Array | null) => !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
const hex = (n: number) => '0x' + n.toString(16);

export class TsMux {
  private pmt: Pmt | null = null;
  private vPid = -1;
  private aPid = -1;
  private carry: Au | null = null;
  private aRest: { data: Uint8Array; pts: number } | null = null;
  private ref: number | null = null;
  // marcas del canal → línea de tiempo entregada (90 kHz)
  private off: number | null = null;
  private frameDur = 3600;
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;
  private video: VideoCfg | null = null;
  private audio: AudioCfg | null = null;
  private obj = 2;
  // audio que no es AAC: tipo, descripción para el MP4, códec y muestras por cuadro
  private kind: 'aac' | 'mpa' | 'ac3' = 'aac';
  private aEntry: Uint8Array | undefined;
  private aCodec = '';
  private aSamples = 1024;
  // siguiente muestra de audio (en muestras) y el último cuadro (relleno si no hay silencio para ese formato)
  private aNext: number | null = null;
  private aLast: Uint8Array | null = null;
  private seq = 1;
  private dirty = true;
  private started = false;
  private startPts = 0;
  private waits = 0;
  // para el reporte: cuadros de silencio puestos y cuadros de audio descartados, saltos cosidos
  filled = 0;
  dropped = 0;
  joins = 0;
  mime = '';
  // para el reporte: por qué va sin audio
  why = '';
  // dónde quedan los cuadros clave entregados (segundos de la línea entregada): si la imagen se traba, el lector salta
  // al siguiente (empujar unas décimas hacía decodificar otra vez desde el mismo cuadro clave y se volvía a trabar)
  keys: number[] = [];
  // idiomas de los audios AAC del canal (en orden) y el que suena
  langs: string[] = [];
  // padStart (video del panel, hls.ts): el panel corta el video en el cuadro clave anterior al segundo pedido y el audio
  // empieza justo en ese segundo (0,5-1 s después); el reproductor de Vega no respeta ese hueco inicial y el audio quedaba
  // atrasado. Con padStart el audio empieza con el video, con silencio hasta su primer cuadro
  // maxWaits: segmentos sin poder empezar antes de entregar el MPEG-TS como antes (2 con segmentos largos: con 3 de 11 s
  // el canal no se veía en 25 s)
  constructor(readonly audioIdx = 0, readonly padStart = false, readonly maxWaits = 3) {}

  private fix(v: number): number {
    if (this.ref === null) return v;
    while (v - this.ref > WRAP / 2) v -= WRAP;
    while (this.ref - v > WRAP / 2) v += WRAP;
    return v;
  }

  private choose(): string {
    const p = this.pmt!;
    if (p.video >= 0 && p.videoType !== 0x1b) return 'video ' + hex(p.videoType);
    // AAC primero; si el canal no trae AAC, MPEG (MP3 / MP2) y después AC-3
    const aac = p.audio.filter(a => a.type === 0x0f);
    const mpa = p.audio.filter(a => a.type === 0x03 || a.type === 0x04);
    const ac3 = p.audio.filter(a => a.type === 0x81 || a.type === 0x06);
    const list = aac.length ? aac : mpa.length ? mpa : ac3;
    this.kind = aac.length ? 'aac' : mpa.length ? 'mpa' : 'ac3';
    if (p.video < 0 && !list.length) return p.audio.length ? 'audio ' + hex(p.audio[0].type) : 'sin video ni audio';
    if (p.video < 0 && this.audioIdx < 0) return 'sin video';
    this.vPid = p.video;
    this.langs = this.audioIdx < 0 ? [] : list.map(a => a.lang);
    this.aPid = list.length && this.audioIdx >= 0 ? list[Math.min(this.audioIdx, list.length - 1)].pid : -1;
    if (this.aPid < 0 && p.audio.length) this.why = 'solo video, audio ' + hex(p.audio[0].type);
    return '';
  }

  push(seg: Uint8Array): MuxResult {
    if (!this.pmt) {
      this.pmt = demux(seg, [], null).pmt;
      if (!this.pmt) return { ok: false, why: 'sin PMT' };
      const why = this.choose();
      if (why) return { ok: false, why };
    }
    const pids = [this.vPid, this.aPid].filter(p => p >= 0);
    const { pes } = demux(seg, pids, this.pmt);
    const v = this.vPid >= 0 ? videoAus(pes.get(this.vPid) || [], this.carry) : { aus: [] as Au[], carry: null };
    this.carry = v.carry;
    const list = pes.get(this.aPid) || [];
    const none = { frames: [] as AacFrame[], info: null, rest: null };
    const a = this.aPid < 0 ? none : this.kind === 'aac' ? aacFrames(list, this.aRest) : otherFrames(this.kind, list, this.aRest);
    this.aRest = a.rest;
    if (this.kind === 'aac') this.config(v.aus, a as { info: { obj: number; channels: number; rate: number; sfi: number } | null });
    else {
      this.config(v.aus, { info: null });
      if (a.info) this.otherConfig(a.info as OtherInfo);
    }
    // todavía sin la configuración del video (SPS/PPS) o del audio: se espera (sin audio en 2 segmentos: solo video)
    if ((this.vPid >= 0 && !this.video) || (this.aPid >= 0 && !this.audio)) {
      if (this.waits >= 1 && this.video && !this.audio && !this.started) {
        this.aPid = -1;
        this.why = 'solo video, sin audio legible';
      } else return this.wait(this.video ? 'sin audio' : 'sin SPS/PPS');
    }
    let aus = v.aus;
    let frames = a.frames;
    if (!this.started) {
      // se empieza en un cuadro clave (y el audio desde ahí)
      if (this.vPid >= 0) {
        const k = aus.findIndex(x => x.key && x.pts >= 0);
        if (k < 0) return this.wait('sin cuadro clave');
        aus = aus.slice(k);
        this.ref = aus[0].dts;
        this.startPts = aus[0].pts;
        this.off = -aus[0].dts;
        frames = frames.filter(f => f.pts >= 0 && this.fix(f.pts) >= this.startPts);
      } else {
        const f0 = frames.find(f => f.pts >= 0);
        if (!f0) return this.wait('sin audio');
        this.ref = f0.pts;
        this.off = -f0.pts;
      }
      this.started = true;
    }
    const parts: Uint8Array[] = [];
    if (this.dirty) {
      const au = this.aPid >= 0 ? this.audio : null;
      parts.push(initSegment(this.vPid >= 0 ? this.video : null, au, this.kind === 'aac' ? undefined : this.aEntry));
      this.mime = mp4Mime(this.vPid >= 0 ? this.video : null, this.kind === 'aac' ? au : null);
      if (au && this.kind !== 'aac') this.mime = this.mime.replace(/"$/, (this.vPid >= 0 ? ',' : '') + this.aCodec + '"').replace(/codecs="",?/, 'codecs="');
      this.dirty = false;
    }
    if (aus.length) parts.push(this.videoFrag(aus));
    if (frames.length && this.aPid >= 0) parts.push(...this.audioFrags(frames));
    return { ok: true, mime: this.mime, data: parts.length ? concat(parts) : null };
  }

  // nada que entregar todavía; 3 segmentos sin poder empezar: el lector entrega el MPEG-TS como antes
  private wait(why: string): MuxResult {
    if (!this.started && ++this.waits >= this.maxWaits) return { ok: false, why };
    return { ok: true, mime: this.mime, data: null };
  }

  // SPS/PPS y formato del audio; si cambian, otro inicio (init) antes de lo siguiente
  private config(aus: Au[], a: { info: { obj: number; channels: number; rate: number; sfi: number } | null }): void {
    for (const au of aus) {
      for (const n of au.nals) {
        const t = n[0] & 0x1f;
        if (t === 7 && !same(n, this.sps)) {
          this.sps = n.slice();
          this.video = null;
        } else if (t === 8 && !same(n, this.pps)) {
          this.pps = n.slice();
          this.video = null;
        }
      }
    }
    if (!this.video && this.sps && this.pps) {
      this.video = { sps: this.sps, pps: this.pps, ...spsSize(this.sps) };
      this.dirty = true;
    }
    const i = a.info;
    if (i && (!this.audio || this.audio.rate !== i.rate || this.audio.channels !== (i.channels || 2) || this.obj !== i.obj)) {
      const ch = i.channels || 2;
      this.obj = i.obj;
      this.audio = { config: new Uint8Array([(i.obj << 3) | (i.sfi >> 1), ((i.sfi & 1) << 7) | (ch << 3)]), channels: ch, rate: i.rate };
      this.aNext = null;
      this.dirty = true;
    }
  }

  // tiene audio que no es AAC (si el equipo no lo acepta, el lector abre el canal solo con el video)
  otherAudio(): boolean {
    return this.aPid >= 0 && this.kind !== 'aac';
  }

  // MP3 / MP2: en MPEG-TS Vega tampoco lo mostraba (sin imagen); AC-3 sí iba así antes
  mpegAudio(): boolean {
    return this.aPid >= 0 && this.kind === 'mpa';
  }

  // MP3 / MP2 (esds con objeto 0x6B / 0x69) o AC-3 (dac3); si cambia el formato, otro inicio
  private otherConfig(i: OtherInfo): void {
    if (this.audio && this.audio.rate === i.rate && this.audio.channels === i.channels) return;
    let ch = i.channels;
    if (this.kind === 'mpa') {
      const v1 = (i.head[1] >> 3) & 1;
      this.aEntry = audioEntry('mp4a', ch, i.rate, esdsFor(v1 ? 0x6b : 0x69, null));
      this.aCodec = v1 ? 'mp4a.6B' : 'mp4a.69';
    } else {
      const d = ac3Info(i.head);
      if (!d) return;
      ch = d.channels;
      this.aEntry = audioEntry('ac-3', ch, i.rate, rawBox('dac3', d.box));
      this.aCodec = 'ac-3';
    }
    this.aSamples = i.samples;
    this.audio = { config: new Uint8Array(0), channels: i.channels, rate: i.rate };
    this.aNext = null;
    this.dirty = true;
  }

  // Cada cuadro dura hasta el siguiente (el último del segmento, hasta el primero del que viene: queda guardado en
  // carry); un salto de marcas (atrás o más de 2 s) se cose: el cuadro siguiente va justo después
  private videoFrag(aus: Au[]): Uint8Array {
    const samples: Sample[] = [];
    const data: Uint8Array[] = [];
    let base = -1;
    for (let i = 0; i < aus.length; i++) {
      const au = aus[i];
      au.dts = this.fix(au.dts);
      au.pts = au.pts < 0 ? au.dts : this.fix(au.pts);
      this.ref = au.dts;
      const next = i + 1 < aus.length ? aus[i + 1] : this.carry;
      const dts = au.dts + this.off!;
      let dur = this.frameDur;
      if (next && next.dts >= 0) {
        const d = this.fix(next.dts) - au.dts;
        if (d > 0 && d <= 2 * HZ) {
          dur = d;
          if (d <= HZ / 2) this.frameDur = d;
        } else {
          // salto: lo que sigue va pegado a este cuadro
          this.off! += au.dts + this.frameDur - this.fix(next.dts);
          this.joins++;
        }
      }
      if (base < 0) base = dts;
      if (au.key) {
        this.keys.push((dts + Math.max(0, au.pts - au.dts)) / HZ);
        if (this.keys.length > 300) this.keys.shift();
      }
      let size = 0;
      for (const n of au.nals) {
        if (ccSei(n)) continue;
        const len = new Uint8Array([(n.length >>> 24) & 255, (n.length >>> 16) & 255, (n.length >>> 8) & 255, n.length & 255]);
        data.push(len, n);
        size += 4 + n.length;
      }
      samples.push({ size, duration: dur, cts: Math.max(0, au.pts - au.dts), key: au.key });
    }
    return fragment(this.seq++, VIDEO_ID, Math.max(0, base), samples, concat(data));
  }

  // Audio de corrido: cada cuadro en la siguiente muestra; si el canal deja un hueco se rellena con silencio y si
  // se monta se descartan los cuadros de más (la diferencia nunca pasa de medio cuadro)
  private audioFrags(frames: AacFrame[]): Uint8Array[] {
    const au = this.audio!;
    const n = this.kind === 'aac' ? 1024 : this.aSamples;
    const step = (n * HZ) / au.rate;
    const silent = this.kind === 'aac' && this.obj === 2 && SILENCE[au.channels] ? new Uint8Array(SILENCE[au.channels]) : null;
    const out: Uint8Array[] = [];
    let samples: Sample[] = [];
    let data: Uint8Array[] = [];
    let base = 0;
    const flush = () => {
      if (samples.length) out.push(fragment(this.seq++, AUDIO_ID, base, samples, concat(data)));
      samples = [];
      data = [];
    };
    const put = (d: Uint8Array) => {
      if (!samples.length) base = this.aNext!;
      samples.push({ size: d.length, duration: n, cts: 0, key: true });
      data.push(d);
      this.aNext! += n;
    };
    let last = -1;
    for (const f of frames) {
      const src = f.pts >= 0 ? this.fix(f.pts) : last >= 0 ? last + step : -1;
      last = src;
      const at = src >= 0 ? src + this.off! : -1;
      if (this.aNext === null) {
        if (at < 0) continue;
        this.aNext = this.padStart && this.vPid >= 0 && silent ? 0 : Math.max(0, Math.round((at * au.rate) / HZ));
      }
      if (at >= 0) {
        // margen de 4 cuadros (~85 ms, no se nota en la sincronía): con 1,5 cuadros, los canales con marcas de tiempo
        // irregulares recibían silencio y descartes a cada rato (microcortes, «grumos» en el audio)
        const tol = 4 * step;
        const drift = at - (this.aNext * HZ) / au.rate;
        if (drift < -tol) {
          if (drift > -2 * HZ) {
            this.dropped++;
            continue;
          }
          // salto grande hacia atrás: se sigue desde ahí
          flush();
          this.aNext = Math.max(0, Math.round((at * au.rate) / HZ));
        } else if (drift > tol) {
          // el hueco del principio (padStart) se rellena aunque sea largo (un grupo de cuadros, hasta 15 s)
          if (drift < (this.padStart && !this.aLast && silent ? 15 : 2) * HZ) {
            for (let k = Math.round(drift / step); k > 0; k--) {
              put(silent || this.aLast || f.data);
              this.filled++;
            }
          } else {
            flush();
            this.aNext = Math.round((at * au.rate) / HZ);
          }
        }
      }
      put(f.data);
      this.aLast = f.data;
    }
    flush();
    return out;
  }
}
