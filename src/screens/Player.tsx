// Reproductor nativo de Vega (W3C Media, modo URL: MP4, MKV, AVI, MOV, MPEG-TS…).
// Películas y episodios: continuar donde quedó, adelantar/retroceder, audio y subtítulos,
// siguiente episodio automático. TV en vivo: cambio de canal con arriba/abajo y guía.
import { HWEvent, useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { KeplerCaptionsView, KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { channelEpg, EpgEntry, episodeUrl, liveUrl, movieUrl } from '../api/xtream';
import { Focusable } from '../components/ui';
import { Item } from '../data/catalog';
import { pref } from '../lib/storage';
import { clock, hms, nowSec } from '../lib/util';
import { PlayParams, useNav } from '../nav';
import { getState, isFav, saveProgress, toggleFav } from '../state';
import { C, px } from '../theme';

type Track = { kind: 'audio' | 'text'; index: number; label: string; on: boolean };

function langMatch(lang: string, label: string, want: string): boolean {
  if (!want) return false;
  const l = (lang + ' ' + label).toLowerCase();
  if (want === 'es') return /\b(es|spa|esp|spanish|español|espanol|latino|castellano)\b/.test(l) || l.startsWith('es');
  if (want === 'en') return /\b(en|eng|english|inglés|ingles)\b/.test(l) || l.startsWith('en');
  return l.includes(want);
}

export default function Player({ params }: { params: PlayParams }) {
  const nav = useNav();
  const video = useRef<VideoPlayer | null>(null);
  const ready = useRef(false);
  const surface = useRef('');
  const captions = useRef('');
  const [index, setIndex] = useState(params.index);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [overlay, setOverlay] = useState(true);
  const [error, setError] = useState('');
  const [menu, setMenu] = useState<Track[] | null>(null);
  const [epg, setEpg] = useState<EpgEntry[]>([]);
  const [status, setStatus] = useState('');
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUi = useRef(0);
  const retried = useRef(false);
  const resumeAt = useRef(params.kind === 'live' ? 0 : params.resume);
  const indexRef = useRef(index);
  indexRef.current = index;

  const live = params.kind === 'live';
  const channel: Item | null = live ? params.channels[index] || params.channel : null;
  const entry = !live ? params.queue[index] : null;
  const title = live ? channel!.name : entry!.title;

  const urlFor = useCallback(
    (i: number): string => {
      const s = getState().session!;
      if (params.kind === 'live') return liveUrl(s, (params.channels[i] || params.channel).id, 'ts');
      const e = params.queue[i];
      return params.kind === 'movie' ? movieUrl(s, e.id, e.ext) : episodeUrl(s, e.id, e.ext);
    },
    [params],
  );

  const showOverlay = useCallback(() => {
    setOverlay(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setOverlay(false), 5000);
  }, []);

  // ---------- progreso ----------
  const save = useCallback(
    (force: boolean) => {
      const v = video.current;
      if (params.kind === 'live' || !v || !ready.current) return;
      const e = params.queue[indexRef.current];
      const position = Math.floor(v.currentTime || 0);
      const duration = Math.floor(v.duration || 0);
      if (position < 5 || !Number.isFinite(duration)) return;
      saveProgress(
        {
          title: params.kind === 'episode' ? params.saveTitle : e.title,
          position,
          duration,
          url: urlFor(indexRef.current),
          poster: params.kind === 'episode' ? params.savePoster : e.poster,
          type: params.kind,
          id: e.id,
          seriesId: params.seriesId,
          categoryId: params.cat,
        },
        force,
      );
    },
    [params, urlFor],
  );

  // ---------- pistas ----------
  const tracks = useCallback((): Track[] => {
    const v = video.current as any;
    const out: Track[] = [];
    if (!v) return out;
    const at = v.audioTracks;
    for (let i = 0; at && i < at.length; i++) {
      const t = at[i];
      out.push({ kind: 'audio', index: i, label: t.label || t.language || 'Audio ' + (i + 1), on: !!t.enabled });
    }
    const tt = v.textTracks;
    for (let i = 0; tt && i < tt.length; i++) {
      const t = tt[i];
      if (t.kind && t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      out.push({ kind: 'text', index: i, label: t.label || t.language || 'Subtítulos ' + (i + 1), on: t.mode === 'showing' });
    }
    return out;
  }, []);

  const pickTrack = useCallback((t: Track | null, kind: 'audio' | 'text') => {
    const v = video.current as any;
    if (!v) return;
    if (kind === 'audio' && t) {
      const at = v.audioTracks;
      for (let i = 0; i < at.length; i++) at[i].enabled = i === t.index;
    } else if (kind === 'text') {
      const tt = v.textTracks;
      for (let i = 0; tt && i < tt.length; i++) tt[i].mode = t && i === t.index ? 'showing' : 'disabled';
    }
  }, []);

  // idioma de audio y subtítulos preferidos (Cuenta › Ajustes)
  const applyPrefs = useCallback(() => {
    const list = tracks();
    const audioPref = pref('audio_lang', 'es');
    const audio = list.filter(t => t.kind === 'audio');
    if (audio.length > 1 && audioPref) {
      const v = video.current as any;
      const m = audio.find(t => langMatch(v.audioTracks[t.index].language || '', t.label, audioPref));
      if (m && !m.on) pickTrack(m, 'audio');
    }
    const subsPref = pref('subs_lang', 'off');
    const subs = list.filter(t => t.kind === 'text');
    if (subs.length) {
      const v = video.current as any;
      const m = subsPref === 'off' ? null : subs.find(t => langMatch(v.textTracks[t.index].language || '', t.label, subsPref));
      pickTrack(m || null, 'text');
    }
  }, [tracks, pickTrack]);

  // ---------- carga ----------
  const load = useCallback(
    (i: number) => {
      const v = video.current;
      if (!v || !ready.current) return;
      setError('');
      setBuffering(true);
      setPos(0);
      setDur(0);
      setStatus(live ? 'Conectando con el canal…' : 'Cargando…');
      v.src = urlFor(i);
      v.play();
    },
    [urlFor, live],
  );

  const next = useCallback(() => {
    if (params.kind !== 'episode') return false;
    const n = indexRef.current + 1;
    if (n >= params.queue.length) return false;
    resumeAt.current = 0;
    setIndex(n);
    load(n);
    showOverlay();
    return true;
  }, [params, load, showOverlay]);

  const zap = useCallback(
    (delta: number) => {
      if (params.kind !== 'live' || params.channels.length < 2) return;
      const n = (indexRef.current + delta + params.channels.length) % params.channels.length;
      retried.current = false;
      setIndex(n);
      setEpg([]);
      load(n);
      showOverlay();
    },
    [params, load, showOverlay],
  );

  useEffect(() => {
    const v = new VideoPlayer();
    video.current = v;
    let alive = true;

    const onMeta = () => {
      if (resumeAt.current > 0) {
        v.currentTime = resumeAt.current;
        resumeAt.current = 0;
      }
      applyPrefs();
    };
    const onTime = () => {
      const now = Date.now();
      if (now - lastUi.current < 500) return;
      lastUi.current = now;
      setPos(v.currentTime || 0);
      const d = v.duration;
      setDur(Number.isFinite(d) ? d : 0);
      save(false);
    };
    const onPlaying = () => {
      setBuffering(false);
      setPaused(false);
      setStatus('');
    };
    const onWaiting = () => setBuffering(true);
    const onPause = () => {
      setPaused(true);
      save(true);
    };
    const onEnded = () => {
      save(true);
      if (!next()) {
        if (params.kind === 'live') load(indexRef.current);
        else nav.pop();
      }
    };
    const onError = () => {
      // TV en vivo: un reintento automático (algunos servidores cortan el primer intento)
      if (params.kind === 'live' && !retried.current) {
        retried.current = true;
        setStatus('Reintentando…');
        setTimeout(() => alive && load(indexRef.current), 1500);
        return;
      }
      setBuffering(false);
      setStatus('');
      setError(params.kind === 'live' ? 'Este canal no está disponible en este momento.' : 'No se pudo reproducir este contenido.');
    };
    const onTrack = () => applyPrefs();

    v.initialize()
      .then(() => {
        if (!alive) return;
        ready.current = true;
        v.autoplay = false;
        v.addEventListener('loadedmetadata', onMeta);
        v.addEventListener('timeupdate', onTime);
        v.addEventListener('playing', onPlaying);
        v.addEventListener('waiting', onWaiting);
        v.addEventListener('pause', onPause);
        v.addEventListener('ended', onEnded);
        v.addEventListener('error', onError);
        (v as any).audioTracks?.addEventListener?.('addtrack', onTrack);
        (v as any).textTracks?.addEventListener?.('addtrack', onTrack);
        if (surface.current) v.setSurfaceHandle(surface.current);
        if (captions.current) v.setCaptionViewHandle(captions.current);
        load(indexRef.current);
      })
      .catch(() => alive && setError('No se pudo iniciar el reproductor.'));

    return () => {
      alive = false;
      save(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      try {
        v.removeEventListener('loadedmetadata', onMeta);
        v.removeEventListener('timeupdate', onTime);
        v.removeEventListener('playing', onPlaying);
        v.removeEventListener('waiting', onWaiting);
        v.removeEventListener('pause', onPause);
        v.removeEventListener('ended', onEnded);
        v.removeEventListener('error', onError);
        v.pause();
        if (surface.current) v.clearSurfaceHandle(surface.current);
        v.deinitializeSync(3000);
      } catch {
        // el reproductor ya estaba cerrado
      }
      video.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // guía del canal actual
  useEffect(() => {
    if (!channel) return;
    let alive = true;
    const s = getState().session;
    if (s) channelEpg(s, { id: channel.id, epg: channel.epg, name: channel.name }).then(l => alive && setEpg(l));
    return () => {
      alive = false;
    };
  }, [channel]);

  useEffect(() => {
    showOverlay();
  }, [showOverlay]);

  // Atrás: cierra el menú de pistas o sale del reproductor
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menu) {
        setMenu(null);
        return true;
      }
      nav.pop();
      return true;
    });
    return () => sub.remove();
  }, [menu, nav]);

  const seek = (delta: number) => {
    const v = video.current;
    if (!v || live) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    let t = (v.currentTime || 0) + delta;
    if (d > 0) t = Math.min(t, d - 2);
    v.currentTime = Math.max(0, t);
    setPos(v.currentTime);
    showOverlay();
  };

  const togglePause = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
    showOverlay();
  };

  useTVEventHandler((evt: HWEvent) => {
    if (evt.eventKeyAction !== undefined && evt.eventKeyAction !== 0) return;
    if (menu) return; // el menú de pistas usa el foco normal
    switch (evt.eventType) {
      case 'select':
        if (error) {
          retried.current = false;
          load(indexRef.current);
        } else if (live) showOverlay();
        else togglePause();
        break;
      case 'playpause':
      case 'play':
      case 'pause':
        togglePause();
        break;
      case 'left':
        live ? showOverlay() : seek(-10);
        break;
      case 'right':
        live ? showOverlay() : seek(10);
        break;
      case 'skip_backward':
      case 'rewind':
        seek(-30);
        break;
      case 'skip_forward':
      case 'forward':
      case 'fastforward':
        seek(30);
        break;
      case 'up':
      case 'channel_up':
        live ? zap(-1) : showOverlay();
        break;
      case 'channel_down':
        zap(1);
        break;
      case 'down':
        if (live) zap(1);
        else setMenu(tracks());
        break;
      case 'menu':
      case 'info':
      case 'more':
      case 'context_menu':
        setMenu(tracks());
        break;
      default:
        showOverlay();
    }
  });

  const now = nowSec();
  const cur = epg.find(e => e.s <= now && now < e.e);
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  return (
    <View style={s.root}>
      <KeplerVideoSurfaceView
        style={s.video}
        onSurfaceViewCreated={(h: string) => {
          surface.current = h;
          if (ready.current) video.current?.setSurfaceHandle(h);
        }}
        onSurfaceViewDestroyed={(h: string) => {
          video.current?.clearSurfaceHandle(h);
          surface.current = '';
        }}
      />
      <KeplerCaptionsView
        style={s.captions}
        onCaptionViewCreated={(h: string) => {
          captions.current = h;
          if (ready.current) video.current?.setCaptionViewHandle(h);
        }}
      />

      {buffering && !error ? (
        <View style={s.center}>
          <View style={s.spinner} />
          {status ? <Text style={s.status}>{status}</Text> : null}
        </View>
      ) : null}

      {error ? (
        <View style={s.center}>
          <Text style={s.error}>{error}</Text>
          <Text style={s.hint}>OK para reintentar · Atrás para salir</Text>
        </View>
      ) : null}

      {overlay || paused ? (
        <View style={s.overlay}>
          <View style={s.topBar}>
            {live && channel?.poster ? <Image source={{ uri: channel.poster }} style={s.chLogo} resizeMode="contain" /> : null}
            <Text style={s.title} numberOfLines={1}>
              {title}
            </Text>
            {live && channel && isFav('live', channel.id) ? <Text style={s.star}>★</Text> : null}
          </View>
          <View style={s.bottom}>
            {live ? (
              <>
                {cur ? (
                  <>
                    <Text style={s.now}>
                      AHORA · {clock(cur.s)} - {clock(cur.e)}
                    </Text>
                    <Text style={s.prog} numberOfLines={1}>
                      {cur.t}
                    </Text>
                    <View style={s.bar}>
                      <View style={[s.barFill, { width: `${Math.min(100, ((now - cur.s) / Math.max(1, cur.e - cur.s)) * 100)}%` }]} />
                    </View>
                  </>
                ) : null}
                <Text style={s.hint}>
                  ▲▼ cambiar canal ({index + 1}/{params.kind === 'live' ? params.channels.length : 1}) · MENÚ audio y subtítulos
                </Text>
              </>
            ) : (
              <>
                <View style={s.bar}>
                  <View style={[s.barFill, { width: `${pct}%` }]} />
                </View>
                <View style={s.times}>
                  <Text style={s.time}>{hms(pos)}</Text>
                  <Text style={s.time}>{paused ? '❚❚ En pausa' : ''}</Text>
                  <Text style={s.time}>{dur > 0 ? '-' + hms(dur - pos) : ''}</Text>
                </View>
                <Text style={s.hint}>◀▶ 10 s · OK pausa · ▼ audio y subtítulos{params.kind === 'episode' && index + 1 < params.queue.length ? ' · al terminar sigue el próximo episodio' : ''}</Text>
              </>
            )}
          </View>
        </View>
      ) : null}

      {menu ? (
        <View style={s.menu}>
          <Text style={s.menuTitle}>Audio y subtítulos</Text>
          {live && channel ? (
            <Focusable
              preferred
              onPress={() => {
                toggleFav('live', channel.id, channel.name, channel.poster, channel.cat);
                setMenu(tracks());
              }}
              style={f => [s.opt, f && s.optF]}>
              {f => <Text style={[s.optText, f && { color: '#000' }]}>{isFav('live', channel.id) ? '★ Quitar de favoritos' : '☆ Agregar a favoritos'}</Text>}
            </Focusable>
          ) : null}
          <FlatList
            data={[...menu, { kind: 'text', index: -1, label: 'Sin subtítulos', on: !menu.some(t => t.kind === 'text' && t.on) } as Track]}
            keyExtractor={t => t.kind + t.index}
            renderItem={({ item: t, index: i }) => (
              <Focusable
                preferred={!live && i === 0}
                onPress={() => {
                  pickTrack(t.index < 0 ? null : t, t.kind);
                  setTimeout(() => setMenu(tracks()), 300);
                }}
                style={f => [s.opt, f && s.optF]}>
                {f => (
                  <Text style={[s.optText, f && { color: '#000' }]}>
                    {t.on ? '✓ ' : '   '}
                    {t.kind === 'audio' ? '🔊 ' : '💬 '}
                    {t.label}
                  </Text>
                )}
              </Focusable>
            )}
          />
          {!menu.some(t => t.kind === 'audio') ? <Text style={s.hint}>Este contenido tiene una sola pista de audio.</Text> : null}
          <Text style={s.hint}>Atrás para cerrar</Text>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  video: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 0 },
  captions: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 2 },
  center: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 5 },
  spinner: { width: px(90), height: px(90), borderRadius: px(45), borderWidth: px(8), borderColor: 'rgba(255,255,255,0.25)', borderTopColor: C.red },
  status: { color: C.green, fontSize: px(28), marginTop: px(20) },
  error: { color: '#fff', fontSize: px(38), fontWeight: '700', textAlign: 'center' },
  overlay: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, justifyContent: 'space-between', zIndex: 6 },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: px(80), paddingTop: px(50), paddingBottom: px(40), backgroundColor: 'rgba(0,0,0,0.55)' },
  chLogo: { width: px(130), height: px(74), marginRight: px(24) },
  title: { color: '#fff', fontSize: px(44), fontWeight: '800', flex: 1 },
  star: { color: '#f5c518', fontSize: px(40) },
  bottom: { paddingHorizontal: px(80), paddingBottom: px(60), paddingTop: px(40), backgroundColor: 'rgba(0,0,0,0.6)' },
  bar: { height: px(8), backgroundColor: 'rgba(255,255,255,0.3)', borderRadius: px(4), marginTop: px(12) },
  barFill: { height: '100%', backgroundColor: C.red, borderRadius: px(4) },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: px(10) },
  time: { color: '#fff', fontSize: px(28) },
  now: { color: C.red, fontSize: px(26), fontWeight: '800' },
  prog: { color: '#fff', fontSize: px(34), fontWeight: '700', marginTop: px(4) },
  hint: { color: C.sub, fontSize: px(24), marginTop: px(14) },
  menu: { position: 'absolute', right: 0, top: 0, bottom: 0, width: px(640), backgroundColor: 'rgba(20,20,20,0.95)', padding: px(50), zIndex: 10 },
  menuTitle: { color: '#fff', fontSize: px(38), fontWeight: '800', marginBottom: px(24) },
  opt: { height: px(72), justifyContent: 'center', paddingHorizontal: px(20), borderRadius: px(6), marginBottom: px(6) },
  optF: { backgroundColor: '#fff' },
  optText: { color: '#fff', fontSize: px(28) },
});
