// HLS del motor del panel (video copiado + audio AAC en MPEG-TS) con Media Source Extensions:
// el reproductor de Vega solo abre HLS por MSE, así que la lista y los segmentos se bajan aquí y se
// entregan al SourceBuffer en orden. La lista es de tipo "event": crece mientras ffmpeg convierte.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { http, UA } from '../lib/http';
import { engineError, markDenied } from '../api/media';
import { t } from '../lib/i18n';
import { MuxResult, TsMux } from '../lib/tsmux';

type Seg = { url: string; start: number; dur: number };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const AHEAD = 45; // segundos que se bajan por adelantado
// el reproductor rechazó el MP4 propio: el resto de la sesión, el MPEG-TS del panel tal cual
let mp4Off = false;

export class PanelHls {
  private ms: any = null;
  private sb: any = null;
  private segs: Seg[] = [];
  private ended = false;
  private next = 0;
  private gen = 0;
  private alive = true;
  private running = false;
  // Vega: su lector MPEG-TS no toma bien el video del panel (Continuar viendo quedaba en «Preparando desde donde
  // quedó…»): cada segmento se convierte a MP4 fragmentado, como los canales (tsmux.ts). Sin H.264 + AAC (HEVC
  // copiado…), el MPEG-TS tal cual. tsOff: dónde va el primer segmento (seekTo)
  private mux: TsMux | null = null;
  private mp4 = false;
  private tsOff = 0;
  private dir: string;
  // el reproductor ya tiene esta fuente (el video directo se dejó)
  attached = false;
  onError: (msg: string) => void = () => {};

  constructor(private v: VideoPlayer, private listUrl: string) {
    const q = listUrl.indexOf('?');
    const path = q >= 0 ? listUrl.slice(0, q) : listUrl;
    this.dir = path.slice(0, path.lastIndexOf('/') + 1);
  }

  // ¿el equipo acepta MPEG-TS por MSE?
  static supported(): boolean {
    try {
      return MediaSource.isTypeSupported('video/mp2t', true);
    } catch {
      return false;
    }
  }

  // '' = empezó; si no, el motivo
  async start(): Promise<string> {
    const err = await this.refresh(60000);
    if (err) return err;
    if (!this.segs.length) return t('El panel no devolvió el audio');
    if (!this.alive) return '';
    const ms: any = new MediaSource();
    this.ms = ms;
    const opened = new Promise<void>(res => ms.addEventListener('sourceopen', () => res()));
    this.attached = true;
    try {
      this.v.src = (URL as any).createObjectURL(ms);
    } catch {
      (this.v as any).srcObject = ms;
    }
    await Promise.race([opened, sleep(10000)]);
    if (ms.readyState !== 'open') return t('El reproductor no aceptó el audio del panel');
    // el SourceBuffer se crea con el primer segmento (MP4 convertido o MPEG-TS: deliver)
    this.pump();
    this.watch = setInterval(() => this.alive && this.unstick(), 300);
    return '';
  }

  // segundos que ya están en la lista (total si la conversión terminó)
  listed(): number {
    const l = this.segs[this.segs.length - 1];
    return l ? l.start + l.dur : 0;
  }

