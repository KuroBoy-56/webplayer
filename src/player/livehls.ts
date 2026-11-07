// HLS en vivo del servidor IPTV (.m3u8 de un canal) con Media Source Extensions: el reproductor de Vega no abre HLS
// por su cuenta (solo por MSE), así que cuando el canal no abre en MPEG-TS directo la lista se baja aquí, se sigue
// mientras crece (lista que se desliza: EXT-X-MEDIA-SEQUENCE) y los segmentos se entregan al SourceBuffer en orden,
// empezando cerca del final (en vivo). Las listas maestras (varias calidades) usan la de más calidad.
// En Vega el modo directo (src = dirección) no abre MPEG-TS (solo MP4, MKV, MP3, FLV, OGG y FLAC; el HLS solo por MSE),
// así que en Fire TV este es el camino principal de la TV en vivo.
// Estabilidad: el lector MPEG-TS de Vega dejaba huecos de décimas entre segmentos (audio y video no terminan juntos)
// y saltarlos era un corte cada pocos segundos. Por eso cada segmento H.264 + AAC se convierte aquí a MP4 fragmentado
// (tsmux.ts) con la duración exacta de cada cuadro: lo entregado queda de corrido, sin huecos. Con otro códec (H.265,
// AC-3…) o si el equipo no lo acepta, se entrega el MPEG-TS como antes, cada segmento a continuación del anterior
// (place); los 2 segmentos siguientes se bajan mientras se entrega el actual; el descifrado va por
// partes sin trabar la app; un vigilante cada 300 ms salta los huecos que queden y, si se acaba lo bajado, pausa hasta
// tener unos segundos de margen en lugar de detenerse y seguir; un segmento que no llega se reintenta y, a la tercera,
// se salta.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { AppState } from 'react-native';
import { UA } from '../lib/http';
import { takeList, takeSeg } from './prefetch';
import { xuiError } from '../lib/xui';
import { cbc } from '@noble/ciphers/aes';
import { liveStartSeg, parseList, resolveUrl, Seg, segIv, tsStart, tsStartPts } from '../lib/hlslist';
import { TsMux } from '../lib/tsmux';
import { disableNativeAes, nativeAesOn, nativeCbc } from '../lib/aesnative';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

// plain: el segmento ya descifrado (lo dejó la miniatura)
type Got = { code: number; url: string; text?: string; data?: Uint8Array; type?: string; plain?: boolean };

// De la miniatura a la pantalla grande sin empezar de cero: la miniatura deja la lista (con el token del balanceador),
// los últimos segmentos ya bajados (descifrados) y las llaves. Antes la pantalla grande pedía otra vez la lista justo al
// cerrarse la miniatura (muchos XUI contestan esa vez una página vacía: 1-3 s de reintentos) y volvía a bajar los
// segmentos que la miniatura ya tenía. Vale 15 s; la toma solo el mismo canal.
const HANDOFF_TTL = 15000;
// segmentos que guarda la miniatura (los más nuevos) y tope de memoria
const KEEP_SEGS = 6;
const KEEP_BYTES = 24 * 1048576;
type Handoff = { first: string; list: string; segs: Seg[]; target: number; keys: Map<string, Uint8Array>; data: Map<number, Uint8Array>; at: number };
let handoff: Handoff | null = null;

export function hasHandoff(url: string): boolean {
  return !!handoff && handoff.first === url && Date.now() - handoff.at < HANDOFF_TTL && handoff.data.size > 0;
}

function takeHandoff(url: string): Handoff | null {
  const h = handoff;
  handoff = null;
  return h && h.first === url && Date.now() - h.at < HANDOFF_TTL && h.data.size ? h : null;
}

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

// el reproductor falló con el MP4 propio: el resto de la sesión, MPEG-TS
let mp4Off = false;
export function disableMp4(): void {
  mp4Off = true;
}

