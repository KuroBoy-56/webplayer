// HLS en vivo del servidor IPTV (.m3u8 de un canal) con Media Source Extensions: el reproductor de Vega no abre HLS
// por su cuenta (solo por MSE), así que cuando el canal no abre en MPEG-TS directo la lista se baja aquí, se sigue
// mientras crece (lista que se desliza: EXT-X-MEDIA-SEQUENCE) y los segmentos se entregan al SourceBuffer en orden,
// empezando cerca del final (en vivo). Las listas maestras (varias calidades) usan la de más calidad.
// En Vega el modo directo (src = dirección) no abre MPEG-TS (solo MP4, MKV, MP3, FLV, OGG y FLAC; el HLS solo por MSE),
// así que en Fire TV este es el camino principal de la TV en vivo.
// Estabilidad: cada segmento se pone justo a continuación del anterior en la línea de tiempo (sus marcas de tiempo
// PTS + timestampOffset; antes, en modo 'sequence', el equipo dejaba un hueco en cada unión y saltarlo era un corte
// de 1-1,5 s cada segmento); los 2 segmentos siguientes se bajan mientras se entrega el actual; el descifrado va por
// partes sin trabar la app; un vigilante cada 300 ms salta los huecos que queden y, si se acaba lo bajado, pausa hasta
// tener unos segundos de margen en lugar de detenerse y seguir; un segmento que no llega se reintenta y, a la tercera,
// se salta.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { UA } from '../lib/http';
import { xuiError } from '../lib/xui';
import { cbc } from '@noble/ciphers/aes';
import { parseList, resolveUrl, Seg, segIv, tsFirstPts, tsStart } from '../lib/hlslist';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type Got = { code: number; url: string; text?: string; data?: Uint8Array; type?: string };

