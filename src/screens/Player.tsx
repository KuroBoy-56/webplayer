// Reproductor nativo de Vega (W3C Media, modo URL: MP4, MKV, AVI, MOV, MPEG-TS…) sin límite de
// resolución ni de bitrate (4K si el equipo y el archivo lo tienen).
// Películas y episodios: continuar donde quedó, adelantar/retroceder, audio y subtítulos (con el
// motor del panel cuando el equipo no puede: player/playback.ts), siguiente episodio automático.
// TV en vivo: cambio de canal con arriba/abajo y guía.
import { HWEvent, useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { KeplerCaptionsView, KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Image, StyleSheet, Text, View } from 'react-native';
import { channelEpg, EpgEntry, episodeUrl, liveUrl, movieUrl } from '../api/xtream';
import TrackMenu from '../components/TrackMenu';
import { Item } from '../data/catalog';
import { clock, hms, nowSec } from '../lib/util';
import { PlayParams, useNav } from '../nav';
import { MenuItem, Playback } from '../player/playback';
import { getState, isFav, saveProgress, toggleFav } from '../state';
import { alpha, C, px, themed } from '../theme';

export default function Player({ params }: { params: PlayParams }) {
  const nav = useNav();
  const video = useRef<VideoPlayer | null>(null);
  const ctl = useRef<Playback | null>(null);
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
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const menuOpen = useRef(false);
  menuOpen.current = !!menu;
  const [epg, setEpg] = useState<EpgEntry[]>([]);
  const [status, setStatus] = useState('');
  const [work, setWork] = useState('');
  const [toast, setToast] = useState('');
  const [sub, setSub] = useState('');
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUi = useRef(0);
  const retried = useRef(false);
  const firstResume = useRef(params.kind === 'live' ? 0 : params.resume);
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

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 4500);
  }, []);

  // ---------- progreso ----------
  const save = useCallback(
    (force: boolean) => {
      const c = ctl.current;
      if (params.kind === 'live' || !c || !ready.current) return;
      const e = params.queue[indexRef.current];
      const position = Math.floor(c.realPos());
      const duration = Math.floor(c.duration());
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

  // ---------- carga ----------
  const load = useCallback(
    (i: number, resume = 0) => {
      const c = ctl.current;
      if (!c || !ready.current) return;
      setError('');
      setBuffering(true);
      setPos(0);
      setDur(0);
      setSub('');
      setWork('');
      setStatus(live ? 'Conectando con el canal…' : 'Cargando…');
      c.load(urlFor(i), resume, live);
    },
    [urlFor, live],
  );

  const next = useCallback(() => {
    if (params.kind !== 'episode') return false;
    const n = indexRef.current + 1;
    if (n >= params.queue.length) return false;
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
    const c = new Playback(v, {
      toast: showToast,
      status: setWork,
      changed: () => menuOpen.current && setMenu(c.menu()),
      subText: setSub,
      fatal: msg => {
        setBuffering(false);
        setError(msg);
      },
    });
    ctl.current = c;
    let alive = true;

    const onMeta = () => c.onMeta();
    const onTime = () => {
      const now = Date.now();
      if (now - lastUi.current < 500) return;
      lastUi.current = now;
      setPos(c.realPos());
      setDur(c.duration());
      save(false);
    };
    const onPlaying = () => {
      setBuffering(false);
      setPaused(false);
      setStatus('');
      c.onPlaying();
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
      // audio que el equipo no decodifica (DTS…): lo prepara el panel
      c.onError().then(handled => {
        if (!alive || handled) return;
        setBuffering(false);
        setStatus('');
        setError(params.kind === 'live' ? 'Este canal no está disponible en este momento.' : 'No se pudo reproducir este contenido.');
      });
    };
    const onTrack = () => {
      c.schedulePrefs();
      if (menuOpen.current) setMenu(c.menu());
    };

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
        load(indexRef.current, firstResume.current);
      })
      .catch(() => alive && setError('No se pudo iniciar el reproductor.'));

    return () => {
      alive = false;
      save(true);
      c.destroy();
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      try {
        v.removeEventListener('loadedmetadata', onMeta);
        v.removeEventListener('timeupdate', onTime);
        v.removeEventListener('playing', onPlaying);
        v.removeEventListener('waiting', onWaiting);
        v.removeEventListener('pause', onPause);
        v.removeEventListener('ended', onEnded);
        v.removeEventListener('error', onError);
        (v as any).audioTracks?.removeEventListener?.('addtrack', onTrack);
        (v as any).textTracks?.removeEventListener?.('addtrack', onTrack);
        v.pause();
        if (surface.current) v.clearSurfaceHandle(surface.current);
        v.deinitializeSync(3000);
      } catch {
        // el reproductor ya estaba cerrado
      }
      video.current = null;
      ctl.current = null;
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

  const openMenu = () => ctl.current && setMenu(ctl.current.menu());

  const seek = (delta: number) => {
    const c = ctl.current;
    if (!c || live) return;
    const d = c.duration();
    let t = c.realPos() + delta;
    if (d > 0) t = Math.min(t, d - 2);
    t = Math.max(0, t);
    c.seek(t);
    setPos(t);
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
          load(indexRef.current, Math.floor(pos));
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
        else openMenu();
        break;
      case 'menu':
      case 'info':
      case 'more':
      case 'context_menu':
        openMenu();
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

      {/* subtítulos que prepara el panel (WebVTT) */}
      {sub ? (
        <View style={[s.subBox, (overlay || paused) && !live && s.subBoxUp]} pointerEvents="none">
          <Text style={s.subText}>{sub}</Text>
        </View>
      ) : null}

      {buffering && !error ? (
        <View style={s.center}>
          <View style={s.spinner} />
          {status || work ? <Text style={s.status}>{work || status}</Text> : null}
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
                  <Text style={s.time}>{dur > 0 ? '-' + hms(Math.max(0, dur - pos)) : ''}</Text>
                </View>
                <Text style={s.hint}>◀▶ 10 s · OK pausa · ▼ audio y subtítulos{params.kind === 'episode' && index + 1 < params.queue.length ? ' · al terminar sigue el próximo episodio' : ''}</Text>
              </>
            )}
          </View>
        </View>
      ) : null}

      {work && !buffering ? (
        <View style={s.workBox} pointerEvents="none">
          <Text style={s.workText}>{work}</Text>
        </View>
      ) : null}

      {toast ? (
        <View style={s.toast} pointerEvents="none">
          <Text style={s.toastText}>{toast}</Text>
        </View>
      ) : null}

      {menu ? (
        <TrackMenu
          items={menu}
          favLabel={live && channel ? (isFav('live', channel.id) ? '★ Quitar de favoritos' : '☆ Agregar a favoritos') : ''}
          onFav={() => {
            if (!channel) return;
            toggleFav('live', channel.id, channel.name, channel.poster, channel.cat);
            openMenu();
          }}
          onPick={m => {
            ctl.current?.select(m);
            setTimeout(() => menuOpen.current && openMenu(), 300);
          }}
        />
      ) : null}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    video: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 0 },
    captions: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 2 },
    subBox: { position: 'absolute', left: px(160), right: px(160), bottom: px(70), alignItems: 'center', zIndex: 3 },
    subBoxUp: { bottom: px(260) },
    subText: { color: '#fff', fontSize: px(44), fontWeight: '700', textAlign: 'center', backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: px(16), paddingVertical: px(4), textShadowColor: '#000', textShadowRadius: px(4), textShadowOffset: { width: 0, height: 0 } },
    center: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center', zIndex: 5 },
    spinner: { width: px(90), height: px(90), borderRadius: px(45), borderWidth: px(8), borderColor: 'rgba(255,255,255,0.25)', borderTopColor: C.red },
    status: { color: C.green, fontSize: px(28), marginTop: px(20) },
    error: { color: '#fff', fontSize: px(38), fontWeight: '700', textAlign: 'center' },
    overlay: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, justifyContent: 'space-between', zIndex: 6 },
    topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: px(80), paddingTop: px(50), paddingBottom: px(40), backgroundColor: alpha(C.bg, 0.6) },
    chLogo: { width: px(130), height: px(74), marginRight: px(24) },
    title: { color: C.text, fontSize: px(44), fontWeight: '800', flex: 1 },
    star: { color: '#f5c518', fontSize: px(40) },
    bottom: { paddingHorizontal: px(80), paddingBottom: px(60), paddingTop: px(40), backgroundColor: alpha(C.bg, 0.65) },
    bar: { height: px(8), backgroundColor: alpha(C.text, 0.3), borderRadius: px(4), marginTop: px(12) },
    barFill: { height: '100%', backgroundColor: C.red, borderRadius: px(4) },
    times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: px(10) },
    time: { color: C.text, fontSize: px(28) },
    now: { color: C.red, fontSize: px(26), fontWeight: '800' },
    prog: { color: C.text, fontSize: px(34), fontWeight: '700', marginTop: px(4) },
    hint: { color: C.sub, fontSize: px(24), marginTop: px(14) },
    workBox: { position: 'absolute', top: px(60), alignSelf: 'center', backgroundColor: alpha(C.bg2, 0.92), borderRadius: px(12), paddingHorizontal: px(30), paddingVertical: px(14), zIndex: 8 },
    workText: { color: C.text, fontSize: px(26), fontWeight: '700' },
    toast: { position: 'absolute', bottom: px(200), alignSelf: 'center', maxWidth: px(1300), backgroundColor: alpha(C.bg2, 0.95), borderRadius: px(12), borderLeftWidth: px(6), borderLeftColor: C.red, paddingHorizontal: px(30), paddingVertical: px(16), zIndex: 9 },
    toastText: { color: C.text, fontSize: px(26) },
  }),
);
