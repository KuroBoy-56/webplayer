// MKV directo del servidor IPTV sin el panel, como ExoPlayer en Android: el modo directo del reproductor de Vega abre el
// MKV pero no deja elegir su audio (no informa las pistas), así que todo cambio de idioma iba a la VPS. Aquí la app lee
// el MKV con pedidos Range al mismo servidor (cabecera, índice Cues y los Cluster de a poco), saca el video y el audio
// elegido y los entrega como MP4 fragmentado (mp4box.ts) al reproductor nativo por MSE. Cambiar de idioma = volver a
// leer desde el mismo segundo con otra pista, sin servidor. Lo que el equipo no decodifica (DTS, TrueHD, E-AC-3 en
// algunos Fire TV) no se puede así: Playback pide entonces el servidor o avisa que hace falta.
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { rangeGet, RangeState } from './rangeget';
import { takeRangeFrom } from './prefetch';
import { bridgeAsk } from './sharedindex';
import { ReadAhead } from './readahead';
import { sameLang } from '../lib/lang';
import { b64, dropIndex, fromBase64, hasIndexKind, loadText, saveText, STALE_INDEX } from './indexstore';
import { AUDIO_ID, audioEntry, concat, esdsFor, fragment, initSegment, rawBox, Sample, VIDEO_ID, videoEntry } from '../lib/mp4box';
import { Probe } from '../lib/probe';
import { Cue } from '../lib/vtt';
import { str, ebmlId, ebmlSize, ebmlUint, ac3Info, aacRate, Mkv, MkvTrack, mpaInfo, readMkvHeader, readCues, hevcCodec } from './mkvparse';
import { StartWatch } from './startwatch';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
const AHEAD = 40; // segundos bajados por adelantado
const FIRST_READ = 1048576; // primer pedido de los Cluster (arranque rápido)
const READ = 4194304; // los siguientes
const CHUNK = 3; // segundos de video por entrega (el primero, 1,5)
const VSCALE = 90000;
const SHIFT = 0.2; // margen para los cuadros B (todo el video y el audio van corridos lo mismo)

type VFrame = { pts: number; key: boolean; data: Uint8Array };
type AFrame = { t: number; data: Uint8Array };

const ID_CLUSTER = 0x1f43b675;
const ID_SEGMENT = 0x18538067;
const ID_TIMECODE = 0xe7;
const ID_SIMPLE = 0xa3;
const ID_GROUP = 0xa0;
const ID_BLOCK = 0xa1;
const ID_REF = 0xfb;

type AInfo = { codec: string; entry: Uint8Array; rate: number; channels: number; frameLen: number };
// datos del audio ya averiguados por pista (para AC-3 / E-AC-3 / MP3 hay que leer su primer cuadro del archivo): van
// con la cabecera guardada
type MkvX = Mkv & { ainfo?: Record<number, AInfo> };

// Cabecera, índice (Cues) y datos de audio del MKV como texto para guardar en el equipo (indexstore.ts): al continuar
// el video se pide directo el Cluster del segundo guardado, sin leer otra vez la cabecera ni el índice (2.0.14)
function packMkv(m: MkvX): string {
  return JSON.stringify({
    v: 1, scale: m.scale, duration: m.duration, segStart: m.segStart, firstCluster: m.firstCluster, cuesPos: m.cuesPos, vnum: m.vnum,
    tracks: m.tracks.map(x => ({ ...x, priv: x.priv ? b64(x.priv) : '' })),
    ct: m.cues ? m.cues.map(c => Math.round(c.t * 1000)) : null,
    cp: m.cues ? m.cues.map(c => c.pos) : null,
    ai: Object.entries(m.ainfo || {}).map(([num, a]) => ({ num: Number(num), codec: a.codec, entry: b64(a.entry), rate: a.rate, channels: a.channels, frameLen: a.frameLen })),
  });
}

function unpackMkv(text: string): MkvX | null {
  try {
    const j = JSON.parse(text);
    if (!j || j.v !== 1 || !Array.isArray(j.tracks) || !(j.firstCluster > 0)) return null;
    const ainfo: Record<number, AInfo> = {};
    for (const a of j.ai || []) ainfo[a.num] = { codec: a.codec, entry: fromBase64(a.entry), rate: a.rate, channels: a.channels, frameLen: a.frameLen };
    return {
      scale: j.scale, duration: j.duration, segStart: j.segStart, firstCluster: j.firstCluster, cuesPos: j.cuesPos, vnum: j.vnum,
      tracks: j.tracks.map((x: any) => ({ ...x, priv: x.priv ? fromBase64(x.priv) : null })),
      cues: Array.isArray(j.ct) && Array.isArray(j.cp) ? j.ct.map((t: number, i: number) => ({ t: t / 1000, pos: j.cp[i] })) : null,
      ainfo,
    };
  } catch {
    return null;
  }
}

