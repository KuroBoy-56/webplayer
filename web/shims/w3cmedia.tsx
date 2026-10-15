// @amazon-devices/react-native-w3cmedia en el televisor: el mismo VideoPlayer (forma de <video>) que usa
// la app de Vega. En webOS el <video> es el reproductor del televisor LG (por hardware: MP4, MKV, MPEG-TS, HLS,
// 4K / HDR, varias pistas de audio con audioTracks); en un navegador (pruebas) es el <video> de Chrome.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native-web';

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

function htmlPlayer(): VideoPlayer {
  const v = document.createElement('video') as any;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;background:#000';
  // HLS del motor del panel: el televisor lo abre directo (src/player/hls.ts)
  Object.defineProperty(v, 'nativeHls', { value: hlsByItself(v) });
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
