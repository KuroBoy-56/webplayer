// @amazon-devices/react-native-w3cmedia en el televisor: el mismo VideoPlayer (forma de <video>) que usa
// la app de Vega. En una TV Samsung va sobre AVPlay (webapis.avplay: MKV, MP4, TS, HLS, 4K, varias pistas
// de audio y subtítulos del archivo); en un navegador (pruebas) es un <video> normal.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native-web';
import { UA } from '../../src/lib/http';

type Listener = (e?: any) => void;

export interface VideoPlayer {
  src: string;
  autoplay: boolean;
  readonly paused: boolean;
  currentTime: number;
  readonly duration: number;
  readonly error: any;
  play(): Promise<void> | void;
  pause(): void;
  addEventListener(type: string, l: Listener): void;
  removeEventListener(type: string, l: Listener): void;
  initialize(): Promise<void>;
  deinitialize(): Promise<void>;
  setSurfaceHandle(h: string): void;
  clearSurfaceHandle(h: string): void;
  setCaptionViewHandle(h: string): void;
}

const g = globalThis as any;

// ---------- pantalla transparente sobre el video de AVPlay (el video va en un plano debajo de la página) ----------

let cleared: { el: HTMLElement; bg: string }[] = [];
function seeThrough(from: HTMLElement | null) {
  restore();
  for (let el = from; el; el = el.parentElement) {
    cleared.push({ el, bg: el.style.getPropertyValue('background-color') });
    el.style.setProperty('background-color', 'transparent', 'important');
  }
}
function restore() {
  for (const c of cleared) c.el.style.setProperty('background-color', c.bg);
  cleared = [];
}

// ---------- lista de pistas con la forma de audioTracks / textTracks ----------

function trackList(): any {
  const list: any = [];
  const ls: Listener[] = [];
  list.addEventListener = (_t: string, l: Listener) => ls.push(l);
  list.removeEventListener = (_t: string, l: Listener) => {
    const i = ls.indexOf(l);
    if (i >= 0) ls.splice(i, 1);
  };
  list.fire = () => ls.slice().forEach(l => l());
  return list;
}

function info(t: any): any {
  try {
    return typeof t.extra_info === 'string' ? JSON.parse(t.extra_info) : t.extra_info || {};
  } catch {
    return {};
  }
}

// ---------- AVPlay ----------

class AvPlayer implements VideoPlayer {
  autoplay = false;
  paused = true;
  error: any = null;
  // HLS del motor del panel: AVPlay lo abre directo (sin Media Source Extensions)
  readonly nativeHls = true;
  readonly audioTracks = trackList();
  readonly textTracks = trackList();
  private url = '';
  private time = 0;
  private dur = NaN;
  private gen = 0;
  private prepared = false;
  private wantPlay = false;
  private host: HTMLElement | null = null;
  private subEl: HTMLDivElement | null = null;
  private subTimer: any = null;
  private ls: Record<string, Listener[]> = {};
  private av = g.webapis.avplay;
  private onVisibility = () => {
    try {
      if (document.hidden) this.av.suspend();
      else this.av.restore();
    } catch {
      // modelo sin suspend/restore
    }
  };

  addEventListener(t: string, l: Listener) {
    (this.ls[t] = this.ls[t] || []).push(l);
  }
  removeEventListener(t: string, l: Listener) {
    const a = this.ls[t] || [];
    const i = a.indexOf(l);
    if (i >= 0) a.splice(i, 1);
  }
  private fire(t: string) {
    for (const l of (this.ls[t] || []).slice()) l({ type: t });
  }

  get src() {
    return this.url;
  }
  set src(u: string) {
    this.open(u);
  }
  get currentTime() {
    return this.time;
  }
  set currentTime(t: number) {
    if (!this.prepared || this.dur === 0) return;
    this.time = t;
    this.fire('seeking');
    try {
      this.av.seekTo(Math.max(0, Math.floor(t * 1000)), () => this.fire('seeked'), () => {});
    } catch {
      // en vivo no se puede adelantar
    }
  }
  get duration() {
    return this.dur;
  }

