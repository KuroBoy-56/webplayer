// Fuente del video, audio y subtítulos del reproductor (misma lógica que PlayerTracks.brs de Roku).
// - Pistas que informa el reproductor de Vega (audioTracks / textTracks): se eligen ahí y se comprueba
//   que el cambio quedó; el búfer se vuelve a llenar en el mismo segundo para que se oiga enseguida.
// - Pistas leídas de la cabecera del MKV/MP4 (probe.ts): idioma y códec de cada una.
// - Audio que el equipo no puede cambiar o decodificar (DTS, TrueHD…): el motor del panel lo prepara
//   en AAC y llega como HLS desde el segundo actual (hls.ts). Subtítulos que el equipo no muestra:
//   el panel los convierte a WebVTT y se dibujan encima del video.
// - Sin permiso del motor (Sin permisos / No compatible): el texto del panel una vez por video y el
//   video sigue directo; nada automático pasa por el motor (estado guardado por línea en media.ts).
import { MediaSource, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { disableMp4, LiveHls } from './livehls';
import { Engine, engineDenied, fileTracks, knownNow, knownTracks, mediaEngine, subCheck, subText, hlsLink } from '../api/media';
import { t } from '../lib/i18n';
import { codecKey, codecName, imageSub, langKey, langName, numbered, sameLang, trackLang } from '../lib/lang';
import { Probe } from '../lib/probe';
import { pref, readJson, setPref, writeJson } from '../lib/storage';
import { Cue, cueAt, parseVtt } from '../lib/vtt';
import { PanelHls } from './hls';
import { reportError } from '../api/report';

export type MenuItem = { kind: 'audio' | 'text' | 'panel'; key: string; label: string; on: boolean };

type AudioItem = { key: string; label: string; lang: string; codec: string; native?: number; probe?: number };
type SubItem = { key: string; label: string; lang: string; image: boolean; native?: number; probe?: number };

export type Hooks = {
  toast: (msg: string) => void;
  status: (msg: string) => void;
  changed: () => void;
  subText: (text: string) => void;
  // no se puede seguir (el video directo falló y el panel tampoco pudo)
  fatal: (msg: string) => void;
  // el panel no pudo preparar el video que el equipo no abrió: el reproductor sigue con sus otros pasos
  panelFailed?: () => void;
  // Continuar viendo directo: no llegó al segundo guardado en 15 s (siguen los pasos: el panel desde ese segundo)
  resumeFailed?: () => void;
  // canal en vivo por HLS (lector propio) que no se pudo abrir o se cortó: el motivo, para el siguiente formato
  liveFailed?: (why: string) => void;
  // el canal se detuvo varias veces (sin datos a tiempo): el estado del lector para el reporte
  liveStalls?: (diag: string) => void;
};

const decodeCache: Record<string, boolean> = {};

// ¿el reproductor de Vega decodifica este audio? (consulta las capacidades del equipo)
export function nativeAudioOk(codec: string, container: string): boolean {
  const k = codecKey(codec);
  if (!k) return true;
  if (k === 'truehd') return false;
  // el lector de MKV del equipo no trae DTS
  if (container === 'mkv' && k === 'dts') return false;
  const mime: Record<string, string> = { aac: 'mp4a.40.2', ac3: 'ac-3', eac3: 'ec-3', dts: 'dtsc', mp3: 'mp3', opus: 'Opus', flac: 'fLaC' };
  if (!mime[k]) return true;
  if (!(k in decodeCache)) {
    try {
      decodeCache[k] = MediaSource.isTypeSupported('audio/mp4; codecs="' + mime[k] + '"');
    } catch {
      decodeCache[k] = true;
    }
  }
  return decodeCache[k];
}

function rememberLang(key: string, lang: string) {
  const k = langKey(lang);
  if (k === 'es' || k === 'en') setPref(key, k);
}

// Archivos que este equipo solo pudo ver por el panel ('p' = copia del panel, 'v' = video convertido): la próxima vez
// se abren de una por ahí, sin probar antes el directo (ahorra los intentos y el tiempo). 7 días, los 300 más recientes.
type Route = { r: 'p' | 'v'; t: number };
const ROUTE_KEY = 'panel_route';
const routeKey = (u: string) => u.replace(/^https?:\/\//i, '');
function panelRoute(url: string): 'p' | 'v' | '' {
  const e = (readJson<Record<string, Route>>(ROUTE_KEY) || {})[routeKey(url)];
  return e && Date.now() - e.t < 7 * 86400000 ? e.r : '';
}

// Idioma que el usuario eligió para ESTE título (menú de audio): se usa al volver a abrirlo (también «Continuar viendo»).
// Un título nuevo (o sin elegir nada) empieza siempre con su audio predeterminado, directo del servidor IPTV; el panel
// prepara otro idioma solo cuando el usuario lo elige. 180 días, los 400 más recientes. a = pista del archivo.
type TitleLang = { l: string; a: number; t: number };
const TLANG_KEY = 'title_audio';
function titleLang(url: string): TitleLang | null {
  const e = (readJson<Record<string, TitleLang>>(TLANG_KEY) || {})[routeKey(url)];
  return e && Date.now() - e.t < 180 * 86400000 ? e : null;
}
function setTitleLang(url: string, it: { lang: string; probe?: number } | null): void {
  const all = readJson<Record<string, TitleLang>>(TLANG_KEY) || {};
  const k = routeKey(url);
  if (!it) {
    if (!all[k]) return;
    delete all[k];
  } else {
    all[k] = { l: it.lang, a: it.probe ?? -1, t: Date.now() };
  }
  const keep = Object.entries(all).sort((x, y) => y[1].t - x[1].t).slice(0, 400);
  writeJson(TLANG_KEY, Object.fromEntries(keep));
}
function setPanelRoute(url: string, r: 'p' | 'v' | ''): void {
  const all = readJson<Record<string, Route>>(ROUTE_KEY) || {};
  const k = routeKey(url);
  if (!r) {
    if (!all[k]) return;
    delete all[k];
  } else {
    if (all[k]?.r === r) return;
    all[k] = { r, t: Date.now() };
    const ks = Object.keys(all);
    if (ks.length > 300) {
      ks.sort((a, b) => all[a].t - all[b].t);
      for (const x of ks.slice(0, ks.length - 300)) delete all[x];
    }
  }
  writeJson(ROUTE_KEY, all);
}

export class Playback {
  private url = '';
  private live = false;
  private gen = 0;
  private probe: Probe | null = null;
  private probing = false;
  private resumeAt = 0;
  private remux: { a: number; label: string } | null = null;
  private hls: PanelHls | null = null;
  private liveHls: LiveHls | null = null;
  // audio del canal elegido en el menú (canales con varios idiomas)
  private liveAudio = 0;
  // el HLS del panel que sigue sonando mientras se prepara otro idioma
  private prevHls: PanelHls | null = null;
  private offset = 0;
  // el HLS del panel ya suena (antes sigue el video directo mientras se prepara)
  private remuxLive = false;
  private remuxFrom = 0;
  private realDur = 0;
  private engine: Engine | null = null;
  private audioKey = '';
  private subKey = '';
  private audioApplied = false;
  private subApplied = false;
  private pendingNative = -1;
  private ext: { s: number; cues: Cue[] } | null = null;
  private subWait: { s: number; tries: number; label: string; got: number } | null = null;
  private subTimer: ReturnType<typeof setInterval> | null = null;
  private prefsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSub = '';
  // el equipo no abrió el archivo y ya se le pidió al panel que lo convierta (una vez por video)
  private formatTried = false;
  // el aviso de motor no disponible ya se mostró en este video
  private deniedShown = false;
  // «Continuar viendo»: segundo pedido y si ya sonó (nunca se abre desde el principio para saltar después: en algunos
  // videos o líneas el servidor no deja saltar y quedaba en bucle)
  private wantAt = 0;
  private played = false;
  // Continuar viendo directo: el reproductor de Vega se queda cargando si se salta antes de que el video empiece
  // (en loadedmetadata, como antes de la 1.0.4); se salta UNA vez apenas suena. seekTo = el segundo pedido mientras
  // tanto (lo que suena es el principio: no cuenta como «ya sonó» ni se guarda); seekTimer: si en 15 s no llegó, siguen
  // los pasos de siempre (el panel desde ese segundo)
  private seekAfter = 0;
  private seekTo = 0;
  private seekTimer: ReturnType<typeof setTimeout> | null = null;
  // idiomas: aviso de una vez, lectura con el video abierto (intentos) y su temporizador
  private langNoticed = false;
  private langTries = 0;
  private langBusy = false;
  private langChecked = false;
  private langTimer: ReturnType<typeof setTimeout> | null = null;
  // el panel prepara el video que el equipo no abrió (no un cambio de idioma): por http / con el video convertido
  private panelFallback = false;
  private panelPlain = false;
  private panelVideo = false;

  constructor(private v: VideoPlayer, private hooks: Hooks) {}

  // ---------- fuente ----------

  load(url: string, resume: number, live: boolean): void {
    this.gen++;
    this.stopHls();
    const sameFile = url.replace(/^https?:\/\//i, '') === this.url.replace(/^https?:\/\//i, '');
    this.wantAt = live ? 0 : resume;
    this.played = false;
    this.clearSeek();
    if (!sameFile) {
      this.langNoticed = false;
      this.langTries = 0;
      this.langChecked = false;
      this.panelPlain = false;
      this.panelVideo = false;
    }
    if (this.langTimer) clearTimeout(this.langTimer);
    this.langTimer = null;
    this.langBusy = false;
    this.panelFallback = false;
    this.url = url;
    this.live = live;
    this.liveAudio = 0;
    this.probe = null;
    this.probing = false;
    this.remux = null;
    this.offset = 0;
    this.realDur = 0;
    this.audioKey = '';
    this.subKey = '';
    this.audioApplied = false;
    this.subApplied = false;
    this.pendingNative = -1;
    this.setExt(null);
    this.subWait = null;
    this.formatTried = false;
    this.deniedShown = false;
    if (live) {
      // .m3u8 del canal: el reproductor de Vega no abre HLS solo; lo lee la app y lo entrega por MSE
      if (/\.m3u8(\?|$)/i.test(url) && !(globalThis as any).PalmSystem && LiveHls.supported()) this.openLive(url);
      else this.direct(resume);
      return;
    }
    // Idiomas que ya se saben SIN tocar el servidor IPTV (lo leído antes en el equipo o lo que recuerda el panel, que
    // la ficha ya pidió al entrar): llegan para el menú y el idioma preferido. Si nadie los sabe, se leen con el video
    // ya abierto, una y otra vez hasta que salgan (langCheck). Nada de leer el archivo antes de abrirlo: muchos
    // servidores bloqueaban la línea un rato.
    const g = this.gen;
    const route = engineDenied() ? '' : panelRoute(url);
    if (route) {
      // ya se sabe que en este equipo solo se ve por el panel: de una por ahí (con el idioma elegido para este título o el predeterminado)
      this.formatTried = true;
      this.panelFallback = true;
      if (route === 'v') this.panelVideo = true;
      knownTracks(url).then(p => {
        if (g !== this.gen) return;
        if (p.ok) this.probe = p;
        const items = p.ok ? this.audioItems() : [];
        const it = this.preferredAudio(items) || items[this.probeDefault()];
        // sin idiomas guardados: se leen de la cabecera a la vez (para el menú), sin esperar
        if (!p.ok)
          fileTracks(url, true).then(q => {
            if (g === this.gen && q.ok && !this.probe) {
              this.probe = q;
              this.hooks.changed();
            }
          });
        this.toRemux(it?.probe ?? 0, it?.label || t('Audio predeterminado'), false, '', resume).then(ok => {
          if (!ok && g === this.gen) {
            // sin el panel: el camino de siempre
            this.panelFallback = false;
            this.formatTried = false;
            this.direct(resume);
          }
        });
      });
      return;
    }
    // Como Roku: los idiomas se piden al entrar a la ficha (warmTracks); si ya llegaron, el video empieza con el idioma
    // elegido. Si todavía no, se espera ese pedido como mucho 2 s (como Roku) y se abre; lo que llegue después se aplica al
    // momento y, si nadie los sabe, se siguen pidiendo con el video abierto hasta tenerlos (langCheck).
    const now = knownNow(url);
    if (now) {
      this.probe = now;
      this.direct(resume);
      this.langWatch(3000);
      return;
    }
    let opened = false;
    const open = () => {
      if (opened || g !== this.gen) return;
      opened = true;
      this.direct(resume);
      this.langWatch(3000);
    };
    const wait = setTimeout(open, 2000);
    knownTracks(url).then(p => {
      clearTimeout(wait);
      if (g !== this.gen) return;
      if (p.ok && !this.probe) {
        this.probe = p;
        // ya sonando: el idioma preferido y el aviso de idiomas con lo que se acaba de saber
        if (this.played) {
          if (!this.audioKey) this.audioApplied = false;
          else this.checkDecodable();
          if (!this.subKey) this.subApplied = false;
          this.applyPrefs();
          this.langNotice();
        }
        this.hooks.changed();
      }
      open();
    });
  }

  // canal en vivo por HLS con el lector propio
  private openLive(url: string): void {
    const g = this.gen;
    const h = new LiveHls(this.v, url, this.liveAudio);
    this.liveHls = h;
    h.onError = why => g === this.gen && this.liveHls === h && this.hooks.liveFailed?.(why);
    h.onStalls = () => g === this.gen && this.liveHls === h && this.hooks.liveStalls?.(h.diag());
    // empieza a sonar el lector cuando tiene 2 segmentos (con margen), no antes
    h.start().then(err => {
      if (err && g === this.gen && this.liveHls === h) this.hooks.liveFailed?.(err);
    });
  }

  // el lector del canal pausó a propósito para juntar margen (Player muestra «cargando», no «en pausa»)
  liveHolding(): boolean {
    return !!this.liveHls?.holding;
  }

  // estado del canal por HLS (para el reporte): lista, segmentos entregados, lo que tiene el reproductor
  // El canal iba en MP4 propio y el reproductor lo rechazó: otra vez el mismo canal entregando el MPEG-TS (el resto
  // de la sesión), sin pasar por otro formato ni protocolo. false = no era eso
  liveRetryTs(): boolean {
    const h = this.liveHls;
    if (!this.live || !h || !h.isMp4() || !(h.mediaFailed() || (this.v as any).error)) return false;
    disableMp4();
    h.destroy();
    this.openLive(this.url);
    return true;
  }

  liveDiag(): string {
    return this.liveHls ? this.liveHls.diag() : '';
  }

  private direct(at: number): void {
    this.stopHls();
    this.offset = 0;
    this.clearSeek();
    if (at > 5 && !this.live && !this.played) {
      // Continuar viendo: se abre y se salta apenas suena (onPlaying)
      this.resumeAt = 0;
      this.seekAfter = at;
    } else this.resumeAt = at;
    this.v.src = this.url;
    this.v.play();
  }

  private clearSeek(): void {
    this.seekAfter = 0;
    this.seekTo = 0;
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
  }

  // timeupdate: el salto de Continuar viendo ya llegó (el reproductor no siempre avisa "playing" después de saltar)
  onTime(): void {
    if (this.seekTo > 0 && !this.v.paused && (this.v.currentTime || 0) >= this.seekTo - 10) this.onPlaying();
  }

  // segundo desde donde reabrir tras un error: el que sonaba o, si aún no arrancó, el de «Continuar viendo»
  resumePos(): number {
    const p = this.realPos();
    return p > 5 && !this.seekTo ? p : this.seekTo || this.seekAfter || this.resumeAt || this.wantAt;
  }

  // aún no empezó a sonar en el segundo guardado (no se guarda avance: se pisaría dónde quedó)
  seeking(): boolean {
    return !this.played && this.wantAt > 0;
  }

  // ya empezó a sonar (directo o con el panel)
  hasPlayed(): boolean {
    return this.played;
  }

  // el panel está preparando o ya entrega este video
  panelActive(): boolean {
    return !!this.remux;
  }

  // Continuar viendo o un video que el equipo no abrió: lo prepara el panel desde ese segundo con el idioma elegido para
  // este título (o el predeterminado). false = sin panel (sin permiso o sin motor)
  async panelOpen(at: number): Promise<boolean> {
    if (this.live || engineDenied()) return false;
    const g = this.gen;
    if (!this.probe?.ok) {
      const k = await knownTracks(this.url);
      if (k.ok) this.probe = k;
    }
    if (g !== this.gen) return false;
    this.clearSeek();
    const items = this.probe?.ok ? this.audioItems() : [];
    const it = this.preferredAudio(items) || items[this.probeDefault()];
    this.panelFallback = true;
    const ok = await this.toRemux(it?.probe ?? 0, it?.label || t('Audio predeterminado'), false, '', at);
    if (!ok) this.panelFallback = false;
    return ok;
  }

  private stopHls(): void {
    this.hls?.destroy();
    this.hls = null;
    this.prevHls?.destroy();
    this.prevHls = null;
    this.liveHls?.destroy();
    this.liveHls = null;
    this.remuxLive = false;
  }

  // Continuar viendo: el panel no arrancó a tiempo; se deja para que el reproductor siga con sus pasos
  panelStop(): void {
    if (!this.remux || this.played) return;
    this.remux = null;
    this.audioKey = '';
    this.panelFallback = false;
    this.stopHls();
    this.hooks.status('');
  }

  destroy(): void {
    this.gen++;
    this.clearSeek();
    this.stopHls();
    this.setExt(null);
    if (this.prefsTimer) clearTimeout(this.prefsTimer);
    if (this.langTimer) clearTimeout(this.langTimer);
  }

  // segundo real del contenido (el HLS del panel empieza en offset)
  realPos(): number {
    return this.offset + (this.v.currentTime || 0);
  }

  duration(): number {
    if (this.remux) {
      if (this.realDur > 0) return this.realDur;
      return this.hls?.done() ? this.offset + this.hls.listed() : 0;
    }
    const d = this.v.duration;
    if (Number.isFinite(d) && d > 0) this.realDur = d;
    return Number.isFinite(d) && d > 0 ? d : 0;
  }

  async seek(t: number): Promise<void> {
    const target = Math.max(0, t);
    if (this.remux && !this.remuxLive) {
      // preparando: solo se mueve el video directo (el HLS empezará donde se pidió)
      if (this.offset === 0 && !this.hls?.attached) this.v.currentTime = target;
      return;
    }
    if (this.remux && this.hls) {
      const rel = target - this.offset;
      if (rel >= 0 && (await this.hls.seekTo(rel))) return;
      // aún no convertido: el panel lo prepara desde ese segundo
      this.startRemux(target);
      return;
    }
    this.v.currentTime = target;
  }

  // loadedmetadata
  onMeta(): void {
    if (this.resumeAt > 0) {
      this.v.currentTime = this.resumeAt;
      this.resumeAt = 0;
    }
    if (this.pendingNative >= 0) {
      const i = this.pendingNative;
      this.pendingNative = -1;
      setTimeout(() => this.enableNative(i), 300);
    }
    this.schedulePrefs();
  }

  // "playing": se aplican los idiomas ya sabidos y, apenas suena, se mira cuántos audios hay (langCheck)
  onPlaying(): void {
    if (this.seekAfter > 0 && !this.remux) {
      // Continuar viendo: ya suena; ahora sí al segundo guardado (una vez)
      const at = this.seekAfter;
      const g = this.gen;
      this.seekAfter = 0;
      this.seekTo = at;
      this.v.currentTime = at;
      this.seekTimer = setTimeout(() => {
        this.seekTimer = null;
        if (g !== this.gen || this.played || !this.seekTo) return;
        // no llegó al segundo guardado: el reproductor sigue con sus pasos (el panel desde ese segundo)
        this.v.pause();
        this.hooks.resumeFailed?.();
      }, 15000);
      return;
    }
    if (this.seekTo > 0 && !this.remux) {
      if ((this.v.currentTime || 0) < this.seekTo - 10) return;
    }
    this.clearSeek();
    this.played = true;
    // cómo se pudo ver este archivo: por el panel (se recuerda) o directo (se olvida lo anterior)
    if (!this.live) setPanelRoute(this.url, this.remux && this.panelFallback ? (this.panelVideo ? 'v' : 'p') : this.remux ? panelRoute(this.url) : '');
    if (this.live || this.probing) return;
    this.probing = true;
    if (this.probe?.ok) {
      if (!this.audioKey) this.audioApplied = false;
      else this.checkDecodable();
      if (!this.subKey) this.subApplied = false;
      this.applyPrefs();
    }
    if (!this.langChecked) this.langWatch(500);
    this.hooks.changed();
  }

  // ---------- idiomas: aviso y lectura con el video abierto ----------

  private langWatch(ms: number): void {
    if (this.live || this.langTimer) return;
    const g = this.gen;
    this.langTimer = setTimeout(() => {
      this.langTimer = null;
      if (g === this.gen) this.langCheck();
    }, ms);
  }

  // aviso de idiomas: una vez por video, con 2 o más audios (los del reproductor o los ya sabidos)
  private langNotice(): void {
    const n = Math.max(this.nativeAudio().length, this.probe?.ok ? this.probe.audio.length : 0);
    if (n < 2 || this.langNoticed) return;
    this.langNoticed = true;
    this.hooks.toast(t('{n} idiomas de audio en este video: pulsa ▼ para cambiar', { n }));
  }

  // cuántos audios hay; si nadie lo sabe y el reproductor informa uno solo, se lee la cabecera del archivo ya (con el
  // video abierto, aunque todavía cargue) y se repite a los 3, 6 y 10 s y después cada 15 s hasta que salgan
  private langCheck(): void {
    if (this.live || this.langBusy) return;
    this.langChecked = true;
    this.langNotice();
    if (this.langNoticed || this.probe?.ok || this.remux) return;
    this.langBusy = true;
    this.langTries++;
    const g = this.gen;
    fileTracks(this.url, true).then(p => {
      if (g !== this.gen) return;
      this.langBusy = false;
      if (p.ok) {
        this.probe = p;
        if (!this.audioKey) this.audioApplied = false;
        else this.checkDecodable();
        if (!this.subKey) this.subApplied = false;
        this.applyPrefs();
        this.langNotice();
        this.hooks.changed();
        return;
      }
      // el archivo contestó y no es MKV ni MP4 (AVI, TS): no hay pistas que leer
      if (p.headOk && !p.container) return;
      this.langWatch([3000, 6000, 10000][this.langTries - 1] ?? 15000);
    });
  }

  // error del reproductor: si el audio del archivo no lo decodifica el equipo, lo prepara el panel
  async onError(): Promise<boolean> {
    if (this.live) return false;
    if (this.remux) {
      // el video directo falló mientras el panel prepara el audio: sigue la preparación
      if (!this.hls?.attached) return true;
      this.remuxFailed(t('el reproductor no pudo abrirlo'));
      return true;
    }
    // sin motor: el error normal, sin pasar por el panel
    if (engineDenied()) return false;
    const g = this.gen;
    if (!this.probe) this.probe = await fileTracks(this.url);
    if (g !== this.gen) return false;
    const items = this.probe.ok ? this.audioItems() : [];
    const def = items[this.probeDefault()];
    if (def && def.probe !== undefined && !this.decodable(def)) {
      // el panel lo convierte a AAC: de una vez el idioma elegido para este título (o el predeterminado)
      const want = this.preferredAudio(items) || def;
      const label = want.label;
      return this.toRemux(want.probe ?? def.probe, label, false, t('Cambiando a {x}…', { x: label }), Math.floor(this.resumeAt || this.realPos()));
    }
    return this.formatFallback(items);
  }

  // el equipo no abre el archivo (contenedor o códec que no reconoce, AVI, MKV raros…): el motor del panel lo
  // entrega como HLS (video sin cambios, audio en AAC) desde donde iba, antes de dar el error. Una vez por video.
  // Con un MKV/MP4 cuyo audio el equipo sí decodifica no se intenta: el video del panel es el mismo (copiado) y si
  // el equipo no lo abre directo tampoco lo abre por el panel (en el simulador eso cerraba la app).
  // También con MKV / MP4 (Plataformas: videos que el equipo no abre tal cual); si el panel tampoco puede, se pide por
  // http y después con el video convertido (remuxFailed).
  private async formatFallback(items: AudioItem[]): Promise<boolean> {
    if (this.formatTried || this.live) return false;
    this.formatTried = true;
    this.panelFallback = true;
    const it = this.preferredAudio(items) || items[this.probeDefault()];
    const ok = await this.toRemux(it?.probe ?? 0, it?.label || t('Audio {n}', { n: 1 }), false, t('Preparando el video en el panel…'), Math.floor(this.resumeAt || this.realPos()));
    if (!ok) this.panelFallback = false;
    return ok;
  }

  // ---------- listas ----------

  private nativeAudio(): { label: string; language: string; enabled: boolean }[] {
    const at = (this.v as any).audioTracks;
    const out = [];
    for (let i = 0; at && i < at.length; i++) {
      const t = at[i];
      out.push({ label: t?.label || '', language: t?.language || '', enabled: !!t?.enabled });
    }
    return out;
  }

  private nativeSubs(): { index: number; label: string; language: string; showing: boolean }[] {
    const tt = (this.v as any).textTracks;
    const out = [];
    for (let i = 0; tt && i < tt.length; i++) {
      const t = tt[i];
      if (!t || (t.kind && t.kind !== 'subtitles' && t.kind !== 'captions')) continue;
      out.push({ index: i, label: t.label || '', language: t.language || '', showing: t.mode === 'showing' });
    }
    return out;
  }

  // pista nativa con el mismo idioma: solo si es la única de ese idioma en los dos lados
  private byLang<T extends { language: string; label: string }>(nat: T[], list: { lang: string; name: string }[], i: number): number {
    const lang = trackLang(list[i].lang, list[i].name);
    if (!lang || list.filter(x => trackLang(x.lang, x.name) === lang).length !== 1) return -1;
    const m = nat.map((t, j) => (trackLang(t.language, t.label) === lang ? j : -1)).filter(j => j >= 0);
    return m.length === 1 ? m[0] : -1;
  }

  private audioItems(): AudioItem[] {
    // canal con varios idiomas (lector propio): uno por audio del canal
    const hl = this.live && this.liveHls ? this.liveHls.audioLangs() : [];
    if (hl.length > 1) return numbered(hl.map((l, i) => ({ key: 'h:' + i, label: langName(l, '') || t('Audio {n}', { n: i + 1 }), lang: trackLang(l, ''), codec: '' })));
    const nat = this.nativeAudio();
    const pr = this.probe?.ok ? this.probe.audio : [];
    if (pr.length && pr.length >= nat.length) {
      return numbered(pr.map((tr, i) => {
        const n = nat.length === pr.length ? i : this.byLang(nat, pr, i);
        return {
          key: 'p:' + i,
          label: langName(tr.lang, tr.name) || t('Audio {n}', { n: i + 1 }),
          lang: trackLang(tr.lang, tr.name),
          codec: tr.codec,
          probe: i,
          native: n >= 0 ? n : undefined,
        };
      }));
    }
    return numbered(nat.map((tr, i) => ({ key: 'n:' + i, label: langName(tr.language, tr.label) || t('Audio {n}', { n: i + 1 }), lang: trackLang(tr.language, tr.label), codec: '', native: i })));
  }

  private subItems(): SubItem[] {
    const nat = this.nativeSubs();
    const pr = this.probe?.ok ? this.probe.subs : [];
    if (pr.length && pr.length >= nat.length) {
      return numbered(pr.map((tr, i) => {
        const n = nat.length === pr.length ? i : this.byLang(nat, pr, i);
        let label = langName(tr.lang, tr.name) || t('Subtítulos {n}', { n: i + 1 });
        if (tr.forced) label += ' · ' + t('forzados');
        return { key: 'p:' + i, label, lang: trackLang(tr.lang, tr.name), image: imageSub(tr.codec), probe: i, native: n >= 0 ? nat[n].index : undefined };
      }));
    }
    return numbered(nat.map((tr, i) => ({ key: 'n:' + i, label: langName(tr.language, tr.label) || t('Subtítulos {n}', { n: i + 1 }), lang: trackLang(tr.language, tr.label), image: false, native: tr.index })));
  }

  private probeDefault(): number {
    const a = this.probe?.audio || [];
    const i = a.findIndex(t => t.def);
    return i >= 0 ? i : 0;
  }

  private enabledNative(): number {
    return this.nativeAudio().findIndex(t => t.enabled);
  }

  private audioOn(items: AudioItem[]): AudioItem | undefined {
    if (this.liveHls && items[0]?.key.startsWith('h:')) return items.find(i => i.key === 'h:' + this.liveHls!.audioIdx);
    if (this.remux) return items.find(i => i.probe === this.remux!.a);
    const n = this.enabledNative();
    if (n >= 0) {
      const m = items.find(i => i.native === n);
      if (m) return m;
    }
    return items.find(i => i.key === this.audioKey) || (this.probe?.ok ? items[this.probeDefault()] : items[0]);
  }

  // el idioma que el usuario eligió para este título; sin elegir, ninguno (suena el predeterminado del archivo)
  private preferredAudio(items: AudioItem[]): AudioItem | undefined {
    const s = titleLang(this.url);
    if (!s) return undefined;
    return items.find(i => i.probe === s.a && sameLang(i.lang, s.l)) || items.find(i => sameLang(i.lang, s.l));
  }

  private decodable(it: AudioItem): boolean {
    return it.probe === undefined || nativeAudioOk(it.codec, this.probe?.container || '');
  }

  // El archivo trae más idiomas de los que informa el reproductor (y el panel está): arriba «Audio predeterminado» (el
  // video directo, tal como lo da el servidor) y debajo todos los idiomas del archivo, que prepara el panel al elegirlos
  // (también el que suena por defecto: volver a él desde otro preparado por el panel podía dejar el video sin sonido)
  private panelMenu(): boolean {
    return !this.live && !!this.probe?.ok && this.probe.audio.length > 1 && this.probe.audio.length > this.nativeAudio().length && !engineDenied();
  }

  // menú de audio y subtítulos
  menu(): MenuItem[] {
    const out: MenuItem[] = [];
    const a = this.audioItems();
    if (this.panelMenu()) {
      out.push({ kind: 'audio', key: 'def', label: t('Audio predeterminado'), on: !this.remux });
      for (const it of a) out.push({ kind: 'audio', key: it.key, label: it.label, on: this.remux?.a === it.probe });
    } else {
      const on = this.audioOn(a);
      for (const it of a) out.push({ kind: 'audio', key: it.key, label: it.label, on: it === on });
    }
    const subs = this.subItems();
    const showing = this.nativeSubs().find(t => t.showing);
    out.push({ kind: 'text', key: 'off', label: t('Desactivados'), on: this.subKey === 'off' || (!this.ext && !showing) });
    for (const it of subs) {
      const isOn = this.ext ? it.probe === this.ext.s : this.subKey !== 'off' && !!showing && it.native === showing.index;
      out.push({ kind: 'text', key: it.key, label: it.label + (this.subWait && this.subWait.s === it.probe && this.ext?.s !== it.probe ? ' (' + t('preparando…') + ')' : ''), on: isOn });
    }
    return out;
  }

  select(m: MenuItem): void {
    if (m.kind === 'panel') {
      const a = this.audioItems();
      const it = a.find(i => i.key === this.audioKey) || this.audioOn(a);
      if (it && it.probe !== undefined) this.toRemux(it.probe, it.label, true, t('Cambiando a {x}…', { x: it.label }));
      return;
    }
    if (m.kind === 'audio') {
      if (m.key === 'def') {
        // «Audio predeterminado»: el video directo (este título vuelve a empezar así)
        this.audioKey = '';
        setTitleLang(this.url, null);
        // el equipo no abre este video directo (sigue por el panel): el primer audio del archivo, preparado por el panel
        if (this.panelFallback && this.remux) {
          if (this.remux.a !== 0) this.toRemux(0, t('Audio predeterminado'), true, t('Cambiando a {x}…', { x: t('Audio predeterminado') }));
          return;
        }
        if (this.remux) this.leaveRemux();
        else this.hooks.toast(t('Audio: {x}', { x: t('Audio predeterminado') }));
        return;
      }
      const it = this.audioItems().find(i => i.key === m.key);
      if (it && it.probe !== undefined && this.panelMenu()) {
        // un idioma de la lista de abajo: lo prepara el panel (también el de por defecto)
        if (this.remux?.a === it.probe) return;
        setTitleLang(this.url, it);
        this.toRemux(it.probe, it.label, true, t('Cambiando a {x}…', { x: it.label }));
        return;
      }
      if (it) this.pickAudio(it, true);
    } else {
      this.pickSub(m.key === 'off' ? null : this.subItems().find(i => i.key === m.key) || null, true);
    }
  }

  // ---------- idioma preferido (Cuenta › Ajustes) ----------

  // nuevas pistas: se espera un momento a que lleguen todas
  schedulePrefs(): void {
    if (this.prefsTimer) clearTimeout(this.prefsTimer);
    const g = this.gen;
    this.prefsTimer = setTimeout(() => g === this.gen && this.applyPrefs(), 700);
  }

  private applyPrefs(): void {
    this.autoAudio();
    this.autoSubs();
    this.hooks.changed();
  }

  // Un título nuevo suena tal como viene del servidor IPTV (su audio predeterminado). Solo se cambia solo a: el idioma
  // que el usuario eligió antes para este mismo título (Continuar viendo), o, si el equipo no puede decodificar el
  // audio que suena (DTS…, quedaría sin sonido), el mismo idioma en un audio que sí decodifica o el panel.
  private autoAudio(): void {
    if (this.audioApplied || this.audioKey || this.remux) return;
    const items = this.audioItems();
    if (!items.length) return;
    const cur = this.audioOn(items);
    const want = this.preferredAudio(items);
    // el audio que suena el equipo no lo puede decodificar (DTS…): hace falta el panel
    const stuck = cur && !this.decodable(cur);
    if (!want && !stuck) return;
    if (items.length < 2 && !stuck) return;
    this.audioApplied = true;
    const pick = want && this.decodable(want) ? want : stuck ? items.find(i => this.decodable(i) && sameLang(i.lang, cur!.lang)) || want || cur : want;
    if (pick && pick !== cur) this.pickAudio(pick, false, pick === want);
    else if (stuck && cur) this.pickAudio(cur, false);
  }

  // ya se eligió un audio antes de conocer los códecs: si el equipo no lo decodifica, otro del
  // mismo idioma o el panel
  private checkDecodable(): void {
    if (this.remux) return;
    const items = this.audioItems();
    const cur = this.audioOn(items);
    if (!cur || this.decodable(cur)) return;
    const alt = items.find(i => i !== cur && i.native !== undefined && this.decodable(i) && sameLang(i.lang, cur.lang));
    this.pickAudio(alt || cur, false);
  }

  private autoSubs(): void {
    if (this.subApplied || this.subKey) return;
    const items = this.subItems();
    if (!items.length) return;
    this.subApplied = true;
    const p = pref('subs_lang', 'off');
    const want = p !== 'off' ? items.find(i => sameLang(i.lang, p) && i.native !== undefined) : undefined;
    this.pickSub(want || null, false);
  }

  // ---------- audio ----------

  private enableNative(i: number): void {
    const at = (this.v as any).audioTracks;
    if (!at || !at[i]) return;
    try {
      // primero la nueva (así nunca queda sin audio) y después se apagan las demás
      at[i].enabled = true;
      for (let j = 0; j < at.length; j++) if (j !== i && at[j].enabled) at[j].enabled = false;
    } catch {
      // el reproductor no permitió el cambio: lo detecta la comprobación
    }
    // el búfer ya tenía el audio anterior: se vuelve al mismo punto
    if (!this.live) {
      const t = this.v.currentTime || 0;
      if (t > 1) this.v.currentTime = t;
    }
  }

  // saved = el idioma que el usuario eligió antes para este título: puede usar el panel como si lo eligiera ahora
  private pickAudio(it: AudioItem, user: boolean, saved = false): void {
    if (it.key.startsWith('h:')) {
      // otro idioma del canal: el lector vuelve a abrir el canal con ese audio
      const i = Number(it.key.slice(2));
      if (!user || !this.liveHls || this.liveHls.audioIdx === i) return;
      this.liveAudio = i;
      this.liveHls.destroy();
      this.openLive(this.url);
      this.hooks.toast(t('Audio: {x}', { x: it.label }));
      this.hooks.changed();
      return;
    }
    this.audioKey = it.key;
    if (user) setTitleLang(this.url, it.probe === this.probeDefault() && !this.panelMenu() ? null : it);
    const ok = this.decodable(it);
    if (it.native !== undefined && ok) {
      if (this.remux) {
        // de vuelta al video directo en el mismo segundo y con esa pista
        this.pendingNative = it.native;
        this.leaveRemux();
        return;
      }
      if (this.enabledNative() === it.native) {
        if (user) this.hooks.toast(t('Audio: {x}', { x: it.label }));
        this.hooks.changed();
        return;
      }
      this.enableNative(it.native);
      const g = this.gen;
      const n = it.native;
      setTimeout(() => {
        if (g !== this.gen || this.remux) return;
        if (this.enabledNative() === n) {
          if (user) this.hooks.toast(t('Audio: {x}', { x: it.label }));
        } else if (it.probe !== undefined && !this.live && (user || saved)) {
          // el equipo no tomó la pista: la prepara el panel
          this.toRemux(it.probe, it.label, true, t('Cambiando a {x}…', { x: it.label }));
        } else {
          this.audioKey = '';
          if (user) this.hooks.toast(t('Este equipo no pudo cambiar a {x}.', { x: it.label }));
        }
        this.hooks.changed();
      }, 1500);
      return;
    }
    if (it.probe === undefined || this.live) return;
    if (this.remux?.a === it.probe) return;
    // la pista que el equipo ya reproduce sin elegir nada
    if (ok && this.remux && it.probe === this.probeDefault()) {
      this.leaveRemux();
      return;
    }
    // el panel trabaja cuando el usuario elige o cuando el equipo no puede decodificar el audio
    if (!user && !saved && ok) {
      this.audioKey = '';
      return;
    }
    this.toRemux(it.probe, it.label, user, user || saved ? t('Cambiando a {x}…', { x: it.label }) : t('Este equipo no reproduce el audio {x}: se prepara con el panel…', { x: codecName(it.codec) }));
  }

  // motor del panel; sin él, el texto del panel una sola vez por video y solo si lo pidió el usuario
  private async getEngine(user: boolean): Promise<Engine | null> {
    const r = await mediaEngine();
    if (r.ok) return (this.engine = r.engine);
    this.denied(r.error, user);
    return null;
  }

  private denied(msg: string, user: boolean): void {
    if (!user || this.deniedShown) return;
    this.deniedShown = true;
    this.hooks.toast(msg);
  }

  // true = el panel empezó a preparar el video. note: aviso que se muestra solo si el motor está
  // (sin motor nada cambia: ni recarga, ni "preparando", ni reintentos)
  private async toRemux(a: number, label: string, user: boolean, note: string, at?: number): Promise<boolean> {
    if (this.live || this.remux?.a === a) return false;
    const g = this.gen;
    const e = await this.getEngine(user);
    if (g !== this.gen) return false;
    if (!e || !PanelHls.supported()) {
      if (e && user) this.hooks.toast(t('Este equipo no puede reproducir el audio que prepara el panel.'));
      this.audioKey = '';
      this.hooks.changed();
      return false;
    }
    const pos = at ?? this.realPos();
    this.duration();
    const before = this.remux;
    this.remux = { a, label };
    this.audioKey = 'p:' + a;
    if (note) this.hooks.toast(note);
    this.startRemux(pos, before);
    return true;
  }

  // before: el audio del panel que sonaba (cambio de idioma con el video ya por el panel)
  private async startRemux(pos: number, before: { a: number; label: string } | null = null): Promise<void> {
    if (!this.remux || !this.engine) return;
    const { a, label } = this.remux;
    // mientras se prepara sigue sonando lo de ahora: el HLS anterior del panel sigue bajando hasta que el nuevo está
    // listo (antes se cortaba al pedir otro idioma y, si el nuevo tardaba o fallaba, el video quedaba sin nada)
    const prev = before && this.hls?.attached && this.played ? this.hls : null;
    if (!prev) this.stopHls();
    else {
      this.prevHls?.destroy();
      this.prevHls = prev;
    }
    this.remuxFrom = Math.floor(pos);
    const h = new PanelHls(this.v, hlsLink(this.engine, this.url, a, pos, { video: this.panelVideo, plain: this.panelPlain }));
    this.hls = h;
    h.onError = msg => this.hls === h && this.remuxFailed(msg);
    this.hooks.status(this.panelVideo ? t('Convirtiendo el video en el panel…') : this.panelFallback ? (this.wantAt > 0 && !this.played ? t('Preparando desde donde quedó…') : t('Preparando el video en el panel…')) : t('Cambiando idioma…'));
    const err = await h.start();
    if (this.prevHls === prev) this.prevHls = null;
    if (this.hls !== h) {
      h.destroy();
      if (prev && this.hls !== prev) prev.destroy();
      return;
    }
    if (err && prev && before) {
      // el otro idioma no se pudo: sigue el que sonaba, sin cortar
      h.destroy();
      this.hls = prev;
      this.remux = before;
      this.audioKey = 'p:' + before.a;
      this.hooks.status('');
      this.hooks.toast(t('No se pudo cambiar a {x} ({msg}). Se sigue con el audio original.', { x: label, msg: err }));
      reportError('playback', 'No se pudo cambiar el audio', 'audio=' + label + ' a=' + a + ' video=' + this.panelVideo + ' plain=' + this.panelPlain + ' motivo=' + err, 'Reproductor');
      this.hooks.changed();
      return;
    }
    prev?.destroy();
    if (err) {
      this.remuxFailed(err);
      return;
    }
    this.offset = Math.floor(pos);
    this.remuxLive = true;
    this.resumeAt = 0;
    this.v.play();
    this.hooks.status('');
    this.hooks.toast(t('Audio: {x}', { x: label }));
    this.hooks.changed();
  }

  // el panel no pudo (sin ffmpeg, servidor caído…): se vuelve al video directo
  private remuxFailed(msg: string): void {
    // el video que el equipo no abrió (o Continuar viendo): por http si no se pudo conectar con la VPS / VDS (su
    // certificado), después con el video también convertido; si tampoco, el reproductor sigue con sus otros pasos
    if (this.panelFallback && !this.played && this.remux && !engineDenied()) {
      const pos = this.remuxFrom;
      if (!this.panelPlain && msg === t('No se pudo conectar con el panel.')) {
        this.panelPlain = true;
        this.startRemux(pos);
        return;
      }
      if (!this.panelVideo) {
        this.panelVideo = true;
        this.startRemux(pos);
        return;
      }
      this.remux = null;
      this.audioKey = '';
      this.panelFallback = false;
      this.stopHls();
      this.hooks.status('');
      this.hooks.changed();
      if (this.hooks.panelFailed) this.hooks.panelFailed();
      else this.hooks.fatal(t('No se pudo reproducir este contenido.'));
      return;
    }
    const label = this.remux?.label || '';
    const attached = !!this.hls?.attached;
    const pos = this.remuxLive ? this.realPos() : attached ? this.remuxFrom : this.realPos();
    this.remux = null;
    this.audioKey = '';
    this.hooks.status('');
    // sin permiso (503): solo el texto del panel, una vez
    const denied = engineDenied();
    if (denied) this.denied(denied, true);
    else this.hooks.toast(t('No se pudo cambiar a {x} ({msg}). Se sigue con el audio original.', { x: label, msg }));
    if (attached) this.direct(pos);
    else {
      this.stopHls();
      if ((this.v as any).error) this.hooks.fatal(t('No se pudo reproducir el audio de este contenido.'));
    }
    this.hooks.changed();
  }

  private leaveRemux(): void {
    const pos = this.realPos();
    this.remux = null;
    this.direct(pos);
    this.hooks.changed();
  }

  // ---------- subtítulos ----------

  private setNativeSub(index: number): void {
    const tt = (this.v as any).textTracks;
    for (let i = 0; tt && i < tt.length; i++) {
      try {
        const want = i === index ? 'showing' : 'disabled';
        if (tt[i].mode !== want) tt[i].mode = want;
      } catch {
        // pista sin control
      }
    }
  }

  private setExt(ext: { s: number; cues: Cue[] } | null): void {
    this.ext = ext;
    if (this.subTimer) clearInterval(this.subTimer);
    this.subTimer = null;
    if (this.lastSub) this.hooks.subText((this.lastSub = ''));
    if (!ext) return;
    this.subTimer = setInterval(() => {
      const t = cueAt(ext.cues, this.realPos());
      if (t !== this.lastSub) this.hooks.subText((this.lastSub = t));
    }, 250);
  }

  private pickSub(it: SubItem | null, user: boolean): void {
    if (!it) {
      this.subKey = 'off';
      this.subWait = null;
      this.setExt(null);
      this.setNativeSub(-1);
      if (user) {
        setPref('subs_lang', 'off');
        this.hooks.toast(t('Subtítulos desactivados'));
      }
      this.hooks.changed();
      return;
    }
    this.subKey = it.key;
    if (user) rememberLang('subs_lang', it.lang);
    if (it.native !== undefined) {
      this.subWait = null;
      this.setExt(null);
      this.setNativeSub(it.native);
      if (user) this.hooks.toast(t('Subtítulos: {x}', { x: it.label }));
      this.hooks.changed();
      return;
    }
    if (it.probe === undefined || this.live) return;
    if (this.ext?.s === it.probe) return;
    // el panel solo trabaja cuando el usuario elige (nunca por el idioma de Ajustes)
    if (!user) {
      this.subKey = '';
      return;
    }
    if (it.image) {
      this.subKey = 'off';
      this.hooks.toast(t('Este subtítulo es de imagen y no se puede mostrar en este equipo.'));
      this.hooks.changed();
      return;
    }
    this.extSub(it.probe, it.label);
  }

  private async extSub(s: number, label: string): Promise<void> {
    const g = this.gen;
    const e = await this.getEngine(true);
    if (g !== this.gen) return;
    if (!e) {
      this.subKey = 'off';
      this.hooks.changed();
      return;
    }
    this.setNativeSub(-1);
    this.setExt(null);
    const wait = { s, tries: 0, label, got: 0 };
    this.subWait = wait;
    this.hooks.toast(t('Preparando subtítulos {x}… (puede tardar un minuto)', { x: label }));
    this.hooks.changed();
    while (this.subWait === wait && g === this.gen) {
      const r = await subCheck(e, this.url, s);
      if (this.subWait !== wait || g !== this.gen) return;
      // a medio leer (un servidor lento tarda minutos en dar el archivo entero): se muestra lo leído
      // y se vuelve a pedir cada 20 s hasta tenerlo completo
      if (r.partial && !r.ready) {
        if (Date.now() - wait.got >= 20000) {
          const part = parseVtt(await subText(e, this.url, s));
          if (this.subWait !== wait || g !== this.gen) return;
          wait.got = Date.now();
          if (part.length) {
            if (this.ext?.s !== s) this.hooks.toast(t('Subtítulos: {x}', { x: label }));
            this.setExt({ s, cues: part });
            this.hooks.changed();
          }
        }
        await new Promise<void>(res => setTimeout(res, 3000));
        continue;
      }
      if (r.ready) {
        const cues = parseVtt(await subText(e, this.url, s));
        if (this.subWait !== wait || g !== this.gen) return;
        this.subWait = null;
        if (!cues.length && this.ext?.s === s) return;
        if (!cues.length) {
          this.subKey = 'off';
          this.hooks.toast(t('Este subtítulo está vacío.'));
        } else {
          if (this.ext?.s !== s) this.hooks.toast(t('Subtítulos: {x}', { x: label }));
          this.setExt({ s, cues });
        }
        this.hooks.changed();
        return;
      }
      if (r.failed || ++wait.tries > 100) {
        this.subWait = null;
        // ya se ve una parte: se queda con lo que hay
        if (this.ext?.s === s) return;
        this.subKey = 'off';
        if (r.denied) this.denied(r.denied, true);
        else this.hooks.toast(t('Este subtítulo no se puede mostrar (es de imagen o el servidor no respondió).'));
        this.hooks.changed();
        return;
      }
      await new Promise<void>(res => setTimeout(res, 3000));
    }
  }
}
