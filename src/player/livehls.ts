// HLS en vivo del servidor IPTV (.m3u8 de un canal) con Media Source Extensions: el reproductor de Vega no abre HLS
// por su cuenta (solo por MSE), así que cuando el canal no abre en MPEG-TS directo la lista se baja aquí, se sigue
// mientras crece (lista que se desliza: EXT-X-MEDIA-SEQUENCE) y los segmentos se entregan al SourceBuffer en orden,
// empezando cerca del final (en vivo). Las listas maestras (varias calidades) usan la de más calidad.
// En Vega el modo directo (src = dirección) no abre MPEG-TS (solo MP4, MKV, MP3, FLV, OGG y FLAC; el HLS solo por MSE),
// así que en Fire TV este es el camino principal de la TV en vivo.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { UA } from '../lib/http';
import { xuiError } from '../lib/xui';
import { cbc } from '@noble/ciphers/aes';
import { parseList, resolveUrl, Seg, segIv, tsStart } from '../lib/hlslist';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// llave AES-128: 16 bytes tal cual o, en algunos servidores, escrita en hexadecimal (32 caracteres, con o sin 0x)
function keyBytes(d: Uint8Array): Uint8Array | null {
  if (d.length === 16) return d;
  const txt = String.fromCharCode(...Array.from(d.slice(0, 80))).trim().replace(/^0x/i, '');
  if (/^[0-9a-f]{32}$/i.test(txt)) {
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) out[i] = parseInt(txt.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  // con un salto de línea o espacio al final
  if (d.length > 16 && d.length <= 18 && d.slice(16).every(b => b === 10 || b === 13 || b === 32)) return d.slice(0, 16);
  return null;
}

export class LiveHls {
  private ms: any = null;
  private sb: any = null;
  private first: string;
  private list: string;
  private segs: Seg[] = [];
  private target = 6;
  private next = -1;
  private alive = true;
  private appended = 0;
  private lastAppend = Date.now();
  private bytes = 0;
  // llaves AES-128 ya bajadas (por dirección) y si el canal viene cifrado (para el reporte)
  private keys = new Map<string, Uint8Array>();
  private encrypted = false;
  private head = '';
  // último problema (para el reporte al panel): código HTTP de la lista o de los segmentos, página de XUI…
  lastProblem = '';
  onError: (msg: string) => void = () => {};

  constructor(private v: VideoPlayer, url: string) {
    this.first = url;
    this.list = url;
  }

  static supported(): boolean {
    try {
      return MediaSource.isTypeSupported('video/mp2t', true);
    } catch {
      return false;
    }
  }

  // estado para el reporte: lista, segmentos entregados, lo que tiene el reproductor y dónde está
  diag(): string {
    let buf = '';
    try {
      const b = this.sb?.buffered;
      for (let i = 0; b && i < b.length; i++) buf += (buf ? ',' : '') + b.start(i).toFixed(1) + '-' + b.end(i).toFixed(1);
    } catch {
      // sin datos
    }
    const host = (this.list.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || '';
    return 'hls host=' + host + ' segs=' + this.segs.length + (this.encrypted ? ' cifrado=aes128' : '') + ' entregados=' + this.appended + ' bytes=' + this.bytes + ' buf=[' + buf + '] t=' + (this.v.currentTime || 0).toFixed(1) + (this.head ? ' inicio=' + this.head : '') + (this.lastProblem ? ' problema=' + this.lastProblem : '');
  }

  // '' = empezó; si no, el motivo (lista que no llega, página de error de XUI, vacía, en fMP4…)
  async start(): Promise<string> {
    const err = await this.refresh();
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
    } catch {
      return 'el equipo no acepta MPEG-TS por MSE';
    }
    try {
      // en orden desde 0 (si el equipo no lo admite, se salta al principio de lo entregado: ver unstick)
      this.sb.mode = 'sequence';
    } catch {
      // modo por defecto
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

  // GET siguiendo redirecciones a mano: XUI manda la lista a otro servidor (balanceador) con un token y los segmentos
  // vienen relativos a esa dirección final, no a la pedida
  // mode: 'list' = texto; 'seg' = bytes salvo que llegue una página (motivo de XUI); 'bin' = siempre bytes (la llave:
  // XUI la manda desde PHP marcada como text/html y antes se leía como texto y no se podía descifrar)
  private async get(url: string, timeout: number, mode: 'list' | 'seg' | 'bin'): Promise<{ code: number; url: string; text?: string; data?: Uint8Array; type?: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let at = url;
    try {
      for (let hop = 0; hop < 6; hop++) {
        const res = await fetch(at, { headers: { 'User-Agent': UA }, signal: ctrl.signal, redirect: 'manual' } as any);
        const loc = res.headers.get('location');
        if (res.status >= 300 && res.status < 400 && loc) {
          at = resolveUrl(at, loc);
          continue;
        }
        const final = (res as any).url || at;
        const type = res.headers.get('content-type') || '';
        if (res.status !== 200) return { code: res.status, url: final, type };
        if (mode === 'list' || (mode === 'seg' && /mpegurl|text\/html/i.test(type))) return { code: 200, url: final, text: await res.text(), type };
        return { code: 200, url: final, data: new Uint8Array(await res.arrayBuffer()), type };
      }
      return { code: 310, url: at };
    } catch {
      return { code: 0, url: at };
    } finally {
      clearTimeout(timer);
    }
  }

  // segmento cifrado con AES-128: llave de la lista (una vez por dirección) e IV del segmento
  private async decrypt(seg: Seg, data: Uint8Array): Promise<Uint8Array | null> {
    const k = seg.key!;
    let key = this.keys.get(k.uri);
    if (!key) {
      const r = await this.get(k.uri, 15000, 'bin');
      key = r.data ? keyBytes(r.data) || undefined : undefined;
      if (!key) {
        const txt = r.data ? String.fromCharCode(...Array.from(r.data.slice(0, 600))) : '';
        const x = /<html|<!doctype/i.test(txt) ? xuiError(txt) : null;
        this.lastProblem = 'llave HTTP ' + r.code + ' ' + (r.type || '') + ' (' + (r.data ? r.data.length : 0) + ' bytes' + (x ? ', xui ' + x.code : '') + ')';
        return null;
      }
      this.keys.set(k.uri, key);
    }
    try {
      return cbc(key, segIv(seg)).decrypt(data);
    } catch (e: any) {
      this.lastProblem = 'descifrado: ' + String(e?.message || e).slice(0, 60);
      return null;
    }
  }

  // motivo de una página en lugar de la lista o del video (XUI «Debug Mode»: INVALID_STREAM_ID…)
  private pageProblem(text: string): string {
    const x = xuiError(text);
    this.lastProblem = x ? 'xui ' + x.code : 'página html';
    return x ? 'XUI ' + x.code + (x.text ? ' (' + x.text + ')' : '') : 'el servidor devolvió una página en lugar del canal';
  }

  private async refresh(): Promise<string> {
    for (let hop = 0; hop < 2; hop++) {
      let r = await this.get(this.list, 15000, 'list');
      // la dirección con token del balanceador pudo vencer: otra vez desde la del canal
      if ((r.code !== 200 || r.text === undefined) && this.list !== this.first) {
        this.list = this.first;
        r = await this.get(this.list, 15000, 'list');
      }
      if (r.code !== 200 || r.text === undefined) {
        this.lastProblem = 'lista HTTP ' + r.code;
        return r.code ? 'el servidor contestó ' + r.code + ' a la lista HLS' : 'sin conexión con el servidor (lista HLS)';
      }
      if (!r.text.trim().startsWith('#EXTM3U')) return /<html|<!doctype/i.test(r.text) ? this.pageProblem(r.text) : ((this.lastProblem = 'lista no es HLS'), 'el servidor no devolvió una lista HLS');
      const p = parseList(r.text, r.url);
      if (p.master) {
        this.list = p.master;
        continue;
      }
      if (p.fmp4) return 'HLS en fMP4 (no compatible)';
      if (p.sampleAes) return 'HLS con cifrado SAMPLE-AES (no compatible)';
      // se sigue la dirección final (el token del balanceador)
      this.list = r.url;
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

  // El reproductor quedó antes, entre o al final de un tramo con otro tramo después: se salta al siguiente. Los canales
  // traen marcas de tiempo grandes (p. ej. 86000 s) y el video empieza en 0; además, entre un segmento y el siguiente
  // puede quedar un hueco de décimas (audio y video no terminan juntos): el video llegaba al final del primer
  // segmento (5-6 s) y se quedaba esperando ahí para siempre. Si la imagen no avanza en 8 s con video por delante,
  // también se empuja.
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
      const stalled = !this.v.paused && Date.now() - this.lastMove > 8000;
      for (let i = 0; i < b.length; i++) {
        const st = b.start(i);
        const en = b.end(i);
        const next = i + 1 < b.length ? b.start(i + 1) : -1;
        if (t < st - 0.3) {
          if (en - st > 0.5) this.jump(st + 0.1);
          return;
        }
        if (t <= en) {
          // al final de este tramo (o quieto) y hay otro después: al siguiente
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
      this.unstick();
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
        if (!err) {
          listFails = 0;
          const last = this.segs.length ? this.segs[this.segs.length - 1].seq : -1;
          // la lista empezó otra numeración (el servidor abrió otra sesión) o no trae nada nuevo hace rato: cerca del
          // final otra vez (antes se esperaba un número que no iba a llegar y el canal quedaba quieto para siempre)
          const late = Date.now() - this.lastAppend > Math.max(20000, this.target * 3000);
          if (last >= 0 && (this.next > last + 2 || late)) {
            this.lastProblem = late ? 'lista sin segmentos nuevos' : 'lista reiniciada';
            if (late) this.list = this.first;
            this.next = this.segs[Math.max(0, this.segs.length - 2)].seq;
            this.lastAppend = Date.now();
          }
        }
        continue;
      }
      const r = await this.get(seg.url, 20000, 'seg');
      if (!this.alive) return;
      if (r.text !== undefined && /<html|<!doctype/i.test(r.text)) {
        // una página en lugar del video: el motivo (XUI) y no se insiste
        this.onError(this.pageProblem(r.text));
        return;
      }
      if (!r.data || !r.data.length) {
        this.lastProblem = 'segmento HTTP ' + r.code;
        if (++fails > 5) {
          this.onError(r.code ? 'el servidor contestó ' + r.code + ' a los segmentos' : 'se cortó la conexión con el canal');
          return;
        }
        await sleep(1000);
        continue;
      }
      let data: Uint8Array = r.data;
      if (seg.key) {
        // segmento cifrado (AES-128): se descifra con la llave de la lista
        this.encrypted = true;
        const plain = await this.decrypt(seg, data);
        if (!this.alive) return;
        if (!plain) {
          if (++fails > 5) {
            this.onError('no se pudo descifrar el canal (' + this.lastProblem + ')');
            return;
          }
          await sleep(1000);
          continue;
        }
        data = plain;
      }
      if (this.appended === 0) this.head = Array.from(data.slice(0, 8), b => (b < 16 ? '0' : '') + b.toString(16)).join('');
      // el video MPEG-TS (0x47 cada 188 bytes) puede venir después de unos bytes de relleno: se entrega desde ahí
      const at = tsStart(data);
      if (at < 0) {
        this.lastProblem = 'segmento no es MPEG-TS (' + (r.type || '?') + ', ' + data.length + ' bytes)';
        if (this.appended === 0) {
          this.onError('el canal no viene en MPEG-TS');
          return;
        }
      } else if (at > 0) data = data.subarray(at);
      fails = 0;
      await this.trim();
      await this.idle();
      try {
        this.sb.appendBuffer(data);
      } catch (e: any) {
        this.lastProblem = 'appendBuffer: ' + String(e?.message || e).slice(0, 60);
        this.onError('el reproductor no aceptó el video del canal (códec de audio o video)');
        return;
      }
      await this.idle();
      this.appended++;
      this.bytes += data.length;
      this.next = seg.seq + 1;
      this.lastAppend = Date.now();
      if (this.appended === 1) {
        this.unstick();
        if (this.v.paused) this.v.play();
      }
    }
  }
}