export class LiveHls {
  private ms: any = null;
  private sb: any = null;
  private objectUrl = '';
  private requests = new Set<AbortController>();
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
  // pausa que no puso el lector (la puso el equipo): desde cuándo y cuántas veces se siguió
  private pausedAt = 0;
  private resumed = 0;
  private holds: number[] = [];
  private skipped = 0;
  // veces que se pidió la lista otra vez desde la dirección del canal (token vencido) y páginas seguidas en lugar de
  // un segmento
  private renews = 0;
  // veces que se volvió a pedir la lista al empezar (el servidor no la dio a la primera)
  private retries = 0;
  private pageRetries = 0;
  // desplazamiento de las marcas de tiempo del canal (null = aún no puesto), cuántas veces se reacomodó (cambio de
  // numeración del servidor, segmento saltado) y huecos que hubo que saltar (deberían ser 0)
  private tsOff: number | null = null;
  private resyncs = 0;
  private gapJumps = 0;
  // uniones en las que el segmento nuevo dejaba un hueco de décimas y se pegó al final de lo entregado
  private joins = 0;
  private lastAppend = Date.now();
  private bytes = 0;
  // llaves AES-128 ya bajadas (por dirección) y si el canal viene cifrado (para el reporte)
  private keys = new Map<string, Uint8Array>();
  // keep: guarda los últimos segmentos para pasarlos a la pantalla grande (solo la miniatura)
  keep = false;
  private kept = new Map<number, Uint8Array>();
  private keptBytes = 0;
  // segmentos que llegaron de la miniatura (para el reporte) y los que quedan por usar
  private fromPreview = 0;
  private handed: Map<number, Uint8Array> | null = null;
  private encrypted = false;
  private head = '';
  // 'mp4' = segmentos convertidos aquí (tsmux); 'ts' = MPEG-TS al reproductor; '' = aún sin el primer segmento
  private mode: '' | 'mp4' | 'ts' = '';
  private mux: TsMux | null = null;
  private muxWhy = '';
  // el reproductor rechazó el video entregado (no la red): con MP4, se vuelve a abrir el canal en MPEG-TS
  private mediaFail = false;
  // último problema (para el reporte al panel): código HTTP de la lista o de los segmentos, página de XUI…
  lastProblem = '';
  onError: (msg: string) => void = () => {};

  // noAudio: el equipo no tomó el audio del canal (MP2 / AC-3 en MP4): solo el video
  // tsOnly: este canal se congeló en MP4 propio: se prueba con el MPEG-TS al reproductor de Vega
  constructor(private v: VideoPlayer, url: string, readonly audioIdx = 0, private noAudio = false, private tsOnly = false) {
    this.first = url;
    this.list = url;
  }

  isMp4(): boolean {
    return this.mode === 'mp4';
  }

  mediaFailed(): boolean {
    return this.mediaFail;
  }

  // el canal trae audio MP3 / MP2 / AC-3 (en MP4 propio o, si el equipo no lo tomó, en MPEG-TS): si no se ve, se
  // prueba solo con el video
  otherAudio(): boolean {
    return !!this.mux && this.mux.otherAudio();
  }

