// Vista previa del canal en TV en vivo (como Roku): al quedarse 2,5 s sobre un canal empieza a reproducirse en el
// cuadro de la derecha (donde estaba el logo). Al moverse a otro canal se corta; con OK se abre a pantalla completa
// (antes se apaga la vista previa: no se usan dos conexiones de la línea a la vez). Mientras carga, el logo.
import { KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import React, { memo, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LIVE_FORMATS, liveUrl, otherScheme, streamFlip } from '../api/xtream';
import { Item } from '../data/catalog';
import { Playback } from '../player/playback';
import { dropPrefetch, prefetchList } from '../player/prefetch';
import { registerLivePreview, waitForLivePreview } from '../player/preview-session';
import { getState } from '../state';
import { px, themed } from '../theme';

export { stopLivePreview } from '../player/preview-session';

// delay: espera antes de conectar (la pantalla de canales la pone con OK: casi enseguida)
export default memo(function LivePreview({ channel, active, delay = 2500 }: { channel: Item | null; active: boolean; delay?: number }) {
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
    let initializing: Promise<void> | null = null;
    let closed: Promise<void> | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    // dirección del canal: su lista y su primer segmento se piden mientras el reproductor se inicia (como Player)
    let url = '';
    const onPlaying = () => alive && setPlaying(true);
    const stop = (): Promise<void> => {
      if (closed) return closed;
      alive = false;
      clearTimeout(timer);
      if (retry) clearTimeout(retry);
      setPlaying(false);
      video.current = null;
      if (url) dropPrefetch(url);
      // lo que ya tiene el canal pasa a la pantalla grande (si se abre ese canal) y la conexión se suelta ya
      try { c?.handOffLive(); } catch { /* sin lector */ }
      const player = v;
      closed = (async () => {
        if (!player) return;
        try { await initializing; } catch { /* inicialización interrumpida */ }
        try {
          player.removeEventListener('playing', onPlaying);
          player.pause();
          if (surface.current) player.clearSurfaceHandle(surface.current);
        } catch { /* ya cerrado */ }
        try { await c?.destroy(); } catch { /* sin motor */ }
        try { await player.deinitialize(); } catch { /* ya cerrado */ }
      })();
      return closed;
    };
    const timer = setTimeout(async () => {
      await waitForLivePreview();
      if (!alive) return;
      try {
        const u = liveUrl(s, channel.id, LIVE_FORMATS[0]);
        url = streamFlip() ? otherScheme(u) : u;
        if (/\.m3u8(\?|$)/i.test(url)) prefetchList(url);
        v = new VideoPlayer();
        initializing = v.initialize();
        await initializing;
        // la superficie antes de darle el video (Amazon: sin ella, error 4); como mucho 3 s
        for (let i = 0; i < 30 && alive && !surface.current; i++) await new Promise<void>(r => setTimeout(r, 100));
        if (!alive) return;
        video.current = v;
        v.autoplay = false;
        v.addEventListener('playing', onPlaying);
        if (surface.current) v.setSurfaceHandle(surface.current);
        c = new Playback(v, { toast: () => {}, status: () => {}, changed: () => {}, subText: () => {}, fatal: () => {} });
        c.liveKeep = true;
        c.load(url, 0, true);
        // sin imagen en 15 s con audio MP2 / AC-3 que el equipo no decodifica: el canal otra vez solo con el video
        // (como en pantalla grande, Player)
        retry = setTimeout(() => {
          if (alive && c && !c.hasPlayed()) c.liveRetryTs();
        }, 15000);
      } catch { void stop(); }
    }, delay);
    const unregister = registerLivePreview(stop);
    return () => {
      clearTimeout(timer);
      unregister();
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
            if (h !== surface.current) return;
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
});

const s = themed(() =>
  StyleSheet.create({
    box: { width: px(480), height: px(270), borderRadius: px(8), overflow: 'hidden', backgroundColor: '#000', marginBottom: px(16) },
    video: { position: 'absolute', left: 0, top: 0, width: px(480), height: px(270) },
    logoWrap: { position: 'absolute', left: 0, top: 0, width: px(480), height: px(270), alignItems: 'center', justifyContent: 'center', backgroundColor: '#000' },
    logo: { width: px(260), height: px(150) },
  }),
);