  play() {
    this.wantPlay = true;
    if (!this.prepared) return Promise.resolve();
    try {
      this.av.play();
      this.paused = false;
      this.fire('play');
      this.fire('playing');
    } catch {
      // el estado no permite reproducir todavía
    }
    return Promise.resolve();
  }
  pause() {
    this.wantPlay = false;
    if (!this.prepared) return;
    try {
      this.av.pause();
    } catch {
      // ya en pausa
    }
    this.paused = true;
    this.fire('pause');
  }

  private close() {
    try {
      this.av.stop();
    } catch {}
    try {
      this.av.close();
    } catch {}
  }

  private open(url: string) {
    const g0 = ++this.gen;
    this.close();
    this.url = url;
    this.error = null;
    this.prepared = false;
    this.time = 0;
    this.dur = NaN;
    this.paused = true;
    this.showSub('', 0);
    this.audioTracks.length = 0;
    this.textTracks.length = 0;
    if (!url) return;
    const fail = (why: string) => {
      if (g0 !== this.gen) return;
      this.error = { code: 4, message: why };
      this.fire('error');
    };
    try {
      this.av.open(url);
      try {
        this.av.setStreamingProperty('USER_AGENT', UA);
      } catch {}
      try {
        // contenido UHD en HLS / DASH (sin efecto en los demás)
        this.av.setStreamingProperty('SET_MODE_4K', 'TRUE');
      } catch {}
      this.av.setListener({
        onbufferingstart: () => g0 === this.gen && this.fire('waiting'),
        onbufferingcomplete: () => g0 === this.gen && !this.paused && this.fire('playing'),
        oncurrentplaytime: (ms: number) => {
          if (g0 !== this.gen) return;
          this.time = ms / 1000;
          this.fire('timeupdate');
        },
        onstreamcompleted: () => {
          if (g0 !== this.gen) return;
          this.paused = true;
          this.fire('ended');
        },
        onerror: (e: any) => fail(String(e)),
        onsubtitlechange: (d: number, text: string) => g0 === this.gen && this.showSub(text, d),
        onevent: () => {},
      });
      this.layout();
      try {
        this.av.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      } catch {}
      this.av.prepareAsync(
        () => {
          if (g0 !== this.gen) return;
          this.prepared = true;
          const d = this.av.getDuration();
          this.dur = d > 0 ? d / 1000 : Infinity;
          this.readTracks();
          this.fire('loadedmetadata');
          this.fire('canplay');
          if (this.wantPlay || this.autoplay) this.play();
        },
        (e: any) => fail(String(e)),
      );
    } catch (e) {
      setTimeout(() => fail(String(e)), 0);
    }
  }

  // pistas del archivo: el menú de audio y subtítulos las cambia con setSelectTrack
  private readTracks() {
    let all: any[] = [];
    let cur: any[] = [];
    try {
      all = this.av.getTotalTrackInfo() || [];
      cur = this.av.getCurrentStreamInfo() || [];
    } catch {
      return;
    }
    const on = (type: string) => cur.find(t => t.type === type)?.index;
    const audioOn = on('AUDIO');
    const self = this;
    for (const t of all) {
      const x = info(t);
      if (t.type === 'AUDIO') {
        let enabled = t.index === audioOn;
        this.audioTracks.push({
          kind: 'main',
          label: x.language || '',
          language: x.language || '',
          get enabled() {
            return enabled;
          },
          set enabled(v: boolean) {
            if (v && !enabled) {
              try {
                self.av.setSelectTrack('AUDIO', t.index);
              } catch {
                return;
              }
              for (const o of self.audioTracks) if (o !== this) o.setOff();
            }
            enabled = v;
          },
          setOff() {
            enabled = false;
          },
        });
      } else if (t.type === 'TEXT') {
        let mode = 'disabled';
        this.textTracks.push({
          kind: 'subtitles',
          label: x.track_lang || x.language || '',
          language: x.track_lang || x.language || '',
          get mode() {
            return mode;
          },
          set mode(v: string) {
            mode = v;
            try {
              if (v === 'showing') {
                self.av.setSelectTrack('TEXT', t.index);
                self.av.setSilentSubtitle(false);
              } else if (!self.textTracks.some((o: any) => o.mode === 'showing')) {
                self.av.setSilentSubtitle(true);
                self.showSub('', 0);
              }
            } catch {
              // pista sin control
            }
          },
        });
      }
    }
    try {
      // sin elegir nada no se muestran subtítulos (Ajustes › idioma de subtítulos decide)
      this.av.setSilentSubtitle(true);
    } catch {}
    this.audioTracks.fire();
    this.textTracks.fire();
  }