// segmentos que se bajan por adelantado mientras se entrega el actual
const PREFETCH = 2;
// el descifrado AES-128 va por partes de este tamaño (múltiplo de 16)
const DEC_CHUNK = 65536;

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
  // el reproductor se quedó sin datos (después de empezar) y cuánto tardan bajar y descifrar cada segmento: para el reporte
  private stalls = 0;
  private fetchMs = 0;
  private decMs = 0;
  // los segmentos siguientes ya se bajan mientras se entrega el actual (por número de segmento)
  private inflight = new Map<number, Promise<Got>>();
  // avisa una vez si el canal se detiene seguido (Player lo manda al panel con diag())
  onStalls: () => void = () => {};
  private lastStall = 0;
  private onWaiting = () => this.stalled();
  // vigilante cada 300 ms: salta los huecos entre tramos y, si se acaba lo bajado, espera con margen (holding)
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  // en pausa a propósito hasta tener margen: Player muestra «cargando», no «en pausa»
  holding = false;
  private holdAt = 0;
  private holds: number[] = [];
  private skipped = 0;
  // veces que se pidió la lista otra vez desde la dirección del canal (token vencido) y páginas seguidas en lugar de
  // un segmento
  private renews = 0;
  private pageRetries = 0;
  // desplazamiento de las marcas de tiempo del canal (null = aún no puesto), cuántas veces se reacomodó (cambio de
  // numeración del servidor, segmento saltado) y huecos que hubo que saltar (deberían ser 0)
  private tsOff: number | null = null;
  private resyncs = 0;
  private gapJumps = 0;
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
    const n = Math.max(1, this.appended);
    return 'hls host=' + host + ' segs=' + this.segs.length + ' duracion=' + this.target + (this.encrypted ? ' cifrado=aes128' : '') + ' entregados=' + this.appended + ' bytes=' + this.bytes +
      ' bajada=' + Math.round(this.fetchMs / n) + 'ms descifrado=' + Math.round(this.decMs / n) + 'ms cortes=' + this.stalls + ' esperas=' + this.holds.length + ' margen=' + this.margin().toFixed(0) +
      's saltados=' + this.skipped + ' reacomodos=' + this.resyncs + ' huecos=' + this.gapJumps + ' renovaciones=' + this.renews + ' buf=[' + buf + '] t=' + (this.v.currentTime || 0).toFixed(1) + (this.head ? ' inicio=' + this.head : '') + (this.lastProblem ? ' problema=' + this.lastProblem : '');
  }

  // '' = empezó; si no, el motivo (lista que no llega, página de error de XUI, vacía, en fMP4…)
  async start(): Promise<string> {
    const err = await this.refresh();
    if (err) return err;
    if (!this.segs.length) return 'lista sin segmentos';
    if (!this.alive) return '';
    // en vivo: 5 segmentos antes del final (unos 25-30 s de margen): con los últimos 3 cualquier demora del servidor o
    // del descifrado dejaba el canal sin datos y se detenía y seguía una y otra vez
    this.next = this.segs[Math.max(0, this.segs.length - 5)].seq;
    this.v.addEventListener('waiting', this.onWaiting);
    const ms: any = new MediaSource();
    this.ms = ms;
    const opened = new Promise<void>(res => ms.addEventListener('sourceopen', () => res()));
    try {
      // el reproductor cerró el video (error del decodificador): Player vuelve a conectar el canal
      ms.addEventListener('sourceclose', () => {
        if (!this.alive || !this.started) return;
        this.lastProblem = 'MediaSource cerrado';
        this.onError('el reproductor cerró el video del canal');
      });
    } catch {
      // sin el evento
    }
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
      // por marcas de tiempo: el lector pone cada segmento a continuación del anterior (place)
      this.sb.mode = 'segments';
    } catch {
      // modo por defecto
    }
    this.timer = setInterval(this.tick, 300);
    this.pump();
    return '';
  }

  destroy(): void {
    this.alive = false;
    this.holding = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.inflight.clear();
    try {
      this.v.removeEventListener('waiting', this.onWaiting);
    } catch {
      // ya cerrado
    }
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
    // por partes de 64 KB cediendo el turno entre una y otra: un segmento de varios MB descifrado de una vez trababa
    // la app (y su vigilante) más de un segundo
    try {
      if (data.length % 16) throw new Error('largo ' + data.length);
      const out = new Uint8Array(data.length);
      let iv = segIv(seg);
      let o = 0;
      for (let i = 0; i < data.length; i += DEC_CHUNK) {
        const end = Math.min(data.length, i + DEC_CHUNK);
        const lastPart = end === data.length;
        const dec = cbc(key, iv, { disablePadding: !lastPart }).decrypt(data.subarray(i, end));
        out.set(dec, o);
        o += dec.length;
        if (lastPart) break;
        iv = data.slice(end - 16, end);
        await sleep(0);
        if (!this.alive) return null;
      }
      return out.subarray(0, o);
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
      // la dirección con token del balanceador pudo vencer (error o una página de XUI): otra vez desde la del canal
      if ((r.code !== 200 || r.text === undefined || !r.text.trim().startsWith('#EXTM3U')) && this.list !== this.first) {
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
      // quieto 3 s con video por delante: se empuja (antes 8 s: el canal se veía congelado)
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

  private lastJump = 0;
  private jump(to: number): void {
    if (this.started) this.gapJumps++;
    this.v.currentTime = to;
    this.lastMove = Date.now();
    this.lastJump = this.lastMove;
    if (this.v.paused && !this.holding) this.v.play();
  }

  // segundos ya bajados por delante de la imagen (en el tramo donde está)
  private aheadSec(): number {
    try {
      const b = this.sb.buffered;
      const t = this.v.currentTime || 0;
      for (let i = 0; i < b.length; i++) if (t >= b.start(i) - 0.3 && t <= b.end(i)) return b.end(i) - t;
    } catch {
      // sin datos
    }
    return 0;
  }

  // margen con el que se sigue después de quedarse sin datos: más si ya pasó varias veces hace poco (red o
  // servidor lentos), así se para una vez y sigue de corrido en lugar de detenerse y seguir cada pocos segundos
  private margin(): number {
    const now = Date.now();
    const recent = this.holds.filter(h => now - h < 180000).length;
    return Math.min(10, Math.max(3, Math.min(this.target, 6)) + Math.max(0, recent - 1) * 2);
  }

  // una detención (del reproductor o del vigilante), contada una vez cada 2 s: a la tercera se avisa al panel
  private stalled(): void {
    if (!this.appended || !this.alive || Date.now() - this.lastStall < 2000) return;
    this.lastStall = Date.now();
    this.stalls++;
    if (this.stalls === 3) this.onStalls();
  }

  private tick = (): void => {
    if (!this.alive || !this.sb || !this.started) return;
    // 45 s sin que llegue nada nuevo (ni renovando la lista): Player vuelve a conectar el canal desde cero
    if (Date.now() - this.lastAppend > 45000) {
      this.alive = false;
      this.lastProblem = this.lastProblem || 'sin video nuevo en 45 s';
      this.onError('el canal dejó de mandar video');
      return;
    }
    this.unstick();
    const ahead = this.aheadSec();
    if (this.holding) {
      // con margen (o con algo después de 8 s esperando) sigue
      if (ahead >= this.margin() || (ahead >= 1.5 && Date.now() - this.holdAt > 8000)) {
        this.holding = false;
        this.lastMove = Date.now();
        this.v.play();
      }
      return;
    }
    // se acaba lo bajado: pausa hasta tener margen (no justo después de saltar un hueco: el salto tarda un instante)
    if (!this.v.paused && ahead < 0.25 && Date.now() - this.lastJump > 1500) {
      this.holding = true;
      this.holdAt = Date.now();
      this.holds.push(this.holdAt);
      if (this.holds.length > 20) this.holds.shift();
      this.stalled();
      this.v.pause();
    }
  };

  // lo ya visto se borra para no llenar la memoria (keep: segundos que se dejan detrás de la imagen)
  private async trim(keep = 15): Promise<void> {
    try {
      const b = this.sb.buffered;
      const t = this.v.currentTime || 0;
      if (b.length && b.start(0) < t - keep - (keep > 5 ? 15 : 0)) {
        this.sb.remove(b.start(0), t - keep);
        await this.idle();
      }
    } catch {
      // nada que borrar
    }
  }

  private segTimeout(): number {
    return Math.max(10000, this.target * 2500);
  }

  // el segmento (el que ya se estaba bajando o uno nuevo)
  private fetchSeg(seg: Seg): Promise<Got> {
    let p = this.inflight.get(seg.seq);
    if (!p) {
      p = this.get(seg.url, this.segTimeout(), 'seg');
      this.inflight.set(seg.seq, p);
    }
    return p;
  }

  // los PREFETCH siguientes ya se empiezan a bajar (con el canal al día, la lista todavía no los tiene)
  private prefetch(from: number): void {
    for (const k of Array.from(this.inflight.keys())) if (k <= from) this.inflight.delete(k);
    if (this.bufEnd() - (this.v.currentTime || 0) > 30) return;
    for (const sg of this.segs) {
      if (sg.seq > from && sg.seq <= from + PREFETCH && !this.inflight.has(sg.seq)) this.inflight.set(sg.seq, this.get(sg.url, this.segTimeout(), 'seg'));
    }
  }

  private async pump(): Promise<void> {
    // fails: fallos seguidos (cualquier segmento); segFails: del segmento actual (al tercero se salta al siguiente)
    let fails = 0;
    let segFails = 0;
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
        // al día con el canal: la lista se vuelve a pedir pronto (un tercio de segmento) para tener el nuevo apenas sale
        await sleep(Math.max(1000, (this.target * 1000) / 3));
        if (!this.alive) return;
        const err = await this.refresh();
        if (err && ++listFails > 6) {
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
            this.inflight.clear();
            this.next = this.segs[Math.max(0, this.segs.length - 2)].seq;
            this.lastAppend = Date.now();
          }
        }
        continue;
      }
      const t0 = Date.now();
      const r = await this.fetchSeg(seg);
      this.inflight.delete(seg.seq);
      if (!this.alive) return;
      this.fetchMs += Date.now() - t0;
      if (r.text !== undefined && /<html|<!doctype/i.test(r.text)) {
        // una página en lugar del video: con el canal ya sonando suele ser el token vencido (la lista se pide otra vez
        // desde la dirección del canal); al empezar, o si sigue igual, el motivo (XUI) y no se insiste
        const why = this.pageProblem(r.text);
        if (this.appended > 0 && ++this.pageRetries <= 2) {
          await this.renew();
          continue;
        }
        this.onError(why);
        return;
      }
      if (!r.data || !r.data.length) {
        this.lastProblem = 'segmento HTTP ' + r.code;
        if (!(await this.failed(seg, ++fails, ++segFails))) {
          this.onError(r.code ? 'el servidor contestó ' + r.code + ' a los segmentos' : 'se cortó la conexión con el canal');
          return;
        }
        if (this.next !== seg.seq) segFails = 0;
        continue;
      }
      // mientras este se descifra y se entrega, los siguientes ya se bajan
      this.prefetch(seg.seq);
      let data: Uint8Array = r.data;
      if (seg.key) {
        // segmento cifrado (AES-128): se descifra con la llave de la lista
        this.encrypted = true;
        const t1 = Date.now();
        const plain = await this.decrypt(seg, data);
        this.decMs += Date.now() - t1;
        if (!this.alive) return;
        if (!plain) {
          if (!(await this.failed(seg, ++fails, ++segFails))) {
            this.onError('no se pudo descifrar el canal (' + this.lastProblem + ')');
            return;
          }
          if (this.next !== seg.seq) segFails = 0;
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
      segFails = 0;
      this.pageRetries = 0;
      await this.trim();
      await this.place(data);
      if (!(await this.append(data))) return;
      this.appended++;
      this.bytes += data.length;
      this.next = seg.seq + 1;
      this.lastAppend = Date.now();
      // empieza a sonar con 2 segmentos entregados (o con 1 si la lista no tiene más): arranca con margen
      const more = this.segs.some(sg => sg.seq === this.next);
      if (!this.started && (this.appended >= 2 || !more)) {
        this.started = true;
        this.unstick();
        if (this.v.paused) this.v.play();
      }
    }
  }

  // segmento que no llegó o no se pudo descifrar: se reintenta dos veces y, a la tercera, se salta al siguiente (el
  // canal sigue en vez de cortarse por un segmento perdido). false = demasiados fallos seguidos: se deja
  // Al segundo fallo seguido la lista se pide otra vez desde la dirección del canal: el token del balanceador de XUI
  // vence a los pocos minutos y todos los segmentos de la lista vieja fallan (antes el canal se cortaba a los ~5 min).
  // Se deja solo con muchos fallos seguidos y más de 30 s sin entregar nada.
  private async failed(seg: Seg, fails: number, segFails: number): Promise<boolean> {
    if (fails > 9 && Date.now() - this.lastAppend > 30000) return false;
    this.inflight.delete(seg.seq);
    if (segFails === 2 || fails % 4 === 0) await this.renew();
    if (segFails >= 3 && this.segs.some(sg => sg.seq === seg.seq + 1)) {
      this.next = seg.seq + 1;
      this.skipped++;
    }
    await sleep(700);
    return this.alive;
  }

  // Lugar del segmento en la línea de tiempo: el primero empieza en 0 y los siguientes van donde dicen sus marcas de
  // tiempo (segmentos seguidos del mismo canal quedan pegados: sin huecos). Si no calza con lo entregado (el servidor
  // reinició la numeración, se saltó un segmento, la lista se reacomodó) se pone justo al final de lo entregado.
  private async place(data: Uint8Array): Promise<void> {
    const pts = tsFirstPts(data);
    if (pts === null) return;
    let off = this.tsOff;
    if (off === null) off = -pts;
    else {
      const end = this.bufEnd();
      if (end > 0 && Math.abs(pts + off - end) > 1.5) {
        off = end - pts;
        this.resyncs++;
      }
    }
    if (off === this.tsOff) return;
    await this.idle();
    try {
      this.sb.timestampOffset = off;
      this.tsOff = off;
    } catch (e: any) {
      this.lastProblem = 'timestampOffset: ' + String(e?.message || e).slice(0, 40);
    }
  }

  // la lista otra vez desde la dirección del canal (token nuevo del balanceador)
  private async renew(): Promise<void> {
    this.renews++;
    this.list = this.first;
    this.inflight.clear();
    await this.refresh();
  }

  // entrega al reproductor; con la memoria llena (QuotaExceeded) borra lo ya visto y prueba otra vez
  private async append(data: Uint8Array): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.idle();
      try {
        this.sb.appendBuffer(data);
        await this.idle();
        return true;
      } catch (e: any) {
        const msg = String(e?.name || '') + ' ' + String(e?.message || e);
        this.lastProblem = 'appendBuffer: ' + msg.trim().slice(0, 60);
        if (!/quota/i.test(msg) || !this.alive) break;
        await this.trim(attempt ? 2 : 5);
        await sleep(500);
      }
    }
    if (this.alive) this.onError('el reproductor no aceptó el video del canal (códec de audio o video)');
    return false;
  }
}
