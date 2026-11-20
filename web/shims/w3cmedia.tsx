// @amazon-devices/react-native-w3cmedia en el televisor: el mismo VideoPlayer (forma de <video>) que usa
// la app de Vega. En VIDAA el <video> es el reproductor del televisor Hisense (HLS, MP4 y lo que su equipo decodifica,
// varias pistas de audio si las informa con audioTracks); en un navegador (pruebas) es el <video> de Chrome.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native-web';
import { onVidaa } from '../../src/lib/platform';

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
  // traspaso entre la miniatura de TV en vivo y la pantalla grande (src/player/preview-session.ts): el video sigue en la
  // página, en el mismo lugar y sonando, hasta que la otra superficie lo toma (sin cerrarlo ni abrir el canal otra vez)
  park?(): void;
}

const g = globalThis as any;

// ---------- <video> del televisor ----------

// ¿el reproductor abre HLS solo? (VIDAA sí; Chrome de escritorio no: ahí el HLS del panel va por MSE)
function hlsByItself(v: HTMLVideoElement): boolean {
  try {
    return !!v.canPlayType('application/vnd.apple.mpegurl') || !!v.canPlayType('application/x-mpegURL');
  } catch {
    return false;
  }
}

// ¿el reproductor del televisor Hisense? (en un navegador de pruebas no: ahí los lectores de la app, como en Vega).
// En VIDAA la app es una página: los lectores propios leen el video con fetch y casi ningún servidor IPTV lo permite
// (CORS), así que el video lo abre siempre primero el <video> del televisor, que no tiene esa traba.
const onTv = () => onVidaa();

// ---------- traspaso sin cortes (miniatura ↔ pantalla grande) ----------
//
// Quitar el <video> de la página lo pausa (el motor lo detiene y en el televisor puede soltar su reproductor): en el
// traspaso nunca sale de la página. Mientras la otra pantalla se dibuja queda «estacionado» encima de todo, en el mismo
// lugar y del mismo tamaño en que se veía, y la superficie nueva lo mueve con un solo appendChild (mover un nodo de un
// lugar a otro de la página no lo pausa). Si nadie lo toma en 1,5 s se oculta (el que lo ofreció lo cierra a los 4-5 s).
let parkBox: HTMLElement | null = null;
let parkTimer: ReturnType<typeof setTimeout> | null = null;

function parkVideo(v: HTMLElement): void {
  if (!v.isConnected) return;
  const r = v.getBoundingClientRect();
  if (!parkBox) {
    parkBox = document.createElement('div');
    parkBox.id = 'mpx-park';
    document.body.appendChild(parkBox);
  }
  const w = r.width > 1 ? r.width : window.innerWidth;
  const h = r.height > 1 ? r.height : window.innerHeight;
  const x = r.width > 1 ? r.left : 0;
  const y = r.height > 1 ? r.top : 0;
  parkBox.style.cssText =
    'position:fixed;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px;overflow:hidden;pointer-events:none;z-index:2147483000;background:#000';
  (v as any).mpxWasPlaying = !(v as any).paused;
  parkBox.appendChild(v);
  if (parkTimer) clearTimeout(parkTimer);
  parkTimer = setTimeout(() => {
    parkTimer = null;
    if (parkBox && parkBox.childNodes.length > 0) parkBox.style.visibility = 'hidden';
  }, 1500);
}

// el video salió del estacionamiento (lo tomó una superficie o se cerró): la caja se oculta
function unpark(): void {
  if (!parkBox || parkBox.childNodes.length > 0) return;
  if (parkTimer) clearTimeout(parkTimer);
  parkTimer = null;
  parkBox.style.cssText = 'display:none';
}

function htmlPlayer(): VideoPlayer {
  const v = document.createElement('video') as any;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  v.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;background:#000';
  // HLS del motor del panel: el televisor lo abre directo (src/player/hls.ts)
  Object.defineProperty(v, 'nativeHls', { value: hlsByItself(v) });
  // en el televisor, MP4 / MKV / MOV los abre su reproductor: src/player/playback.ts no usa los lectores propios de Vega
  // salvo para cambiar de audio o subtítulos si el televisor no puede (y si el servidor lo permite)
  Object.defineProperty(v, 'nativeFiles', { value: onTv() });
  // canales con el reproductor del televisor (HLS): solo en el televisor
  Object.defineProperty(v, 'nativeLive', { value: onTv() });
  return Object.assign(v, {
    async initialize() {},
    async deinitialize() {
      v.pause();
      v.removeAttribute('src');
      try {
        v.load();
      } catch {}
      v.remove();
      unpark();
    },
    setSurfaceHandle(h: string) {
      const el = document.getElementById(h);
      if (!el) return;
      const parked = !!parkBox && v.parentElement === parkBox;
      if (v.parentElement !== el) el.appendChild(v);
      if (!parked) return;
      unpark();
      // en televisores con un motor más viejo, mover el <video> lo pausa: sigue sonando
      if (v.mpxWasPlaying && v.paused) {
        try {
          const p = v.play();
          if (p && p.catch) p.catch(() => {});
        } catch {}
      }
    },
    // solo si el video sigue en esa superficie: la miniatura que se desmonta después de entregarlo a la pantalla grande
    // (o al revés) ya no lo quita de la superficie nueva
    clearSurfaceHandle(h?: string) {
      if (h && v.parentElement && v.parentElement.id !== h) return;
      v.remove();
      unpark();
    },
    setCaptionViewHandle() {},
    park() {
      parkVideo(v);
    },
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