  // idiomas de los audios del canal (MP4 propio; el que suena es audioIdx)
  audioLangs(): string[] {
    return this.mode === 'mp4' && this.mux ? this.mux.langs : [];
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
    const m = this.mux;
    const how = ' modo=' + (this.mode || '?') + (this.mode === 'mp4' && m ? ' ' + m.mime.replace(/^.*codecs=/, '') + (m.why ? ' (' + m.why + ')' : '') + ' silencio=' + m.filled + ' descartados=' + m.dropped + ' cosidos=' + m.joins : '') + (this.muxWhy ? ' (' + this.muxWhy + ')' : '');
    return 'hls host=' + host + how + ' segs=' + this.segs.length + ' duracion=' + this.target + (this.encrypted ? ' cifrado=aes128' + (nativeAesOn() ? '(nativo)' : '(js)') : '') + ' entregados=' + this.appended + ' bytes=' + this.bytes +
      ' bajada=' + Math.round(this.fetchMs / n) + 'ms descifrado=' + Math.round(this.decMs / n) + 'ms cortes=' + this.stalls + ' esperas=' + this.holds.length + ' margen=' + this.margin().toFixed(0) +
      's saltados=' + this.skipped + ' reacomodos=' + this.resyncs + ' pegados=' + this.joins + ' huecos=' + this.gapJumps + ' renovaciones=' + this.renews + (this.resumed ? ' reanudados=' + this.resumed : '') + (this.retries ? ' reintentos=' + this.retries : '') + (this.fromPreview ? ' miniatura=' + this.fromPreview : '') + ' buf=[' + buf + '] t=' + (this.v.currentTime || 0).toFixed(1) + (this.head ? ' inicio=' + this.head : '') + (this.lastProblem ? ' problema=' + this.lastProblem : '');
  }

  // Con los segmentos de la miniatura: se empieza en uno de ellos (el primero desde donde empezaría siempre, 5 antes del
  // final; si la miniatura solo tiene anteriores, el más cercano), así la primera imagen sale sin bajar nada
  private handedStart(): number {
    const want = liveStartSeg(this.segs).seq;
    const have = Array.from(this.handed!.keys()).filter(q => this.segs.some(sg => sg.seq === q)).sort((a, b) => a - b);
    if (!have.length) return want;
    return have.find(q => q >= want) ?? have[have.length - 1];
  }

  // la miniatura ya tenía este canal: su lista, sus segmentos y sus llaves, sin pedir nada
  adopt(): boolean {
    const h = takeHandoff(this.first);
    if (!h) return false;
    this.list = h.list;
    this.segs = h.segs;
    this.target = h.target;
    this.keys = h.keys;
    this.handed = h.data;
    return true;
  }

  // La miniatura se cierra para abrir el canal en pantalla grande: deja lo que tiene y se apaga (suelta la conexión).
  // Si nadie lo toma en 15 s, se suelta la memoria
  handOff(): void {
    if (this.alive && this.kept.size && this.segs.length) {
      const h: Handoff = { first: this.first, list: this.list, segs: this.segs.slice(), target: this.target, keys: new Map(this.keys), data: new Map(this.kept), at: Date.now() };
      handoff = h;
      const t: any = setTimeout(() => {
        if (handoff === h) handoff = null;
      }, HANDOFF_TTL);
      t?.unref?.();
    }
    this.destroy();
  }

  // la pantalla grande se quedó con este lector: ya no hace falta guardar segmentos
  stopKeeping(): void {
    this.keep = false;
    this.kept.clear();
    this.keptBytes = 0;
  }

  // segmento ya entregado (texto plano): los KEEP_SEGS más nuevos, con tope de memoria
  private remember(seq: number, data: Uint8Array): void {
    this.kept.set(seq, data);
    this.keptBytes += data.length;
    for (const q of this.kept.keys()) {
      if (this.kept.size <= KEEP_SEGS && this.keptBytes <= KEEP_BYTES) break;
      this.keptBytes -= this.kept.get(q)!.length;
      this.kept.delete(q);
    }
  }

