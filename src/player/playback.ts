// VOD: modo URL de Vega para archivos y Shaka para manifiestos. Los lectores
// locales MP4/MKV mantienen el segundo de reproducción cuando hace falta cambiar de ruta.
import type { AudioTrack, TextTrack, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { disableMp4, LiveHls } from './livehls';
import { Engine, engineDenied, fileTracks, knownNow, knownTracks, mediaEngine, shareTracks, subCheck, subText, hlsLink } from '../api/media';
import { t } from '../lib/i18n';
import { imageSub, langKey, langName, numbered, sameLang, trackLang } from '../lib/lang';
import { osBefore2, osVersion } from '../lib/osversion';
import { Probe, stopProbe } from '../lib/probe';
import { UA } from '../lib/http';
import { pref, readJson, setPref, writeJson } from '../lib/storage';
import { markNativeLiveBad, nativeLiveGood, nativeAllowed, nativeFailedOnce, nativeHttpOk, nativeKnownGood, nativeLiveBad, nativeRejectedHttp, nativeWorked } from './nativemode';
import { Cue, cueAt, parseVtt } from '../lib/vtt';
import { PanelHls } from './hls';
import { dropWarm, mp4Ready, Mp4Mse, NOT_MP4_MKV, STALE_INDEX } from './mp4mse';
import { hostStats, isSingle, lineLimit } from './rangeget';
import { dropPrefetch } from './prefetch';
import { dropMkvWarm, MkvMse, mkvKnown, mkvReady } from './mkvmse';
import { Mkv } from './mkvparse';
import { reportError } from '../api/report';
import { ShakaPlayback } from './shaka';

export type MenuItem = { kind: 'audio' | 'text' | 'local'; key: string; label: string; on: boolean };

type AudioItem = { key: string; trackId?: string; label: string; lang: string; codec: string; native?: number; probe?: number; shaka?: string; mp4?: number };
type SubItem = { key: string; label: string; lang: string; image: boolean; native?: number; probe?: number };

export type Hooks = {
  toast: (msg: string) => void;
  status: (msg: string) => void;
  changed: () => void;
  subText: (text: string) => void;
  fatal: (msg: string) => void;
  vodStarting?: (position: number) => void;
  vodPlaying?: () => void;
  vodFailed?: (position: number) => void;
  // 2.1.4: abrir el mismo video otra vez en un reproductor nuevo desde ese segundo (Player lo crea)
  vodFresh?: (position: number) => void;
  // canal en vivo por HLS (lector propio) que no se pudo abrir o se cortó: el motivo, para el siguiente formato
  liveFailed?: (why: string) => void;
  // el canal se detuvo varias veces (sin datos a tiempo): el estado del lector para el reporte
  liveStalls?: (diag: string) => void;
};

function rememberLang(key: string, lang: string) {
  const k = langKey(lang);
  if (k) setPref(key, k);
}

const fileKey = (url: string) => url.replace(/^https?:\/\//i, '');
// archivos que el reproductor de Amazon abrió y no pudo mostrar en esta sesión: el lector de la app, sin volver a él
const nativeLost = new Set<string>();
const readerFile = /\.(mp4|m4v|mov|mkv)([?#]|$)/i;
const manifestFile = /\.(m3u8|mpd)([?#]|$)/i;
type VodRoute = 'native' | 'reader' | 'adaptive' | 'panel';

export function nativeVodAllowed(url: string): boolean {
  return !manifestFile.test(url) && nativeHttpOk(url)
    && (!/^http:/i.test(url) || !osBefore2());
}

// Idioma que el usuario eligió para ESTE título (menú de audio): se usa al volver a abrirlo (también «Continuar viendo»).
// Un título nuevo (o sin elegir nada) empieza siempre con su audio predeterminado, directo del servidor IPTV; el panel
// prepara otro idioma solo cuando el usuario lo elige. 180 días, los 400 más recientes. a = pista del archivo.
type TitleLang = { l: string; a: number; t: number; n?: string };
// _2 (1.0.33): se olvidan los idiomas elegidos en las versiones de prueba
const TLANG_KEY = 'title_audio_2';
function titleLang(url: string): TitleLang | null {
  const e = (readJson<Record<string, TitleLang>>(TLANG_KEY) || {})[fileKey(url)];
  return e && Date.now() - e.t < 180 * 86400000 ? e : null;
}
// títulos donde el usuario volvió al audio predeterminado en esta sesión (se le avisa al panel con a: '')
const langCleared = new Set<string>();
// El idioma elegido en otro equipo (Roku, otro Fire TV…), que llega con el avance del panel (state.ts PlayHint): vale si
// este equipo no tiene uno propio para el título. Así Continuar viendo abre en el idioma en que se venía viendo en
// cualquier equipo, cada uno a su manera (Vega con su reproductor; Roku convirtiendo si hace falta). 2.0.14
export function seedTitleLang(url: string, lang: string, a = -1): void {
  if (typeof lang !== 'string' || !lang || titleLang(url) || langCleared.has(fileKey(url))) return;
  setTitleLang(url, { lang, probe: a >= 0 ? a : undefined });
}
// lo que va con el avance al panel: el idioma elegido para este título (o '' si se volvió al predeterminado)
export function titlePlayHint(url: string): { a: string; ai?: number } | undefined {
  const s = titleLang(url);
  if (s?.l) return { a: s.l, ai: s.a };
  return langCleared.has(fileKey(url)) ? { a: '' } : undefined;
}
// idioma elegido para el título (los lectores abren directo con esa pista)
export function titleLangOf(url: string): string {
  return titleLang(url)?.l || '';
}
function setTitleLang(url: string, it: { lang: string; probe?: number; trackId?: string } | null): void {
  const all = readJson<Record<string, TitleLang>>(TLANG_KEY) || {};
  const k = fileKey(url);
  if (it) langCleared.delete(k);
  else langCleared.add(k);
  if (!it) {
    if (!all[k]) return;
    delete all[k];
  } else {
    all[k] = { l: it.lang, a: it.probe ?? -1, t: Date.now(), n: it.trackId };
  }
  const keep = Object.entries(all).sort((x, y) => y[1].t - x[1].t).slice(0, 400);
  writeJson(TLANG_KEY, Object.fromEntries(keep));
}
// Canales y el reproductor nativo de Vega en esta sesión (2.0.15). Un fallo suelto antes de verse NO cuenta: al cambiar
// de canal rápido (▲▼ o la lista en pantalla grande) el reproductor anterior todavía puede estar soltando el
// decodificador (Amazon: uno solo; hay que cerrar el anterior antes de iniciar el siguiente) o el servidor sigue
// contando la conexión del canal anterior. Antes ese fallo pasajero dejaba el canal sin el nativo toda la sesión (y, con
// dos, 2 días): HBO y otros canales que solo se ven bien con el nativo pasaban al lector de la app, se congelaban, iban a
// MPEG-TS sin imagen y a los 40 s probaban el otro protocolo («No se pudo reproducir»). Ahora el primer fallo se prueba
// otra vez con un reproductor nuevo, como abre la miniatura; con 2 seguidos, el lector de la app.
const nativeMiss = new Map<string, number>();
const liveKey = (u: string) => u.replace(/^https?:\/\//i, '').replace(/\.(m3u8|ts)(\?.*)?$/i, '');
// canales que el reproductor no mostró en MP4 propio (van en MPEG-TS) y en MPEG-TS (van en MP4). Antes un MP4 rechazado
// apagaba el MP4 para TODOS los canales de la sesión (y muchos en MPEG-TS no muestran imagen en Vega); ahora solo ese
// canal, y con 3 canales distintos, el equipo entero
const mp4BadLive = new Set<string>();
const tsBadLive = new Set<string>();
// el canal va a abrir con el reproductor nativo (entonces no hace falta pedir su lista HLS por adelantado)
export function nativeLivePlanned(url: string): boolean {
  return nativeAllowed('live') && nativeHttpOk(url) && (nativeMiss.get(liveKey(url)) || 0) < 2 && /\.m3u8(\?|$)/i.test(url) && !nativeLiveBad(url);
}
// qué hacer con un canal que falló: 'here' = sigue en este mismo reproductor (otra forma ya puesta), 'fresh' = otra vez
// con un reproductor nuevo (Player y la miniatura lo crean, como al cambiar de canal), '' = no queda otra forma
export type LiveNext = 'here' | 'fresh' | '';
export class Playback {
  private url = '';
  private live = false;
  private gen = 0;
  private probe: Probe | null = null;
  private probing = false;
  private remux: { a: number; label: string } | null = null;
  private hls: PanelHls | null = null;
  private mse: Mp4Mse | MkvMse | null = null;
  private mkvIndex: Mkv | null = null;
  private wantNote = '';
  // por qué la lectura propia del MP4 no siguió (va al reporte)
  private mp4Why = '';
  private liveHls: LiveHls | null = null;
  // el canal en el reproductor nativo de Vega (modo directo con el .ts del canal, como Roku y LG): se usa cuando el
  // lector propio se congela (Amazon: imagen quieta con el audio sonando suele ser video entrelazado, 1080i, como HBO)
  private liveNative = false;
  private nativeDog: ReturnType<typeof setInterval> | null = null;
  // la miniatura (LivePreview): el lector del canal guarda los últimos segmentos para la pantalla grande
  liveKeep = false;
  // ya se le dio un canal a este reproductor / el canal actual va en un reproductor ya usado
  private hadLive = false;
  private reused = false;
  private shaka: ShakaPlayback | null = null;
  private shakaRelease: Promise<void> | null = null;
  private mp4Audio = -1;
  // 2.1.5: el idioma del lector lo eligió el usuario ahora (no el guardado del título): solo entonces el panel lo prepara
  private audioByUser = false;
  // el idioma guardado no suena en este equipo: sigue el predeterminado del archivo y no se vuelve a aplicar
  private langGaveUp = false;
  private mp4Index: Uint8Array | null = null;
  private mp4Paused = false;
  private audioChange = 0;
  private audioTimer: ReturnType<typeof setTimeout> | null = null;
  // audio del canal elegido en el menú (canales con varios idiomas)
  private liveAudio = 0;
  // el reproductor falló con el audio MP2 / AC-3 del canal convertido: el canal otra vez, solo con el video
  private liveNoAudio = false;
  // veces que el canal se congeló (LiveHls.frozen): se vuelve a abrir alternando MP4 propio (impar) y MPEG-TS (par)
  private liveFrozen = 0;
  // el HLS del panel que sigue sonando mientras se prepara otro idioma
  private prevHls: PanelHls | null = null;
  private offset = 0;
  // el HLS del panel ya suena (antes sigue el video directo mientras se prepara)
  private remuxLive = false;
  private remuxFrom = 0;
  private audioRemuxTried = new Set<number>();
  private panelReturn: { route: 'native' | 'reader'; audio: number; paused: boolean } | null = null;
  private realDur = 0;
  private engine: Engine | null = null;
  private audioKey = '';
  private subKey = '';
  private audioApplied = false;
  private subApplied = false;
  private ext: { s: number; cues: Cue[] } | null = null;
  private subWait: { s: number; tries: number; label: string; got: number } | null = null;
  private subTimer: ReturnType<typeof setInterval> | null = null;
  private prefsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSub = '';
  private wantAt = 0;
  private played = false;
  private vodReady = false;
  private resettingVod = false;
  private nativeTried = false;
  private readerTried = false;
  private staleIndexRetried = false;
  private seekIssuedAt = 0;
  private resumeSample: number | null = null;
  private restoreMuted: boolean | null = null;
  private langNoticed = false;
  // el panel prepara el video que el equipo no abrió (no un cambio de idioma): por http / con el video convertido
  private panelFallback = false;
  private panelPlain = false;
  private panelVideo = false;

  private vodNative = false;
  private mkvBody = false;
  private nativeMeta = false;
  private nativeAt = 0;
  private vodTimer: ReturnType<typeof setTimeout> | null = null;
  private vodWatch = 0;
  private pendingSub = '';
  private nativeSubTimer: ReturnType<typeof setTimeout> | null = null;
  private readerLang = '';

  constructor(private v: VideoPlayer, private hooks: Hooks) {}

  // la pantalla grande se queda con el reproductor de la miniatura: desde ahora avisa a Player
  setHooks(h: Hooks): void {
    this.hooks = h;
    this.liveKeep = false;
    this.liveHls?.stopKeeping();
  }

  // el reproductor vuelve de la pantalla grande a la miniatura: avisos de la miniatura y el lector guarda otra vez los
  // últimos segmentos (por si se vuelve a agrandar)
  toPreview(h: Hooks): void {
    this.hooks = h;
    this.liveKeep = true;
    if (this.liveHls) this.liveHls.keep = true;
  }

  // ---------- fuente ----------

  load(url: string, resume: number, live: boolean): void {
    const oldUrl = this.url;
    this.gen++;
    this.audioChange++;
    this.played = false;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = null;
    if (this.prefsTimer) clearTimeout(this.prefsTimer);
    this.prefsTimer = null;
    if (oldUrl && !this.live) this.releaseVodSource();
    this.stopHls();
    this.clearSeek();
    this.wantAt = live || !Number.isFinite(resume) ? 0 : Math.max(0, resume);
    this.langNoticed = oldUrl === url && this.langNoticed;
    this.panelFallback = false;
    this.panelPlain = false;
    this.panelVideo = false;
    this.panelReturn = null;
    this.audioRemuxTried.clear();
    this.reused = live && this.hadLive;
    if (live) this.hadLive = true;
    this.url = url;
    this.live = live;
    this.liveAudio = 0;
    this.liveNoAudio = false;
    this.liveFrozen = 0;
    this.mp4Audio = -1;
    this.audioByUser = false;
    this.langGaveUp = false;
    this.mp4Index = null;
    this.mkvIndex = null;
    this.mp4Paused = false;
    this.pendingSub = '';
    this.readerLang = '';
    this.probe = live ? null : knownNow(url);
    this.probing = false;
    this.remux = null;
    this.offset = 0;
    this.realDur = 0;
    this.audioKey = '';
    this.subKey = '';
    this.audioApplied = false;
    this.subApplied = false;
    this.setExt(null);
    this.subWait = null;
    this.nativeTried = false;
    this.readerTried = false;
    this.staleIndexRetried = false;
    this.mkvBody = false;
    this.mp4Why = '';
    this.nativeNote = '';
    this.direct(this.wantAt);
    if (!live && !this.probe && readerFile.test(url)) {
      const g = this.gen;
      knownTracks(url).then(p => {
        if (g !== this.gen || !p.ok || this.probe?.ok || (this.mse && this.mse.tracks.length >= p.audio.length)) return;
        this.probe = p;
        this.schedulePrefs();
      }).catch(() => {});
    }
  }

  // canal en vivo por HLS con el lector propio
  private openLive(url: string): void {
    const g = this.gen;
    this.liveNative = false;
    this.stopNative();
    // primero el reproductor nativo de Vega con el .ts del canal (como Roku y LG: rápido y sin trabajo de la app, no se
    // entrecorta al recorrer la lista); si en este equipo no abre o ese canal falla, el lector propio
    if (!this.reused && nativeLivePlanned(url)) {
      this.openNative();
      return;
    }
    // MPEG-TS: el canal que en MP4 propio no se vio o se congeló (alternando); nunca el que en MPEG-TS no mostró imagen
    const k = liveKey(url);
    const ts = !tsBadLive.has(k) && (mp4BadLive.has(k) || (this.liveFrozen > 0 && this.liveFrozen % 2 === 0));
    const h = new LiveHls(this.v, url, this.liveAudio, this.liveNoAudio, ts);
    h.keep = this.liveKeep;
    this.liveHls = h;
    h.onError = why => g === this.gen && this.liveHls === h && this.hooks.liveFailed?.(why);
    h.onStalls = () => g === this.gen && this.liveHls === h && this.hooks.liveStalls?.(h.diag());
    // empieza a sonar el lector cuando tiene 2 segmentos (con margen), no antes
    h.start().then(err => {
      if (err && g === this.gen && this.liveHls === h) this.hooks.liveFailed?.(err);
    });
  }

  // la miniatura se cierra para abrir el canal en pantalla grande: el lector deja lista y segmentos y suelta la conexión
  handOffLive(): void {
    this.liveHls?.handOff();
  }

  // el lector del canal pausó a propósito para juntar margen (Player muestra «cargando», no «en pausa»)
  liveHolding(): boolean {
    return !!this.liveHls?.holding;
  }

  // estado del canal por HLS (para el reporte): lista, segmentos entregados, lo que tiene el reproductor
  // compatibilidad (pruebas): true = sigue en este reproductor
  liveRetryTs(): boolean {
    return this.liveNext() === 'here';
  }

  // El canal falló (error, sin imagen, imagen quieta). Qué sigue, sin pasar por otro formato ni protocolo: el servidor
  // contestó; lo que no anduvo es la forma de mostrarlo en este equipo
  liveNext(): LiveNext {
    if (!this.live) return '';
    const k = liveKey(this.url);
    // el reproductor nativo no pudo (error, sin imagen o imagen quieta)
    if (this.liveNative) {
      this.httpCheck();
      this.stopNative();
      if (!this.played) {
        const n = (nativeMiss.get(k) || 0) + 1;
        nativeMiss.set(k, n);
        // el primero: el nativo otra vez con un reproductor nuevo (si el equipo no rechazó http al instante)
        if (n < 2 && nativeLivePlanned(this.url)) return 'fresh';
        nativeFailedOnce('live');
        // dos seguidos con reproductores nuevos: los próximos días va directo al lector de la app
        markNativeLiveBad(this.url, true);
      } else nativeMiss.set(k, 2);
      this.openLive(this.url);
      return 'here';
    }
    const h = this.liveHls;
    if (!h) return '';
    // Entregó el canal y el equipo no lo muestra (2.0.15): el nativo con un reproductor nuevo si se puede; si no, el otro
    // modo del lector (MPEG-TS ↔ MP4) en este mismo reproductor
    if (h.noShow) {
      if (h.isMp4()) mp4BadLive.add(k);
      else tsBadLive.add(k);
      h.destroy();
      this.liveHls = null;
      if (!this.played && nativeLivePlanned(this.url)) return 'fresh';
      if (mp4BadLive.has(k) && tsBadLive.has(k)) return '';
      this.openLive(this.url);
      return 'here';
    }
    // imagen congelada con video por delante: primero el reproductor nativo de Vega con el MPEG-TS del canal (con un
    // reproductor nuevo: el nativo no toma otra dirección en uno ya usado); si no, el canal otra vez alternando MP4
    // propio y MPEG-TS (solo este canal), hasta 6 veces; nunca la pantalla de error por esto
    if (h.frozen) {
      if (this.liveFrozen >= 6) return '';
      this.liveFrozen++;
      h.destroy();
      if (!this.reused && nativeLivePlanned(this.url)) {
        this.liveHls = null;
        return 'fresh';
      }
      this.openLive(this.url);
      return 'here';
    }
    // con audio MP2 / AC-3 lo que falló (error o sin imagen) es ese audio: el mismo canal en MP4 sin él (en MPEG-TS
    // Vega no mostraba imagen)
    // (si ya se veía, se reconecta igual: nunca se apaga el MP4 de toda la sesión por el audio de un canal)
    if (h.otherAudio()) {
      if (this.liveNoAudio || this.hasPlayed()) return '';
      this.liveNoAudio = true;
    } else if (h.isMp4() && (h.mediaFailed() || (this.v as any).error)) {
      // el reproductor rechazó el MP4 propio de este canal: este canal en MPEG-TS (con 3 canales, todo el equipo)
      mp4BadLive.add(k);
      if (mp4BadLive.size >= 3) disableMp4();
    } else return '';
    h.destroy();
    this.openLive(this.url);
    return 'here';
  }

  // el canal todavía no se ve pero sigue llegando video (segmentos largos o servidor lento)
  liveBusy(): boolean {
    return !!this.liveHls && Date.now() - this.liveHls.lastData < 8000;
  }

  liveDiag(): string {
    if (this.liveNative) return 'modo=nativo (.ts directo) t=' + (this.v.currentTime || 0).toFixed(1);
    return this.liveHls ? this.liveHls.diag() : '';
  }

  // El canal con el reproductor de Vega en modo directo (.ts, Vega OS 2.0): lo que hacen Roku y LG. Si en 20 s no
  // empieza, da error o la imagen queda quieta 8 s sonando, Player vuelve al lector propio (liveRetryTs)
  private openNative(): void {
    const g = this.gen;
    this.stopNative();
    this.liveNative = true;
    this.nativeAt = Date.now();
    this.v.src = this.url.replace(/\.m3u8(\?|$)/i, '.ts$1');
    this.v.play();
    const began = Date.now();
    let last = -1;
    let still = began;
    this.nativeDog = setInterval(() => {
      if (g !== this.gen || !this.liveNative) {
        this.stopNative();
        return;
      }
      const t = this.v.currentTime || 0;
      if (t !== last) {
        last = t;
        still = Date.now();
      }
      // sin empezar: 10 s; si el equipo ya recibe el canal (readyState, algo bajado) hasta 18 s (servidor lento al
      // cambiar de canal: antes a los 10 s se daba el nativo por perdido con el canal llegando)
      let loading = false;
      try {
        loading = ((this.v as any).readyState || 0) >= 1 || ((this.v as any).buffered?.length || 0) > 0;
      } catch {
        loading = false;
      }
      if (!this.v.paused && Date.now() - still > 8000 && (t > 0 || Date.now() - began > (loading ? 18000 : 10000))) {
        this.stopNative();
        this.hooks.liveFailed?.(t > 0 ? 'nativo: imagen quieta' : 'nativo: no empezó');
      }
    }, 1000);
  }

  private stopNative(): void {
    if (this.nativeDog) clearInterval(this.nativeDog);
    this.nativeDog = null;
  }

  private direct(at: number, route?: 'native' | 'reader'): void {
    if (!this.live) {
      this.wantAt = at;
      this.played = false;
      this.audioChange++;
      if (this.audioTimer) clearTimeout(this.audioTimer);
      this.audioTimer = null;
      this.audioKey = '';
      this.releaseVodSource();
      this.audioApplied = false;
      this.subApplied = false;
      this.subKey = '';
      this.subWait = null;
      this.setExt(null);
      this.hooks.vodStarting?.(at);
    }
    this.stopHls();
    const g = this.gen;
    const open = () => {
      if (g === this.gen) this.startDirect(at, route);
    };
    if (this.shakaRelease) void this.shakaRelease.then(open);
    else open();
  }

  private startDirect(at: number, route?: 'native' | 'reader'): void {
    this.offset = 0;
    this.clearSeek();
    if (this.live) {
      if (/\.m3u8(\?|$)/i.test(this.url) && LiveHls.supported()) this.openLive(this.url);
      else if (manifestFile.test(this.url)) this.openAdaptive(0);
      else {
        this.v.src = this.url;
        void this.v.play();
      }
      return;
    }
    if (manifestFile.test(this.url)) {
      this.openAdaptive(at);
      return;
    }
    if (route === 'native' || (!route && this.nativeVodPlanned(this.url, at))) {
      this.openNativeVod(at);
      return;
    }
    if (readerFile.test(this.url)) {
      this.openReader(at);
      return;
    }
    this.failVod(at, 'URL directa no disponible');
  }

  private openReader(at: number): void {
    this.readerTried = true;
    const g = this.gen;
    const mkv = /\.mkv([?#]|$)/i.test(this.url) || this.mkvBody || mkvKnown(this.url);
    const want = this.mp4Audio;
    const language = want < 0 ? this.readerLang || titleLangOf(this.url) : '';
    const m = mkv ? new MkvMse(this.v, this.url, want, this.mkvIndex, language)
      : Mp4Mse.open(this.v, this.url, want, this.mp4Index, language);
    this.mse = m;
    const active = () => g === this.gen && this.mse === m;
    m.onHeader = () => {
      if (!active()) return;
      if (m instanceof MkvMse) this.probe = m.probe() || this.probe;
      else {
        if (m.index) this.mp4Index = m.index;
        this.readerSubs(m);
        this.shareReaderTracks(m);
      }
      this.hooks.changed();
    };
    m.onTracks = () => {
      if (!active()) return;
      this.vodReady = true;
      if (m instanceof MkvMse) {
        this.mkvIndex = m.index;
        this.probe = m.probe() || this.probe;
      } else {
        this.mp4Index = m.index;
        this.readerSubs(m);
      }
      this.shareReaderTracks(m);
      if (this.mp4Paused) {
        this.mp4Paused = false;
        m.cancelPlay();
        this.v.pause();
        this.clearVodTimer();
        // El usuario cambió una pista en pausa. El lector ya está en el punto elegido.
        this.played = true;
        this.hooks.vodPlaying?.();
      }
      if (this.pendingSub) {
        const sub = this.subItems().find(i => i.key === this.pendingSub);
        this.pendingSub = '';
        if (sub) this.pickSub(sub, true);
      }
      this.applyPrefs();
      this.hooks.changed();
    };
    m.onError = () => {
      if (active()) this.readerGaveUp(m.why);
    };
    this.watchVod('reader');
    m.start(at).then(err => {
      if (!active()) return;
      if (err) {
        if (!mkv && err.includes(NOT_MP4_MKV)) {
          this.mkvBody = true;
          this.direct(this.resumePos(), 'reader');
        } else this.readerGaveUp(err);
        return;
      }
      // 2.1.5: el idioma guardado del título (elegido antes aquí o en otro equipo, p. ej. Roku con el audio que preparó el
      // panel) no suena en este equipo con el lector: sigue con el audio predeterminado del archivo, sin el panel. El panel
      // solo si el idioma se elige ahora en el menú
      const def = Math.max(0, m.tracks.findIndex(tr => (tr as { def?: boolean }).def));
      if (m.noAudio && !this.audioByUser && !this.langGaveUp && m.audioIdx !== def) {
        this.langGaveUp = true;
        this.mp4Audio = def;
        this.direct(this.resumePos(), 'reader');
        return;
      }
      if (m.noAudio && (want < 0 || !this.audioByUser) && !this.nativeTried && !nativeLost.has(fileKey(this.url)) && nativeVodAllowed(this.url)) {
        this.direct(this.resumePos(), 'native');
        return;
      }
      const lost = m.noAudio ? (want >= 0 ? want : Math.max(0, m.audioIdx)) : want >= 0 && m.audioIdx !== want ? want : -1;
      // el lector abrió otra pista que la guardada y suena: sigue así (sin el panel)
      if (lost >= 0 && !m.noAudio && !this.audioByUser) {
        this.langGaveUp = true;
        return;
      }
      if (lost >= 0 && !this.audioRemuxTried.has(lost)) {
        this.audioRemuxTried.add(lost);
        const label = this.audioItems().find(i => i.mp4 === lost)?.label || t('Audio predeterminado');
        void this.toRemux(lost, label, true, t('Este equipo no reproduce el audio {x}: se prepara con el panel…', { x: label }), this.resumePos());
      }
    }).catch(() => {
      if (active()) this.readerGaveUp('no se pudo preparar el archivo');
    });
  }

  // Los idiomas que leyó el lector (índice del MP4 entero, cabecera del MKV) al panel (tracks.php): así los equipos que
  // abren el mismo video con el reproductor nativo ven todos los idiomas sin leer nada del servidor IPTV (2.0.16)
  private shareReaderTracks(m: Mp4Mse | MkvMse): void {
    if (m instanceof MkvMse) {
      const p = m.probe();
      if (p?.ok) shareTracks(this.url, p);
      return;
    }
    // (un índice a medias no trae todas las pistas)
    if (!m.index || !m.tracks.length) return;
    shareTracks(this.url, {
      ok: true,
      container: 'mp4',
      audio: m.tracks.map((tr, i) => ({ id: String(i), lang: tr.lang, codec: tr.codec, name: '', def: !!tr.def, forced: false })),
      subs: m.subList(),
    });
  }

  nativeVodPlanned(url: string, at: number): boolean {
    if (!nativeVodAllowed(url) || nativeLost.has(fileKey(url))) return false;
    // Con el índice ya leído (la ficha lo leyó mientras se miraba, o el título ya se abrió) el lector pide de una vez el
    // video: una sola espera del servidor IPTV. El reproductor de Amazon pide cabecera, índice y video: ~12 s (2.1.3)
    // 2.1.4: Continuar viendo (at > 5) también con el lector, como hasta 2.0.17: el de Amazon empezaba en 0 y saltaba al
    // segundo guardado sin mostrar nada (pantalla negra, el tiempo quieto); queda de respaldo si el lector no puede
    if (readerFile.test(url) && (at > 5 || mkvReady(url) || mp4Ready(url))) return false;
    return true;
  }

  private openNativeVod(at: number): void {
    const g = this.gen;
    dropWarm(this.url);
    dropMkvWarm(this.url);
    dropPrefetch(this.url);
    this.nativeTried = true;
    this.vodNative = true;
    this.vodReady = true;
    this.nativeMeta = false;
    this.nativeAt = Date.now();
    this.watchVod('native');
    try {
      if (at > 5) {
        try {
          this.restoreMuted = !!this.v.muted;
          this.v.muted = true;
        } catch { this.restoreMuted = null; }
      }
      // Mismo User-Agent que la lectura local del servidor.
      if (typeof this.v.setSrcWithCustomHeaders === 'function') this.v.setSrcWithCustomHeaders(this.url, { 'User-Agent': UA });
      else this.v.src = this.url;
      if (g === this.gen && this.vodNative) {
        void this.v.play().catch(() => {
          if (g === this.gen && this.vodNative) this.nativeGaveUp('el reproductor no inició');
        });
      }
    } catch {
      if (g === this.gen && this.vodNative) this.nativeGaveUp('el reproductor no aceptó la URL');
    }
  }

  private releaseVodSource(): void {
    if (this.probing) stopProbe(this.url);
    if (!this.vodReady && !this.vodNative && !this.mse && !this.remuxLive && !this.hls?.attached) return;
    this.vodReady = false;
    this.resettingVod = true;
    try {
      this.v.pause();
      // removeAttribute + load libera la URL sin emitir el error de asignar src = ''.
      if (!this.shaka && typeof this.v.removeAttribute === 'function' && typeof this.v.load === 'function') {
        this.v.removeAttribute('src');
        this.v.load();
      }
    } catch {
      // El próximo intento asignará su propia fuente.
    } finally {
      this.resettingVod = false;
    }
  }

  private nativeGaveUp(why: string): void {
    this.httpCheck();
    const pos = this.resumePos();
    this.nativeNote = nativeHttpOk(this.url) ? why : 'http_rechazado';
    if (!this.readerTried && readerFile.test(this.url)) {
      // 2.1.4: el reproductor de Amazon llegó a abrir el archivo (Vega OS 2.0): ese mismo reproductor después no muestra el
      // lector de la app (pantalla negra; lo mismo que «el equipo no aceptó el MP4 del lector» en los canales). El lector
      // va en uno nuevo. Con http rechazado al instante (Vega OS antes de 2.0) sigue en este, como siempre
      if (nativeHttpOk(this.url) && this.hooks.vodFresh) {
        nativeLost.add(fileKey(this.url));
        this.clearVodTimer();
        this.releaseVodSource();
        this.hooks.vodFresh(pos);
        return;
      }
      this.direct(pos, 'reader');
    } else this.failVod(pos, why);
  }

  private readerGaveUp(why: string): void {
    const pos = this.resumePos();
    this.mp4Why = why + (this.mse ? ' ' + this.mse.diag() : '');
    if (why.includes(STALE_INDEX) && !this.staleIndexRetried) {
      this.staleIndexRetried = true;
      this.mp4Index = null;
      this.mkvIndex = null;
      this.direct(pos, 'reader');
    } else if (!this.nativeTried && !nativeLost.has(fileKey(this.url)) && nativeVodAllowed(this.url)) this.direct(pos, 'native');
    else this.failVod(pos, why);
  }

  private openAdaptive(at: number): void {
    const g = this.gen;
    const s = new ShakaPlayback(this.v);
    this.shaka = s;
    const active = () => g === this.gen && this.shaka === s;
    s.onTracks = () => {
      if (!active()) return;
      this.applyPrefs();
      this.hooks.changed();
    };
    s.onError = () => { if (active()) this.adaptiveFallback(); };
    if (!this.live) this.watchVod('adaptive');
    s.start(this.url, at, titleLangOf(this.url), this.live).then(() => {
      if (active() && !this.live) this.vodReady = true;
    }).catch(() => {
      if (active()) this.adaptiveFallback();
    });
  }

  adaptiveFallback(): boolean {
    if (!this.shaka) return false;
    if (this.live) {
      // Las rutas en vivo conservan su transición al lector de canales.
      this.stopHls();
      const g = this.gen;
      void (this.shakaRelease || Promise.resolve()).then(() => {
        if (g !== this.gen) return;
        this.v.src = this.url;
        void this.v.play();
      });
    } else this.failVod(this.resumePos(), 'manifiesto HLS/DASH');
    return true;
  }

  // Solo hay un vigilante de arranque por fuente.
  private watchVod(route: VodRoute): void {
    this.clearVodTimer();
    const watch = this.vodWatch;
    const began = Date.now();
    const initial = route === 'native' ? Math.min(21000, Math.max(12000, hostStats(this.url).wait * 2 + 3000))
      : route === 'reader' ? 24000 : route === 'adaptive' ? 26000 : 28000;
    const check = () => {
      const now = Date.now();
      const elapsed = now - began;
      if (this.played || watch !== this.vodWatch) return;
      this.onTime();
      if (this.played || watch !== this.vodWatch) return;
      const pending = route === 'native'
        ? this.seekIssuedAt ? now - this.seekIssuedAt < 9000 && elapsed < 36000
          : (this.nativeMeta || this.v.readyState >= 1 || !!this.v.buffered?.length) && elapsed < initial + 8000
        : route === 'reader' && elapsed < 85000 && !!this.mse?.busy();
      if (elapsed < initial || pending) {
        this.vodTimer = setTimeout(check, 1000);
        return;
      }
      this.vodTimer = null;
      if (route === 'native') this.nativeGaveUp('sin imagen en ' + Math.round(elapsed / 1000) + ' s');
      else if (route === 'reader') this.readerGaveUp('sin imagen en ' + Math.round(elapsed / 1000) + ' s');
      else if (route === 'panel') this.remuxFailed(t('el reproductor no pudo abrirlo'));
      else this.adaptiveFallback();
    };
    this.vodTimer = setTimeout(check, 750);
  }

  private clearVodTimer(): void {
    this.vodWatch++;
    if (this.vodTimer) clearTimeout(this.vodTimer);
    this.vodTimer = null;
  }

  private failVod(at: number, why: string): void {
    this.played = false;
    this.wantAt = at;
    this.releaseVodSource();
    this.stopHls();
    this.clearSeek();
    this.mp4Why ||= why;
    this.hooks.vodStarting?.(at);
    if (this.hooks.vodFailed) this.hooks.vodFailed(at);
    else this.hooks.fatal(t('No se pudo reproducir este contenido.'));
  }

  vodError(why?: string): void {
    if (this.live || this.resettingVod) return;
    const detail = why || 'error del reproductor' + (this.v.error?.code ? ' ' + this.v.error.code : '');
    if (this.remux) {
      if (this.hls?.attached) this.remuxFailed(t('el reproductor no pudo abrirlo'));
    } else if (this.vodNative) this.nativeGaveUp(detail);
    else if (this.mse && this.vodReady) this.readerGaveUp(detail);
    else if (this.shaka && this.vodReady) this.adaptiveFallback();
  }

  // error 4 apenas se le dio una dirección http al nativo: el sistema no admite http en modo directo (Vega OS antes de 2.0)
  private httpCheck(): void {
    const e: any = (this.v as any).error;
    const cleartext = /cleartext|insecure (protocol|scheme)|http.*not (allowed|supported)/i.test(e?.message || '');
    // (2.1.2: también si el equipo no dice su versión —solo trae keplerOSVariant—: el error 4 al instante con http es el
    // rechazo de Vega OS antes de 2.0; sin esto el nativo se probaba en cada película y la ficha no preparaba nada)
    const unknownOs = !/\d/.test(osVersion());
    if (e?.code === 4 && /^http:/i.test(this.url) && (cleartext || ((osBefore2() || unknownOs) && Date.now() - this.nativeAt < 500)) && nativeRejectedHttp()) {
      // una vez por sesión: con Vega OS anterior a 2.0, cómo hacer que todo abra al instante
      const v = osVersion();
      if (osBefore2(v)) this.hooks.toast(t('Este Fire TV tiene Vega OS {v}. Actualízalo a Vega OS 2.0 (Configuración › Mi Fire TV › Acerca de › Buscar actualizaciones) para que las películas y los canales abran al instante.', { v }));
      // (2.1.0) el equipo no dice su versión (Platform.constants solo trae keplerOSVariant): el mismo consejo sin el número
      else if (!/\d/.test(v)) this.hooks.toast(t('El sistema de este Fire TV no abre los videos con el reproductor de Amazon. Actualízalo a Vega OS 2.0 (Configuración › Mi Fire TV › Acerca de › Buscar actualizaciones) para que las películas y los canales abran más rápido.'));
    }
  }

  // con qué se está viendo la película (para el aviso de apertura lenta). 2.1.1: también qué pasó con el reproductor de
  // Amazon (reproductor_amazon=): http_rechazado (el sistema no admite http en modo directo: Vega OS antes de 2.0),
  // error, lento (no empezó en sus plazos), abrió o no_probado
  vodMode(): string {
    const m = this.vodNative ? 'nativo' : this.mse ? 'lector ' + (this.mse instanceof MkvMse ? 'mkv ' : 'mp4 ') + this.mse.diag() : this.shaka ? 'shaka' : this.remux ? 'panel' : 'directo';
    const amazon = this.nativeNote || (!nativeHttpOk(this.url) ? 'http_rechazado' : nativeKnownGood('vod') ? 'abre_en_este_equipo' : 'no_probado');
    return m + (this.mp4Why ? ' (' + this.mp4Why + ')' : '') + ' reproductor_amazon=' + amazon;
  }
  private nativeNote = '';

  private clearSeek(): void {
    this.seekIssuedAt = 0;
    this.resumeSample = null;
    if (this.restoreMuted !== null) {
      const muted = this.restoreMuted;
      this.restoreMuted = null;
      try { this.v.muted = muted; } catch { /* La fuente ya se cerró. */ }
    }
  }

  // Solo se guarda la posición real después de confirmar la reproducción.
  resumePos(): number {
    return this.played ? this.realPos() : this.wantAt;
  }

  seeking(): boolean {
    return !this.played && this.wantAt > 5;
  }

  hasPlayed(): boolean {
    return this.played;
  }

  async panelOpen(at: number): Promise<boolean> {
    if (this.live || engineDenied()) return false;
    const it = this.startAudio(this.probe?.ok ? this.audioItems() : []);
    this.panelFallback = true;
    const ok = await this.toRemux(it.a, it.label, false, '', at);
    if (!ok) this.panelFallback = false;
    return ok;
  }

  private stopHls(): void {
    if (this.shaka) {
      const s = this.shaka;
      this.shaka = null;
      const done = s.destroy().catch(() => {});
      this.shakaRelease = done;
      done.then(() => { if (this.shakaRelease === done) this.shakaRelease = null; });
    }
    this.mse?.destroy();
    this.mse = null;
    this.hls?.destroy();
    this.hls = null;
    this.prevHls?.destroy();
    this.prevHls = null;
    this.liveHls?.destroy();
    this.liveHls = null;
    this.stopNative();
    this.liveNative = false;
    this.vodNative = false;
    this.clearVodTimer();
    if (this.nativeSubTimer) clearTimeout(this.nativeSubTimer);
    this.nativeSubTimer = null;
    this.vodReady = false;
    this.remuxLive = false;
  }

  destroy(): Promise<void> {
    this.gen++;
    this.audioChange++;
    this.played = false;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = null;
    if (!this.live) this.releaseVodSource();
    this.clearSeek();
    this.stopHls();
    this.setExt(null);
    this.subWait = null;
    if (this.prefsTimer) clearTimeout(this.prefsTimer);
    this.prefsTimer = null;
    return this.shakaRelease || Promise.resolve();
  }

  // segundo real del contenido (el HLS del panel empieza en offset)
  realPos(): number {
    const current = Number.isFinite(this.v.currentTime) ? Math.max(0, this.v.currentTime) : 0;
    if (this.mse instanceof MkvMse) return this.mse.timeOf(current);
    return this.offset + current;
  }

  duration(): number {
    if (this.remux) {
      if (this.realDur > 0) return this.realDur;
      return this.hls?.done() ? this.offset + this.hls.listed() : 0;
    }
    const duration = this.v.duration;
    if (!Number.isFinite(duration) || duration <= 0) return 0;
    this.realDur = this.mse instanceof MkvMse ? this.mse.timeOf(duration) : duration;
    return this.realDur;
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
    if (this.mse) {
      this.mse.seekTo(target);
      return;
    }
    this.v.currentTime = target;
  }

  onMeta(): void {
    if (this.vodNative) this.nativeMeta = true;
    this.schedulePrefs();
  }

  // En URL mode se puede saltar antes de mostrar el principio cuando Vega
  // ya tiene datos y expone el intervalo. En otros casos se espera a playing.
  onCanPlay(): void {
    if (!this.vodNative || !this.seeking() || this.seekIssuedAt) return;
    const ranges = this.v.seekable;
    for (let i = 0; ranges && i < ranges.length; i++) {
      if (this.wantAt >= ranges.start(i) && this.wantAt < ranges.end(i)) {
        this.issueResumeSeek();
        break;
      }
    }
  }

  private issueResumeSeek(): void {
    this.seekIssuedAt = Date.now();
    try {
      this.v.currentTime = this.wantAt;
    } catch {
      this.nativeGaveUp('el salto al segundo guardado no se pudo iniciar');
    }
  }

  onTime(): void {
    if (this.live || this.played || !this.vodReady || this.v.paused) return;
    const pos = this.realPos();
    if (!this.seeking()) {
      if (pos > 0.15) this.markPlaying();
      return;
    }
    if (this.vodNative && !this.seekIssuedAt) {
      if (pos > 0.15) this.issueResumeSeek();
      return;
    }
    // currentTime puede saltar al destino aunque el decodificador siga esperando.
    if (pos < this.wantAt - 0.25 || this.v.seeking) {
      this.resumeSample = null;
      return;
    }
    if (this.resumeSample === null || pos < this.resumeSample) this.resumeSample = pos;
    else if (pos - this.resumeSample >= 0.1) this.markPlaying();
  }

  onPlaying(): void {
    if (this.played || this.resettingVod) return;
    if (!this.live && !this.vodReady) return;
    if (this.seeking()) {
      if (this.vodNative && !this.seekIssuedAt) this.issueResumeSeek();
      this.onTime();
      return;
    }
    this.markPlaying();
  }

  private markPlaying(): void {
    this.clearSeek();
    this.clearVodTimer();
    this.played = true;
    if (this.vodNative && this.mp4Paused) {
      this.mp4Paused = false;
      this.v.pause();
    }
    if (this.liveNative) {
      nativeWorked('live');
      nativeLiveGood(this.url);
      nativeMiss.delete(liveKey(this.url));
    }
    if (this.vodNative) {
      nativeWorked('vod');
      this.nativeNote = 'abrio';
    }
    if (this.live) return;
    this.schedulePrefs();
    // Si la línea tiene capacidad, se puede completar el catálogo de pistas
    // desde el archivo. En una línea de una conexión el menú ofrece el lector local.
    if (!this.probing && this.vodNative && readerFile.test(this.url) && !this.probe?.ok && lineLimit() > 1 && !isSingle(this.url)) {
      this.probing = true;
      const g = this.gen;
      fileTracks(this.url, true).then(p => {
        if (g !== this.gen || !this.vodNative || !p.ok) return;
        this.probe = p;
        this.schedulePrefs();
      }).catch(() => {});
    }
    this.hooks.changed();
    this.hooks.vodPlaying?.();
  }

  private langNotice(): void {
    const n = this.audioItems().length;
    if (this.live || n < 2 || this.langNoticed) return;
    this.langNoticed = true;
    this.hooks.toast(t('{n} idiomas de audio en este video: pulsa ▼ para cambiar', { n }));
  }

  // ---------- listas ----------

  private nativeAudio() {
    const list = this.v.audioTracks as typeof this.v.audioTracks & ArrayLike<AudioTrack>;
    return Array.from({ length: list?.length || 0 }, (_, index) => {
      const track = list[index];
      return track && { index, id: track.id, label: track.label || '', language: track.language || '', enabled: !!track.enabled, track };
    }).filter(Boolean);
  }

  private nativeSubs() {
    const list = this.v.textTracks as typeof this.v.textTracks & ArrayLike<TextTrack>;
    return Array.from({ length: list?.length || 0 }, (_, index) => {
      const track = list[index];
      return track && { index, id: track.id, label: track.label || '', language: track.language || '', kind: track.kind, showing: track.mode === 'showing' };
    }).filter(track => track && (!track.kind || track.kind === 'subtitles' || track.kind === 'captions'));
  }

  private matchNative(
    native: { label: string; language: string }[],
    probe: { name: string; lang: string }[],
  ): number[] {
    const norm = (s: string) => s.trim().toLowerCase();
    const languages = native.map(track => trackLang(track.language, track.label));
    const known = probe.map(track => trackLang(track.lang, track.name));
    const sameOrder = native.length === probe.length && languages.every((lang, i) => !lang || !known[i] || lang === known[i]);
    const indices = native.map((track, i) => {
      const lang = languages[i];
      const label = norm(track.label);
      const matches = probe.flatMap((other, j) => {
        if (lang && known[j] && lang !== known[j]) return [];
        return (label && label === norm(other.name || '')) || (lang && lang === known[j]) ? [j] : [];
      });
      const exact = label ? matches.filter(j => label === norm(probe[j].name || '')) : [];
      if (exact.length === 1) return exact[0];
      if (matches.length === 1 && languages.filter(x => x === lang).length === 1) return matches[0];
      return sameOrder ? i : -1;
    });
    return indices.map(index => index >= 0 && indices.indexOf(index) === indices.lastIndexOf(index) ? index : -1);
  }

  private audioItems(): AudioItem[] {
    if (this.shaka) return this.shaka.audioTracks().map(tr => ({ key: 's:' + tr.id, label: tr.label, lang: tr.lang, codec: tr.codec, shaka: tr.id }));
    if (this.mse?.tracks.length) {
      // 2.1.1: con el índice a medias el lector todavía no vio todas las pistas; si el panel conoce más (otro equipo las
      // leyó), el menú las muestra todas (mismo orden que en el archivo) y elegir una que falta lee ese resto
      const pr = this.probe?.ok ? this.probe.audio : [];
      const list = this.mse instanceof Mp4Mse && pr.length > this.mse.tracks.length ? pr.map(x => ({ lang: x.lang, codec: x.codec })) : this.mse.tracks;
      return numbered(list.map((tr, i) => ({
        key: 'm:' + i, label: langName(tr.lang, '') || t('Audio {n}', { n: i + 1 }), lang: tr.lang, codec: tr.codec, mp4: i, probe: i,
      })));
    }
    // canal con varios idiomas (lector propio): uno por audio del canal
    const hl = this.live && this.liveHls ? this.liveHls.audioLangs() : [];
    if (hl.length > 1) return numbered(hl.map((l, i) => ({ key: 'h:' + i, label: langName(l, '') || t('Audio {n}', { n: i + 1 }), lang: trackLang(l, ''), codec: '' })));
    const nat = this.remux ? [] : this.nativeAudio();
    const pr = this.probe?.ok ? this.probe.audio : [];
    const match = this.matchNative(nat, pr);
    const native: AudioItem[] = nat.map((tr, i) => {
      const p = pr[match[i]];
      const label = tr.label || p?.name || '';
      const lang = tr.language || p?.lang || '';
      return {
        key: 'n:' + (tr.id || '#' + tr.index), trackId: tr.id,
        label: langName(lang, label) || t('Audio {n}', { n: i + 1 }),
        lang: trackLang(lang, label), codec: p?.codec || '', native: tr.index,
        probe: p ? match[i] : undefined,
      };
    });
    const extra: AudioItem[] = pr.flatMap((tr, i) => match.includes(i) ? [] : [{
      key: 'p:' + i, label: langName(tr.lang, tr.name) || t('Audio {n}', { n: i + 1 }),
      lang: trackLang(tr.lang, tr.name), codec: tr.codec, probe: i,
    }]);
    return numbered([...native, ...extra]);
  }

  private subItems(): SubItem[] {
    const nat = this.mse || this.remux ? [] : this.nativeSubs();
    const pr = this.probe?.ok ? this.probe.subs : [];
    const match = this.matchNative(nat, pr);
    const native: SubItem[] = nat.map((tr, i) => {
      const p = pr[match[i]];
      const lang = tr.language || p?.lang || '';
      const name = tr.label || p?.name || '';
      const label = langName(lang, name) || t('Subtítulos {n}', { n: i + 1 });
      return {
        key: 'n:' + (tr.id || '#' + tr.index), label: label + (p?.forced ? ' · ' + t('forzados') : ''),
        lang: trackLang(lang, name), image: imageSub(p?.codec || ''),
        native: tr.index, probe: p ? match[i] : undefined,
      };
    });
    const extra: SubItem[] = pr.flatMap((tr, i) => {
      if (match.includes(i)) return [];
      const label = langName(tr.lang, tr.name) || t('Subtítulos {n}', { n: i + 1 });
      return [{
        key: 'p:' + i, label: label + (tr.forced ? ' · ' + t('forzados') : ''),
        lang: trackLang(tr.lang, tr.name), image: imageSub(tr.codec), probe: i,
      }];
    });
    return numbered([...native, ...extra]);
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
    if (this.shaka) {
      const active = this.shaka.audioTracks().find(tr => tr.active);
      return items.find(it => it.shaka === active?.id);
    }
    if (this.mse) return items.find(it => it.mp4 === this.mse!.audioIdx);
    if (this.liveHls && items[0]?.key.startsWith('h:')) return items.find(i => i.key === 'h:' + this.liveHls!.audioIdx);
    if (this.remux) return items.find(i => i.probe === this.remux!.a);
    const n = this.enabledNative();
    if (n >= 0) {
      const m = items.find(i => i.native === n);
      if (m) return m;
    }
    return items.find(i => i.key === this.audioKey) || items.find(i => i.probe === this.probeDefault()) || items[0];
  }

  // el idioma que el usuario eligió para este título; sin elegir, ninguno (suena el predeterminado del archivo)
  private preferredAudio(items: AudioItem[]): AudioItem | undefined {
    const s = titleLang(this.url);
    if (!s) return undefined;
    return items.find(i => i.probe === s.a && sameLang(i.lang, s.l))
      || (s.n ? items.find(i => i.trackId === s.n && (!s.l || sameLang(i.lang, s.l))) : undefined)
      || items.find(i => sameLang(i.lang, s.l));
  }

  // pista con la que el panel abre el video cuando lo abre él (archivo que no abre directo, Continuar viendo): el idioma
  // elegido para este título o, sin elegir, la marcada del archivo como «Audio predeterminado» (así queda marcado
  // en el menú; antes salía marcado su idioma, p. ej. «Inglés»)
  private startAudio(items: AudioItem[]): { a: number; label: string } {
    const want = this.preferredAudio(items);
    const first = items.find(i => i.probe === this.probeDefault());
    return { a: (want || first)?.probe ?? 0, label: want ? want.label : t('Audio predeterminado') };
  }

  menu(): MenuItem[] {
    const out: MenuItem[] = [];
    const items = this.audioItems();
    const current = this.audioOn(items);
    for (const it of items) out.push({ kind: 'audio', key: it.key, label: it.label, on: it === current });
    if (this.vodNative && this.played && readerFile.test(this.url) && !this.probe?.ok) {
      out.push({ kind: 'local', key: 'tracks', label: t('Buscar más pistas en el archivo'), on: false });
    }
    if (this.shaka) {
      const subs = this.shaka.textTracks();
      out.push({ kind: 'text', key: 'off', label: t('Desactivados'), on: !subs.some(tr => tr.active) });
      for (const tr of subs) out.push({ kind: 'text', key: 's:' + tr.id, label: tr.label, on: tr.active });
      return out;
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
    if (m.kind === 'local') {
      if (this.vodNative && this.played && readerFile.test(this.url)) this.toReaderTracks();
      return;
    }
    if (m.kind === 'audio') {
      const audio = this.audioItems().find(i => i.key === m.key);
      if (audio) this.pickAudio(audio, true);
      return;
    }
    if (this.shaka) {
      const sub = this.shaka.textTracks().find(track => 's:' + track.id === m.key);
      if (m.key === 'off' || sub) {
        this.subApplied = true;
        this.subKey = m.key;
        if (sub) rememberLang('subs_lang', sub.lang);
        else setPref('subs_lang', 'off');
        this.shaka.selectText(sub?.id || null);
      }
      return;
    }
    const sub = this.subItems().find(i => i.key === m.key);
    if (m.key === 'off' || sub) this.pickSub(sub || null, true);
  }

  private toReaderTracks(audio?: AudioItem, sub?: SubItem, user = false): void {
    // 2.1.5: del reproductor de Amazon al lector para el idioma: en un reproductor nuevo desde este segundo (en el mismo
    // quedaba en negro, 2.1.4), que abre el lector con el idioma del título
    if (audio && !sub && this.vodNative && nativeHttpOk(this.url) && this.hooks.vodFresh) {
      setTitleLang(this.url, audio);
      nativeLost.add(fileKey(this.url));
      const pos = this.resumePos();
      this.clearVodTimer();
      this.releaseVodSource();
      this.hooks.vodFresh(pos);
      return;
    }
    const items = this.audioItems();
    this.readerLang = audio?.lang || this.audioOn(items)?.lang || '';
    this.mp4Audio = audio?.probe ?? (audio ? -1 : this.audioOn(items)?.probe ?? -1);
    this.mp4Paused = this.played && this.v.paused;
    if (sub?.probe !== undefined) this.pendingSub = 'p:' + sub.probe;
    this.audioByUser = user;
    if (audio && user) setTitleLang(this.url, audio);
    this.direct(this.resumePos(), 'reader');
  }

  private nativeSwitch(it: AudioItem, user: boolean): void {
    const choice = ++this.audioChange;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = null;
    this.enableNative(it.native!);
    const confirm = () => {
      const item = this.audioItems().find(x => x.key === it.key);
      const tracks = this.nativeAudio();
      if (item?.native === undefined || !tracks.find(track => track.index === item.native)?.enabled) return false;
      for (const track of tracks) {
        if (track.index !== item.native && track.enabled) {
          try { track.track.enabled = false; } catch { /* La pista ya cambió. */ }
        }
      }
      this.audioKey = item.key;
      if (user) {
        setTitleLang(this.url, item);
        this.hooks.toast(t('Audio: {x}', { x: item.label }));
      }
      this.hooks.changed();
      return true;
    };
    if (confirm()) return;
    const g = this.gen;
    this.audioTimer = setTimeout(() => {
      this.audioTimer = null;
      if (g !== this.gen || choice !== this.audioChange || this.remux) return;
      if (confirm()) return;
      if (this.vodNative && this.played && readerFile.test(this.url) && (it.probe !== undefined || it.lang)) {
        this.toReaderTracks(it, undefined, user);
      } else if (user) this.hooks.toast(t('Este equipo no pudo cambiar a {x}.', { x: it.label }));
    }, 1200);
  }

  // ---------- idioma preferido (Cuenta › Ajustes) ----------

  schedulePrefs(): void {
    if (this.prefsTimer) clearTimeout(this.prefsTimer);
    const g = this.gen;
    this.prefsTimer = setTimeout(() => {
      this.prefsTimer = null;
      if (g === this.gen) this.applyPrefs();
    }, 160);
  }

  private applyPrefs(): void {
    this.autoAudio();
    if (!this.live) this.autoSubs();
    this.langNotice();
    this.hooks.changed();
  }

  private autoAudio(): void {
    if (this.audioApplied || this.audioKey || this.live || this.langGaveUp) return;
    const want = this.preferredAudio(this.audioItems());
    if (!want) return;
    if (want.native === undefined && want.shaka === undefined && want.mp4 === undefined) {
      if (this.vodNative && this.played && readerFile.test(this.url) && want.probe !== undefined) {
        this.audioApplied = true;
        this.toReaderTracks(want);
      }
      return;
    }
    this.audioApplied = true;
    this.pickAudio(want, false);
  }

  private autoSubs(): void {
    if (this.subApplied || this.subKey) return;
    if (this.shaka) {
      const tracks = this.shaka.textTracks();
      if (!tracks.length) return;
      this.subApplied = true;
      const language = pref('subs_lang', 'off');
      const want = language !== 'off' ? tracks.find(tr => sameLang(tr.lang, language)) : undefined;
      this.shaka.selectText(want?.id || null);
      return;
    }
    const items = this.subItems();
    const language = pref('subs_lang', 'off');
    if (language === 'off') {
      this.setNativeSub(-1);
      return;
    }
    const want = items.find(i => sameLang(i.lang, language) && (i.native !== undefined || !!this.localCues(i)));
    if (want) {
      this.subApplied = true;
      this.pickSub(want, false);
    }
  }

  // ---------- audio ----------

  private enableNative(i: number): void {
    const track = (this.v.audioTracks as VideoPlayer['audioTracks'] & ArrayLike<AudioTrack>)?.[i];
    if (!track) return;
    try { track.enabled = true; } catch { /* El cambio se comprueba con el estado real. */ }
  }

  private pickAudio(it: AudioItem, user: boolean): void {
    if (it.native !== undefined && !this.mse && !this.shaka && !this.remux) {
      this.nativeSwitch(it, user);
      return;
    }
    this.audioChange++;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = null;
    if (it.shaka !== undefined && this.shaka) {
      if (this.shaka.selectAudio(it.shaka)) {
        this.audioKey = it.key;
        if (user) {
          setTitleLang(this.url, it);
          this.hooks.toast(t('Audio: {x}', { x: it.label }));
        }
        this.hooks.changed();
      }
      return;
    }
    if (it.mp4 !== undefined && this.mse) {
      if (this.mse.noAudio && this.mse.audioIdx === it.mp4) {
        // (2.1.5) el idioma guardado que no suena lo resuelve el lector al terminar de abrir (el predeterminado, sin el
        // panel); el panel solo si se elige ahora en el menú
        if (user) this.toRemux(it.mp4, it.label, user, t('Cambiando a {x}…', { x: it.label }));
        return;
      }
      if (this.mse.audioIdx !== it.mp4 || this.mse.noAudio) {
        // 2.1.0: el mismo lector cambia de idioma con lo ya bajado (sin abrir de nuevo ni esperar al servidor)
        if (this.mse instanceof Mp4Mse && !this.mse.noAudio && this.mse.switchAudio(it.mp4)) {
          this.mp4Audio = it.mp4;
        } else {
          const pos = this.resumePos();
          this.mp4Audio = it.mp4;
          this.audioByUser = user;
          this.mp4Paused = this.played && this.v.paused;
          this.direct(pos, 'reader');
        }
      }
      this.audioKey = it.key;
      if (user) {
        setTitleLang(this.url, it);
        this.hooks.toast(t('Audio: {x}', { x: it.label }));
      }
      this.hooks.changed();
      return;
    }
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
    if (!user || this.live || it.probe === undefined || this.remux?.a === it.probe) return;
    if (this.vodNative && readerFile.test(this.url)) {
      this.toReaderTracks(it, undefined, true);
      return;
    }
    const g = this.gen;
    const choice = this.audioChange;
    void this.toRemux(it.probe, it.label, true, t('Cambiando a {x}…', { x: it.label })).then(ok => {
      if (ok && g === this.gen && choice === this.audioChange) setTitleLang(this.url, it);
    });
  }

  // motor del panel; sin él, el texto del panel una sola vez por video y solo si lo pidió el usuario
  private async getEngine(user: boolean, what: 'audio' | 'sub' = 'audio'): Promise<Engine | null> {
    const g = this.gen;
    const r = await mediaEngine();
    if (g !== this.gen) return null;
    if (r.ok) return (this.engine = r.engine);
    this.denied(r.error, user, what);
    return null;
  }

  // el equipo no puede solo y el servidor (FFmpeg del panel) está apagado o sin permiso: se dice claro que hace falta
  // encenderlo y se avisa al panel (Reportes) con el motivo, el archivo y la pista
  private denied(msg: string, user: boolean, what: 'audio' | 'sub' = 'audio'): void {
    // cada vez que el usuario lo pide (antes una sola vez por video y después no pasaba nada)
    if (!user) return;
    this.hooks.toast(what === 'sub' ? t('Subtítulo no compatible con este equipo: es necesario encender el servidor.') : t('Audio no compatible con este equipo: es necesario encender el servidor.'));
    const ext = (this.url.match(/\.([A-Za-z0-9]{2,5})(\?|$)/) || [])[1] || '?';
    reportError('playback', what === 'sub' ? 'Subtítulo no compatible sin servidor' : 'Audio no compatible sin servidor',
      'motivo=' + msg + ' archivo=' + ext + ' lector=' + (this.shaka ? 'shaka' : this.mse ? (this.mse instanceof MkvMse ? 'mkv' : 'mp4') : 'directo') + (this.wantNote ? ' pedido=' + this.wantNote : ''), 'Reproductor');
  }

  // true = el panel empezó a preparar el video. note: aviso que se muestra solo si el motor está
  // (sin motor nada cambia: ni recarga, ni "preparando", ni reintentos)
  private async toRemux(a: number, label: string, user: boolean, note: string, at?: number): Promise<boolean> {
    if (this.live || this.remux?.a === a) return false;
    const g = this.gen;
    const choice = this.audioChange;
    const tr = this.probe?.audio[a];
    this.wantNote = label + (tr ? ' (' + (tr.codec || '?') + ')' : '');
    const e = await this.getEngine(user);
    if (g !== this.gen || choice !== this.audioChange) return false;
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
    const paused = this.played && this.v.paused;
    if (!prev) {
      if (!this.panelFallback && this.played && (this.vodNative || this.mse)) {
        this.panelReturn = {
          route: this.mse ? 'reader' : 'native',
          audio: this.mse && !this.mse.noAudio ? this.mse.audioIdx : -1,
          paused,
        };
      }
      this.wantAt = pos;
      this.played = false;
      this.releaseVodSource();
      this.stopHls();
      if (this.shakaRelease) {
        const g = this.gen;
        await this.shakaRelease;
        if (g !== this.gen || !this.remux || !this.engine) return;
      }
    }
    else {
      this.prevHls?.destroy();
      this.prevHls = prev;
    }
    this.remuxFrom = Math.floor(pos);
    const h = new PanelHls(this.v, hlsLink(this.engine, this.url, a, pos, { video: this.panelVideo, plain: this.panelPlain }));
    this.hls = h;
    h.onError = msg => this.hls === h && this.remuxFailed(msg);
    this.hooks.status(this.panelVideo ? t('Convirtiendo el video en el panel…') : this.panelFallback ? (this.wantAt > 0 && !this.played ? t('Preparando desde donde quedó…') : t('Preparando el video en el panel…')) : t('Cambiando idioma…'));
    const err = await h.start().catch(() => t('No se pudo conectar con el panel.'));
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
    this.wantAt = this.offset;
    this.clearSeek();
    this.played = false;
    this.remuxLive = true;
    this.vodReady = true;
    if (paused) {
      this.played = true;
      this.v.pause();
      this.hooks.vodPlaying?.();
    } else {
      this.watchVod('panel');
      void this.v.play().catch(() => { if (this.hls === h) this.remuxFailed(t('el reproductor no pudo abrirlo')); });
    }
    this.hooks.status('');
    this.hooks.toast(t('Audio: {x}', { x: label }));
    this.hooks.changed();
  }

  // el panel no pudo (sin ffmpeg, servidor caído…): se vuelve al video directo
  private remuxFailed(msg: string): void {
    // el video que el equipo no abrió (o Continuar viendo): por http si no se pudo conectar con la VPS / VDS (su
    // certificado), después con el video también convertido; si tampoco, el reproductor sigue con sus otros pasos
    if (this.panelFallback && this.remux) {
      const at = this.remuxLive ? this.realPos() : this.remuxFrom;
      if (!this.played && !engineDenied()) {
        if (!this.panelPlain && msg === t('No se pudo conectar con el panel.')) {
          this.panelPlain = true;
          void this.startRemux(at);
          return;
        }
        if (!this.panelVideo) {
          this.panelVideo = true;
          void this.startRemux(at);
          return;
        }
      }
      this.played = false;
      this.wantAt = at;
      this.releaseVodSource();
      this.remux = null;
      this.audioKey = '';
      this.panelFallback = false;
      this.stopHls();
      this.hooks.status('');
      this.hooks.changed();
      this.hooks.fatal(t(this.wantAt > 5 ? 'No se pudo continuar donde quedó' : 'No se pudo reproducir este contenido.'));
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
    const back = this.panelReturn;
    this.panelReturn = null;
    if (back) {
      this.mp4Audio = back.audio;
      this.mp4Paused = back.paused;
      this.direct(attached ? pos : this.remuxFrom, back.route);
    } else if (attached && !this.panelFallback) this.direct(pos);
    else {
      this.stopHls();
      this.hooks.fatal(t('No se pudo reproducir el audio de este contenido.'));
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
      if (tt[i]?.kind && !['subtitles', 'captions'].includes(tt[i].kind)) continue;
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
    if (this.nativeSubTimer) clearTimeout(this.nativeSubTimer);
    this.nativeSubTimer = null;
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
    this.subWait = null;
    if (user) rememberLang('subs_lang', it.lang);
    if (it.native !== undefined) {
      this.subWait = null;
      this.setExt(null);
      this.setNativeSub(it.native);
      const showing = () => this.nativeSubs().some(track => track.index === it.native && track.showing);
      if (user && showing()) this.hooks.toast(t('Subtítulos: {x}', { x: it.label }));
      else if (user) {
        const g = this.gen;
        this.nativeSubTimer = setTimeout(() => {
          this.nativeSubTimer = null;
          if (g !== this.gen || this.subKey !== it.key) return;
          if (showing()) this.hooks.toast(t('Subtítulos: {x}', { x: it.label }));
          else if (this.vodNative && it.probe !== undefined && !it.image && readerFile.test(this.url)) this.toReaderTracks(undefined, it);
          else {
            this.subKey = '';
            this.hooks.toast(t('Este subtítulo no se puede mostrar (es de imagen o el servidor no respondió).'));
          }
          this.hooks.changed();
        }, 900);
      }
      this.hooks.changed();
      return;
    }
    if (it.probe === undefined || this.live) return;
    if (user && this.vodNative && !it.image && readerFile.test(this.url)) {
      this.toReaderTracks(undefined, it);
      return;
    }
    // subtítulo de texto del MKV: lo lee la app junto con el video (como Android), sin servidor
    const local = this.localCues(it);
    if (local) {
      this.subWait = null;
      this.setNativeSub(-1);
      if (this.ext?.s !== it.probe || this.ext.cues !== local) this.setExt({ s: it.probe, cues: local });
      if (user) this.hooks.toast(t('Subtítulos: {x}', { x: it.label }));
      this.hooks.changed();
      return;
    }
    if (this.ext?.s === it.probe) return;
    // el servidor solo trabaja cuando el usuario elige (nunca por el idioma de Ajustes) y solo si el equipo no puede
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

  // textos de un subtítulo que la app lee del MKV (null = de imagen, otro formato o sin lector propio)
  private localCues(it: SubItem): Cue[] | null {
    if (it.probe === undefined || !this.mse) return null;
    // (2.1.0) también los de texto de un MP4 (tx3g / WebVTT): los lee el lector junto con el video
    return this.mse.subCues(it.probe);
  }

  // las pistas de subtítulos de texto que leyó el lector de MP4 van al menú si el panel no las conocía (2.1.0)
  private readerSubs(m: Mp4Mse): void {
    const subs = m.subList();
    if (!subs.length) return;
    if (!this.probe?.ok) {
      this.probe = { ok: true, container: 'mp4', audio: m.tracks.map((tr, i) => ({ id: String(i), lang: tr.lang, codec: tr.codec, name: '', def: !!tr.def, forced: false })), subs };
    } else if (!this.probe.subs.length) this.probe = { ...this.probe, subs };
  }

  private async extSub(s: number, label: string): Promise<void> {
    const g = this.gen;
    this.wantNote = label;
    const wait = { s, tries: 0, label, got: 0 };
    this.subWait = wait;
    const e = await this.getEngine(true, 'sub');
    if (g !== this.gen || this.subWait !== wait) return;
    if (!e) {
      this.subWait = null;
      this.subKey = 'off';
      this.hooks.changed();
      return;
    }
    this.setNativeSub(-1);
    this.setExt(null);
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
        if (r.denied) this.denied(r.denied, true, 'sub');
        else this.hooks.toast(t('Este subtítulo no se puede mostrar (es de imagen o el servidor no respondió).'));
        this.hooks.changed();
        return;
      }
      await new Promise<void>(res => setTimeout(res, 3000));
    }
  }
}