// cabeceras de los últimos MKV abiertos o leídos por adelantado desde la ficha (warm.ts)
const fileKey = (u: string) => u.replace(/^https?:\/\//i, '');
const MKV_CACHE = new Map<string, { m: MkvX; size: number }>();
type MkvPre = { p: Promise<MkvX | null>; stop: () => void; size: () => number; claimed: boolean };
const MKV_PRE = new Map<string, MkvPre>();
function rememberMkv(url: string, m: MkvX, size: number): void {
  const k = fileKey(url);
  MKV_CACHE.delete(k);
  MKV_CACHE.set(k, { m, size });
  while (MKV_CACHE.size > 3) MKV_CACHE.delete(MKV_CACHE.keys().next().value as string);
}

// ¿ya se tiene (o se está leyendo) la cabecera de este archivo como MKV?
export function mkvKnown(url: string): boolean {
  const k = fileKey(url);
  return MKV_CACHE.has(k) || MKV_PRE.has(k) || hasIndexKind(url, 'k');
}

// lo que la ficha estaba leyendo de este MKV se corta (el video lo abre el reproductor nativo)
export function dropMkvWarm(url: string): void {
  MKV_PRE.get(fileKey(url))?.stop();
}

// Lee la cabecera y el índice de un MKV sin abrirlo (y los guarda en el equipo)
export function preloadMkv(url: string): { stop: () => void; done: Promise<string> } {
  const k = fileKey(url);
  if (MKV_CACHE.has(k) || hasIndexKind(url, 'k')) return { stop: () => {}, done: Promise.resolve('ok') };
  const old = MKV_PRE.get(k);
  if (old) return { stop: old.stop, done: old.p.then(m => (m ? 'ok' : '')) };
  const r = new MkvMse(null as unknown as VideoPlayer, url);
  const p = r.indexOnly();
  const pre: MkvPre = { p, size: () => r.fileSize(), claimed: false, stop: () => { if (!pre.claimed) r.destroy(); } };
  MKV_PRE.set(k, pre);
  p.then(() => MKV_PRE.get(k) === pre && MKV_PRE.delete(k), () => MKV_PRE.delete(k));
  return { stop: pre.stop, done: p.then(m => (m ? 'ok' : '')) };
}

export class MkvMse {
  tracks: { lang: string; codec: string }[] = [];
  audioIdx = -1;
  onTracks: () => void = () => {};
  // las pistas apenas se lee la cabecera (el menú de idiomas sin esperar al reproductor)
  onHeader: () => void = () => {};
  // índice Cues pedido mientras se abre el reproductor (Continuar viendo)
  private cuesP: Promise<unknown> | null = null;
  // la cabecera ya leída (se reusa al cambiar de idioma o al volver a abrir)
  index: MkvX | null = null;
  why = '';
  // descarga adelantada de los Cluster (readahead.ts): varias ventanas a la vez, por delante de lo que se ve
  private ra: ReadAhead;
  // la cabecera salió de lo guardado en el equipo: tamaño del archivo cuando se guardó
  private packed = false;
  private packSize = 0;
  noAudio = false;
  onError: () => void = () => {};
  // video que el equipo no decodifica (Vega no avisa el error)
  private sw = new StartWatch();
  private ms: any = null;
  private objectUrl = '';
  private requests = new Set<AbortController>();
  // pedidos al servidor: cierre de conexión, servidor que ignora el final del Range, tamaño y motivo (rangeget.ts)
  private rs: RangeState = { close: false, unbounded: false, size: 0, why: '' };
  private sb: any = null;
  private vt: MkvTrack | null = null;
  private at: MkvTrack | null = null;
  private arate = 0;
  private aFrameLen = 1024;
  private seq = 1;
  private gen = 0;
  private alive = true;
  private running = false;
  private watch: ReturnType<typeof setInterval> | null = null;
  private lastT = -1;
  private lastMove = Date.now();
  // lectura: buf empieza en el byte bufOff del archivo; pos = próximo elemento a leer
  private buf = new Uint8Array(0);
  private bufOff = 0;
  private pos = 0;
  private eof = false;
  private clusterTc = 0;
  private vq: VFrame[] = [];
  private aq: AFrame[] = [];
  private aNext = -1;
  private needKey = true;
  private startAt = 0; // segundo desde el que se arma (después de un salto)
  private firstOut = true;
  private size = 0;
  // el primer tramo de los Cluster ya leído al buscar la cabecera del audio: el video empieza con él, sin pedirlo otra vez
  private pre: { off: number; data: Uint8Array } | null = null;

  constructor(private v: VideoPlayer, private url: string, private selectedAudio = -1, index: Mkv | null = null, private wantLang = '') {
    this.index = index;
    this.ra = new ReadAhead(url, this.rs, () => (this.size > 0 && this.index && this.index.duration > 1 ? this.size / this.index.duration : 0));
  }

  // subtítulos de texto del archivo (SRT, ASS, WebVTT) por pista: se juntan mientras se lee el video, sin servidor
  private subMap(): Map<number, Cue[]> {
    const m = this.index!;
    if (!m.subs) m.subs = new Map();
    return m.subs;
  }

  // subtítulos de texto de la pista N (orden de las pistas de subtítulos, como el panel: 0:s:N); null = de imagen u
  // otro formato (los prepara el servidor). La lista crece mientras se lee el video
  subCues(n: number): Cue[] | null {
    const st = (this.index?.tracks || []).filter(x => x.type === 17)[n];
    if (!st || st.compressed || !/^S_TEXT\//.test(st.codec)) return null;
    let list = this.subMap().get(st.num);
    if (!list) this.subMap().set(st.num, (list = []));
    return list;
  }

  // ya leyó la cabecera y armó el video (si no, Player no le da más tiempo)
  get indexed(): boolean {
    return !!this.vt;
  }

  // pistas como las lee probe.ts (el panel usa el mismo orden: 0:a:N y 0:s:N), para el menú y los subtítulos
  probe(): Probe | null {
    const m = this.index;
    if (!m) return null;
    const one = (x: MkvTrack, i: number) => ({ id: String(i), lang: x.lang, codec: x.codec, name: x.name, def: x.def, forced: x.forced });
    return { ok: true, headOk: true, container: 'mkv', audio: m.tracks.filter(x => x.type === 2).map(one), subs: m.tracks.filter(x => x.type === 17).map(one) };
  }

  // '' = empezó; si no, el motivo (Playback sigue con el modo directo de siempre)
  async start(at: number): Promise<string> {
    // ¿hay puente con caché en la VPS / VDS? (antes del primer pedido)
    if (!this.index) await bridgeAsk(this.url);
    if (!this.alive) return '';
    let m: MkvX | null = this.index;
    const hit = m ? null : MKV_CACHE.get(fileKey(this.url));
    if (hit) {
      m = hit.m;
      if (!this.size) this.size = hit.size;
    }
    // la ficha ya la estaba leyendo: se espera ese mismo pedido
    const pre = m ? null : MKV_PRE.get(fileKey(this.url));
    if (pre) {
      pre.claimed = true;
      m = await pre.p;
      if (!this.alive) return '';
      if (m) this.size = pre.size();
    }
    // la cabecera y el índice guardados en el equipo (Continuar viendo, volver a abrir): sin pedirlos al servidor
    if (!m) {
      const pk = await loadText(this.url, 'k');
      if (!this.alive) return '';
      const got = pk ? unpackMkv(pk.text) : null;
      if (pk && got) {
        m = got;
        this.packed = true;
        this.packSize = pk.size;
        this.size = pk.size;
      }
    }
    if (!m) m = await readMkvHeader((o, l) => this.get(o, l));
    if (!m) return 'cabecera: ' + (this.why || 'no se pudo leer');
    if (!this.alive) return '';
    this.index = m;
    rememberMkv(this.url, m, this.size);
    // Continuar viendo con el índice ya sabido: el Cluster del segundo pedido se pide ya, mientras se abre el reproductor
    if (at > 0.5 && m.cues) {
      const from = this.cueFor(at);
      if (from > 0) this.ra.seek(from, 524288);
    } else if (at <= 0.5 && (this.packed || hit || pre)) {
      // desde el principio con la cabecera ya sabida (Player no pidió nada por adelantado): el primer Cluster ya
      this.ra.seek(m.firstCluster, 524288);
    }
    const vt = m.tracks.find(x => x.type === 1) || null;
    const auds = m.tracks.filter(x => x.type === 2);
    this.tracks = auds.map(x => ({ lang: x.lang, codec: x.codec }));
    this.onHeader();
    // Continuar viendo: el índice (al final del archivo) se pide ya, mientras se abre el reproductor
    if (at > 0.5 && !m.cues && m.cuesPos > 0) this.cuesP = readCues((o, l) => this.get(o, l), m).then(c => (m.cues = c));
    if (!vt) return 'sin video';
    if (vt.compressed) return 'video con compresión de cabecera';
    const ve = videoOf(vt);
    if (!ve) return 'códec v=' + vt.codec;
    // audio: el elegido, si no el predeterminado; el que el equipo no acepta se prueba con los demás y si ninguno, solo video
    // sin pista elegida a mano, el idioma guardado para el título
    const byLang = this.selectedAudio < 0 && this.wantLang ? auds.find(x => sameLang(x.lang, this.wantLang)) : undefined;
    const pick = auds[this.selectedAudio] || byLang || auds.find(x => x.def) || auds[0] || null;
    const order = pick ? [pick, ...auds.filter(x => x !== pick)] : [];
    this.vt = vt;
    this.startAt = Math.max(0, at);
    if (!this.alive) return '';
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
    if (ms.readyState !== 'open') return 'MSE sin abrir';
    // el primer cuadro del audio (para AC-3 / E-AC-3 / MP3 hace falta su cabecera): se lee del primer Cluster
    let init: Uint8Array | null = null;
    for (const a of order) {
      const ae = await this.audioOf(a);
      if (!this.alive) return '';
      if (!ae) continue;
      try {
        this.sb = ms.addSourceBuffer('video/mp4; codecs="' + ve.codec + ',' + ae.codec + '"');
      } catch {
        continue;
      }
      // solo el elegido por el usuario: si es otro el que suena, el menú lo muestra
      this.at = a;
      this.arate = ae.rate;
      this.aFrameLen = ae.frameLen;
      init = initSegment({ sps: new Uint8Array(4), pps: new Uint8Array(0), width: vt.width, height: vt.height }, { config: new Uint8Array(2), channels: ae.channels, rate: ae.rate }, ae.entry, VSCALE, ve.entry);
      break;
    }
    if (!this.sb) {
      try {
        this.sb = ms.addSourceBuffer('video/mp4; codecs="' + ve.codec + '"');
      } catch (e: any) {
        return 'MSE video/mp4 ' + ve.codec + ': ' + String(e?.message || e).slice(0, 60);
      }
      this.noAudio = auds.length > 0;
      init = initSegment({ sps: new Uint8Array(4), pps: new Uint8Array(0), width: vt.width, height: vt.height }, null, undefined, VSCALE, ve.entry);
    }
    this.audioIdx = this.at ? auds.indexOf(this.at) : pick ? auds.indexOf(pick) : -1;
    try {
      if (m.duration > 0) ms.duration = m.duration + SHIFT;
    } catch {
      // sin duración
    }
    if (!(await this.append(init!))) return 'inicio no aceptado: ' + this.why;
    await this.place(this.startAt);
    if (this.startAt > 0) this.v.currentTime = this.startAt + SHIFT;
    this.pump();
    this.watch = setInterval(() => this.alive && this.unstick(), 300);
    this.v.play();
    this.onTracks();
    this.keepIndex();
    return '';
  }

  // solo la cabecera y el índice, sin abrir el video (preloadMkv): quedan en memoria y en el equipo
  async indexOnly(): Promise<MkvX | null> {
    await bridgeAsk(this.url);
    if (!this.alive) return null;
    const m: MkvX | null = await readMkvHeader((o, l) => this.get(o, l));
    if (!m || !this.alive) return null;
    if (!m.cues && m.cuesPos > 0) {
      try {
        m.cues = await readCues((o, l) => this.get(o, l), m);
      } catch {
        // sin índice
      }
    }
    if (!this.alive) return null;
    rememberMkv(this.url, m, this.size);
    if (this.size > 0) saveText(this.url, 'k', this.size, () => packMkv(m));
    return m;
  }

  fileSize(): number {
    return this.size;
  }

  // para el aviso de apertura lenta (como el lector de MP4)
  diag(): string {
    const n = this.rs.reqs || 0;
    return '[archivo=' + Math.round(this.size / 1048576) + 'MB cabecera_guardada=' + this.packed + ' indice=' + (this.index?.cues ? this.index.cues.length : 'no') + ' ' + this.ra.diag() + ' pedidos=' + n + (this.rs.bridge ? ' puente=' + this.rs.bridge : '') + (n ? ' espera_media=' + Math.round((this.rs.waitMs || 0) / n) + 'ms' : '') + (this.why ? ' motivo=' + this.why : '') + ']';
  }

  // posición del Cluster del índice en o antes de t (0 = sin índice)
  private cueFor(t: number): number {
    const cues = this.index?.cues || [];
    let best = -1;
    for (let i = 0; i < cues.length; i++) if (cues[i].t <= t + 0.01 && (best < 0 || cues[i].t >= cues[best].t)) best = i;
    return best >= 0 ? cues[best].pos : 0;
  }

  // Cabecera e índice al equipo cuando el video ya lleva unos segundos abierto. El índice (Cues, al final del archivo)
  // se lee antes si todavía no se leyó (desde el principio no hace falta para ver, pero sí para continuar después sin
  // pedirlo); con líneas de una sola conexión no se pide (cortaría el video): se guarda la cabecera sola
  private keepIndex(): void {
    if (this.packed && this.index?.cues) return;
    setTimeout(async () => {
      const m = this.index;
      if (!this.alive || !m || !this.size) return;
      if (!m.cues && m.cuesPos > 0 && !this.ra.single) {
        this.ra.hold = true;
        try {
          m.cues = await readCues((o, l) => this.get(o, l), m);
        } catch {
          // sin índice: se sigue igual
        }
        this.ra.hold = false;
        if (!this.alive) return;
      }
      try {
        saveText(this.url, 'k', this.size, () => packMkv(m));
      } catch {
        // cabecera rara: no se guarda
      }
    }, 10000);
  }

  destroy(): void {
    this.alive = false;
    this.gen++;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.ra.stop();
    if (this.watch) clearInterval(this.watch);
    this.watch = null;
    try {
      if (this.sb?.updating) this.sb.abort();
    } catch {
      // ya cerrado
    }
    if (this.objectUrl) {
      try { (URL as any).revokeObjectURL?.(this.objectUrl); } catch { /* API opcional en Vega */ }
      this.objectUrl = '';
    }
  }

  // tiempo del archivo (sin el margen de los cuadros B)
  timeOf(current: number): number {
    return Math.max(0, current - SHIFT);
  }

  // ◀▶ o un salto: lo ya bajado al momento; si no, desde el Cluster del índice anterior a t
  async seekTo(t: number): Promise<void> {
    if (!this.sb || !this.vt) return;
    if (this.isBuffered(t + SHIFT)) {
      this.v.currentTime = t + SHIFT;
      return;
    }
    this.gen++;
    for (const request of this.requests) request.abort();
    // lo que venía en camino ya no sirve (la próxima lectura empieza en el lugar nuevo)
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
      // se sigue igual
    }
    await this.place(t);
    this.v.currentTime = t + SHIFT;
    if (!this.running) this.pump();
  }

  // empieza a leer en el Cluster del índice en o antes de t (sin índice: por proporción del archivo)
  private async place(t: number): Promise<void> {
    const m = this.index!;
    this.vq = [];
    this.aq = [];
    this.aNext = -1;
    this.needKey = true;
    this.startAt = t;
    this.firstOut = true;
    this.eof = false;
    this.buf = new Uint8Array(0);
    let at = m.firstCluster;
    if (t > 0.5) {
      if (!m.cues && this.cuesP) await this.cuesP.catch(() => null);
      if (!m.cues && m.cuesPos > 0) m.cues = await readCues((o, l) => this.get(o, l), m);
      const cue = this.cueFor(t);
      if (cue > 0) at = cue;
      else if (m.duration > 0 && this.size > 0) at = Math.max(m.firstCluster, Math.floor((t / m.duration) * this.size) - 2097152);
    }
    this.pos = this.bufOff = at;
    if (this.pre && this.pre.off === at) {
      this.buf = this.pre.data;
      this.pre = null;
    }
  }

  private async audioOf(a: MkvTrack): Promise<AInfo | null> {
    const m = this.index!;
    // ya averiguado (va con la cabecera guardada en el equipo): sin leer el primer Cluster otra vez
    const known = m.ainfo?.[a.num];
    if (known) return known;
    const got = await this.audioRead(a);
    if (got) (m.ainfo = m.ainfo || {})[a.num] = got;
    return got;
  }

  private async audioRead(a: MkvTrack): Promise<AInfo | null> {
    if (a.compressed) return null;
    const c = a.codec;
    if (c.startsWith('A_AAC')) {
      let cfg = a.priv;
      if (!cfg || cfg.length < 2) cfg = aacConfig(c, a.rate || 48000, a.channels || 2);
      const r = aacRate(cfg);
      return { codec: 'mp4a.40.' + Math.max(1, cfg[0] >> 3), entry: audioEntry('mp4a', a.channels || 2, r.rate, esdsFor(0x40, cfg)), rate: r.rate, channels: a.channels || 2, frameLen: 1024 };
    }
    if (c === 'A_AC3' || c === 'A_EAC3' || c === 'A_MPEG/L3' || c === 'A_MPEG/L2') {
      const f = await this.firstAudioFrame(a.num);
      if (!f) return null;
      if (c === 'A_MPEG/L3' || c === 'A_MPEG/L2') {
        const i = mpaInfo(f);
        if (!i) return null;
        return { codec: 'mp4a.6B', entry: audioEntry('mp4a', i.channels, i.rate, esdsFor(0x6b, null)), rate: i.rate, channels: i.channels, frameLen: i.samples };
      }
      const i = ac3Info(f);
      if (!i) return null;
      return { codec: c === 'A_AC3' ? 'ac-3' : 'ec-3', entry: audioEntry(c === 'A_AC3' ? 'ac-3' : 'ec-3', i.channels, i.rate, rawBox(c === 'A_AC3' ? 'dac3' : 'dec3', i.box)), rate: i.rate, channels: i.channels, frameLen: i.samples };
    }
    // DTS, TrueHD, Opus, FLAC, Vorbis: el equipo no los toma por MSE (los prepara el servidor)
    return null;
  }

  // primer cuadro de una pista (para leer la cabecera AC-3 / MP3): se buscan los bloques del primer Cluster
  private async firstAudioFrame(num: number): Promise<Uint8Array | null> {
    const m = this.index!;
    // de a un pedido: primero termina el índice (Continuar viendo), por las líneas de una sola conexión
    if (this.cuesP) await this.cuesP.catch(() => null);
    const data = this.pre?.off === m.firstCluster ? this.pre.data : await this.get(m.firstCluster, 1048576);
    if (!data) return null;
    this.pre = { off: m.firstCluster, data };
    let p = 0;
    let n = 0;
    while (p < data.length - 12 && n++ < 4000) {
      const id = ebmlId(data, p);
      if (!id) return null;
      const sz = ebmlSize(data, p + id.len);
      if (!sz) return null;
      const body = p + id.len + sz.len;
      if (id.id === ID_CLUSTER || id.id === ID_GROUP) {
        p = body;
        continue;
      }
      if (id.id === ID_SIMPLE || id.id === ID_BLOCK) {
        if (body + sz.size > data.length) return null;
        const b = parseBlock(data.subarray(body, body + sz.size));
        if (b && b.track === num && b.frames[0]?.length) return b.frames[0];
      }
      if (sz.size < 0) return null;
      p = body + sz.size;
    }
    return null;
  }

  // el servidor sigue entregando (hay pedidos en curso o llegó algo hace poco): vale la pena esperar
  busy(): boolean {
    return this.requests.size > 0 || this.ra.active > 0 || Date.now() - (this.rs.lastData || 0) < 10000;
  }

  // [off, off + len) del archivo; partial: vale lo que haya desde off en lo ya pedido al abrir (ensure junta el resto)
  private async get(off: number, len: number, partial = false): Promise<Uint8Array | null> {
    const g = this.gen;
    const pre = partial ? takeRangeFrom(this.url, off, len) : null;
    const got = pre ? await pre : null;
    if (got) {
      if (got.size > 0) this.size = this.rs.size = got.size;
      return got.data;
    }
    const d = await rangeGet(this.url, off, len, this.rs, this.requests, () => this.alive && g === this.gen);
    if (this.rs.size > 0) this.size = this.rs.size;
    if (!d) this.why = this.rs.why || this.why;
    return d;
  }

  // que haya n bytes desde pos (lee más del archivo)
  private async ensure(n: number): Promise<boolean> {
    for (;;) {
      // se saltó un elemento más allá de lo leído: se empieza a leer ahí
      if (this.pos > this.bufOff + this.buf.length) {
        this.buf = new Uint8Array(0);
        this.bufOff = this.pos;
      }
      if (this.bufOff + this.buf.length >= this.pos + n) return true;
      if (this.eof) return false;
      const from = this.bufOff + this.buf.length;
      if (this.size > 0 && from >= this.size) {
        this.eof = true;
        return false;
      }
      const g = this.gen;
      // lo pedido al abrir (Player, desde el principio) o la descarga adelantada. De a tramos de ~1,5 s el primero y ~4 s
      // los siguientes (antes siempre 1 y 4 MB: con un video liviano eso eran 30 s y había que esperarlos enteros)
      const bps = this.size > 0 && this.index && this.index.duration > 1 ? this.size / this.index.duration : 0;
      const want = this.firstOut ? Math.max(262144, Math.min(FIRST_READ, Math.round(bps * 1.5) || FIRST_READ)) : Math.max(524288, Math.min(READ, Math.round(bps * 4) || READ));
      const pre = takeRangeFrom(this.url, from, want);
      const early = pre ? await pre : null;
      if (early && early.size > 0) this.size = this.rs.size = early.size;
      const d = early ? early.data : await this.ra.read(from, want);
      if (this.rs.size > 0) this.size = this.rs.size;
      if (!d && !early) this.why = this.ra.why || this.rs.why || this.why;
      if (g !== this.gen || !this.alive) return false;
      // lo guardado en el equipo era de otro archivo (el servidor lo cambió: otro tamaño)
      if (this.packed && this.rs.size > 0 && this.rs.size !== this.packSize) {
        dropIndex(this.url);
        this.index = null;
        throw new Error(STALE_INDEX);
      }
      if (!d) {
        if (this.size > 0 && from >= this.size - 1) this.eof = true;
        else throw new Error(this.why || 'bajada');
        return false;
      }
      if (!d.length) {
        this.eof = true;
        return false;
      }
      // se suelta lo ya leído
      const keep = Math.max(0, this.pos - this.bufOff);
      const rest = this.buf.subarray(keep);
      this.buf = concat([rest, d]);
      this.bufOff += keep;
      if (d.length < want) this.eof = this.size > 0 ? from + d.length >= this.size : true;
    }
  }

  // lee elementos hasta tener algo que entregar (o el final)
  private async readSome(): Promise<void> {
    const g = this.gen;
    for (let n = 0; n < 2000 && g === this.gen && this.alive; n++) {
      if (!(await this.ensure(12))) {
        this.eof = true;
        return;
      }
      const o = this.pos - this.bufOff;
      const id = ebmlId(this.buf, o);
      const sz = id ? ebmlSize(this.buf, o + id.len) : null;
      if (!id || !sz) {
        // basura (salto por proporción): se busca el próximo Cluster
        if (!this.resync()) this.pos += Math.max(1, this.buf.length - (this.pos - this.bufOff) - 4);
        continue;
      }
      const head = id.len + sz.len;
      // se entra en el Segment, el Cluster y el BlockGroup; el resto se salta entero
      if (id.id === ID_SEGMENT || id.id === ID_CLUSTER) {
        this.pos += head;
        continue;
      }
      if (sz.size < 0) {
        this.pos += head;
        continue;
      }
      if (id.id === ID_TIMECODE || id.id === ID_SIMPLE || id.id === ID_GROUP) {
        if (!(await this.ensure(head + sz.size))) return;
        if (g !== this.gen) return;
        const at = this.pos - this.bufOff + head;
        const body = this.buf.subarray(at, at + sz.size);
        this.pos += head + sz.size;
        if (id.id === ID_TIMECODE) this.clusterTc = ebmlUint(body);
        else this.onBlock(id.id === ID_SIMPLE ? body : groupBlock(body), id.id === ID_SIMPLE ? null : body);
        if (this.ready()) return;
        continue;
      }
      this.pos += head + sz.size;
    }
  }

  // busca la marca de un Cluster en lo que hay leído
  private resync(): boolean {
    const b = this.buf;
    for (let i = this.pos - this.bufOff + 1; i + 4 <= b.length; i++) {
      if (b[i] === 0x1f && b[i + 1] === 0x43 && b[i + 2] === 0xb6 && b[i + 3] === 0x75) {
        this.pos = this.bufOff + i;
        return true;
      }
    }
    return false;
  }

  private onBlock(block: Uint8Array | null, group: Uint8Array | null): void {
    if (!block) return;
    const b = parseBlock(block);
    if (!b) return;
    const m = this.index!;
    const t0 = ((this.clusterTc + b.rel) * m.scale) / 1e9;
    if (this.vt && b.track === this.vt.num) {
      const key = group ? !hasRef(group) : b.key;
      if (this.needKey) {
        if (!key) return;
        this.needKey = false;
      }
      for (const f of b.frames) this.vq.push({ pts: t0, key, data: f });
      return;
    }
    if (this.at && b.track === this.at.num) {
      let t = t0;
      for (const f of b.frames) {
        this.aq.push({ t, data: f });
        t += this.aFrameLen / this.arate;
      }
      return;
    }
    const list = this.subMap().get(b.track) || this.textTrack(b.track);
    if (list) {
      const d = group ? groupDuration(group) : -1;
      const text = subText(str(b.frames[0] || new Uint8Array(0)), this.index!.tracks.find(x => x.num === b.track)!.codec);
      if (!text) return;
      const cue = { s: t0, e: t0 + (d > 0 ? (d * m.scale) / 1e9 : 4), text };
      // en orden y sin repetir (después de un salto se vuelve a leer lo mismo)
      let i = list.length;
      while (i > 0 && list[i - 1].s > cue.s) i--;
      if (i > 0 && list[i - 1].s === cue.s && list[i - 1].text === cue.text) return;
      list.splice(i, 0, cue);
    }
  }

  // lista de una pista de subtítulos de texto (se crea al primer bloque)
  private textTrack(num: number): Cue[] | null {
    const st = this.index?.tracks.find(x => x.num === num);
    if (!st || st.type !== 17 || st.compressed || !/^S_TEXT\//.test(st.codec)) return null;
    const list: Cue[] = [];
    this.subMap().set(num, list);
    return list;
  }

  // hay video para una entrega (o se terminó el archivo)
  private ready(): boolean {
    if (this.vq.length < 2) return false;
    const need = this.firstOut ? 1.5 : CHUNK;
    return this.vq[this.vq.length - 1].pts - this.vq[0].pts >= need + 0.5;
  }

  // corte donde todo lo anterior se muestra antes que todo lo siguiente (no parte un grupo de cuadros B)
  private cutAt(): number {
    const q = this.vq;
    const need = this.firstOut ? 1.5 : CHUNK;
    const minAfter: number[] = new Array(q.length + 1);
    minAfter[q.length] = Infinity;
    for (let i = q.length - 1; i >= 0; i--) minAfter[i] = Math.min(q[i].pts, minAfter[i + 1]);
    let maxBefore = -Infinity;
    for (let j = 1; j <= q.length; j++) {
      maxBefore = Math.max(maxBefore, q[j - 1].pts);
      if (j === q.length) return this.eof ? j : -1;
      // 4 cuadros de margen después del corte (los cuadros B de lo que sigue)
      if (q.length - j < 4 && !this.eof) return -1;
      if (q[j - 1].pts - q[0].pts >= need && maxBefore < minAfter[j]) return j;
    }
    return -1;
  }

  // arma la entrega: video [0, j) y el audio hasta donde termina ese video
  private build(j: number): Uint8Array {
    const vs = this.vq.splice(0, j);
    const rest = this.vq.length ? Math.min(...this.vq.slice(0, 16).map(f => f.pts)) : -1;
    const sorted = vs.map(f => f.pts).sort((a, b) => a - b);
    const fd = sorted.length > 1 ? (sorted[sorted.length - 1] - sorted[0]) / (sorted.length - 1) : 0.04;
    const u = (s: number) => Math.round(s * VSCALE);
    const samples: Sample[] = [];
    for (let i = 0; i < vs.length; i++) {
      const dts = u(sorted[i]);
      const nextDts = i + 1 < vs.length ? u(sorted[i + 1]) : rest >= 0 ? u(rest) : dts + u(fd || 0.04);
      samples.push({ size: vs[i].data.length, duration: Math.max(1, nextDts - dts), cts: Math.max(0, u(vs[i].pts + SHIFT) - dts), key: vs[i].key });
    }
    const out: Uint8Array[] = [fragment(this.seq++, VIDEO_ID, u(sorted[0]), samples, concat(vs.map(f => f.data)))];
    const vEnd = rest >= 0 ? rest : sorted[sorted.length - 1] + fd;
    // audio hasta el final de este video (desde el primer cuadro del video después de un salto)
    if (this.at) {
      let k = 0;
      // al final del archivo va todo lo que queda
      while (k < this.aq.length && (this.aq[k].t < vEnd || (this.eof && !this.vq.length))) k++;
      let as = this.aq.splice(0, k);
      if (this.aNext < 0) as = as.filter(f => f.t >= sorted[0] - 0.05);
      out.push(...this.audioFrags(as));
    }
    this.firstOut = false;
    return concat(out);
  }

  // cuadros de audio seguidos (sin huecos de redondeo de los milisegundos del MKV); un salto real empieza otro fragmento
  private audioFrags(fr: AFrame[]): Uint8Array[] {
    const out: Uint8Array[] = [];
    let run: AFrame[] = [];
    let base = -1;
    const flush = () => {
      if (!run.length) return;
      const samples = run.map(f => ({ size: f.data.length, duration: this.aFrameLen, cts: 0, key: true }));
      out.push(fragment(this.seq++, AUDIO_ID, base, samples, concat(run.map(f => f.data))));
      this.aNext = base + run.length * this.aFrameLen;
      run = [];
    };
    for (const f of fr) {
      const t = Math.round((f.t + SHIFT) * this.arate);
      const expect = run.length ? base + run.length * this.aFrameLen : this.aNext;
      if (expect >= 0 && Math.abs(t - expect) <= this.arate * 0.08) {
        if (!run.length) base = expect;
      } else {
        flush();
        base = t;
      }
      run.push(f);
    }
    flush();
    return out;
  }

  private async pump(): Promise<void> {
    this.running = true;
    try {
      while (this.alive) {
        const g = this.gen;
        if (this.bufEnd() - (this.v.currentTime || 0) > AHEAD) {
          await sleep(1000);
          continue;
        }
        try {
          await this.readSome();
        } catch (e: any) {
          if (g !== this.gen) continue;
          this.why = 'bajada: ' + String(e?.message || e).slice(0, 60);
          this.onError();
          return;
        }
        if (g !== this.gen || !this.alive) continue;
        let j = this.cutAt();
        if (j < 0 && this.eof) j = this.vq.length;
        if (j > 0) {
          const data = this.build(j);
          await this.trim();
          if (g !== this.gen) continue;
          if (!(await this.append(data))) {
            this.onError();
            return;
          }
        }
        if (this.eof && !this.vq.length) {
          await this.idle();
          try {
            if (this.ms.readyState === 'open') this.ms.endOfStream();
          } catch {
            // ya terminado
          }
          return;
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async idle(): Promise<void> {
    for (let i = 0; i < 100 && this.sb?.updating; i++) await sleep(50);
  }

  private async append(data: Uint8Array): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.idle();
      try {
        this.sb.appendBuffer(data);
        await this.idle();
        return true;
      } catch (e: any) {
        this.why = 'append: ' + String(e?.message || e).slice(0, 60);
        // memoria llena: se borra lo ya visto y otra vez
        try {
          const t = this.v.currentTime || 0;
          if (t > 10) this.sb.remove(0, t - 5);
        } catch {
          return false;
        }
      }
    }
    return false;
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

  // como mp4mse.ts: salta al tramo con datos si el reproductor se queda quieto al principio o en un hueco
  private unstick(): void {
    try {
      const b = this.sb.buffered;
      const t = this.v.currentTime || 0;
      if (this.sw.stuck(t, this.bufEnd() - t, this.v.paused)) {
        this.why = 'con video bajado y sin imagen en 8 s (el equipo no decodifica este video)';
        this.onError();
        return;
      }
      if (t !== this.lastT) {
        this.lastT = t;
        this.lastMove = Date.now();
      }
      const still = this.v.paused ? 0 : Date.now() - this.lastMove;
      const stalled = still > 3000;
      for (let i = 0; i < b.length; i++) {
        const st = b.start(i);
        const en = b.end(i);
        const next = i + 1 < b.length ? b.start(i + 1) : -1;
        if (t < st - 0.05) {
          if (en - st > 0.5) this.jump(st + 0.02);
          return;
        }
        if (t <= en) {
          if (next > 0 && ((en - t < 0.3 && still > 1000) || stalled)) this.jump(next + 0.02);
          else if (stalled && en - t > 1) this.jump(t + 0.5);
          return;
        }
      }
    } catch {
      // sin datos todavía
    }
  }

  private jump(to: number): void {
    this.sw.moved(to);
    this.v.currentTime = to;
    this.lastMove = Date.now();
    if (this.v.paused) this.v.play();
  }
}

// descripción del video para MSE: H.264 (avcC tal cual) o H.265 (hvcC)
function videoOf(vt: MkvTrack): { codec: string; entry: Uint8Array } | null {
  const p = vt.priv;
  if (!p || p.length < 7) return null;
  if (vt.codec === 'V_MPEG4/ISO/AVC') {
    const h = (n: number) => (n < 16 ? '0' : '') + n.toString(16);
    return { codec: 'avc1.' + h(p[1]) + h(p[2]) + h(p[3]), entry: videoEntry('avc1', p, vt.width, vt.height) };
  }
  if (vt.codec === 'V_MPEGH/ISO/HEVC' && p.length >= 23) return { codec: hevcCodec(p), entry: videoEntry('hvc1', p, vt.width, vt.height) };
  return null;
}

// AudioSpecificConfig de un AAC sin CodecPrivate (A_AAC/MPEG4/LC…)
function aacConfig(codec: string, rate: number, channels: number): Uint8Array {
  const rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
  const sbr = /SBR/i.test(codec);
  const obj = /MAIN/i.test(codec) ? 1 : /SSR/i.test(codec) ? 3 : /LTP/i.test(codec) ? 4 : 2;
  let fi = rates.indexOf(sbr ? rate / 2 : rate);
  if (fi < 0) fi = 3;
  return new Uint8Array([(obj << 3) | (fi >> 1), ((fi & 1) << 7) | ((channels & 15) << 3)]);
}

// Block / SimpleBlock: pista, tiempo relativo, clave y los cuadros (con o sin lacing)
export function parseBlock(b: Uint8Array): { track: number; rel: number; key: boolean; frames: Uint8Array[] } | null {
  const tn = ebmlSize(b, 0);
  if (!tn || b.length < tn.len + 3) return null;
  let o = tn.len;
  let rel = (b[o] << 8) | b[o + 1];
  if (rel & 0x8000) rel -= 0x10000;
  const flags = b[o + 2];
  o += 3;
  const lacing = (flags >> 1) & 3;
  if (!lacing) return { track: tn.size, rel, key: (flags & 0x80) !== 0, frames: [b.subarray(o)] };
  const n = b[o++] + 1;
  const sizes: number[] = [];
  if (lacing === 1) {
    // Xiph
    for (let i = 0; i < n - 1; i++) {
      let s = 0;
      while (o < b.length) {
        const c = b[o++];
        s += c;
        if (c !== 255) break;
      }
      sizes.push(s);
    }
  } else if (lacing === 3) {
    // EBML
    const first = ebmlSize(b, o);
    if (!first) return null;
    o += first.len;
    sizes.push(first.size);
    for (let i = 1; i < n - 1; i++) {
      const d = ebmlSize(b, o);
      if (!d) return null;
      const bias = 2 ** (7 * d.len - 1) - 1;
      sizes.push(sizes[i - 1] + (d.raw - bias));
      o += d.len;
    }
  } else {
    // fijo
    const each = Math.floor((b.length - o) / n);
    for (let i = 0; i < n - 1; i++) sizes.push(each);
  }
  const frames: Uint8Array[] = [];
  for (const s of sizes) {
    if (s < 0 || o + s > b.length) return null;
    frames.push(b.subarray(o, o + s));
    o += s;
  }
  frames.push(b.subarray(o));
  return { track: tn.size, rel, key: (flags & 0x80) !== 0, frames };
}

// el Block dentro de un BlockGroup
function groupBlock(g: Uint8Array): Uint8Array | null {
  let p = 0;
  while (p < g.length) {
    const id = ebmlId(g, p);
    const sz = id ? ebmlSize(g, p + id.len) : null;
    if (!id || !sz || sz.size < 0) return null;
    const body = p + id.len + sz.len;
    if (id.id === ID_BLOCK) return g.subarray(body, body + sz.size);
    p = body + sz.size;
  }
  return null;
}

// BlockDuration de un BlockGroup (unidades de tiempo del archivo); -1 = no tiene
function groupDuration(g: Uint8Array): number {
  let p = 0;
  while (p < g.length) {
    const id = ebmlId(g, p);
    const sz = id ? ebmlSize(g, p + id.len) : null;
    if (!id || !sz || sz.size < 0) return -1;
    const body = p + id.len + sz.len;
    if (id.id === 0x9b) return ebmlUint(g.subarray(body, body + sz.size));
    p = body + sz.size;
  }
  return -1;
}

// texto de un bloque de subtítulos: SRT / WebVTT sin etiquetas; ASS / SSA solo el texto (el bloque trae «orden, capa,
// estilo, nombre, márgenes, efecto, texto») sin sus códigos {\...}
export function subText(raw: string, codec: string): string {
  let t = raw;
  if (/^S_TEXT\/(ASS|SSA)/.test(codec)) {
    const parts = t.split(',');
    t = parts.length >= 9 ? parts.slice(8).join(',') : t;
    t = t.replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ');
  }
  return t.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\r/g, '').trim();
}

// BlockGroup con ReferenceBlock = no es cuadro clave
function hasRef(g: Uint8Array): boolean {
  let p = 0;
  while (p < g.length) {
    const id = ebmlId(g, p);
    const sz = id ? ebmlSize(g, p + id.len) : null;
    if (!id || !sz || sz.size < 0) return false;
    if (id.id === ID_REF) return true;
    p += id.len + sz.len + sz.size;
  }
  return false;
}

