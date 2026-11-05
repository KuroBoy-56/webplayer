// Fuente del video, audio y subtítulos del reproductor (misma lógica que PlayerTracks.brs de Roku).
// - Pistas que informa el reproductor de Vega (audioTracks / textTracks): se eligen ahí y se comprueba
//   que el cambio quedó; el búfer se vuelve a llenar en el mismo segundo para que se oiga enseguida.
// - Shaka con MSE para HLS/DASH y lector MSE local para MP4: pistas y cambios en el equipo.
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
import { Mp4Mse } from './mp4mse';
import { MkvMse } from './mkvmse';
import { Mkv } from './mkvparse';
import { reportError } from '../api/report';
import { ShakaPlayback } from './shaka';

export type MenuItem = { kind: 'audio' | 'text' | 'panel'; key: string; label: string; on: boolean };

type AudioItem = { key: string; label: string; lang: string; codec: string; native?: number; probe?: number; shaka?: string; mp4?: number };
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
// _2 (1.0.33): se olvidan las rutas que guardaba un Continuar viendo por el panel (abrían por el panel desde el principio)
const ROUTE_KEY = 'panel_route_3'; // _3 (1.0.40): los MP4 que antes solo salían por el panel ahora los lee la app
const routeKey = (u: string) => u.replace(/^https?:\/\//i, '');
function panelRoute(url: string): 'p' | 'v' | '' {
  const e = (readJson<Record<string, Route>>(ROUTE_KEY) || {})[routeKey(url)];
  return e && Date.now() - e.t < 7 * 86400000 ? e.r : '';
}

// Idioma que el usuario eligió para ESTE título (menú de audio): se usa al volver a abrirlo (también «Continuar viendo»).
// Un título nuevo (o sin elegir nada) empieza siempre con su audio predeterminado, directo del servidor IPTV; el panel
// prepara otro idioma solo cuando el usuario lo elige. 180 días, los 400 más recientes. a = pista del archivo.
type TitleLang = { l: string; a: number; t: number };
// _2 (1.0.33): se olvidan los idiomas elegidos en las versiones de prueba
const TLANG_KEY = 'title_audio_2';
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
// 1.0.35: ya no se recuerda por servidor que «Continuar viendo» va por el panel (1.0.30 lo hacía y desde entonces todo
// Continuar viendo de ese servidor gastaba la VPS con el audio predeterminado): siempre se prueba primero directo del
// servidor IPTV y el panel entra solo si ese video no salta al segundo guardado (pasos de Player.tsx)
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

// Televisor: servidores cuyos canales solo se vieron con el lector de la app (el reproductor del televisor no los abrió):
// en esta sesión sus canales van directo al lector (sin esperar otra vez al del televisor al cambiar de canal ni al
// reconectar)
const readerHosts = new Set<string>();
const hostOf = (u: string) => (u.match(/^https?:\/\/([^/?#]+)/i) || [])[1]?.toLowerCase() || '';

export class Playback {
  private url = '';
  private live = false;
  private gen = 0;
  private probe: Probe | null = null;
  private probing = false;
  private resumeAt = 0;
  private remux: { a: number; label: string } | null = null;
  private hls: PanelHls | null = null;
  // MP4 leído por la app del servidor IPTV (mp4mse.ts); mp4Url: no se pudo, este video va con el modo directo de siempre
  // MKV: también leído por la app (mkvmse.ts) para cambiar el audio en el equipo, sin servidor (como ExoPlayer en Android)
  private mse: Mp4Mse | MkvMse | null = null;
  private mkvIndex: Mkv | null = null;
  // Televisor (LG webOS, VideoPlayer con nativeFiles): MP4 / MKV los abre su reproductor por hardware; el lector propio
  // solo si el televisor no pudo cambiar el audio o los subtítulos (readerWanted). lunaAudio / lunaSub: pista elegida con
  // el servicio de medios del televisor (tvSelectTrack); tvLuna*Failed: ese servicio no la tomó en este video
  private readerWanted = false;
  private lunaAudio = -1;
  private lunaSub = -1;
  private tvLunaAudioFailed = false;
  private tvLunaSubFailed = false;
  private pendingSub = -1;
  // lo que se pidió al servidor (para el aviso y el reporte cuando está apagado)
  private wantNote = '';
  private mp4Url = false;
  // MKV cuyo audio no entra por MSE (E-AC-3, DTS, TrueHD…): primero el lector nativo de Vega (decodifica eAC-3 en MKV,
  // guía de Amazon: archivos por URL); si falla, de nuevo el lector de la app solo con el video, como antes
  private mkvNative: '' | 'trying' | 'failed' = '';
  // por qué la lectura propia del MP4 no siguió (va al reporte)
  private mp4Why = '';
  private liveHls: LiveHls | null = null;
  private shaka: ShakaPlayback | null = null;
  private shakaRelease: Promise<void> | null = null;
  private adaptiveTried = false;
  private mp4Audio = -1;
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
  // televisor: este canal ya se probó con el lector de la app (después de su propio reproductor)
  private liveReaderTried = false;
  // televisor: el idioma que el lector de la app está preparando (aviso al empezar a sonar con él)
  private switchNote = '';
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
  // el panel se usó para continuar en el segundo guardado (el directo no salta), no porque el archivo no abra: no se
  // recuerda como «solo por el panel» (antes ese título abría por el panel también desde el principio)
  private resumePanel = false;
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
  // lo que suena antes del salto (el principio) va sin sonido
  private seekMuted = false;
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
    this.audioChange++;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = null;
    this.stopHls();
    const sameFile = url.replace(/^https?:\/\//i, '') === this.url.replace(/^https?:\/\//i, '');
    this.wantAt = live ? 0 : resume;
    this.played = false;
    this.clearSeek();
    if (!sameFile) {
      this.readerWanted = false;
      this.lunaAudio = -1;
      this.lunaSub = -1;
      this.tvLunaAudioFailed = false;
      this.tvLunaSubFailed = false;
      this.pendingSub = -1;
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
    this.liveNoAudio = false;
    this.liveFrozen = 0;
    this.liveReaderTried = false;
    this.mp4Audio = -1;
    this.mp4Index = null;
    this.mkvIndex = null;
    this.mp4Paused = false;
    this.adaptiveTried = false;
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
    this.resumePanel = false;
    this.mp4Url = false;
    this.mkvNative = '';
    this.mp4Why = '';
    this.deniedShown = false;
    if (live) {
      this.direct(resume);
      return;
    }
    // Abrir ya: la detección de pistas nunca espera al panel ni reutiliza una ruta
    // remota antigua antes de probar las capacidades locales actuales.
    this.probe = knownNow(url);
    this.direct(resume);
    // los idiomas del archivo se leen a los 1,5 s de abrirlo (antes 3 s), o apenas suena (onPlaying), lo que llegue antes
    // MP4 y MKV: el lector propio ya trae las pistas (leer la cabecera aparte competía con el video al abrir)
    if (!/\.(m3u8|mpd)(\?|$)/i.test(url) && (this.tvNative() || !/\.(mp4|m4v|mov|mkv)(\?|$)/i.test(url))) this.langWatch(1500);
  }

  // canal en vivo por HLS con el lector propio
  private openLive(url: string): void {
    const g = this.gen;
    // congelado: se alterna MP4 propio y MPEG-TS (solo si el equipo acepta MPEG-TS por MSE; si no, siempre MP4)
    const h = new LiveHls(this.v, url, this.liveAudio, this.liveNoAudio, this.liveFrozen > 0 && this.liveFrozen % 2 === 0 && LiveHls.tsSupported());
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
    if (!this.live || !h) return false;
    // imagen congelada con video por delante: el canal otra vez, alternando MP4 propio y MPEG-TS (solo este canal),
    // hasta 6 veces; nunca la pantalla de error por esto (antes, a la tercera, probaba https y terminaba en error)
    if (h.frozen) {
      if (this.liveFrozen >= 6) return false;
      this.liveFrozen++;
      h.destroy();
      this.openLive(this.url);
      return true;
    }
    // con audio MP2 / AC-3 lo que falló (error o sin imagen) es ese audio: el mismo canal en MP4 sin él (en MPEG-TS
    // Vega no mostraba imagen)
    // (si ya se veía, se reconecta igual: nunca se apaga el MP4 de toda la sesión por el audio de un canal)
    if (h.otherAudio()) {
      if (this.liveNoAudio || this.hasPlayed()) return false;
      this.liveNoAudio = true;
    } else if (h.isMp4() && (h.mediaFailed() || (this.v as any).error) && LiveHls.tsSupported()) disableMp4();
    else return false;
    h.destroy();
    this.openLive(this.url);
    return true;
  }

  // el canal todavía no se ve pero sigue llegando video (segmentos largos o servidor lento)
  liveBusy(): boolean {
    return !!this.liveHls && Date.now() - this.liveHls.lastData < 8000;
  }

  // Televisor (LG): el canal no abrió con su reproductor o no dio imagen a tiempo. El mismo .m3u8 con el lector de la app
  // (el de Vega: baja la lista y los segmentos, descifra AES y entrega MP4 por MSE), antes de probar otro formato.
  // false = no aplica (otro equipo, no es .m3u8, sin MSE) o ya se probó
  // url: la dirección .m3u8 del canal (si lo que falló fue el .ts)
  liveReader(url = this.url): boolean {
    if (!this.live || !this.tvLivePlayer() || this.liveHls || this.liveReaderTried || !/\.m3u8(\?|$)/i.test(url) || !LiveHls.supported()) return false;
    this.liveReaderTried = true;
    this.url = url;
    // primero se suelta la conexión del reproductor del televisor (muchas líneas permiten una sola a la vez)
    try {
      this.v.pause();
      this.v.src = '';
    } catch {
      // sin video todavía
    }
    this.openLive(this.url);
    return true;
  }

  liveDiag(): string {
    return this.liveHls ? this.liveHls.diag() : '';
  }

  private direct(at: number): void {
    this.stopHls();
    const g = this.gen;
    if (this.shakaRelease) {
      this.shakaRelease.then(() => g === this.gen && this.startDirect(at));
    } else this.startDirect(at);
  }

  private startDirect(at: number): void {
    this.offset = 0;
    this.clearSeek();
    // Canales: el lector propio (livehls.ts) convierte cada segmento a MP4 de corrido; con Shaka el MPEG-TS va al lector
    // de Vega, que deja micro-huecos entre segmentos (los cortes de 1.0.20-1.0.25). Shaka queda para HLS/DASH de
    // películas y series, y para canales si el equipo no tiene MSE para el lector propio.
    // el televisor (LG) abre los canales HLS con su propio reproductor (como siempre en webOS)
    const readerFirst = this.live && this.tvLivePlayer() && readerHosts.has(hostOf(this.url));
    if (readerFirst) this.liveReaderTried = true;
    if (this.live && /\.m3u8(\?|$)/i.test(this.url) && (!this.tvLivePlayer() || readerFirst) && LiveHls.supported()) {
      this.openLive(this.url);
      return;
    }
    if (!this.adaptiveTried && !this.tvNative() && /\.(m3u8|mpd)(\?|$)/i.test(this.url)) {
      this.openAdaptive(at);
      return;
    }
    // MP4: la app lo lee del servidor IPTV y lo entrega al reproductor (el modo directo de Vega da error 4 con los MP4
    // de índice al final, los de casi todos los servidores IPTV). Empieza ya en el segundo pedido (sin el salto)
    if (!this.live && !this.mp4Url && (!this.tvNative() || this.readerWanted) && /\.(mp4|m4v|mov|mkv)(\?|$)/i.test(this.url)) {
      this.resumeAt = 0;
      const g = this.gen;
      const mkv = /\.mkv(\?|$)/i.test(this.url);
      const want = this.mp4Audio;
      const m = mkv ? new MkvMse(this.v, this.url, this.mp4Audio, this.mkvIndex) : new Mp4Mse(this.v, this.url, this.mp4Audio, this.mp4Index);
      this.mse = m;
      m.onTracks = () => {
        if (g !== this.gen || this.mse !== m) return;
        if (m instanceof MkvMse) {
          this.mkvIndex = m.index;
          // las pistas del MKV ya leídas: el menú (audio y subtítulos) sin leer otra vez la cabecera
          if (!this.probe?.ok) this.probe = m.probe();
        } else this.mp4Index = m.index;
        // el subtítulo que se eligió y el televisor no mostró: ahora lo lee la app
        if (this.pendingSub >= 0) {
          const ps = this.subItems().find(x => x.probe === this.pendingSub);
          this.pendingSub = -1;
          if (ps) setTimeout(() => g === this.gen && this.pickSub(ps, true), 0);
        }
        if (this.mp4Paused) { this.mp4Paused = false; this.v.pause(); }
        if (this.switchNote) {
          this.hooks.status('');
          this.hooks.toast(t('Audio: {x}', { x: this.audioItems().find(i => i.mp4 === m.audioIdx)?.label || this.switchNote }));
          this.switchNote = '';
        }
        this.applyPrefs();
        this.hooks.changed();
      };
      m.onError = () => g === this.gen && this.mse === m && this.mp4Failed(at, m.why);
      m.start(at)
        .catch((e: any) => 'excepción: ' + String(e?.message || e).slice(0, 80))
        .then(err => {
          if (g !== this.gen || this.mse !== m) return;
          if (err) {
            this.mp4Failed(at, err);
            return;
          }
          if (m instanceof MkvMse && m.noAudio && want < 0 && !this.mkvNative) {
            this.mkvNative = 'trying';
            this.mp4Failed(at, 'MKV con audio que no entra por MSE: lector nativo');
            return;
          }
          // el equipo no tomó el audio pedido (o ninguno del archivo): el servidor lo prepara; apagado, el aviso
          const lost = m.noAudio ? (want >= 0 ? want : Math.max(0, this.probeDefault())) : want >= 0 && m.audioIdx !== want ? want : -1;
          if (lost >= 0) {
            const label = this.audioItems().find(i => i.mp4 === lost)?.label || t('Audio predeterminado');
            this.toRemux(lost, label, true, t('Este equipo no reproduce el audio {x}: se prepara con el panel…', { x: label }));
          }
        });
      return;
    }
    if (at > 5 && !this.live && !this.played && this.tvNative()) {
      // televisor LG: su reproductor empieza ya en el segundo guardado (mediaOption playTime) y, si no lo tomó, salta en
      // loadedmetadata, antes de sonar; cuenta como «ya suena» cuando avanza pasado ese segundo (seekTo, con plazo)
      this.resumeAt = at;
      this.seekTo = at;
      (this.v as any).startAt = at;
    } else if (at > 5 && !this.live && !this.played) {
      // Continuar viendo: se abre y se salta apenas suena (onPlaying)
      this.resumeAt = 0;
      this.seekAfter = at;
    } else this.resumeAt = at;
    this.v.src = this.url;
    this.v.play();
  }

  private openAdaptive(at: number): void {
    this.adaptiveTried = true;
    const g = this.gen;
    const s = new ShakaPlayback(this.v);
    this.shaka = s;
    s.onTracks = () => {
      if (g !== this.gen || this.shaka !== s) return;
      this.applyPrefs();
      this.langNotice();
      this.hooks.changed();
    };
    s.onError = () => g === this.gen && this.shaka === s && this.adaptiveFallback();
    // como Roku: sin elección guardada para este título, el audio predeterminado del archivo
    const language = titleLang(this.url)?.l || '';
    s.start(this.url, at, language, this.live).catch(() => {
      if (g === this.gen && this.shaka === s) this.adaptiveFallback();
    });
  }

  // Shaka falló: se prueba el lector local anterior antes de los pasos del panel.
  adaptiveFallback(): boolean {
    if (!this.shaka) return false;
    const pos = this.live ? 0 : this.realPos() || this.wantAt;
    this.direct(pos);
    return true;
  }

  // la lectura propia del MP4 no pudo (códec raro, el servidor cortó): el modo directo de siempre desde donde iba
  private mp4Failed(at: number, why: string): void {
    const pos = this.played ? this.realPos() : at;
    if (this.switchNote) {
      this.switchNote = '';
      this.hooks.status('');
    }
    this.mp4Why = why;
    this.mp4Url = true;
    // televisor: el lector se abrió para cambiar de audio y no pudo; vuelve el reproductor del televisor y ese audio lo
    // prepara el servidor (último recurso; apagado, el aviso)
    const want = this.tvNative() && this.readerWanted ? this.mp4Audio : -1;
    this.direct(pos);
    if (want >= 0) {
      const it = this.audioItems().find(i => i.probe === want);
      this.toRemux(want, it?.label || t('Audio predeterminado'), true, t('Cambiando a {x}…', { x: it?.label || '' }), Math.floor(pos));
    }
  }

  // error del reproductor con el MP4 leído por la app: true = se sigue con el modo directo de siempre
  mp4Fallback(why = 'error del reproductor'): boolean {
    if (this.mkvNative === 'trying' && !this.mse && !this.played) {
      // el lector nativo tampoco pudo con el MKV: el de la app con el video (y el audio por el panel / aviso)
      this.mkvNative = 'failed';
      this.mp4Url = false;
      this.direct(this.wantAt);
      return true;
    }
    if (!this.mse || this.mp4Url) return false;
    const e: any = (this.v as any).error;
    this.mp4Failed(this.played ? this.realPos() : this.wantAt, why + (e?.code ? ' ' + e.code : '') + (this.mse.why ? ' · ' + this.mse.why : ''));
    return true;
  }

  // la app todavía arma el MP4 (el reproductor espera más antes de darlo por perdido)
  mp4Starting(): boolean {
    return !!this.mse && !this.mp4Url && !this.played;
  }

  // el reproductor es el del televisor (LG webOS): abre MP4 / MKV / HLS solo
  private tvNative(): boolean {
    return !!(this.v as any).nativeFiles;
  }

  // canales con el reproductor por hardware del televisor (no en el simulador de LG: ahí el lector de la app)
  private tvLivePlayer(): boolean {
    return !!(this.v as any).nativeLive;
  }

  // el lector propio puede leer este archivo (MP4 / MKV con MSE en el equipo)
  private readerCan(): boolean {
    try {
      return /\.(mp4|m4v|mov|mkv)(\?|$)/i.test(this.url) && !!(MediaSource as any)?.isTypeSupported?.('video/mp4; codecs="avc1.640028"');
    } catch {
      return false;
    }
  }

  // Televisor: otro idioma sin el servidor. 1) el servicio de medios del televisor (selectTrack), 2) el lector propio de la
  // app (MP4 / MKV: el audio cambia en la app, desde el mismo segundo), 3) solo entonces el servidor (si está apagado,
  // el aviso de encenderlo)
  private async tvAudio(it: AudioItem, user: boolean): Promise<void> {
    if (it.probe === undefined) return;
    const g = this.gen;
    const sel = (this.v as any).tvSelectTrack;
    if (sel && !this.tvLunaAudioFailed && !this.mse) {
      const ok = await Promise.resolve(sel('audio', it.probe)).catch(() => false);
      if (g !== this.gen) return;
      if (ok) {
        this.lunaAudio = it.probe;
        this.audioKey = it.key;
        if (user) {
          setTitleLang(this.url, it);
          this.hooks.toast(t('Audio: {x}', { x: it.label }));
        }
        this.hooks.changed();
        return;
      }
      this.tvLunaAudioFailed = true;
    }
    if (!this.readerWanted && !this.mse && this.readerCan()) {
      this.readerWanted = true;
      this.mp4Audio = it.probe;
      this.audioKey = it.key;
      if (user) setTitleLang(this.url, it);
      // a la vista mientras el lector lee el índice (en un MP4 con el índice al final puede tardar): antes solo un aviso
      // corto y después nada, sin el idioma marcado
      this.switchNote = it.label;
      this.hooks.status(t('Cambiando a {x}…', { x: it.label }));
      this.direct(this.realPos());
      this.readerDog();
      return;
    }
    const pick = it;
    this.toRemux(it.probe, it.label, true, t('Cambiando a {x}…', { x: it.label })).then(ok => ok && user && setTitleLang(this.url, pick));
  }

  // el lector abierto para cambiar de idioma no consigue el índice (el servidor no entrega): vuelve el video como estaba y
  // ese idioma queda para el servidor (apagado: el aviso de encenderlo). Mientras siga llegando algo, hasta 2 min
  private readerDog(): void {
    const g = this.gen;
    const t0 = Date.now();
    let idle = 0;
    const check = () => {
      const m = this.mse;
      if (g !== this.gen || !m || this.mp4Url || m.indexed) return;
      idle = m.busy() ? 0 : idle + 5;
      if (idle < 20 && Date.now() - t0 < 120000) {
        setTimeout(check, 5000);
        return;
      }
      this.mp4Fallback('sin el índice para cambiar el idioma');
    };
    setTimeout(check, 5000);
  }

  // Televisor: un subtítulo que el <video> no muestra. 1) el servicio de medios del televisor (también los de imagen,
  // los dibuja el televisor), 2) MKV de texto: el lector propio de la app, 3) false = sigue el servidor
  private async tvSub(it: SubItem): Promise<boolean> {
    if (it.probe === undefined) return false;
    const g = this.gen;
    const sel = (this.v as any).tvSelectTrack;
    if (sel && !this.tvLunaSubFailed && !this.mse) {
      const ok = await Promise.resolve(sel('text', it.probe)).catch(() => false);
      if (g !== this.gen) return true;
      if (ok) {
        this.lunaSub = it.probe;
        this.subKey = it.key;
        this.setExt(null);
        this.hooks.toast(t('Subtítulos: {x}', { x: it.label }));
        this.hooks.changed();
        return true;
      }
      this.tvLunaSubFailed = true;
    }
    if (!it.image && !this.readerWanted && !this.mse && /\.mkv(\?|$)/i.test(this.url) && this.readerCan()) {
      this.readerWanted = true;
      this.pendingSub = it.probe;
      this.subKey = it.key;
      this.direct(this.realPos());
      return true;
    }
    return false;
  }

  // el lector propio ya leyó el índice del archivo (si no, no vale la pena esperarlo más)
  mp4Indexed(): boolean {
    return !!this.mse?.indexed;
  }

  // el lector propio todavía está bajando el índice (servidor lento pero entregando)
  mp4Busy(): boolean {
    return !!this.mse && !this.mp4Url && this.mse.busy();
  }

  mp4Note(): string {
    return this.mp4Why;
  }

  private clearSeek(): void {
    this.seekAfter = 0;
    this.seekTo = 0;
    if (this.seekTimer) clearTimeout(this.seekTimer);
    this.seekTimer = null;
  }

  // timeupdate: el salto de Continuar viendo ya llegó. Cuenta solo cuando el video AVANZA pasado el segundo pedido: al
  // saltar, el reproductor avisa timeupdate al instante con ese segundo aunque se quede cargando (1.0.27 lo tomaba como
  // «ya suena», apagaba el vigilante y quedaba cargando sin fin)
  onTime(): void {
    if (this.seekTo > 0 && !this.remux && !this.v.paused && (this.v.currentTime || 0) >= this.seekTo + 1.5) this.arrived();
  }

  private arrived(): void {
    if (this.seekMuted) {
      this.seekMuted = false;
      try {
        (this.v as any).muted = false;
      } catch {
        // sin control de silencio
      }
    }
    this.clearSeek();
    this.onPlaying();
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
    const it = this.startAudio(this.probe?.ok ? this.audioItems() : []);
    this.panelFallback = true;
    this.resumePanel = true;
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
    this.remuxLive = false;
  }

  // Continuar viendo: el panel no arrancó a tiempo; se deja para que el reproductor siga con sus pasos
  panelStop(): void {
    if (!this.remux || this.played) return;
    // si se abrió por el panel porque así se vio antes y ahora no arrancó, la próxima vez se prueba directo
    setPanelRoute(this.url, '');
    this.remux = null;
    this.audioKey = '';
    this.panelFallback = false;
    this.stopHls();
    this.hooks.status('');
  }

  destroy(): Promise<void> {
    this.gen++;
    this.audioChange++;
    if (this.audioTimer) clearTimeout(this.audioTimer);
    this.audioTimer = null;
    this.clearSeek();
    this.stopHls();
    this.setExt(null);
    if (this.prefsTimer) clearTimeout(this.prefsTimer);
    if (this.langTimer) clearTimeout(this.langTimer);
    return this.shakaRelease || Promise.resolve();
  }

  // segundo real del contenido (el HLS del panel empieza en offset)
  realPos(): number {
    if (this.mse instanceof MkvMse) return this.mse.timeOf(this.v.currentTime || 0);
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
    if (this.mse) {
      this.mse.seekTo(target);
      return;
    }
    this.v.currentTime = target;
  }

  // loadedmetadata
  onMeta(): void {
    if (this.resumeAt > 0) {
      // el televisor ya empezó ahí (mediaOption): sin saltar otra vez
      if (!this.tvNative() || Math.abs((this.v.currentTime || 0) - this.resumeAt) > 3) this.v.currentTime = this.resumeAt;
      this.resumeAt = 0;
      if (this.tvNative() && this.seekTo > 0 && !this.seekTimer) this.resumeDog();
    }
    if (this.pendingNative >= 0) {
      const i = this.pendingNative;
      this.pendingNative = -1;
      setTimeout(() => this.enableNative(i), 300);
    }
    this.schedulePrefs();
  }

  // Continuar viendo en el televisor: si en 15 s no avanza pasado el segundo guardado, siguen los pasos de siempre (el
  // panel desde ese segundo; Player)
  private resumeDog(): void {
    const g = this.gen;
    this.seekTimer = setTimeout(() => {
      this.seekTimer = null;
      if (g !== this.gen || this.played || !this.seekTo) return;
      this.v.pause();
      this.hooks.resumeFailed?.();
    }, 15000);
  }

  // "playing": se aplican los idiomas ya sabidos y, apenas suena, se mira cuántos audios hay (langCheck)
  onPlaying(): void {
    if (this.seekAfter > 0 && !this.remux) {
      // Continuar viendo: ya suena; ahora sí al segundo guardado (una vez)
      const at = this.seekAfter;
      const g = this.gen;
      this.seekAfter = 0;
      this.seekTo = at;
      try {
        (this.v as any).muted = true;
        this.seekMuted = true;
      } catch {
        // sin control de silencio: se oye un instante el principio
      }
      this.v.currentTime = at;
      this.seekTimer = setTimeout(() => {
        this.seekTimer = null;
        if (g !== this.gen || this.played || !this.seekTo) return;
        // no llegó al segundo guardado: el reproductor sigue con sus pasos (el panel desde ese segundo)
        this.v.pause();
        if (this.seekMuted) {
          this.seekMuted = false;
          try {
            (this.v as any).muted = false;
          } catch {
            // sin control de silencio
          }
        }
        this.hooks.resumeFailed?.();
      }, 15000);
      return;
    }
    // saltando al segundo guardado: "playing" no basta (puede llegar antes de que el video avance); manda onTime
    if (this.seekTo > 0 && !this.remux) return;
    this.clearSeek();
    this.played = true;
    if (this.live && this.liveHls && this.tvLivePlayer()) readerHosts.add(hostOf(this.url));
    // cómo se pudo ver este archivo: por el panel (se recuerda) o directo (se olvida lo anterior)
    if (!this.live) setPanelRoute(this.url, this.remux && this.panelFallback && !this.resumePanel ? (this.panelVideo ? 'v' : 'p') : this.remux ? panelRoute(this.url) : '');
    if (this.live || this.probing) return;
    this.probing = true;
    if (this.probe?.ok) {
      if (!this.audioKey) this.audioApplied = false;
      else this.checkDecodable();
      if (!this.subKey) this.subApplied = false;
      this.applyPrefs();
    }
    if (!this.langChecked) {
      // ya suena (la conexión del video está abierta): los idiomas se leen ya, sin esperar el plazo de load()
      if (this.langTimer) clearTimeout(this.langTimer);
      this.langTimer = null;
      this.langWatch(150);
    }
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
    const n = this.audioItems().length;
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
    if (this.shaka || (this.mse && !this.mp4Url)) return;
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
    // televisor: su reproductor no abrió el MP4 / MKV (ni por los otros caminos): antes del servidor, el lector de la app
    // (como en Vega); un audio que el equipo no decodifica queda fuera y el video se ve sin él, con el aviso de encender
    // el servidor
    if (this.tvNative() && !this.readerWanted && !this.mse && !this.played && this.readerCan()) {
      const g0 = this.gen;
      if (!this.probe) this.probe = await fileTracks(this.url);
      if (g0 !== this.gen) return false;
      const all = this.probe.ok ? this.audioItems() : [];
      this.readerWanted = true;
      this.mp4Url = false;
      this.mp4Audio = this.preferredAudio(all)?.probe ?? -1;
      this.direct(this.resumeAt || this.wantAt);
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
      const it = this.startAudio(items);
      return this.toRemux(it.a, it.label, false, t('Cambiando a {x}…', { x: it.label }), Math.floor(this.resumeAt || this.realPos()));
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
    this.resumePanel = false;
    const it = this.startAudio(items);
    const ok = await this.toRemux(it.a, it.label, false, t('Preparando el video en el panel…'), Math.floor(this.resumeAt || this.realPos()));
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
    if (this.shaka) return this.shaka.audioTracks().map(tr => ({ key: 's:' + tr.id, label: tr.label, lang: tr.lang, codec: tr.codec, shaka: tr.id }));
    if (this.mse?.tracks.length) return numbered(this.mse.tracks.map((tr, i) => ({
      key: 'm:' + i, label: langName(tr.lang, '') || t('Audio {n}', { n: i + 1 }), lang: tr.lang, codec: tr.codec, mp4: i, probe: i,
    })));
    // canal con varios idiomas (lector propio): uno por audio del canal
    const hl = this.live && this.liveHls ? this.liveHls.audioLangs() : [];
    if (hl.length > 1) return numbered(hl.map((l, i) => ({ key: 'h:' + i, label: langName(l, '') || t('Audio {n}', { n: i + 1 }), lang: trackLang(l, ''), codec: '' })));
    const nat = this.nativeAudio();
    const pr = this.probe?.ok ? this.probe.audio : [];
    if (pr.length && pr.length >= nat.length) {
      return numbered(pr.map((tr, i) => {
        // mismo orden que el archivo, salvo que el reproductor diga otro idioma en ese lugar (el televisor LG puede
        // ordenar sus pistas de otra forma): entonces por idioma
        const nl = nat.length === pr.length ? trackLang(nat[i].language, nat[i].label) : '';
        const pl = trackLang(tr.lang, tr.name);
        const n = nat.length === pr.length && (!nl || !pl || nl === pl) ? i : this.byLang(nat, pr, i);
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
    if (this.shaka) {
      const active = this.shaka.audioTracks().find(tr => tr.active);
      return items.find(it => it.shaka === active?.id);
    }
    if (this.mse) {
      if (this.mse.indexed) return items.find(it => it.mp4 === this.mse!.audioIdx);
      // todavía leyendo el índice: el idioma pedido (o el predeterminado)
      const want = this.mp4Audio >= 0 ? this.mp4Audio : this.probeDefault();
      return items.find(it => it.mp4 === want || it.probe === want);
    }
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

  // pista con la que el panel abre el video cuando lo abre él (archivo que no abre directo, Continuar viendo): el idioma
  // elegido para este título o, sin elegir, la marcada del archivo como «Audio predeterminado» (así queda marcado
  // en el menú; antes salía marcado su idioma, p. ej. «Inglés»)
  private startAudio(items: AudioItem[]): { a: number; label: string } {
    const want = this.preferredAudio(items);
    return { a: (want || items[this.probeDefault()])?.probe ?? 0, label: want ? want.label : t('Audio predeterminado') };
  }

  private decodable(it: AudioItem): boolean {
    return it.probe === undefined || nativeAudioOk(it.codec, this.probe?.container || '');
  }

  // Menú remoto únicamente cuando no existe un lector local ni pistas nativas expuestas.
  private panelMenu(): boolean {
    return !this.live && !this.shaka && !this.mse && !this.nativeAudio().length && !!this.probe?.ok && this.probe.audio.length > 1;
  }

  // menú de audio y subtítulos
  menu(): MenuItem[] {
    const out: MenuItem[] = [];
    const a = this.audioItems();
    if (this.panelMenu()) {
      const def = this.lunaAudio < 0 && (!this.remux || this.remux.label === t('Audio predeterminado'));
      out.push({ kind: 'audio', key: 'def', label: t('Audio predeterminado'), on: def });
      for (const it of a) out.push({ kind: 'audio', key: it.key, label: it.label, on: !def && (this.lunaAudio >= 0 ? this.lunaAudio === it.probe : this.remux?.a === it.probe) });
    } else {
      const on = this.audioOn(a);
      for (const it of a) out.push({ kind: 'audio', key: it.key, label: it.label, on: it === on });
    }
    if (this.shaka) {
      const subs = this.shaka.textTracks();
      out.push({ kind: 'text', key: 'off', label: t('Desactivados'), on: !subs.some(tr => tr.active) });
      for (const tr of subs) out.push({ kind: 'text', key: 's:' + tr.id, label: tr.label, on: tr.active });
      return out;
    }
    const subs = this.subItems();
    const showing = this.nativeSubs().find(t => t.showing);
    out.push({ kind: 'text', key: 'off', label: t('Desactivados'), on: this.subKey === 'off' || (!this.ext && !showing && this.lunaSub < 0) });
    for (const it of subs) {
      const isOn = this.ext ? it.probe === this.ext.s : this.lunaSub >= 0 ? it.probe === this.lunaSub : this.subKey !== 'off' && !!showing && it.native === showing.index;
      out.push({ kind: 'text', key: it.key, label: it.label + (this.subWait && this.subWait.s === it.probe && this.ext?.s !== it.probe ? ' (' + t('preparando…') + ')' : ''), on: isOn });
    }
    return out;
  }

  select(m: MenuItem): void {
    if (this.shaka && m.kind === 'text') {
      this.subApplied = true;
      this.subKey = m.key;
      this.shaka.selectText(m.key === 'off' ? null : m.key.slice(2));
      return;
    }
    if (m.kind === 'panel') {
      const a = this.audioItems();
      const it = a.find(i => i.key === this.audioKey) || this.audioOn(a);
      if (it && it.probe !== undefined) this.toRemux(it.probe, it.label, true, t('Cambiando a {x}…', { x: it.label }));
      return;
    }
    if (m.kind === 'audio') {
      if (m.key === 'def') {
        // «Audio predeterminado»: el audio que el archivo trae marcado (este título vuelve a empezar así, directo)
        this.audioKey = '';
        setTitleLang(this.url, null);
        // el televisor tenía otro idioma elegido con su servicio de medios: vuelve al del archivo
        if (this.lunaAudio >= 0 && !this.remux) {
          const sel = (this.v as any).tvSelectTrack;
          this.lunaAudio = -1;
          if (sel) Promise.resolve(sel('audio', this.probeDefault())).catch(() => false);
          this.hooks.toast(t('Audio: {x}', { x: t('Audio predeterminado') }));
          this.hooks.changed();
          return;
        }
        if (this.remux) {
          // al principio, otra vez el video directo; ya avanzado, el panel sigue con el audio marcado del archivo, sin
          // cortar: volver al directo obliga al reproductor a saltar dentro del archivo y en Vega eso falla en algunos
          // servidores (error 4: quedaba cargando sin fin y «Audio predeterminado» no se podía elegir)
          const d = this.probeDefault();
          if (this.realPos() < 5 && !this.panelFallback) this.leaveRemux();
          else if (this.remux.a !== d) this.toRemux(d, t('Audio predeterminado'), true, t('Cambiando a {x}…', { x: t('Audio predeterminado') }));
          else {
            // ya suena esa misma pista: solo cambia lo marcado en el menú
            this.remux = { a: d, label: t('Audio predeterminado') };
            this.hooks.changed();
          }
          return;
        }
        this.hooks.toast(t('Audio: {x}', { x: t('Audio predeterminado') }));
        return;
      }
      const it = this.audioItems().find(i => i.key === m.key);
      if (it && it.probe !== undefined && this.panelMenu()) {
        // un idioma de la lista de abajo: lo prepara el panel (también el de por defecto)
        if (this.remux?.a === it.probe) {
          // el panel ya da esa pista (como «Audio predeterminado»): solo cambia lo marcado
          setTitleLang(this.url, it);
          this.remux = { a: it.probe, label: it.label };
          this.hooks.changed();
          return;
        }
        // televisor: su reproductor y el lector de la app antes que el servidor
        if (this.tvNative()) {
          this.tvAudio(it, true);
          return;
        }
        // se recuerda solo si el panel lo prepara (sin el motor: el aviso y sigue «Audio predeterminado»)
        const pick = it;
        this.toRemux(pick.probe!, pick.label, true, t('Cambiando a {x}…', { x: pick.label })).then(ok => ok && setTitleLang(this.url, pick));
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
    // en vivo no se tocan las pistas de texto del equipo (los subtítulos ocultos CC de algunos canales)
    if (!this.live) this.autoSubs();
    this.hooks.changed();
  }

  // Recordar la elección local del título. Una preferencia nunca enciende por sí sola el panel.
  private autoAudio(): void {
    if (this.audioApplied || this.audioKey) return;
    const items = this.audioItems();
    if (!items.length) return;
    this.audioApplied = true;
    // solo el idioma que el usuario eligió antes para este título (Continuar viendo); un título nuevo empieza con el
    // audio predeterminado, como Roku
    const want = this.preferredAudio(items);
    // Las preferencias automáticas solo se aplican a pistas disponibles localmente.
    if (want && (want.shaka !== undefined || want.mp4 !== undefined || want.native !== undefined)) this.pickAudio(want, false);
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
    if (!items.length) return;
    this.subApplied = true;
    const p = pref('subs_lang', 'off');
    const want = p !== 'off' ? items.find(i => sameLang(i.lang, p) && (i.native !== undefined || !!this.localCues(i))) : undefined;
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
    // El cambio de pista nativo no fuerza una búsqueda ni recarga del archivo.
  }

  // saved = el idioma que el usuario eligió antes para este título: puede usar el panel como si lo eligiera ahora
  private pickAudio(it: AudioItem, user: boolean, saved = false): void {
    const choice = ++this.audioChange;
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
    // el lector todavía lee el índice: ahora este otro idioma, sin empezar de nuevo (antes iba al servidor: «encender el
    // servidor»)
    const pi = it.mp4 ?? it.probe;
    if (this.mse && !this.mse.indexed && !this.mp4Url && pi !== undefined && this.decodable(it) && this.mse.want(pi)) {
      this.mp4Audio = pi;
      this.audioKey = it.key;
      if (user) {
        setTitleLang(this.url, it);
        if (this.switchNote) {
          this.switchNote = it.label;
          this.hooks.status(t('Cambiando a {x}…', { x: it.label }));
        }
      }
      this.hooks.changed();
      return;
    }
    if (it.mp4 !== undefined && this.mse) {
      if (this.mse.noAudio && this.mse.audioIdx === it.mp4) {
        this.toRemux(it.mp4, it.label, user, t('Cambiando a {x}…', { x: it.label }));
        return;
      }
      if (this.mse.audioIdx !== it.mp4 || this.mse.noAudio) {
        if (!this.decodable(it)) {
          this.toRemux(it.mp4, it.label, user, t('Cambiando a {x}…', { x: it.label }));
          return;
        }
        const pos = this.realPos();
        this.mp4Audio = it.mp4;
        this.mp4Paused = this.v.paused;
        this.direct(pos);
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
    this.audioKey = it.key;
    if (user) setTitleLang(this.url, it.probe === this.probeDefault() && !this.panelMenu() ? null : it);
    // el idioma elegido antes para este título (Continuar viendo): lo prepara el panel, como al elegirlo en el menú; en el
    // televisor antes su propio reproductor y el lector de la app (el servidor es el último recurso)
    if ((user || saved) && it.probe !== undefined && this.panelMenu()) {
      if (this.tvNative()) {
        this.tvAudio(it, user);
        return;
      }
      this.toRemux(it.probe, it.label, user, t('Cambiando a {x}…', { x: it.label }));
      return;
    }
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
      this.audioTimer = setTimeout(() => {
        this.audioTimer = null;
        if (g !== this.gen || choice !== this.audioChange || this.remux) return;
        if (this.enabledNative() === n) {
          if (user) this.hooks.toast(t('Audio: {x}', { x: it.label }));
        } else if (it.probe !== undefined && !this.live && (user || saved)) {
          // el equipo no tomó la pista: en el televisor su servicio de medios y el lector de la app; si no, el panel
          if (this.tvNative()) this.tvAudio(it, user);
          else this.toRemux(it.probe, it.label, true, t('Cambiando a {x}…', { x: it.label }));
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
    // un audio que el equipo no decodifica: con el servidor apagado se avisa una vez (el video sigue sin ese audio)
    this.toRemux(it.probe, it.label, user || (!ok && !this.deniedShown), user || saved ? t('Cambiando a {x}…', { x: it.label }) : t('Este equipo no reproduce el audio {x}: se prepara con el panel…', { x: codecName(it.codec) }));
  }

  // motor del panel; sin él, el texto del panel una sola vez por video y solo si lo pidió el usuario
  private async getEngine(user: boolean, what: 'audio' | 'sub' = 'audio'): Promise<Engine | null> {
    const r = await mediaEngine();
    if (r.ok) return (this.engine = r.engine);
    this.denied(r.error, user, what);
    return null;
  }

  // el equipo no puede solo y el servidor (FFmpeg del panel) está apagado o sin permiso: se dice claro que hace falta
  // encenderlo y se avisa al panel (Reportes) con el motivo, el archivo y la pista
  private denied(msg: string, user: boolean, what: 'audio' | 'sub' = 'audio'): void {
    // cada vez que el usuario lo pide (antes una sola vez por video y después no pasaba nada)
    if (!user) return;
    this.deniedShown = true;
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
    if (!prev) {
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
      if (this.lunaSub >= 0) {
        this.lunaSub = -1;
        Promise.resolve((this.v as any).tvSubtitleOff?.()).catch(() => false);
      }
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
    // televisor: su reproductor (también los de imagen) y el lector de la app antes que el servidor
    if (this.tvNative()) {
      const g = this.gen;
      const pick = it;
      this.tvSub(it).then(done => !done && g === this.gen && this.subLast(pick));
      return;
    }
    this.subLast(it);
  }

  // último recurso para un subtítulo: el servidor lo convierte a texto (los de imagen no se pueden)
  private subLast(it: SubItem): void {
    if (it.probe === undefined) return;
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
    return it.probe !== undefined && this.mse instanceof MkvMse && !this.mp4Url ? this.mse.subCues(it.probe) : null;
  }

  private async extSub(s: number, label: string): Promise<void> {
    const g = this.gen;
    this.wantNote = label;
    const e = await this.getEngine(true, 'sub');
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
        if (r.denied) this.denied(r.denied, true, 'sub');
        else this.hooks.toast(t('Este subtítulo no se puede mostrar (es de imagen o el servidor no respondió).'));
        this.hooks.changed();
        return;
      }
      await new Promise<void>(res => setTimeout(res, 3000));
    }
  }
}
