// HLS en vivo del servidor IPTV (.m3u8 de un canal) con Media Source Extensions: el reproductor de Vega no abre HLS
// por su cuenta (solo por MSE), así que cuando el canal no abre en MPEG-TS directo la lista se baja aquí, se sigue
// mientras crece (lista que se desliza: EXT-X-MEDIA-SEQUENCE) y los segmentos se entregan al SourceBuffer en orden,
// empezando cerca del final (en vivo). Las listas maestras (varias calidades) usan la de más calidad.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { UA } from '../lib/http';

type Seg = { seq: number; url: string; dur: number };

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// dirección absoluta de una línea de la lista (relativa a la lista, a la raíz del servidor o completa)
export function resolveUrl(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  const m = base.match(/^(https?:\/\/[^/?#]+)([^?#]*)/i);
  if (!m) return ref;
  if (ref.startsWith('//')) return base.split(':')[0] + ':' + ref;
  if (ref.startsWith('/')) return m[1] + ref;
  return m[1] + m[2].slice(0, m[2].lastIndexOf('/') + 1) + ref;
}

// lista de un canal: segmentos con su número; master = lista de calidades (se usa la de más ancho de banda)
export function parseList(body: string, base: string): { master: string; segs: Seg[]; target: number; ended: boolean; fmp4: boolean } {
  const lines = body.split(/\r?\n/).map(l => l.trim());
  let best = '';
  let bw = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const b = Number((lines[i].match(/BANDWIDTH=(\d+)/i) || [])[1]) || 0;
    const next = lines.slice(i + 1).find(l => l && !l.startsWith('#'));
    if (next && b > bw) {
      bw = b;
      best = resolveUrl(base, next);
    }
  }
  const segs: Seg[] = [];
  let seq = 0;
  let dur = 0;
  let target = 6;
  let ended = false;
  let fmp4 = false;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = parseInt(line.slice(22), 10) || 0;
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) target = parseFloat(line.slice(22)) || 6;
    else if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8)) || 0;
    else if (line.startsWith('#EXT-X-MAP')) fmp4 = true;
    else if (line === '#EXT-X-ENDLIST') ended = true;
    else if (line && !line.startsWith('#')) segs.push({ seq: seq++, url: resolveUrl(base, line), dur });
  }
  return { master: best, segs, target, ended, fmp4 };
}

export class LiveHls {
  private ms: any = null;
  private sb: any = null;
  private list: string;
  private segs: Seg[] = [];
  private target = 6;
  private next = -1;
  private alive = true;
  // último problema (para el reporte al panel): código HTTP de la lista o de los segmentos
  lastProblem = '';
  onError: (msg: string) => void = () => {};

  constructor(private v: VideoPlayer, url: string) {
    this.list = url;
  }

  static supported(): boolean {
    try {
      return MediaSource.isTypeSupported('video/mp2t', true);
    } catch {
      return false;
    }
  }

  // '' = empezó; si no, el motivo (lista que no llega, vacía, en fMP4…)
  async start(): Promise<string> {
    let err = await this.refresh();
    if (err) return err;
    if (!this.segs.length) return 'lista sin segmentos';
    if (!this.alive) return '';
    // en vivo: los últimos 3 segmentos (arranca rápido y cerca del momento actual)
    this.next = this.segs[Math.max(0, this.segs.length - 3)].seq;
    const ms: any = new MediaSource();
    this.ms = ms;
    const opened = new Promise<void>(res => ms.addEventListener('sourceopen', () => res()));
    try {
      this.v.src = (URL as any).createObjectURL(ms);
    } catch {
      (this.v as any).srcObject = ms;
    }
    await Promise.race([opened, sleep(10000)]);
    if (ms.readyState !== 'open') return 'el reproductor no abrió MediaSource';
    try {
      this.sb = ms.addSourceBuffer('video/mp2t');
      this.sb.mode = 'sequence';
    } catch {
      return 'el equipo no acepta MPEG-TS por MSE';
    }
    this.pump();
    return '';
  }

  destroy(): void {
    this.alive = false;
    try {
      if (this.sb?.updating) this.sb.abort();
    } catch {
      // ya cerrado
    }
  }

  private async get(url: string, timeout: number): Promise<{ code: number; url: string; text?: string; data?: Uint8Array }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal });
      const final = (res as any).url || url;
      if (res.status !== 200) return { code: res.status, url: final };
      if (/\.m3u8?(\?|$)/i.test(url) || /mpegurl/i.test(res.headers.get('content-type') || '')) return { code: 200, url: final, text: await res.text() };
      return { code: 200, url: final, data: new Uint8Array(await res.arrayBuffer()) };
    } catch {
      return { code: 0, url };
    } finally {
      clearTimeout(timer);
    }
  }

  private async refresh(): Promise<string> {
    for (let hop = 0; hop < 2; hop++) {
      const r = await this.get(this.list, 15000);
      if (r.code !== 200 || r.text === undefined) {
        this.lastProblem = 'lista HTTP ' + r.code;
        return r.code ? 'el servidor contestó ' + r.code + ' a la lista HLS' : 'sin conexión con el servidor (lista HLS)';
      }
      if (!r.text.startsWith('#EXTM3U')) {
        this.lastProblem = 'lista no es HLS';
        return 'el servidor no devolvió una lista HLS';
      }
      const p = parseList(r.text, r.url);
      if (p.master) {
        this.list = p.master;
        continue;
      }
      if (p.fmp4) return 'HLS en fMP4 (no compatible)';
      this.segs = p.segs;
      this.target = p.target;
      return '';
    }
    return 'lista HLS sin calidades';
  }

  private async idle(): Promise<void> {
    for (let i = 0; i < 100 && this.sb?.updating; i++) await sleep(100);
  }

  private bufEnd(): number {
    try {
      const b = this.sb.buffered;
      return b.length ? b.end(b.length - 1) : 0;
    } catch {
      return 0;
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

  private async pump(): Promise<void> {
    let fails = 0;
    let listFails = 0;
    while (this.alive) {
      // en vivo no hace falta más de ~30 s por delante
      if (this.bufEnd() - (this.v.currentTime || 0) > 30) {
        await sleep(1000);
        continue;
      }
      let seg = this.segs.find(sg => sg.seq === this.next);
      if (!seg && this.segs.length && this.next < this.segs[0].seq) {
        // se quedó atrás (la lista ya no tiene ese segmento): al más viejo que queda
        this.next = this.segs[0].seq;
        seg = this.segs[0];
      }
      if (!seg) {
        await sleep(Math.max(1000, (this.target * 1000) / 2));
        if (!this.alive) return;
        const err = await this.refresh();
        if (err && ++listFails > 4) {
          this.onError(err);
          return;
        }
        if (!err) listFails = 0;
        continue;
      }
      const r = await this.get(seg.url, 20000);
      if (!this.alive) return;
      if (!r.data || !r.data.length) {
        this.lastProblem = 'segmento HTTP ' + r.code;
        if (++fails > 5) {
          this.onError(r.code ? 'el servidor contestó ' + r.code + ' a los segmentos' : 'se cortó la conexión con el canal');
          return;
        }
        await sleep(1000);
        continue;
      }
      fails = 0;
      await this.trim();
      await this.idle();
      try {
        this.sb.appendBuffer(r.data);
      } catch {
        this.onError('el reproductor no aceptó el video del canal');
        return;
      }
      await this.idle();
      this.next = seg.seq + 1;
    }
  }
}
