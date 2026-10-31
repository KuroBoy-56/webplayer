// Tema de prueba (estilo IBO Player), solo con Omitir y si el panel lo ofrece (Pantalla Falsa): recuadros grandes con
// Películas a la izquierda, Series al lado y Ajustes (solo «Cerrar sesión»). Reproduce los videos de la carpeta player
// del panel con un reproductor sencillo. No guarda sesión, progreso ni caché.
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, StyleSheet, Text, View } from 'react-native';
import { KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import type { Review as ReviewData, ReviewVideo } from '../api/panel';
import { Focusable, Logo } from '../components/ui';
import { t } from '../lib/i18n';
import { useNav } from '../nav';
import { alpha, px } from '../theme';

type Page = 'home' | 'movies' | 'series' | 'settings';

export default function Review({ data }: { data: ReviewData }) {
  const nav = useNav();
  const [page, setPage] = useState<Page>('home');
  const [playing, setPlaying] = useState<ReviewVideo | null>(null);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (playing) setPlaying(null);
      else if (page !== 'home') setPage('home');
      else BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, [page, playing]);

  if (playing) return <ReviewPlayer video={playing} onClose={() => setPlaying(null)} />;

  const title = page === 'movies' ? t('Películas') : page === 'series' ? t('Series') : page === 'settings' ? t('Ajustes') : '';
  return (
    <View style={s.root}>
      <View style={s.top}>
        <Logo size={70} />
        <Text style={s.title}>{title}</Text>
      </View>
      {page === 'home' ? (
        <View style={s.tiles}>
          <Focusable preferred onPress={() => setPage('movies')} style={f => [s.tile, s.tileMovies, f && s.tileF]}>
            <Text style={s.tileText}>{t('Películas')}</Text>
          </Focusable>
          <Focusable onPress={() => setPage('series')} style={f => [s.tile, s.tileSeries, f && s.tileF]}>
            <Text style={s.tileText}>{t('Series')}</Text>
          </Focusable>
          <Focusable onPress={() => setPage('settings')} style={f => [s.tile, s.tileSmall, f && s.tileF]}>
            <Text style={s.tileText}>{t('Ajustes')}</Text>
          </Focusable>
        </View>
      ) : page === 'settings' ? (
        <View style={s.settings}>
          <Focusable preferred onPress={() => nav.reset({ name: 'login' })} style={f => [s.logout, f && s.logoutF]}>
            <Text style={s.logoutText}>{t('Cerrar sesión')}</Text>
          </Focusable>
        </View>
      ) : (
        <Videos list={page === 'movies' ? data.movies : data.series} onPlay={setPlaying} />
      )}
    </View>
  );
}

function Videos({ list, onPlay }: { list: ReviewVideo[]; onPlay: (v: ReviewVideo) => void }) {
  if (!list.length) return <Text style={s.empty}>{t('Todavía no hay videos de prueba.')}</Text>;
  return (
    <FlatList
      data={list}
      numColumns={4}
      keyExtractor={(v, i) => v.url + i}
      contentContainerStyle={s.grid}
      renderItem={({ item, index }) => (
        <Focusable preferred={index === 0} onPress={() => onPlay(item)} style={f => [s.card, f && s.cardF]}>
          <View style={s.thumb}>
            <Text style={s.play}>▶</Text>
          </View>
          <Text style={s.cardText} numberOfLines={2}>
            {item.name}
          </Text>
        </Focusable>
      )}
    />
  );
}