  private showSub(text: string, ms: number) {
    if (this.subTimer) clearTimeout(this.subTimer);
    if (!this.subEl) return;
    this.subEl.textContent = text || '';
    this.subEl.style.display = text ? 'block' : 'none';
    if (text && ms > 0) this.subTimer = setTimeout(() => this.showSub('', 0), ms);
  }

  // AVPlay dibuja en coordenadas de 1920x1080 (la página se escala a la pantalla)
  private layout() {
    const r = this.host?.getBoundingClientRect();
    const k = 1920 / (window.innerWidth || 1920);
    try {
      if (r && r.width > 0) this.av.setDisplayRect(Math.round(r.left * k), Math.round(r.top * k), Math.round(r.width * k), Math.round(r.height * k));
      else this.av.setDisplayRect(0, 0, 1920, 1080);
    } catch {}
  }

  async initialize() {
    document.addEventListener('visibilitychange', this.onVisibility);
  }
  async deinitialize() {
    this.gen++;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.close();
    restore();
  }
  setSurfaceHandle(h: string) {
    this.host = document.getElementById(h);
    seeThrough(this.host);
    if (this.host && !this.subEl) {
      const d = document.createElement('div');
      d.style.cssText =
        'position:absolute;left:8%;right:8%;bottom:7%;text-align:center;color:#fff;font-size:44px;font-weight:700;' +
        'text-shadow:0 0 6px #000,0 0 3px #000;white-space:pre-line;display:none;pointer-events:none';
      this.host.appendChild(d);
      this.subEl = d;
    }
    this.layout();
  }
  clearSurfaceHandle() {
    this.subEl?.remove();
    this.subEl = null;
    this.host = null;
    restore();
  }
  setCaptionViewHandle() {}
}

// ---------- <video> (navegador / emulador sin AVPlay) ----------

function htmlPlayer(): VideoPlayer {
  const v = document.createElement('video') as any;
  v.setAttribute('playsinline', '');
  v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;background:#000';
  return Object.assign(v, {
    async initialize() {},
    async deinitialize() {
      v.pause();
      v.removeAttribute('src');
      try {
        v.load();
      } catch {}
      v.remove();
    },
    setSurfaceHandle(h: string) {
      document.getElementById(h)?.appendChild(v);
    },
    clearSurfaceHandle() {
      v.remove();
    },
    setCaptionViewHandle() {},
  });
}

export const VideoPlayer: { new (): VideoPlayer } = function VideoPlayer(this: any) {
  return g.webapis?.avplay ? new AvPlayer() : htmlPlayer();
} as any;

export const MediaSource: any =
  g.MediaSource ||
  class {
    static isTypeSupported() {
      return false;
    }
  };

// ---------- superficie del video y capa de subtítulos ----------

let seq = 0;

export function KeplerVideoSurfaceView({ style, onSurfaceViewCreated, onSurfaceViewDestroyed }: any) {
  const ref = useRef<any>(null);
  useEffect(() => {
    const el = ref.current as HTMLElement;
    const id = 'mpx-surface-' + ++seq;
    el.id = id;
    onSurfaceViewCreated?.(id);
    return () => onSurfaceViewDestroyed?.(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <View ref={ref} style={style} />;
}

// los subtítulos del archivo los dibuja el propio reproductor (AVPlay: dentro de la superficie)
export function KeplerCaptionsView(_: any) {
  return null;
}