  // '' = empezó; si no, el motivo (lista que no llega, página de error de XUI, vacía, en fMP4…)
  async start(): Promise<string> {
    // Al pasar de la vista previa a pantalla completa (o al cambiar de canal) la lista se pide en el mismo momento en
    // que se cierra la conexión anterior: muchos servidores XUI contestan esa vez 200 con una página vacía o sin lista
    // (text/html) y un momento después sí la dan. Se espera y se vuelve a pedir (hasta 3 veces, 1 s, 2 s y 3 s) antes de
    // dar el canal por perdido; un motivo claro de XUI (canal inexistente, vencida…) no se reintenta.
    const h = this.adopt();
    // el video del canal anterior se reemplaza ya, antes de pedir la lista: al cambiar de canal en pantalla grande el
    // anterior seguía sonando (y con su conexión abierta: el servidor contaba una conexión más y devolvía una página vacía
    // en lugar de la lista del nuevo); el aviso de error quedaba encima de ese canal. Además se abre mientras llega la lista
    const ms: any = new MediaSource();
    this.ms = ms;
    const opened = new Promise<void>(res => ms.addEventListener('sourceopen', () => res()));
    try {
      // el reproductor cerró el video (error del decodificador): Player vuelve a conectar el canal
      ms.addEventListener('sourceclose', () => {
        if (!this.alive || !this.started) return;
        if (this.mode === 'mp4') this.mediaFail = true;
        this.lastProblem = 'MediaSource cerrado';
        this.onError('el reproductor cerró el video del canal');
      });
    } catch {
      // sin el evento
    }
    try {
      this.objectUrl = (URL as any).createObjectURL(ms);
      this.v.src = this.objectUrl;
    } catch {
      (this.v as any).srcObject = ms;
    }
    let err = h ? '' : await this.refresh();
    for (let i = 0; err && i < 3 && this.alive && this.retryable(); i++) {
      this.retries++;
      await sleep(1000 * (i + 1));
      if (!this.alive) return '';
      this.list = this.first;
      err = await this.refresh();
    }
    if (err) return err;
    if (!this.segs.length) return 'lista sin segmentos';
    if (!this.alive) return '';
    // en vivo: 5 segmentos antes del final (unos 25-30 s de margen): con los últimos 3 cualquier demora del servidor o
    // del descifrado dejaba el canal sin datos y se detenía y seguía una y otra vez
    this.next = this.handed ? this.handedStart() : liveStartSeg(this.segs).seq;
    this.v.addEventListener('waiting', this.onWaiting);
    await Promise.race([opened, sleep(10000)]);
    if (!this.alive) return '';
    if (ms.readyState !== 'open') return 'el reproductor no abrió MediaSource';
    // el SourceBuffer (MP4 o MPEG-TS) se crea con el primer segmento (deliver)
    this.timer = setInterval(this.tick, 300);
    this.pump();
    return '';
  }

