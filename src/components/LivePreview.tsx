// Vista previa del canal en TV en vivo (como Roku): al quedarse 2,5 s sobre un canal empieza a reproducirse en el
// cuadro de la derecha (donde estaba el logo). Al moverse a otro canal se corta; con OK se abre a pantalla completa
// (antes se apaga la vista previa: no se usan dos conexiones de la línea a la vez). Mientras carga, el logo.
import { KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import React, { memo, useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LIVE_FORMATS, liveFormatStart, liveUrl, otherScheme, streamFlip } from '../api/xtream';
import { Item } from '../data/catalog';
import { Playback } from '../player/playback';
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
    let reader: ReturnType<typeof setTimeout> | undefined;
    const onPlaying = () => alive && setPlaying(true);
    // televisor (LG): su reproductor no abrió el canal o no da imagen en 12 s: el lector de la app (en otros equipos no hace nada)
    let readerUrl = '';
    const toReader = () => {
      if (alive && c && !c.hasPlayed() && readerUrl) c.liveReader(readerUrl);
    };
    const stop = (): Promise<void> => {
      if (closed) return closed;
      alive = false;
      clearTimeout(timer);
      if (retry) clearTimeout(retry);
      if (reader) clearTimeout(reader);
      setPlaying(false);
      video.current = null;
      const player = v;
      closed = (async () => {
        if (!player) return;
        try { await initializing; } catch { /* inicialización interrumpida */ }
        try {
          player.removeEventListener('playing', onPlaying);
          player.removeEventListener('error', toReader);
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
        v = new VideoPlayer();
        initializing = v.initialize();
        await initializing;
        if (!alive) return;
        video.current = v;
        v.autoplay = false;
        v.addEventListener('playing', onPlaying);
        v.addEventListener('error', toReader);
        if (surface.current) v.setSurfaceHandle(surface.current);
        c = new Playback(v, { toast: () => {}, status: () => {}, changed: () => {}, subText: () => {}, fatal: () => {} });
        const fmt = LIVE_FORMATS[liveFormatStart()];
        const u = liveUrl(s, channel.id, fmt);
        const url = streamFlip() ? otherScheme(u) : u;
        readerUrl = fmt === 'direct' ? '' : url.replace(/\.ts(\?|$)/i, '.m3u8$1');
        c.load(url, 0, true);
        // sin imagen en 15 s con audio MP2 / AC-3 que el equipo no decodifica: el canal otra vez solo con el video
        // (como en pantalla grande, Player)
        reader = setTimeout(toReader, 12000);
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
