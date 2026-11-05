// @amazon-devices/react-native-w3cmedia en el televisor: el mismo VideoPlayer (forma de <video>) que usa
// la app de Vega. En webOS el <video> es el reproductor del televisor LG (por hardware: MP4, MKV, MPEG-TS, HLS,
// 4K / HDR, varias pistas de audio con audioTracks); en un navegador (pruebas) es el <video> de Chrome.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native-web';
import { luna } from '../../src/lib/platform';

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

// ---------- <video> del televisor ----------

// ¿el reproductor abre HLS solo? (webOS sí; Chrome de escritorio no: ahí el HLS del panel va por MSE)
function hlsByItself(v: HTMLVideoElement): boolean {
  try {
    return !!v.canPlayType('application/vnd.apple.mpegurl') || !!v.canPlayType('application/x-mpegURL');
  } catch {
    return false;
  }
}

// ¿es el televisor LG? (PalmSystem solo existe en webOS; en un navegador de pruebas no)
const onTv = () => !!g.PalmSystem;

// id del video en el reproductor del televisor (webOS lo pone en el <video> al cargar: mediaId)
function mediaIdOf(v: any): string {
  return String(v.mediaId || v.getAttribute?.('mediaId') || '');
}

// Tipo del video para el reproductor del televisor. webOS solo usa su reproductor por hardware (el de LG: HLS, MPEG-TS,
// MKV, Dolby, DTS, varias pistas de audio con audioTracks y mediaId para com.webos.media) cuando el <video> lleva el tipo
// en un <source>; con solo src lo puede abrir el motor de Chromium (FFmpegDemuxer: «open context failed» con los canales,
// MKV y audios Dolby que no abren, audioTracks vacío). hls: HLS por su transporte (mediaTransportType HLS: LG lo pone
// solo si la dirección dice .m3u8; el HLS del panel no lo dice). file: archivo (si el reproductor del televisor no lo
// abre, se prueba una vez como antes, sin tipo). '' = sin tipo (blob: de MSE, data:)
export function tvType(url: string): { type: string; hls: boolean; file: boolean } {
  const none = { type: '', hls: false, file: false };
  if (!/^https?:\/\//i.test(url)) return none;
  const path = url.split(/[?#]/)[0].toLowerCase();
  if (/\.m3u8?$/.test(path) || /[?&]do=hls\b/i.test(url)) return { type: 'application/vnd.apple.mpegurl', hls: true, file: false };
  if (/\.mpd$/.test(path)) return { type: 'application/dash+xml', hls: false, file: false };
  // canales: .ts y la dirección corta de Xtream (usuario/contraseña/número, sin extensión)
  if (/\.ts$/.test(path) || /\/\d+$/.test(path)) return { type: 'video/mp2t', hls: false, file: false };
  const ext = (path.match(/\.([a-z0-9]{2,4})$/) || [])[1] || '';
  const files: Record<string, string> = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', mpg: 'video/mpeg', mpeg: 'video/mpeg', wmv: 'video/x-ms-wmv', flv: 'video/x-flv' };
  return files[ext] ? { type: files[ext], hls: false, file: true } : none;
}

// el tipo con su mediaOption (LG: JSON escapado en el parámetro mediaOption del tipo). Si el televisor no reconoce ese
// tipo (canPlayType vacío: el <source> se saltaría sin avisar), el genérico video/mp4: su reproductor mira el archivo
function typed(v: HTMLVideoElement, url: string): string {
  const k = tvType(url);
  if (!k.type) return '';
  let type = k.type;
  const can = (x: string) => {
    try {
      return !!v.canPlayType(x);
    } catch {
      return false;
    }
  };
  if (!can(type)) type = k.hls ? (can('application/x-mpegURL') ? 'application/x-mpegURL' : '') : can('video/mp4') ? 'video/mp4' : '';
  if (!type) return '';
  return type + ';mediaOption=' + encodeURIComponent(JSON.stringify({ mediaTransportType: k.hls ? 'HLS' : 'URI' }));
}

// en el televisor, src pone un <source> con el tipo (el reproductor de LG). Un <source> que no abre avisa el error en
// sí mismo, no en el <video>: se pasa al <video> (con su motivo en error) para que la app siga con lo suyo
function tvSource(v: any): void {
  const proto = (globalThis as any).HTMLMediaElement?.prototype;
  const srcProp = proto && Object.getOwnPropertyDescriptor(proto, 'src');
  const errProp = proto && Object.getOwnPropertyDescriptor(proto, 'error');
  if (!srcProp?.set || !errProp?.get) return;
  let cur = '';
  let srcError: { code: number; message: string } | null = null;
  const clear = () => {
    for (const el of Array.from(v.querySelectorAll('source')) as HTMLElement[]) el.remove();
  };
  const plain = (url: string) => {
    clear();
    if (url) srcProp.set!.call(v, url);
    else {
      v.removeAttribute('src');
      try {
        v.load();
      } catch {}
    }
  };
  Object.defineProperty(v, 'error', { configurable: true, get: () => errProp.get!.call(v) || srcError });
  Object.defineProperty(v, 'src', {
    configurable: true,
    get: () => cur,
    set: (url: string) => {
      cur = String(url || '');
      srcError = null;
      const type = cur ? typed(v, cur) : '';
      if (!type) return plain(cur);
      clear();
      v.removeAttribute('src');
      const el = document.createElement('source');
      const mine = cur;
      el.addEventListener('error', () => {
        if (cur !== mine || errProp.get!.call(v)) return;
        // un archivo (MP4, MKV…) que el reproductor del televisor no abrió: una vez más como antes (sin tipo)
        if (tvType(mine).file) return plain(mine);
        srcError = { code: 4, message: 'LG: el reproductor del televisor no abrió el video' };
        v.dispatchEvent(new Event('error'));
      });
      el.setAttribute('src', cur);
      el.setAttribute('type', type);
      v.appendChild(el);
      try {
        v.load();
      } catch {}
    },
  });
}

function htmlPlayer(): VideoPlayer {
  const v = document.createElement('video') as any;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;background:#000';
  if (onTv()) tvSource(v);
  // HLS del motor del panel: el televisor lo abre directo (src/player/hls.ts)
  Object.defineProperty(v, 'nativeHls', { value: hlsByItself(v) });
  // en el televisor, MP4 / MKV / MOV / TS los abre su reproductor por hardware (todos los audios, Dolby y DTS incluidos):
  // src/player/playback.ts no usa los lectores propios de Vega salvo para cambiar de audio o subtítulos si el televisor
  // no puede
  Object.defineProperty(v, 'nativeFiles', { value: onTv() });
  // Cambio de pista con el servicio de medios del televisor (com.webos.media, el mismo reproductor por hardware), para
  // cuando el <video> no informa sus pistas (audioTracks / textTracks vacíos): index = orden de la pista en el archivo
  // (el mismo de la cabecera leída: 0:a:N / 0:s:N). true = el televisor aceptó el cambio
  Object.defineProperty(v, 'tvSelectTrack', {
    value: async (type: 'audio' | 'text', index: number): Promise<boolean> => {
      if (!onTv()) return false;
      const mediaId = mediaIdOf(v);
      if (!mediaId || index < 0) return false;
      const r = await luna('luna://com.webos.media/selectTrack', { mediaId, type, index });
      if (!r) return false;
      if (type === 'text') await luna('luna://com.webos.media/setSubtitleEnable', { mediaId, enable: true });
      return true;
    },
  });
  Object.defineProperty(v, 'tvSubtitleOff', {
    value: async (): Promise<boolean> => {
      const mediaId = onTv() ? mediaIdOf(v) : '';
      return !!mediaId && !!(await luna('luna://com.webos.media/setSubtitleEnable', { mediaId, enable: false }));
    },
  });
  return Object.assign(v, {
    async initialize() {},
    async deinitialize() {
      v.pause();
      // también el <source> del televisor: con él, load() volvería a abrir el video en un <video> ya quitado
      if (onTv()) v.src = '';
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

export const VideoPlayer: { new (): VideoPlayer } = function VideoPlayer() {
  return htmlPlayer();
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

// los subtítulos del archivo los dibuja el propio reproductor (textTracks del <video>)
export function KeplerCaptionsView(_: any) {
  return null;
}