  destroy(): void {
    this.alive = false;
    this.holding = false;
    this.kept.clear();
    this.keptBytes = 0;
    this.handed = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.inflight.clear();
    this.keys.clear();
    try {
      this.v.removeEventListener('waiting', this.onWaiting);
    } catch {
      // ya cerrado
    }
    if (this.objectUrl) {
      try { (URL as any).revokeObjectURL?.(this.objectUrl); } catch { /* sin URL de objetos */ }
      this.objectUrl = '';
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
    if (!this.alive) return { code: 0, url };
    // la lista del canal ya pedida por Player mientras se iniciaba el reproductor (prefetch.ts)
    if (mode === 'list') {
      const pre = takeList(url);
      if (pre) {
        const got = await pre;
        if (got.code) return got;
      }
    }
    // el primer segmento, pedido apenas llegó la lista mientras el reproductor se iniciaba (se corta al cerrar)
    if (mode === 'seg') {
      const pre = takeSeg(url);
      if (pre) {
        this.requests.add(pre.ctrl);
        try {
          const got = await pre.p;
          if (got.code || !this.alive) return got;
        } finally {
          this.requests.delete(pre.ctrl);
        }
      }
    }
    const ctrl = new AbortController();
    this.requests.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(), timeout);
    let at = url;
    try {
      for (let hop = 0; hop < 6; hop++) {
        if (!this.alive) return { code: 0, url: at };
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
      this.requests.delete(ctrl);
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
    // primero el descifrado nativo de Vega (milisegundos); si no da MPEG-TS, el de JavaScript y, si ese sí lo da, el
    // nativo no se vuelve a usar en la sesión
    const fast = await nativeCbc(key, segIv(seg), data);
    if (!this.alive) return null;
    if (fast && tsStart(fast) >= 0) return fast;
    const slow = await this.slowDecrypt(seg, key, data);
    if (fast && slow && tsStart(slow) >= 0) disableNativeAes();
    return slow;
  }

  // AES-128 en JavaScript (@noble), por partes de 64 KB cediendo el turno entre una y otra: un segmento de varios MB
  // descifrado de una vez trababa la app (y su vigilante) más de un segundo
  private async slowDecrypt(seg: Seg, key: Uint8Array, data: Uint8Array): Promise<Uint8Array | null> {
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

  // ¿vale la pena volver a pedir la lista? Página sin lista, vacía, sin motivo de XUI o con uno de conexiones /
  // demasiados pedidos (la conexión anterior todavía se está cerrando), o un 429 / 503 / 509 del servidor
  private retryable(): boolean {
    const p = this.lastProblem;
    return /^lista no es HLS|^página html|^lista HTTP (429|503|509)\b/.test(p) || /^xui .*(CONNECT|LIMIT|FLOOD|BLOCKED_IP|SESSION)/i.test(p);
  }

  // motivo de una página en lugar de la lista o del video (XUI «Debug Mode»: INVALID_STREAM_ID…)
  private pageProblem(text: string): string {
    const x = xuiError(text);
    this.lastProblem = x ? 'xui ' + x.code : 'página html (' + text.length + ' bytes)';
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
      if (!r.text.trim().startsWith('#EXTM3U')) {
        if (/<html|<!doctype/i.test(r.text)) return this.pageProblem(r.text);
        // lo que llegó en lugar de la lista (para el reporte): tipo, tamaño y el comienzo
        const head = r.text.replace(/\s+/g, ' ').trim().slice(0, 60);
        this.lastProblem = 'lista no es HLS (' + (r.type || '?') + ', ' + r.text.length + ' bytes' + (head ? ': ' + head : '') + ')';
        return 'el servidor no devolvió una lista HLS';
      }
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
          // trabado con video por delante: al cuadro clave siguiente (el decodificador empieza limpio y deja atrás el
          // tramo que lo trababa); sin uno conocido, unas décimas más adelante
          else if (stalled && en - t > 1) {
            const k = this.nextKey(t, en);
            this.jump(k > 0 ? k + 0.15 : t + (Date.now() - this.lastJump < 8000 && en - t > 3 ? 2 : 0.5));
            this.froze();
          }
          return;
        }
      }
    } catch {
      // sin datos todavía
    }
  }

  // cuadro clave entregado después de t (MP4 propio: todos; MPEG-TS: el comienzo de cada segmento)
  private segStarts: number[] = [];
  private nextKey(t: number, end: number): number {
    const list = this.mode === 'mp4' && this.mux ? this.mux.keys : this.segStarts;
    return list.find(k => k > t + 0.3 && k < end - 0.5) ?? 0;
  }

  // Imagen congelada con video de sobra por delante (el audio puede seguir sonando): 3 veces en 30 s y empujarla no
  // sirve. Player vuelve a abrir el canal (playback.liveRetryTs): primero igual (reproductor nuevo) y después en MPEG-TS
  frozen = false;
  private freezes: number[] = [];
  private froze(): void {
    const now = Date.now();
    this.freezes = this.freezes.filter(x => now - x < 30000);
    this.freezes.push(now);
    if (this.freezes.length < 3 || this.frozen || !this.alive) return;
    this.frozen = true;
    this.lastProblem = 'imagen congelada con ' + this.aheadSec().toFixed(0) + ' s por delante';
    this.onError('la imagen se congeló');
  }

