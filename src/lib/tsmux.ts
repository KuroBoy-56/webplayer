// MPEG-TS → MP4 fragmentado para el lector de canales (livehls.ts). En Vega el lector MPEG-TS del equipo dejaba
// huecos de décimas entre segmentos (audio y video no terminan juntos) y saltarlos era un corte. Aquí cada segmento
// se convierte a fMP4 con la duración exacta de cada cuadro: el video va de corrido (cada cuadro dura hasta el
// siguiente, aunque esté en el segmento que viene) y el audio también (cuadros AAC de 1024 muestras uno tras otro;
// si al canal le falta audio se rellena con silencio y si le sobra se descarta, así nunca se desincroniza). Un salto
// de marcas de tiempo (el servidor reinició, se saltó un segmento) se cose: lo nuevo sigue justo donde iba.
// Solo H.264 + AAC; con otro códec el lector entrega el MPEG-TS como antes.
import { AudioCfg, AUDIO_ID, concat, fragment, initSegment, mp4Mime, Sample, VideoCfg, VIDEO_ID } from './mp4box';
import { aacFrames, AacFrame, Au, demux, Pmt, spsSize, videoAus } from './tsdemux';

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
  // idiomas de los audios AAC del canal (en orden) y el que suena
  langs: string[] = [];
  // padStart (video del panel, hls.ts): el panel corta el video en el cuadro clave anterior al segundo pedido y el audio
  // empieza justo en ese segundo (0,5-1 s después); el reproductor de Vega no respeta ese hueco inicial y el audio quedaba
  // atrasado. Con padStart el audio empieza con el video, con silencio hasta su primer cuadro
  constructor(readonly audioIdx = 0, readonly padStart = false) {}

  private fix(v: number): number {
    if (this.ref === null) return v;
    while (v - this.ref > WRAP / 2) v -= WRAP;
    while (this.ref - v > WRAP / 2) v += WRAP;
    return v;
  }

  private choose(): string {
    const p = this.pmt!;
    if (p.video >= 0 && p.videoType !== 0x1b) return 'video ' + hex(p.videoType);
    const aac = p.audio.filter(a => a.type === 0x0f);
    if (p.audio.length && !aac.length) return 'audio ' + hex(p.audio[0].type);
    if (p.video < 0 && !aac.length) return 'sin video ni audio';
    this.vPid = p.video;
    this.langs = aac.map(a => a.lang);
    this.aPid = aac.length ? aac[Math.min(this.audioIdx, aac.length - 1)].pid : -1;
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
    const a = this.aPid >= 0 ? aacFrames(pes.get(this.aPid) || [], this.aRest) : { frames: [] as AacFrame[], info: null, rest: null };
    this.aRest = a.rest;
    this.config(v.aus, a);
    // todavía sin la configuración del video (SPS/PPS) o del audio: se espera (sin audio en 2 segmentos: solo video)
    if ((this.vPid >= 0 && !this.video) || (this.aPid >= 0 && !this.audio)) {
      if (this.waits >= 1 && this.video && !this.audio && !this.started) this.aPid = -1;
      else return this.wait(this.video ? 'sin audio AAC' : 'sin SPS/PPS');
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
      parts.push(initSegment(this.vPid >= 0 ? this.video : null, this.aPid >= 0 ? this.audio : null));
      this.mime = mp4Mime(this.vPid >= 0 ? this.video : null, this.aPid >= 0 ? this.audio : null);
      this.dirty = false;
    }
    if (aus.length) parts.push(this.videoFrag(aus));
    if (frames.length && this.aPid >= 0) parts.push(...this.audioFrags(frames));
    return { ok: true, mime: this.mime, data: parts.length ? concat(parts) : null };
  }

  // nada que entregar todavía; 3 segmentos sin poder empezar: el lector entrega el MPEG-TS como antes
  private wait(why: string): MuxResult {
    if (!this.started && ++this.waits >= 3) return { ok: false, why };
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
      let size = 0;
      for (const n of au.nals) {
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
    const step = (1024 * HZ) / au.rate;
    const silent = this.obj === 2 && SILENCE[au.channels] ? new Uint8Array(SILENCE[au.channels]) : null;
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
      samples.push({ size: d.length, duration: 1024, cts: 0, key: true });
      data.push(d);
      this.aNext! += 1024;
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
        const drift = at - (this.aNext * HZ) / au.rate;
        if (drift < -1.5 * step) {
          if (drift > -2 * HZ) {
            this.dropped++;
            continue;
          }
          // salto grande hacia atrás: se sigue desde ahí
          flush();
          this.aNext = Math.max(0, Math.round((at * au.rate) / HZ));
        } else if (drift > 1.5 * step) {
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
