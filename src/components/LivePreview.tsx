// Vista previa del canal en TV en vivo (como Roku): al quedarse 2,5 s sobre un canal empieza a reproducirse en el
// cuadro de la derecha (donde estaba el logo). Al moverse a otro canal se corta. Con OK otra vez la pantalla grande se
// queda con este mismo reproductor (sin cortar el canal ni abrirlo de nuevo, como Roku y Vega OS) y al salir de la
// pantalla grande el reproductor vuelve aquí igual (preview-session.ts). Mientras carga, el logo.
import { KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { LIVE_FORMATS, liveFormatStart, liveUrl, otherScheme, streamFlip } from '../api/xtream';
import { Item } from '../data/catalog';
import { Playback } from '../player/playback';
import { dropReturn, offerPreview, registerLivePreview, takeReturn, waitForLivePreview } from '../player/preview-session';
import { getState } from '../state';
import { px, themed } from '../theme';
import { ChannelLogo } from './ui';

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    // dirección del canal (la pantalla grande hereda el reproductor solo si abre esta misma)
    let url = '';
    // ya suena: también para el reproductor (hasPlayed): la pantalla grande que lo hereda sabe que el canal ya se ve, y el
    // respaldo de los 12 s (lector de la app) ya no reabre un canal que el televisor está mostrando
    const onPlaying = () => {
      if (!alive) return;
      setPlaying(true);
      c?.onPlaying();
    };
    // televisor (LG): su reproductor no abrió el canal o no da imagen en 12 s: el lector de la app (en otros equipos no hace nada)
    let readerUrl = '';
    const toReader = () => {
      if (alive && c && !c.hasPlayed() && readerUrl) c.liveReader(readerUrl);
    };
    // OK otra vez: la pantalla grande se queda con este reproductor (sin cerrarlo ni abrir el canal de nuevo), también si
    // todavía conecta: abrir el canal otra vez mientras el servidor sigue contando la conexión de la miniatura puede dar
    // «línea en uso» en líneas de una conexión
    const give = (): boolean => {
      if (!alive || closed || !v || !c) return false;
      alive = false;
      if (timer) clearTimeout(timer);
      if (retry) clearTimeout(retry);
      if (reader) clearTimeout(reader);
      const player = v;
      try {
        player.removeEventListener('playing', onPlaying);
        player.removeEventListener('error', toReader);
        // el video sigue en la página, en su lugar y sonando, hasta que la pantalla grande pone su superficie
        if (player.park) player.park();
        else if (surface.current) player.clearSurfaceHandle(surface.current);
      } catch { /* sigue igual */ }
      video.current = null;
      closed = Promise.resolve();
      offerPreview({ url, v: player, c, at: Date.now() });
      return true;
    };
    const stop = (): Promise<void> => {
      if (closed) return closed;
      alive = false;
      if (timer) clearTimeout(timer);
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
    const hooks = { toast: () => {}, status: () => {}, changed: () => {}, subText: () => {}, fatal: () => {} };
    // Se vuelve de la pantalla grande con este canal sonando: la miniatura se queda con ese mismo reproductor (solo cambia
    // la superficie, como Roku): sin cortar el canal ni abrirlo otra vez
    const back = takeReturn(channel.id);
    if (back) {
      v = back.v;
      c = back.c;
      const fmt = LIVE_FORMATS[liveFormatStart()];
      const u = liveUrl(s, channel.id, fmt);
      url = streamFlip() ? otherScheme(u) : u;
      readerUrl = fmt === 'direct' ? '' : url.replace(/\.ts(\?|$)/i, '.m3u8$1');
      initializing = Promise.resolve();
      video.current = v;
      setPlaying(true);
      try {
        v.addEventListener('playing', onPlaying);
        v.addEventListener('error', toReader);
        if (surface.current) v.setSurfaceHandle(surface.current);
        c.setHooks(hooks);
        if (v.paused) void v.play();
      } catch { /* sigue igual: si quedó mal, el error del reproductor lo vuelve a abrir */ }
      return registerLivePreview(stop, give);
    }
    timer = setTimeout(async () => {
      // el reproductor que volvió de la pantalla grande era de otro canal: se cierra antes de abrir este
      dropReturn();
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
        c = new Playback(v, hooks);
        const fmt = LIVE_FORMATS[liveFormatStart()];
        const u = liveUrl(s, channel.id, fmt);
        url = streamFlip() ? otherScheme(u) : u;
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
    const unregister = registerLivePreview(stop, give);
    return () => {
      if (timer) clearTimeout(timer);
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
      {!playing && channel ? (
        <View style={s.logoWrap}>
          <ChannelLogo uri={channel.poster} style={s.logo} />
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
