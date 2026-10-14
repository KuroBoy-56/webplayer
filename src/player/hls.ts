// HLS del motor del panel (video copiado + audio AAC en MPEG-TS) con Media Source Extensions:
// el reproductor de Vega solo abre HLS por MSE, así que la lista y los segmentos se bajan aquí y se
// entregan al SourceBuffer en orden. La lista es de tipo "event": crece mientras ffmpeg convierte.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { http, UA } from '../lib/http';
import { engineError } from '../api/media';
import { t } from '../lib/i18n';

type Seg = { url: string; start: number; dur: number };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const AHEAD = 45; // segundos que se bajan por adelantado

export class PanelHls {
  private ms: any = null;
  private sb: any = null;
  private segs: Seg[] = [];
  private ended = false;
  private next = 0;
  private gen = 0;
  private alive = true;
  private running = false;
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
    try {
      this.sb = ms.addSourceBuffer('video/mp2t');
    } catch {
      return t('Este equipo no acepta el video que prepara el panel');
    }
    // en orden desde 0 (el HLS empieza en el segundo pedido)
    try {
      this.sb.mode = 'sequence';
      this.sb.timestampOffset = 0;
    } catch {
      // modo por defecto
    }
    this.pump();
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
      this.sb.abort();
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
    if (!r.ok) return engineError(r.body, r.code ? t('No se pudo preparar el audio ({code})', { code: r.code }) : t('No se pudo conectar con el panel.'));
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
        if (!(await this.append(data))) {
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
