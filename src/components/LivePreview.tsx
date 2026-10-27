// Vista previa del canal en TV en vivo (como Roku): al quedarse 2,5 s sobre un canal empieza a reproducirse en el
// cuadro de la derecha (donde estaba el logo). Al moverse a otro canal se corta; con OK se abre a pantalla completa
// (antes se apaga la vista previa: no se usan dos conexiones de la línea a la vez). Mientras carga, el logo.
import { KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LIVE_FORMATS, liveUrl, otherScheme, streamFlip } from '../api/xtream';
import { Item } from '../data/catalog';
import { Playback } from '../player/playback';
import { getState } from '../state';
import { px, themed } from '../theme';

// la vista previa que está sonando (para apagarla justo antes de abrir el reproductor)
let stopCurrent: (() => void) | null = null;
export function stopLivePreview(): void {
  stopCurrent?.();
  stopCurrent = null;
}

export default function LivePreview({ channel, active }: { channel: Item | null; active: boolean }) {
  const surface = useRef('');
  const video = useRef<VideoPlayer | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlaying(false);
    const s = getState().session;
    if (!channel || !active || !s) return;
    let alive = true;
    let v: VideoPlayer | null = null;
    let c: Playback | null = null;
    const onPlaying = () => alive && setPlaying(true);
    const stop = () => {
      if (!alive) return;
      alive = false;
      setPlaying(false);
      try {
        c?.destroy();
        if (v) {
          v.removeEventListener('playing', onPlaying);
          v.pause();
          if (surface.current) v.clearSurfaceHandle(surface.current);
          v.deinitialize().catch(() => {});
        }
      } catch {
        // ya cerrado
      }
      video.current = null;
    };
    const timer = setTimeout(() => {
      if (!alive) return;
      v = new VideoPlayer();
      video.current = v;
      v.initialize()
        .then(() => {
          if (!alive || !v) return;
          v.autoplay = false;
          v.addEventListener('playing', onPlaying);
          if (surface.current) v.setSurfaceHandle(surface.current);
          c = new Playback(v, { toast: () => {}, status: () => {}, changed: () => {}, subText: () => {}, fatal: () => {} });
          const u = liveUrl(s, channel.id, LIVE_FORMATS[0]);
          c.load(streamFlip() ? otherScheme(u) : u, 0, true);
        })
        .catch(() => {});
    }, 2500);
    stopCurrent = stop;
    return () => {
      clearTimeout(timer);
      stop();
      if (stopCurrent === stop) stopCurrent = null;
    };
  }, [channel, active]);

  return (
    <View style={s.box}>
      {channel && active ? (
        <KeplerVideoSurfaceView
          style={s.video}
          onSurfaceViewCreated={(h: string) => {
            surface.current = h;
            video.current?.setSurfaceHandle(h);
          }}
          onSurfaceViewDestroyed={(h: string) => {
            video.current?.clearSurfaceHandle(h);
            surface.current = '';
          }}
        />
      ) : null}
      {!playing && channel?.poster ? (
        <View style={s.logoWrap}>
          <Image source={{ uri: channel.poster }} style={s.logo} resizeMode="contain" />
        </View>
      ) : null}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    box: { width: px(480), height: px(270), borderRadius: px(8), overflow: 'hidden', backgroundColor: '#000', marginBottom: px(16) },
    video: { position: 'absolute', left: 0, top: 0, width: px(480), height: px(270) },
    logoWrap: { position: 'absolute', left: 0, top: 0, width: px(480), height: px(270), alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
    logo: { width: px(260), height: px(150) },
  }),
);
