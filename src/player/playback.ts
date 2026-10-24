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
import { Engine, engineDenied, mediaEngine, subCheck, subText, hlsLink } from '../api/media';
import { t } from '../lib/i18n';
import { codecKey, codecName, imageSub, langKey, langName, numbered, sameLang, trackLang } from '../lib/lang';
import { Probe, probeTracks } from '../lib/probe';
import { pref, setPref } from '../lib/storage';
import { Cue, cueAt, parseVtt } from '../lib/vtt';
import { PanelHls } from './hls';

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

export class Playback {
  private url = '';
  private live = false;
  private gen = 0;
  private probe: Probe | null = null;
  private probing = false;
  private resumeAt = 0;
  private remux: { a: number; label: string } | null = null;
  private hls: PanelHls | null = null;
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

  constructor(private v: VideoPlayer, private hooks: Hooks) {}

  // ---------- fuente ----------

  load(url: string, resume: number, live: boolean): void {
    this.gen++;
    this.stopHls();
    this.url = url;
    this.live = live;
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
    this.direct(resume);
  }

  private direct(at: number): void {
    this.stopHls();
    this.offset = 0;
    this.resumeAt = at;
    this.v.src = this.url;
    this.v.play();
  }

  private stopHls(): void {
    this.hls?.destroy();
    this.hls = null;
    this.remuxLive = false;
  }

  destroy(): void {
    this.gen++;
    this.stopHls();
    this.setExt(null);
    if (this.prefsTimer) clearTimeout(this.prefsTimer);
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

  // primera vez "playing": se lee la cabecera del archivo (como Roku, ya con el video andando)
  onPlaying(): void {
    if (this.live || this.probe || this.probing) return;
    this.probing = true;
    const g = this.gen;
    probeTracks(this.url).then(p => {
      if (g !== this.gen) return;
      this.probe = p;
      if (p.ok) {
        if (!this.audioKey) this.audioApplied = false;
        else this.checkDecodable();
        if (!this.subKey) this.subApplied = false;
        this.applyPrefs();
        if (p.audio.length > 1) this.hooks.toast(t('{n} idiomas de audio en este video: pulsa ▼ para cambiar', { n: p.audio.length }));
      }
      this.hooks.changed();
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
    if (!this.probe) this.probe = await probeTracks(this.url);
    if (g !== this.gen) return false;
    const items = this.probe.ok ? this.audioItems() : [];
    const def = items[this.probeDefault()];
    if (def && def.probe !== undefined && !this.decodable(def)) {
      // el panel lo convierte a AAC: de una vez el idioma preferido
      const want = this.preferredAudio(items) || def;
      const label = want.label;
      return this.toRemux(want.probe ?? def.probe, label, false, t('Cambiando a {x}…', { x: label }), Math.floor(this.resumeAt || this.realPos()));
    }
    return this.formatFallback(items);
  }

  // el equipo no abre el archivo (contenedor o códec que no reconoce, AVI, MKV raros…): el motor del panel lo
  // entrega como HLS (video sin cambios, audio en AAC) desde donde iba, antes de dar el error. Una vez por video.
  private async formatFallback(items: AudioItem[]): Promise<boolean> {
    if (this.formatTried || this.live) return false;
    this.formatTried = true;
    const it = this.preferredAudio(items) || items[this.probeDefault()];
    return this.toRemux(it?.probe ?? 0, it?.label || t('Audio {n}', { n: 1 }), false, t('Este equipo no abre el video directo: se prepara con el panel…'), Math.floor(this.resumeAt || this.realPos()));
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
    if (this.remux) return items.find(i => i.probe === this.remux!.a);
    const n = this.enabledNative();
    if (n >= 0) {
      const m = items.find(i => i.native === n);
      if (m) return m;
    }
    return items.find(i => i.key === this.audioKey) || (this.probe?.ok ? items[this.probeDefault()] : items[0]);
  }

  private preferredAudio(items: AudioItem[]): AudioItem | undefined {
    const p = pref('audio_lang', 'es');
    return p ? items.find(i => sameLang(i.lang, p)) : undefined;
  }

  private decodable(it: AudioItem): boolean {
    return it.probe === undefined || nativeAudioOk(it.codec, this.probe?.container || '');
  }

  // menú de audio y subtítulos
  menu(): MenuItem[] {
    const out: MenuItem[] = [];
    const a = this.audioItems();
    const on = this.audioOn(a);
    for (const it of a) out.push({ kind: 'audio', key: it.key, label: it.label, on: it === on });
    // como "Reabrir en modo compatible" de Roku: si el equipo no cambió el idioma, lo hace el panel
    if (!this.live && !this.remux && this.probe?.ok && a.length > 1 && !engineDenied()) out.push({ kind: 'panel', key: 'panel', label: t('¿No cambia el idioma? Prepararlo con el panel'), on: false });
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
      const it = this.audioItems().find(i => i.key === m.key);
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

  private autoAudio(): void {
    if (this.audioApplied || this.audioKey || this.remux) return;
    const items = this.audioItems();
    if (!items.length) return;
    const cur = this.audioOn(items);
    const want = this.preferredAudio(items);
    // el audio que suena el equipo no lo puede decodificar (DTS…): hace falta el panel
    const stuck = cur && !this.decodable(cur);
    if (items.length < 2 && !stuck) return;
    this.audioApplied = true;
    const pick = want && this.decodable(want) ? want : stuck ? items.find(i => this.decodable(i) && sameLang(i.lang, cur!.lang)) || want || cur : want;
    if (pick && pick !== cur) this.pickAudio(pick, false);
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

  private pickAudio(it: AudioItem, user: boolean): void {
    this.audioKey = it.key;
    if (user) rememberLang('audio_lang', it.lang);
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
        } else if (it.probe !== undefined && !this.live && user) {
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
    if (!user && ok) {
      this.audioKey = '';
      return;
    }
    this.toRemux(it.probe, it.label, user, user ? t('Cambiando a {x}…', { x: it.label }) : t('Este equipo no reproduce el audio {x}: se prepara con el panel…', { x: codecName(it.codec) }));
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
    this.remux = { a, label };
    this.audioKey = 'p:' + a;
    if (note) this.hooks.toast(note);
    this.startRemux(pos);
    return true;
  }

  private async startRemux(pos: number): Promise<void> {
    if (!this.remux || !this.engine) return;
    const { a, label } = this.remux;
    // mientras se prepara sigue lo que suena (video directo o el HLS anterior hasta donde llegó)
    this.stopHls();
    this.remuxFrom = Math.floor(pos);
    const h = new PanelHls(this.v, hlsLink(this.engine, this.url, a, pos));
    this.hls = h;
    h.onError = msg => this.hls === h && this.remuxFailed(msg);
    this.hooks.status(t('Cambiando idioma…'));
    const err = await h.start();
    if (this.hls !== h) return;
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