  // último segmento que llegó del servidor (el vigilante de Player espera más si el canal sigue bajando)
  lastData = 0;
  private lastJump = 0;
  private jump(to: number): void {
    // cada salto se ve como un microcorte: al tercero también se avisa al panel (antes solo las detenciones; los
    // microcortes no dejaban ningún registro)
    if (this.started && ++this.gapJumps === 3 && this.stalls < 3) this.onStalls();
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
    // Vega pausa el reproductor por su cuenta a veces (al soltarse el audio de la miniatura al pasar a pantalla grande):
    // el canal quedaba en pausa para siempre, porque el vigilante solo mira el video andando. En vivo nadie pausa a
    // propósito (Player no deja pausar un canal): con video por delante sigue; sin él, espera margen como siempre
    if (this.v.paused && !this.holding) {
      if (!this.pausedAt) this.pausedAt = Date.now();
      else if (Date.now() - this.pausedAt > 1500 && AppState.currentState === 'active') {
        this.pausedAt = 0;
        if (this.aheadSec() >= 1) {
          this.resumed++;
          this.lastMove = Date.now();
          this.v.play();
        } else {
          this.holding = true;
          this.holdAt = Date.now();
        }
      }
      return;
    }
    this.pausedAt = 0;
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
    const mine = this.handed?.get(seg.seq);
    if (mine) {
      this.handed!.delete(seg.seq);
      this.fromPreview++;
      return Promise.resolve({ code: 200, url: seg.url, data: mine, type: 'video/mp2t', plain: true });
    }
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
      if (sg.seq > from && sg.seq <= from + PREFETCH && !this.inflight.has(sg.seq) && !this.handed?.has(sg.seq)) this.inflight.set(sg.seq, this.get(sg.url, this.segTimeout(), 'seg'));
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
      // el primer segmento se baja solo, con toda la conexión: antes se pedían a la vez los dos siguientes y los tres se
      // repartían la red, así que la primera imagen tardaba hasta tres veces más. Los siguientes empiezan apenas llega
      // (prefetch de abajo), mientras este se convierte y se entrega
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
      this.lastData = Date.now();
      // mientras este se descifra y se entrega, los siguientes ya se bajan
      this.prefetch(seg.seq);
      let data: Uint8Array = r.data;
      if (seg.key && !r.plain) {
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
      const got = await this.deliver(data);
      if (!got) return;
      if (seg.key) this.encrypted = true;
      // la miniatura guarda lo entregado para la pantalla grande
      if (this.keep) this.remember(seg.seq, data);
      this.next = seg.seq + 1;
      // nada entregado todavía (el MP4 espera el primer cuadro clave)
      if (got === 2) continue;
      this.appended++;
      this.bytes += data.length;
      this.lastAppend = Date.now();
      // empieza a sonar con el primer segmento entregado cuando la lista ya tiene al menos 2 más listos para bajar
      // (empieza 5 antes del final: esos ya existen y se bajan al instante, en paralelo); si no, con 2 (o con 1 si la
      // lista no tiene más). Antes esperaba siempre 2: el canal tardaba un segmento más en verse
      const more = this.segs.some(sg => sg.seq === this.next);
      const backlog = this.segs.filter(sg => sg.seq >= this.next).length;
      if (!this.started && (this.appended >= 2 || !more || backlog >= 2)) {
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
  // tiempo. En Vega el audio y el video de cada segmento no terminan juntos y lo entregado acaba unas décimas antes de
  // donde empieza el segmento siguiente (buf=[0-9.6, 9.7-19.2…]): el reproductor se frenaba en cada unión y saltar el
  // hueco era un corte de ~1 s cada segmento. Por eso, si el segmento nuevo dejaría un hueco de hasta medio segundo,
  // se pega justo al final de lo entregado (la pista que empieza más tarde arranca ahí; la otra se monta unas décimas
  // sobre el final del segmento anterior). Si no calza en absoluto (el servidor reinició la numeración, se saltó un
  // segmento, la lista se reacomodó) también se pone al final de lo entregado.
  private async place(data: Uint8Array): Promise<void> {
    const pts = tsStartPts(data);
    if (!pts) return;
    let off = this.tsOff;
    if (off === null) off = -pts.min;
    else {
      const end = this.bufEnd();
      if (end > 0) {
        const at = pts.max + off;
        if (Math.abs(pts.min + off - end) > 1.5) {
          off = end - pts.max;
          this.resyncs++;
        } else if (at > end + 0.005 && at - end <= 0.5) {
          // 20 ms antes del final: se monta un poco y el reproductor lo toma como un solo tramo
          off = end - 0.02 - pts.max;
          this.joins++;
        }
      }
    }
    this.segStarts.push(pts.min + off);
    if (this.segStarts.length > 60) this.segStarts.shift();
    if (off === this.tsOff) return;
    await this.idle();
    try {
      this.sb.timestampOffset = off;
      this.tsOff = off;
    } catch (e: any) {
      this.lastProblem = 'timestampOffset: ' + String(e?.message || e).slice(0, 40);
    }
  }

  // Entrega un segmento: convertido a MP4 (de corrido) o, si no se puede, el MPEG-TS tal cual. 0 = error (ya avisado),
  // 1 = entregado, 2 = nada que entregar todavía
  private async deliver(data: Uint8Array): Promise<0 | 1 | 2> {
    if (this.mode !== 'ts' && !mp4Off && !this.tsOnly) {
      if (!this.mux) this.mux = new TsMux(this.noAudio ? -1 : this.audioIdx, false, this.target >= 8 ? 2 : 3);
      await sleep(0);
      let r;
      try {
        r = this.mux.push(data);
      } catch (e: any) {
        r = { ok: false as const, why: 'mux: ' + String(e?.message || e).slice(0, 40) };
      }
      if (r.ok) {
        if (!r.data) return 2;
        if (!this.sb) {
          let okType = false;
          try {
            okType = MediaSource.isTypeSupported(r.mime);
          } catch {
            okType = false;
          }
          if (okType) {
            try {
              this.sb = this.ms.addSourceBuffer(r.mime);
              this.mode = 'mp4';
            } catch (e: any) {
              this.muxWhy = 'addSourceBuffer mp4: ' + String(e?.message || e).slice(0, 40);
            }
          } else this.muxWhy = 'no acepta ' + r.mime;
          // el equipo no toma el audio MP3 / MP2: el mismo segmento otra vez, solo con el video (en MPEG-TS Vega
          // tampoco mostraba nada: buf vacío); AC-3 sigue en MPEG-TS como antes
          if (!this.sb && this.mux.mpegAudio()) {
            this.noAudio = true;
            this.mux = null;
            return this.deliver(data);
          }
        }
        if (this.mode === 'mp4') return (await this.append(r.data)) ? 1 : 0;
      } else if (this.mode === 'mp4') {
        // el canal cambió a algo que no se convierte: se vuelve a abrir en MPEG-TS
        this.lastProblem = 'mp4: ' + r.why;
        this.mediaFail = true;
        this.onError('el canal cambió de formato');
        return 0;
      } else this.muxWhy = r.why;
      if (!this.sb) this.mode = 'ts';
    }
    if (!this.sb) {
      this.mode = 'ts';
      try {
        this.sb = this.ms.addSourceBuffer('video/mp2t');
      } catch {
        this.onError('el equipo no acepta MPEG-TS por MSE');
        return 0;
      }
      try {
        // por marcas de tiempo: el lector pone cada segmento a continuación del anterior (place)
        this.sb.mode = 'segments';
      } catch {
        // modo por defecto
      }
    }
    await this.place(data);
    return (await this.append(data)) ? 1 : 0;
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
        if (!/quota/i.test(msg) || !this.alive) {
          if (this.mode === 'mp4') this.mediaFail = true;
          break;
        }
        await this.trim(attempt ? 2 : 5);
        await sleep(500);
      }
    }
    if (this.alive) this.onError('el reproductor no aceptó el video del canal (códec de audio o video)');
    return false;
  }
}