  done(): boolean {
    return this.ended;
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

  // t: segundo dentro del HLS. false = aún no está convertido (hay que pedirlo desde ahí)
  async seekTo(t: number): Promise<boolean> {
    if (!this.sb) return false;
    if (this.isBuffered(t)) {
      this.v.currentTime = t;
      return true;
    }
    const k = this.segs.findIndex(sg => t >= sg.start && t < sg.start + sg.dur);
    if (k < 0) return false;
    this.gen++;
    await this.idle();
    try {
      this.sb?.abort();
      const end = this.bufEnd();
      if (end > 0) {
        this.sb.remove(0, end + 1);
        await this.idle();
      }
      this.sb.timestampOffset = this.segs[k].start;
    } catch {
      // se sigue igual
    }
    this.next = k;
    this.tsOff = this.segs[k].start;
    // MP4 convertido: otra línea de tiempo desde 0, puesta en el segundo del segmento
    if (this.mp4) this.mux = new TsMux(0, true);
    this.v.currentTime = t;
    if (!this.running) this.pump();
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

  private async refresh(timeout: number): Promise<string> {
    const r = await http(this.listUrl, { timeout });
    if (!r.ok) {
      const msg = engineError(r.body, r.code ? t('No compatible con el dispositivo') : t('No se pudo conectar con el panel.'));
      // sin permiso o sin ffmpeg: no se le vuelve a pedir nada al motor en esta línea
      if (r.code === 503 || r.code === 501) markDenied(msg);
      return msg;
    }
    const segs: Seg[] = [];
    let at = 0;
    let dur = 0;
    let ended = false;
    for (const raw of r.body.split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8)) || 0;
      else if (line === '#EXT-X-ENDLIST') ended = true;
      else if (line && !line.startsWith('#')) {
        segs.push({ url: /^https?:\/\//i.test(line) ? line : this.dir + line, start: at, dur });
        at += dur;
      }
    }
    if (!segs.length) return t('El panel no devolvió el audio');
    this.segs = segs;
    this.ended = ended;
    return '';
  }

  private async fetchSeg(url: string): Promise<Uint8Array | null> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      if (res.status !== 200) return null;
      const b = new Uint8Array(await res.arrayBuffer());
      return b.length ? b : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async idle(): Promise<void> {
    for (let i = 0; i < 100 && this.sb?.updating; i++) await sleep(100);
  }

  private async append(data: Uint8Array): Promise<boolean> {
    await this.idle();
    try {
      this.sb.appendBuffer(data);
    } catch {
      return false;
    }
    await this.idle();
    return true;
  }

  // El reproductor de Vega no empieza si lo bajado no arranca justo en el segundo actual (el video del panel empieza en
  // ~1,4 s) y se queda quieto para siempre en un hueco entre segmentos: el cambio de idioma y Continuar viendo quedaban
  // cargando sin fin. Como el lector de canales (livehls.ts unstick), cada 300 ms se salta al tramo con datos; quieto
  // 3 s con video por delante, se empuja.
  private watch: ReturnType<typeof setInterval> | null = null;
  private lastT = -1;
  private lastMove = Date.now();
  private unstick(): void {
    try {
      const b = this.sb.buffered;
      const t = this.v.currentTime || 0;
      if (t !== this.lastT) {
        this.lastT = t;
        this.lastMove = Date.now();
      }
      const stalled = !this.v.paused && Date.now() - this.lastMove > 3000;
      for (let i = 0; i < b.length; i++) {
        const st = b.start(i);
        const en = b.end(i);
        const next = i + 1 < b.length ? b.start(i + 1) : -1;
        if (t < st - 0.3) {
          if (en - st > 0.5) this.jump(st + 0.1);
          return;
        }
        if (t <= en) {
          if (next > 0 && (en - t < 0.5 || stalled)) this.jump(next + 0.1);
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

  // un segmento al reproductor: convertido a MP4 o, si no se puede, el MPEG-TS tal cual. false = no lo aceptó
  private async deliver(data: Uint8Array): Promise<boolean> {
    if (!mp4Off && (!this.sb || this.mp4)) {
      let r: MuxResult;
      try {
        r = (this.mux = this.mux || new TsMux(0, true)).push(data);
      } catch {
        r = { ok: false, why: 'mux' };
      }
      if (r.ok && !r.data) return true; // todavía sin cuadro clave o sin la configuración: con el siguiente
      if (r.ok && r.data) {
        if (!this.sb) {
          try {
            if (MediaSource.isTypeSupported(r.mime)) {
              this.sb = this.ms.addSourceBuffer(r.mime);
              this.mp4 = true;
              this.sb.timestampOffset = this.tsOff;
            }
          } catch {
            this.sb = null;
          }
        }
        if (this.mp4) return this.append(r.data);
      }
      if (this.mp4) return false; // ya iba en MP4 y el video dejó de poder convertirse
    }
    if (!this.sb) {
      try {
        this.sb = this.ms.addSourceBuffer('video/mp2t');
      } catch {
        return false;
      }
      // en orden desde el segundo pedido (el HLS empieza ahí)
      try {
        this.sb.mode = 'sequence';
        this.sb.timestampOffset = this.tsOff;
      } catch {
        // modo por defecto
      }
    }
    return this.append(data);
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

  private async pump(): Promise<void> {
    this.running = true;
    let fails = 0;
    try {
      while (this.alive) {
        const g = this.gen;
        if (this.bufEnd() - (this.v.currentTime || 0) > AHEAD) {
          await sleep(1000);
          continue;
        }
        if (this.next >= this.segs.length) {
          if (this.ended) {
            await this.idle();
            try {
              if (this.ms.readyState === 'open') this.ms.endOfStream();
            } catch {
              // ya terminado
            }
            return;
          }
          await sleep(3000);
          if (this.alive) await this.refresh(20000);
          continue;
        }
        const data = await this.fetchSeg(this.segs[this.next].url);
        if (!this.alive || g !== this.gen) continue;
        if (!data) {
          if (++fails > 4) {
            this.onError(t('Se cortó la conexión con el panel'));
            return;
          }
          await sleep(1500);
          continue;
        }
        fails = 0;
        await this.trim();
        if (g !== this.gen) continue;
        if (!(await this.deliver(data))) {
          if (this.mp4) mp4Off = true;
          this.onError(t('El reproductor no aceptó el audio del panel'));
          return;
        }
        this.next++;
      }
    } finally {
      this.running = false;
    }
  }
}
