// Descarga adelantada de una película o capítulo para los lectores propios (mp4mse.ts, mkvmse.ts). 2.0.14.
//
// Antes cada lector pedía el video de a ~4 s, un pedido después del otro. Con servidores IPTV que tardan en contestar
// cada pedido (avisos «tardó en empezar»: espera_media=6439ms) eso son 4 s de video cada 6-10 s: la película se quedaba
// quieta una y otra vez y abría tarde. Aquí el archivo se baja por ventanas seguidas, hasta 3 a la vez (cada conexión la
// limita el servidor por separado) y más grandes cuando el servidor tarda en contestar, siempre por delante de lo que
// se está viendo. El lector pide [off, off + len) y sale de las ventanas ya bajadas o en camino.
//
// - Arranque: la primera ventana es corta (~2 s de video) para que la imagen salga apenas llega; las siguientes crecen
//   (4, 8, 8 s…) y se piden todas a la vez, sin esperar a la primera.
// - Línea de una sola conexión: si un pedido falla o llega cortado mientras hay otro en curso, se sigue de a uno, con
//   ventanas más grandes (single).
// - Salto (◀▶, Continuar viendo): seek() corta lo que estaba en camino y empieza en el byte nuevo.
// - Memoria: como mucho ~20 MB entre lo bajado sin usar y lo que viene en camino.
import { hostStats, isSingle, lineLimit, markSingle, rangeGet, RangeState } from './rangeget';

const MB = 1048576;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// conexiones de la línea y servidores «de a uno» (rangeget.ts, donde está el tope de pedidos a la vez)
export { lineLimit, setLineMax } from './rangeget';
// ¿este archivo se lee de a un pedido? (línea de una conexión, o el servidor rechazó varios a la vez hace poco)
export function singleFor(url: string): boolean {
  return isSingle(url);
}

// waiting: falló y espera su turno para pedirse otra vez (de a uno, primero la de más atrás)
type Win = { off: number; len: number; data: Uint8Array | null; done: boolean; failed: boolean; par: boolean; waiting: boolean; p: Promise<void>; at?: number };

function join(list: Uint8Array[]): Uint8Array {
  if (list.length === 1) return list[0];
  const out = new Uint8Array(list.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of list) {
    out.set(x, o);
    o += x.length;
  }
  return out;
}

export class ReadAhead {
  // la línea admite un solo pedido a la vez
  single = false;
  // mientras se baja el índice del archivo: un solo pedido en camino
  hold = false;
  // pedidos a la vez como mucho (3; los lectores lo bajan cuando leen video y audio por separado)
  par = 3;
  // hasta dónde vale la pena leer (fin del video dentro del archivo); 0 = no se sabe
  end = 0;
  // bytes como mucho desde donde se empezó (lectura por adelantado desde la ficha: solo el arranque); 0 = sin tope
  limit = 0;
  // bytes ya leídos que se guardan detrás de lo que se lee (2.1.0): cambiar de idioma vuelve a armar el video del segundo
  // actual desde aquí, sin pedirle nada al servidor (los audios de todos los idiomas vienen intercalados con el video)
  keepBehind = 0;
  private readAt = -1;
  // ventanas siempre de este tamaño (2.1.1: el índice en segundo plano de a 2 MB, así nunca traba la navegación al
  // convertir lo bajado; 0 = como siempre)
  fixed = 0;
  // sin ventanas nuevas mientras tanto (2.1.1: el resto del índice usa la única conexión de la línea)
  paused = false;
  // solo lo que se pide (read), nada por adelantado (el resto del índice de un MP4 mientras suena el video, 2.0.15)
  lazy = false;
  // tamaño de las primeras ventanas (las que van a la vez al empezar): iguales, así llegan juntas (el índice); 0 = como siempre
  startLen = 0;
  private start0 = 0;
  why = '';
  // para el reporte: ventanas pedidas, bytes y milisegundos (espera + bajada)
  count = 0;
  bytes = 0;
  ms = 0;
  private wins: Win[] = [];
  private flyP = new Set<Promise<void>>();
  private next = 0;
  private gen = 0;
  private ramp = 0;
  private firstNeed = 0;
  private flying = 0;
  private reqs = new Set<AbortController>();
  private alive = true;

  // bps: bytes por segundo del archivo (0 = todavía no se sabe)
  constructor(private url: string, private rs: RangeState, private bps: () => number) {
    this.single = isSingle(url);
  }

  // de a un pedido desde ahora (y los próximos videos de este servidor en la sesión)
  goSingle(): void {
    this.single = true;
    markSingle(this.url);
  }