// reproductor sencillo para un video del panel (sin sesión ni progreso): OK pausa / sigue, Atrás cierra
function ReviewPlayer({ video, onClose }: { video: ReviewVideo; onClose: () => void }) {
  const v = useRef<VideoPlayer | null>(null);
  const surface = useRef('');
  const ready = useRef(false);
  const [state, setState] = useState(t('Cargando…'));
  useEffect(() => {
    const p = new VideoPlayer();
    v.current = p;
    let alive = true;
    const onPlaying = () => alive && setState('');
    const onPause = () => alive && setState(t('En pausa'));
    const onError = () => alive && setState(t('No se pudo reproducir este contenido.'));
    const onEnded = () => alive && onClose();
    p.initialize()
      .then(() => {
        if (!alive) return;
        ready.current = true;
        p.addEventListener('playing', onPlaying);
        p.addEventListener('pause', onPause);
        p.addEventListener('error', onError);
        p.addEventListener('ended', onEnded);
        if (surface.current) p.setSurfaceHandle(surface.current);
        p.src = video.url;
        p.play();
      })
      .catch(onError);
    return () => {
      alive = false;
      try {
        p.pause();
        p.removeEventListener('playing', onPlaying);
        p.removeEventListener('pause', onPause);
        p.removeEventListener('error', onError);
        p.removeEventListener('ended', onEnded);
        if (surface.current) p.clearSurfaceHandle(surface.current);
      } catch {
        // ya cerrado
      }
      p.deinitialize().catch(() => {});
    };
  }, [video, onClose]);
  const toggle = () => {
    const p = v.current;
    if (!p || !ready.current) return;
    if (p.paused) p.play();
    else p.pause();
  };
  return (
    <View style={s.playerRoot}>
      <KeplerVideoSurfaceView
        style={s.video}
        onSurfaceViewCreated={(h: string) => {
          surface.current = h;
          if (ready.current) v.current?.setSurfaceHandle(h);
        }}
        onSurfaceViewDestroyed={(h: string) => {
          v.current?.clearSurfaceHandle(h);
          surface.current = '';
        }}
      />
      <Focusable preferred onPress={toggle} style={() => s.playerTap}>
        <View style={s.playerBar}>
          <Text style={s.playerTitle} numberOfLines={1}>
            {video.name}
          </Text>
          {state ? <Text style={s.playerState}>{state}</Text> : null}
        </View>
      </Focusable>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0B1026', paddingHorizontal: px(80), paddingVertical: px(40) },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: px(40) },
  title: { color: '#fff', fontSize: px(40), fontWeight: '700' },
  tiles: { flex: 1, flexDirection: 'row', maxHeight: px(520) },
  tile: { flex: 1, borderRadius: px(28), alignItems: 'center', justifyContent: 'center', marginRight: px(36), borderWidth: px(4), borderColor: 'transparent' },
  tileMovies: { backgroundColor: '#B0102A' },
  tileSeries: { backgroundColor: '#1E4FB8' },
  tileSmall: { flex: 0.6, marginRight: 0, backgroundColor: '#37474F' },
  tileF: { borderColor: '#fff', transform: [{ scale: 1.05 }] },
  tileText: { color: '#fff', fontSize: px(52), fontWeight: '700' },
  grid: { paddingBottom: px(40) },
  card: { width: px(400), marginRight: px(28), marginBottom: px(28), padding: px(14), borderRadius: px(16), backgroundColor: alpha('#FFFFFF', 0.12), borderWidth: px(3), borderColor: 'transparent' },
  cardF: { backgroundColor: alpha('#FFFFFF', 0.3), borderColor: '#fff' },
  thumb: { height: px(210), borderRadius: px(10), backgroundColor: alpha('#000000', 0.45), alignItems: 'center', justifyContent: 'center' },
  play: { color: '#fff', fontSize: px(70) },
  cardText: { color: '#fff', fontSize: px(26), fontWeight: '600', marginTop: px(10) },
  empty: { color: '#bbb', fontSize: px(30) },
  settings: { alignItems: 'flex-start' },
  logout: { paddingHorizontal: px(48), paddingVertical: px(24), borderRadius: px(16), backgroundColor: alpha('#FFFFFF', 0.18), borderWidth: px(3), borderColor: 'transparent' },
  logoutF: { backgroundColor: alpha('#FFFFFF', 0.35), borderColor: '#fff' },
  logoutText: { color: '#fff', fontSize: px(34), fontWeight: '700' },
  playerRoot: { flex: 1, backgroundColor: '#000' },
  video: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 },
  playerTap: { flex: 1, justifyContent: 'flex-end' },
  playerBar: { padding: px(40), backgroundColor: alpha('#000000', 0.45) },
  playerTitle: { color: '#fff', fontSize: px(34), fontWeight: '700' },
  playerState: { color: '#ddd', fontSize: px(26), marginTop: px(8) },
});