  // pedidos en camino
  get active(): number {
    return this.reqs.size;
  }

  // ventanas sin terminar (también las que esperan su turno para pedirse otra vez)
  get pending(): number {
    return this.flying;
  }

  // ¿ya se está leyendo desde off (o cerca)? Los lectores no vuelven a posicionar si es así
  covers(off: number): boolean {
    return this.wins.length > 0 && off >= this.wins[0].off && off <= this.next + 4 * MB;
  }

  diag(): string {
    const kbs = this.ms > 0 ? Math.round(this.bytes / 1024 / (this.ms / 1000)) : 0;
    return 'adelanto=' + this.count + 'v ' + (this.bytes / MB).toFixed(1) + 'MB' + (kbs ? ' ' + kbs + 'KB/s_por_conexion' : '') + (this.single ? ' de_a_uno' : '');
  }

  // De a un pedido (2.1.0): cada ventana paga la espera entera del servidor (3,5 s en los avisos) y mientras tanto no
  // llega nada. Antes eran de ~10 s de video (1,3-1,7 MB en un capítulo): el video bajaba apenas más rápido de lo que se
  // veía y cualquier pedido lento lo detenía (simulador: 4,4 s detenido en los primeros 10 s de Continuar viendo). Ahora
  // el tamaño sale de la espera y el ritmo reales del servidor: lo bastante grande para que la espera pese poco
  // (3 veces lo mínimo para no detenerse, entre 4 y 16 MB); la primera, lo que dura la espera de la segunda con margen.
  private singleSize(bps: number): number {
    const hs = hostStats(this.url);
    const n = this.rs.reqs || 0;
    const wait = (n ? (this.rs.waitMs || 0) / n : hs.wait || 3500) / 1000 + 0.3;
    const rate = this.rs.rate || hs.rate || 1000000;
    // para no detenerse: L / bps >= espera + L / ritmo
    const min = rate > bps * 1.1 ? (wait * bps * rate) / (rate - bps) : 16 * MB;
    const steady = Math.max(4 * MB, Math.min(16 * MB, 3 * min));
    const second = Math.max(4 * MB, steady * 0.6);
    if (this.ramp === 0) {
      // la primera (2.1.1): justo lo que se ve mientras llega la segunda (su espera y su bajada, sin margen) más lo que va
      // antes del segundo pedido (desde el cuadro clave), entre 1,5 y 4 MB; en 2.1.0 tenía margen de más (hasta 6 MB: con
      // 1 MB/s eran 3 s más antes de la primera imagen). El colchón de arranque (startPlay) cubre lo que falte
      const first = Math.round(bps * (wait + second / rate)) + this.firstNeed;
      return Math.max(this.firstNeed, Math.min(4 * MB, Math.max(1536 * 1024, first)));
    }
    if (this.ramp === 1) return Math.round(second);
    return Math.round(steady);
  }

  // tamaño de la próxima ventana
  private size(): number {
    if (this.fixed > 0) return this.fixed;
    const known = this.bps() > 0;
    const bps = this.bps() || 250000;
    if (this.single && known && !this.startLen && !this.lazy) return this.singleSize(bps);
    const wait = this.rs.reqs ? (this.rs.waitMs || 0) / this.rs.reqs / 1000 : 1.5;
    // en régimen: lo bastante larga para que la espera del servidor pese poco en cada pedido
    const steady = Math.max(8, Math.min(16, 4 + 2 * wait));
    const steps = this.single ? [2, 8, steady * 1.25] : [2, 4, 8, 8, steady];
    const secs = steps[Math.min(this.ramp, steps.length - 1)];
    const max = (this.single ? 12 : 8) * MB;
    let len = Math.max(256 * 1024, Math.round(secs * bps));
    // sin saber todavía el ritmo del archivo, la primera con algo de margen (alta definición)
    if (!known && this.ramp === 0) len = Math.max(len, 1536 * 1024);
    if (this.ramp === 0 && this.firstNeed > len) len = this.firstNeed;
    if (this.startLen > 0 && this.ramp < 3) len = this.startLen;
    return Math.min(max, len);
  }

  // pide ventanas mientras haya lugar; must: byte hasta donde el lector ya está esperando
  private fill(must = 0): void {
    if (!this.alive || this.paused) return;
    const par = this.single || this.hold ? 1 : Math.max(1, Math.min(this.par, lineLimit() === 2 ? 2 : 3));
    // lo que se guarda por delante: con ventanas de hasta 16 MB, dos (la que se está viendo y la siguiente)
    const cap = (this.single ? 24 : 20) * MB;
    for (let guard = 0; guard < 16; guard++) {
      // fin del video dentro del archivo o, si no se sabe, el tamaño del archivo
      const lim = this.end > 0 ? this.end : this.rs.size || 0;
      if (lim > 0 && this.next >= lim) return;
      if (this.flying >= par) return;
      if (this.lazy && this.next >= must) return;
      // una ventana espera su turno para pedirse otra vez (la rechazaron): nada nuevo hasta que llegue, si no le gana la
      // conexión y el video llega desordenado (2.0.15)
      if (this.wins.some(w => w.waiting)) return;
      if (this.limit > 0 && this.next >= must && this.next - this.start0 >= this.limit) return;
      // (solo lo que está por delante de lo que se lee; lo guardado detrás no cuenta)
      const held = this.next - Math.max(this.readAt, this.wins.length ? this.wins[0].off : this.next);
      if (this.next >= must && held >= cap) return;
      let len = this.size();
      if (lim > 0) len = Math.min(len, lim - this.next);
      if (len <= 0) return;
      this.launch(this.next, len);
      this.next += len;
    }
  }

  private launch(off: number, len: number): void {
    const g = this.gen;
    const w: Win = { off, len, data: null, done: false, failed: false, par: this.flying > 0, waiting: false, p: Promise.resolve(), at: Date.now() };
    if (w.par) for (const x of this.wins) if (!x.done) x.par = true;
    this.wins.push(w);
    this.flying++;
    this.ramp++;
    this.count++;
    const ok = () => this.alive && g === this.gen;
    // llegó entero (o hasta el final del archivo)
    const whole = (d: Uint8Array | null) => !!d && (d.length >= len || (this.rs.size > 0 && off + d.length >= this.rs.size));
    // otro pedido bajando, o una ventana de más atrás que también espera su turno
    const busy = () => this.wins.some(x => x !== w && !x.done && (!x.waiting || x.off < w.off));
    w.p = (async () => {
      const t0 = Date.now();
      const e0 = this.rs.errs || 0;
      let d = await rangeGet(this.url, off, len, this.rs, this.reqs, ok);
      // se cortó por la red con otro pedido en curso (el servidor corta la conexión más vieja de la línea) aunque al
      // reintentar haya llegado: de a uno desde ahora
      if (ok() && w.par && !this.single && (this.rs.errs || 0) > e0) this.goSingle();
      for (let attempt = 0; attempt < 2 && ok() && !whole(d) && !this.rs.unbounded; attempt++) {
        // falló o llegó cortado con otro pedido en curso: la línea no admite varios a la vez. Se sigue de a uno: cada
        // ventana que falló espera a que no haya nada bajando y se pide otra vez, primero la de más atrás
        if (w.par && !this.single) this.goSingle();
        w.waiting = true;
        for (let i = 0; i < 150 && ok() && busy(); i++) await sleep(100);
        await sleep(700);
        w.waiting = false;
        if (!ok()) break;
        d = await rangeGet(this.url, off, len, this.rs, this.reqs, ok);
      }
      if (!ok()) return;
      this.flying--;
      w.done = true;
      if (whole(d)) {
        w.data = d;
        this.bytes += d!.length;
        this.ms += Math.max(1, Date.now() - t0);
      } else {
        w.failed = true;
        this.why = this.rs.why || 'bajada incompleta';
      }
      this.fill();
    })();
    const p = w.p;
    this.flyP.add(p);
    p.then(() => this.flyP.delete(p), () => this.flyP.delete(p));
  }

  // empieza (o vuelve a empezar) a leer en el byte off; need: bytes que el lector necesita de entrada
  seek(off: number, need = 0): void {
    this.gen++;
    for (const c of this.reqs) c.abort();
    this.reqs.clear();
    this.wins = [];
    this.flyP.clear();
    this.flying = 0;
    this.next = off;
    this.start0 = off;
    this.readAt = off;
    this.ramp = 0;
    this.firstNeed = need;
    this.why = '';
    this.fill(off + need);
  }

  // lo que ya llegó por otro pedido (el principio del archivo en una línea de una sola conexión): se lee de ahí y lo
  // siguiente se pide a continuación
  seed(off: number, data: Uint8Array): void {
    this.gen++;
    for (const c of this.reqs) c.abort();
    this.reqs.clear();
    this.flyP.clear();
    this.flying = 0;
    this.wins = [{ off, len: data.length, data, done: true, failed: false, par: false, waiting: false, p: Promise.resolve() }];
    this.next = off + data.length;
    this.start0 = off;
    this.readAt = off;
    this.ramp = 1;
    this.firstNeed = 0;
    this.why = '';
  }

  // sin tope desde ahora (el video se abrió de verdad): sigue leyendo por delante
  go(): void {
    this.limit = 0;
    if (this.wins.length) this.fill();
  }

  // corta lo que está en camino sin pedir nada más (el próximo read vuelve a empezar donde haga falta)
  park(): void {
    this.gen++;
    for (const c of this.reqs) c.abort();
    this.reqs.clear();
    this.wins = [];
    this.flyP.clear();
    this.flying = 0;
  }

  stop(): void {
    this.alive = false;
    this.park();
  }

  // [off, off + len) si ya está bajado (sin pedir nada); null si no (los subtítulos del MP4 salen de aquí, 2.1.0)
  peek(off: number, len: number): Uint8Array | null {
    const end = off + len;
    const out: Uint8Array[] = [];
    let at = off;
    for (const w of this.wins) {
      if (w.off + w.len <= at) continue;
      if (w.off > at || !w.done || !w.data || w.data.length < w.len) return null;
      out.push(w.data.subarray(at - w.off, Math.min(w.len, end - w.off)));
      at = Math.min(end, w.off + w.len);
      if (at >= end) break;
    }
    if (at < end) return null;
    return out.length === 1 ? out[0] : join(out);
  }

  // segundos que faltan para que llegue la próxima ventana en camino (espera del servidor + bajada), 0 si no hay ninguna
  eta(): number {
    const w = this.wins.find(x => !x.done);
    if (!w) return 0;
    const hs = hostStats(this.url);
    const n = this.rs.reqs || 0;
    const wait = (n ? (this.rs.waitMs || 0) / n : hs.wait || 3500) / 1000;
    const rate = this.rs.rate || hs.rate || 1000000;
    return Math.max(0, (w.at || Date.now()) / 1000 + wait + w.len / rate - Date.now() / 1000);
  }

  // hasta qué byte está todo bajado desde off, sin esperar nada (los lectores entregan eso y no esperan la ventana
  // siguiente entera: un tramo que cruzaba el final de una ventana detenía el video aunque tuviera segundos bajados)
  doneUntil(off: number): number {
    let at = off;
    for (const w of this.wins) {
      if (w.off > at) break;
      if (w.off + w.len <= at) continue;
      if (!w.done || !w.data || w.data.length < w.len) break;
      at = w.off + w.len;
    }
    return at;
  }

  // [off, off + len) del archivo; null = no se pudo bajar (why) o se saltó a otro lugar mientras tanto
  async read(off: number, len: number): Promise<Uint8Array | null> {
    if (!this.alive || len <= 0) return null;
    // fuera de lo que se está leyendo (un salto): se empieza ahí
    if (!this.covers(off)) this.seek(off, len);
    const g = this.gen;
    // lo que quedó atrás se suelta (salvo keepBehind)
    this.readAt = off;
    while (this.wins.length && this.wins[0].done && this.wins[0].off + this.wins[0].len <= off - this.keepBehind) this.wins.shift();
    for (let guard = 0; guard < 400; guard++) {
      // fin de lo que hay para leer (se sabe con la primera respuesta del servidor)
      const lim = this.end > 0 ? this.end : this.rs.size || 0;
      const end = lim > 0 ? Math.min(off + len, Math.max(lim, off)) : off + len;
      this.fill(end);
      const need = this.wins.filter(w => w.off < end && w.off + w.len > off);
      const pending = need.find(w => !w.done);
      if (pending) {
        await pending.p;
        if (g !== this.gen || !this.alive) return null;
        continue;
      }
      if (need.some(w => w.failed)) return null;
      const last = need[need.length - 1];
      const covered = need.length > 0 && need[0].off <= off && last.off + last.len >= end;
      if (covered || (lim > 0 && this.next >= lim)) {
        const out: Uint8Array[] = [];
        for (const w of need) {
          const a = Math.max(off, w.off) - w.off;
          const b = Math.min(end, w.off + w.len) - w.off;
          if (w.data && a < w.data.length) out.push(w.data.subarray(a, Math.min(b, w.data.length)));
        }
        return out.length ? join(out) : null;
      }
      // detenida un momento (el resto del índice usa la conexión, moovGate): se espera, no es un fallo
      if (this.paused && !this.flyP.size) {
        await sleep(200);
        if (g !== this.gen || !this.alive) return null;
        continue;
      }
      // todavía no se pudo pedir lo que falta (los lugares están ocupados): se espera a que termine alguno
      if (!this.flyP.size) return null;
      await Promise.race(Array.from(this.flyP));
      if (g !== this.gen || !this.alive) return null;
    }
    return null;
  }
}
