// Reproductor Vega: Shaka/MSE para HLS/DASH, MSE local MP4 y modo URL para los otros archivos, sin límite de
// resolución ni de bitrate (4K si el equipo y el archivo lo tienen).
// Películas y episodios: continuar donde quedó, adelantar/retroceder, audio y subtítulos (con el
// motor del panel cuando el equipo no puede: player/playback.ts), siguiente episodio automático.
// TV en vivo: cambio de canal con arriba/abajo y guía.
import { HWEvent, useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { KeplerCaptionsView, KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { reportError } from '../api/report';
import { engineDenied, warmTracks } from '../api/media';
import { viaDns } from '../lib/securedns';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { channelEpg, EpgEntry, episodeUrl, LIVE_FORMATS, liveUrl, movieUrl, otherScheme, setStreamFlip, streamFlip } from '../api/xtream';
import TrackMenu from '../components/TrackMenu';
import { Button, Focusable, Loader } from '../components/ui';
import { Item } from '../data/catalog';
import { useListScroll } from '../lib/listscroll';
import { clock, hms, nowSec } from '../lib/util';
import { PlayParams, useNav } from '../nav';
import { Hooks, MenuItem, nativeLivePlanned, Playback, seedTitleLang, titlePlayHint } from '../player/playback';
import { dropReturn, offerReturn, playerClosing, setLastLive, stopLivePreview, takeLiveOrigin, takePreview, waitForLivePreview } from '../player/preview-session';
import { dropPrefetch, prefetchList, prefetchRange } from '../player/prefetch';
import { hasHandoff } from '../player/livehls';
import { vodKnown } from '../player/warm';
import { idxWarmHold } from '../player/idxwarm';
import { freeMp4Memory, MP4_HEAD, mp4Spot } from '../player/mp4mse';
import { setLineMax, singleFor } from '../player/readahead';
import { StreamCheck, streamCheck } from '../player/streamcheck';
import { setPlayerOpen } from '../lib/cacheclear';
import { probeTracks } from '../lib/probe';
import { getState, isFav, saveProgress, toggleFav, playHintFor } from '../state';
import { t } from '../lib/i18n';
import { alpha, C, px, themed } from '../theme';

// aviso según la página de error del servidor (XUI.one en «Debug Mode» contesta 200 con el código del motivo)
function serverText(r: StreamCheck, live: boolean): string {
  const x = r.xui || '';
  if (/STREAM_ID|OFFLINE|NOT_FOUND|NO_SERVER|BOUQUET/.test(x)) return live ? t('Canal no disponible en el servidor') : t('Video no disponible');
  if (/EXPIRED/.test(x)) return t('Línea vencida');
  if (/CREDENTIAL|DISABLED|NOT_ACTIVE|INVALID_USER|AUTH/.test(x)) return t('Línea no activa');
  if (/CONNECTION|MAX_|LIMIT/.test(x)) return t('Línea en uso en otro equipo');
  if (/BLOCK|BAN|FLOOD|RESTREAM|ASN|COUNTRY|ISP|USER_AGENT|_IP/.test(x)) return t('El servidor bloqueó este equipo ({x})', { x });
  return t('El servidor no entregó el video ({x})', { x: x || 'HTML' });
}

// películas y episodios que ya avisaron al panel que tardaron en empezar (una vez por archivo mientras la app está abierta)
const slowSent = new Set<string>();

// alto de cada canal de la lista (fijo: la lista abre ya en el canal que suena)
const CH_ROW = 76;

// canal de la lista de pantalla grande (memorizado: recorrerla solo redibuja la fila que pierde y la que gana el foco)
const ChRow = memo(function ChRow({ c, i, on, pick, focus }: { c: Item; i: number; on: boolean; pick: (i: number) => void; focus: (i: number) => void }) {
  return (
    <Focusable preferred={on} onPress={() => pick(i)} onFocus={() => focus(i)} style={f => [s.chRow, on && s.chRowOn, f && s.chRowF]}>
      {f => (
        <>
          <Text style={[s.chNum, f && s.chTextF]}>{i + 1}</Text>
          {c.poster ? <Image source={{ uri: c.poster }} style={s.chRowLogo} resizeMode="contain" /> : <View style={s.chRowLogo} />}
          <Text style={[s.chName, f && s.chTextF]} numberOfLines={1}>
            {c.name}
          </Text>
        </>
      )}
    </Focusable>
  );
});

export default function Player({ params }: { params: PlayParams }) {
  const nav = useNav();
  const video = useRef<VideoPlayer | null>(null);
  const ctl = useRef<Playback | null>(null);
  const ready = useRef(false);
  const surface = useRef('');
  const captions = useRef('');
  const [index, setIndex] = useState(params.index);
  // Cambio de canal en pantalla grande: un reproductor nuevo por canal, como la miniatura y como indica Amazon (cerrar el
  // reproductor, crear otro, iniciarlo, ponerle la superficie y recién darle el canal). Al cambiarle la dirección a un
  // reproductor ya usado, el nativo de Vega daba error («Reconectando…») y el lector de la app tardaba y se congelaba
  const [session, setSession] = useState(0);
  // abierto desde TV en vivo: al salir, el reproductor que suena vuelve a su miniatura (preview-session.ts)
  const [fromLive] = useState(() => params.kind === 'live' && takeLiveOrigin());
  // el reproductor se cierra para abrir otro canal (no se sale de la pantalla)
  const zapping = useRef(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [overlay, setOverlay] = useState(true);
  const overlayVisible = useRef(true);
  overlayVisible.current = overlay;
  const [controlsFocused, setControlsFocused] = useState(false);
  const controlsFocus = useRef(false);
  controlsFocus.current = controlsFocused;
  const [error, setError] = useState('');
  // el aviso de error a la vista (el vigilante de película quieta no la vuelve a abrir)
  const errorRef = useRef('');
  errorRef.current = error;
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [menuMode, setMenuMode] = useState<'audio' | 'all'>('all');
  const [audioLabel, setAudioLabel] = useState('');
  // botón de la barra central que se ilumina un instante al usarlo con el control (◀◀ 10 s, pausa, 10 s ▶▶)
  // (los botones ◀◀ / pausa / ▶▶ se quitaron: ◀ ▶ y OK del control lo hacen directo, sin redibujar la pantalla)
  const flashKey = (_k: 'back' | 'play' | 'fwd') => {};
  const menuOpen = useRef(false);
  menuOpen.current = !!menu;
  // el menú se vuelve a dibujar solo si cambió algo (antes cada aviso del reproductor lo rehacía entero y, con el
  // video del panel, el control se trababa al moverse por el menú)
  const menuSig = useRef('');
  const showMenu = useCallback((items: MenuItem[] | null) => {
    const sig = items ? items.map(m => m.kind + m.key + (m.on ? '1' : '0') + m.label).join('|') : '';
    if (items && sig === menuSig.current && menuOpen.current) return;
    // Los eventos de Shaka pueden llegar antes del siguiente render de React.
    // Cerrar también la referencia evita que uno de ellos vuelva a abrir el menú.
    menuOpen.current = !!items;
    menuSig.current = sig;
    setMenu(items);
  }, []);
  const [epg, setEpg] = useState<EpgEntry[]>([]);
  const [status, setStatus] = useState('');
  const [work, setWork] = useState('');
  const [toast, setToast] = useState('');
  const [sub, setSub] = useState('');
  // capítulo en el que se pulsó Cancelar en el aviso del siguiente; «¿Salir del video?» abierto
  const [nextOff, setNextOff] = useState(-1);
  const [askExit, setAskExit] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUi = useRef(0);
  const retried = useRef(false);
  const firstResume = useRef(params.kind === 'live' ? 0 : params.resume);
  const indexRef = useRef(index);
  indexRef.current = index;
  const zapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRev = useRef(0);

  const live = params.kind === 'live';
  const channel: Item | null = live ? params.channels[index] || params.channel : null;
  const entry = !live ? params.queue[index] : null;
  const title = live ? channel!.name : entry!.title;

  // el servidor no entrega el video por el protocolo de la sesión (quedó en https y el video solo va por
  // http, o al revés): tras un error se prueba una vez el otro antes de dar el error
  // empieza con el protocolo que ya funcionó en esta sesión; triedOther: ya se probó el otro en este video
  const flipped = useRef(streamFlip());
  const triedOther = useRef(false);
  // vueltas automáticas por todas las formas (http, https, DNS, motor) antes de rendirse: nada de «Reintentar»
  const rounds = useRef(0);
  // canal con la línea llena: veces que se esperó una conexión libre (se reinicia al cambiar de canal o al sonar)
  const lineWaits = useRef(0);
  // botón DNS: si tampoco abre, una vez por la IP que da el DNS elegido (solo ese video)
  const triedDns = useRef(false);
  // TV en vivo: formato que se está probando (LIVE_FORMATS)
  const fmtAt = useRef(0);
  const dnsUrl = useRef<{ i: number; url: string } | null>(null);
  // película o episodio que todavía no sonó: ya se le preguntó al servidor (checked), se esperaron 10 s tras un 403
  // (waited), se corrigió la extensión (extFixed); Continuar viendo: 0 = directo, 1 = el panel, 2 = otra vez directo
  // (retried); intentos para el reporte. Se reinicia con cada video (vodIdx)
  const vod = useRef({ idx: -1, checked: false, waited: false, extFixed: false, stage: 0, retried: false, gone: false, inUse: false, format: false, srv: 0, acct: '', attempts: [] as string[], live: null as StreamCheck | null, xui: null as StreamCheck | null });
  // vigilante: si el video no empieza a sonar a tiempo, se prueba otra forma (antes podía quedar cargando para siempre)
  const startDog = useRef<ReturnType<typeof setTimeout> | null>(null);
  // ya se le dieron 15 s más a este canal porque seguía bajando video
  const liveWait = useRef(false);
  const onErrorRef = useRef<() => void>(() => {});
  // canal: motivo del último intento que no salió del reproductor (lector HLS, vigilante)
  const liveNote = useRef('');
  // canal que ya se estaba viendo y se cortó: reconexiones seguidas (n), cuándo sonó la última vez (ok) y desde cuándo
  // se ve el canal (since, para el reporte)
  const liveRecon = useRef({ n: 0, ok: 0, since: 0 });
  // película o episodio: desde cuándo se abre (t: al entrar al reproductor o al pasar a otro episodio) y cuándo se le dio
  // el video al reproductor (load); i = -1 antes del primero
  const openAt = useRef({ i: -1, t: Date.now(), load: 0 });
  // la orden de borrar la caché del panel espera a que se cierre el reproductor
  useEffect(() => {
    setPlayerOpen(true);
    // los índices de Continuar viendo en segundo plano se detienen (la línea es del video)
    idxWarmHold(true);
    return () => {
      setPlayerOpen(false);
      idxWarmHold(false);
      if (startDog.current) clearTimeout(startDog.current);
    };
  }, []);
  const urlFor = useCallback(
    (i: number): string => {
      const s = getState().session!;
      let u: string;
      if (params.kind === 'live') u = liveUrl(s, (params.channels[i] || params.channel).id, LIVE_FORMATS[fmtAt.current]);
      else {
        const e = params.queue[i];
        u = params.kind === 'movie' ? movieUrl(s, e.id, e.ext) : episodeUrl(s, e.id, e.ext);
      }
      return flipped.current ? otherScheme(u) : u;
    },
    [params],
  );

  const showOverlay = useCallback(() => {
    setOverlay(true);
    if (ctl.current && ready.current) {
      setPos(Math.floor(ctl.current.realPos()));
      setDur(ctl.current.duration());
    }
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!menuOpen.current && !controlsFocus.current) setOverlay(false);
    }, 5000);
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
      // el motor del panel no sabe la duración total: la del servidor, para que Continuar viendo tenga su avance
      const duration = Math.floor(c.duration()) || e.dur || 0;
      // abriendo desde el principio para saltar a donde quedó: no se pisa el avance guardado
      if (position < 5 || !Number.isFinite(duration) || c.seeking()) return;
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
          // el idioma elegido para el título va con el avance: los demás equipos abren en ese idioma
          play: titlePlayHint(urlFor(indexRef.current)),
        },
        force,
      );
    },
    [params, urlFor],
  );

  // El lector de la app no pudo y la película sigue por otro camino (modo directo de Vega): 30 s para empezar a sonar; si
  // no, los pasos de siempre hasta el aviso. Antes no quedaba ningún plazo después de ese cambio y, si el modo directo
  // no arrancaba (índice al final, servidor lento), la pantalla quedaba cargando para siempre (2.0.15)
  const vodFinal = useCallback((i: number) => {
    if (startDog.current) clearTimeout(startDog.current);
    startDog.current = setTimeout(() => {
      startDog.current = null;
      const c = ctl.current;
      if (!c || c.hasPlayed() || indexRef.current !== i) return;
      onErrorRef.current();
    }, 30000);
  }, []);

  // ---------- carga ----------
  const load = useCallback(
    (i: number, resume = 0) => {
      const c = ctl.current;
      if (!c || !ready.current) return;
      loadRev.current++;
      const op = openAt.current;
      if (op.i !== i || !op.t) openAt.current = { i, t: op.i < 0 ? op.t : Date.now(), load: Date.now() };
      setError('');
      setBuffering(true);
      setPos(0);
      setDur(0);
      setSub('');
      setAudioLabel('');
      setWork('');
      setStatus(live ? t('Conectando con el canal…') : t('Cargando…'));
      if (vod.current.idx !== i) vod.current = { idx: i, checked: false, waited: false, extFixed: false, stage: 0, retried: false, gone: false, inUse: false, format: false, srv: 0, acct: '', attempts: [], live: null, xui: null };
      if (params.kind !== 'live') {
        // el idioma con el que se venía viendo este título en otro equipo (llega con el avance del panel)
        const hint = playHintFor(params.kind, params.queue[i].id, params.seriesId);
        if (hint?.a) seedTitleLang(urlFor(i), String(hint.a), typeof hint.ai === 'number' ? hint.ai : -1);
      }
      // conexiones de la línea (la lectura de películas no prueba varias a la vez si la línea admite una)
      setLineMax(Number(getState().session?.max) || 0);
      c.load(dnsUrl.current && dnsUrl.current.i === i ? dnsUrl.current.url : urlFor(i), resume, live);
      if (startDog.current) clearTimeout(startDog.current);
      startDog.current = null;
      liveWait.current = false;
      // 20 s para empezar a sonar (15 s en Continuar viendo; 25 s en los canales: la app baja la lista y los primeros
      // segmentos); con el panel, sus propios plazos
      startDog.current = setTimeout(() => {
        startDog.current = null;
        if (!ctl.current || ctl.current.hasPlayed()) return;
        if (ctl.current.panelActive()) {
          // abierto por el panel (así se vio antes este archivo): 45 s más para empezar; si no, se deja y siguen los
          // pasos (antes no había plazo y quedaba cargando sin fin)
          startDog.current = setTimeout(() => {
            startDog.current = null;
            const c2 = ctl.current;
            if (!c2 || c2.hasPlayed() || !c2.panelActive() || indexRef.current !== i) return;
            c2.panelStop();
            onErrorRef.current();
          }, 45000);
          return;
        }
        // el canal sigue bajando (segmentos largos, servidor lento): 15 s más una vez antes de probar otra forma
        if (live && ctl.current.liveBusy() && !liveWait.current) {
          liveWait.current = true;
          startDog.current = setTimeout(() => {
            startDog.current = null;
            const c2 = ctl.current;
            if (!c2 || c2.hasPlayed() || indexRef.current !== i) return;
            liveNote.current = 'sin imagen en 40 s';
            onErrorRef.current();
          }, 15000);
          return;
        }
        if (live) liveNote.current = 'sin imagen en 25 s';
        // el MP4 que lee la app (índice al final del archivo) puede tardar más en empezar: 25 s más
        // el lector propio sin el índice del archivo en 20 s: el servidor no lo entrega así; se sigue ya con lo demás
        // (antes se esperaban 25 s más: 45 s con la pantalla cargando)
        // si el servidor sigue entregando (XUI da las películas a la velocidad del video y el índice de muchos MP4 está
        // al final y pesa varios MB) se espera mientras llegue algo, hasta 2 min; sin nada llegando, se sigue ya
        if (!live && ctl.current.mp4Starting() && !ctl.current.mp4Indexed()) {
          const t0 = Date.now();
          const waitIndex = () => {
            startDog.current = null;
            const c2 = ctl.current;
            if (!c2 || c2.hasPlayed() || indexRef.current !== i || !c2.mp4Starting()) return;
            if (c2.mp4Indexed()) {
              // ya tiene el índice: 25 s más para empezar a sonar
              startDog.current = setTimeout(() => {
                startDog.current = null;
                const c3 = ctl.current;
                if (!c3 || c3.hasPlayed() || indexRef.current !== i) return;
                if (c3.mp4Fallback('sin empezar tras leer el índice')) vodFinal(i);
                else onErrorRef.current();
              }, 25000);
              return;
            }
            if (c2.mp4Busy() && Date.now() - t0 < 100000) {
              setStatus(t('Cargando…'));
              startDog.current = setTimeout(waitIndex, 5000);
              return;
            }
            if (c2.mp4Fallback('sin índice en ' + Math.round(20 + (Date.now() - t0) / 1000) + ' s')) vodFinal(i);
            else onErrorRef.current();
          };
          waitIndex();
          return;
        }
        if (!live && ctl.current.mp4Starting()) {
          startDog.current = setTimeout(() => {
            startDog.current = null;
            const c2 = ctl.current;
            if (!c2 || c2.hasPlayed() || indexRef.current !== i) return;
            if (c2.mp4Fallback('sin empezar en 45 s')) vodFinal(i);
            else onErrorRef.current();
          }, 25000);
          return;
        }
        onErrorRef.current();
      }, live ? 25000 : resume > 0 ? 15000 : 20000);
    },
    [urlFor, live, vodFinal],
  );

  // La app pasa a segundo plano con el reproductor abierto (botón de inicio, 2.1.0). Vega cierra las apps que ocupan más
  // de 150 MB en segundo plano y al volver muestra «Could not resume where you left off» (foto del aviso): el video
  // bajado por adelantado, los índices y lo que preparaba la ficha pesan decenas de MB. Se guarda el avance, se suelta
  // todo y al volver se abre otra vez desde el mismo segundo (con el índice guardado en el equipo: un solo pedido)
  useEffect(() => {
    let away: { i: number; at: number } | null = null;
    const sub = AppState.addEventListener('change', st => {
      const c = ctl.current;
      if (!c || !ready.current) return;
      if (st === 'background' && !away) {
        save(true);
        away = { i: indexRef.current, at: live ? 0 : c.hasPlayed() ? Math.floor(c.realPos()) : Math.floor(c.resumePos()) };
        if (startDog.current) clearTimeout(startDog.current);
        startDog.current = null;
        try {
          video.current?.pause();
        } catch {
          // ya cerrado
        }
        void c.destroy();
        freeMp4Memory();
      } else if (st === 'active' && away) {
        const a = away;
        away = null;
        load(a.i, a.at);
      }
    });
    return () => sub.remove();
  }, [load, save, live]);

  const next = useCallback(() => {
    if (params.kind !== 'episode') return false;
    const n = indexRef.current + 1;
    if (n >= params.queue.length) return false;
    setIndex(n);
    load(n);
    showOverlay();
    return true;
  }, [params, load, showOverlay]);

  // capítulo anterior (botón |◀ de las series)
  const prevEp = useCallback(() => {
    if (params.kind !== 'episode') return;
    const n = indexRef.current - 1;
    if (n < 0) return;
    setIndex(n);
    load(n);
    showOverlay();
  }, [params, load, showOverlay]);

  // canal n de la carpeta (▲▼ o la lista de canales)
  const goTo = useCallback(
    (n: number) => {
      if (params.kind !== 'live' || n === indexRef.current || !params.channels[n]) return;
      retried.current = false;
      triedDns.current = false;
      triedOther.current = false;
      fmtAt.current = 0;
      rounds.current = 0;
      lineWaits.current = 0;
      liveRecon.current = { n: 0, ok: 0, since: 0 };
      // El índice cambia ya, incluso si llegan varias flechas antes del render.
      // Al mantener la tecla, solo abre el último canal elegido tras 120 ms.
      indexRef.current = n;
      loadRev.current++;
      if (zapTimer.current) clearTimeout(zapTimer.current);
      if (startDog.current) clearTimeout(startDog.current);
      startDog.current = null;
      setIndex(n);
      setEpg([]);
      setError('');
      setBuffering(true);
      setStatus(t('Conectando con el canal…'));
      zapTimer.current = setTimeout(() => {
        zapTimer.current = null;
        zapping.current = true;
        setSession(x => x + 1);
      }, 120);
      showOverlay();
    },
    [params, load, showOverlay],
  );
  const zap = useCallback(
    (delta: number) => {
      if (params.kind !== 'live' || params.channels.length < 2) return;
      goTo((indexRef.current + delta + params.channels.length) % params.channels.length);
    },
    [params, goTo],
  );
  // lista de canales de la carpeta a la izquierda (OK en un canal, como Roku)
  const [chList, setChList] = useState(false);
  const chListRef = useRef(false);
  chListRef.current = chList;
  const chScroll = useListScroll<Item>(px(CH_ROW), params.kind === 'live' ? params.channels.length : 0);
  const pickCh = useCallback(
    (i: number) => {
      setChList(false);
      goTo(i);
    },
    [goTo],
  );

  useEffect(() => {
    // el canal que ya suena en la miniatura: la pantalla grande se queda con ese reproductor (sin cerrarlo ni abrir el
    // canal de nuevo; solo cambia la superficie), como Roku
    const inherited = session === 0 && params.kind === 'live' ? takePreview(urlFor(indexRef.current)) : null;
    zapping.current = false;
    const v = inherited ? inherited.v : new VideoPlayer();
    video.current = v;
    const hooks: Hooks = {
      toast: showToast,
      status: setWork,
      changed: () => {
        const items = c.menu();
        setAudioLabel(items.find(item => item.kind === 'audio' && item.on)?.label || '');
        if (menuOpen.current) showMenu(items);
      },
      subText: setSub,
      fatal: msg => {
        setBuffering(false);
        setError(msg);
      },
      // el panel no pudo preparar el video que el equipo no abrió: siguen los otros pasos
      panelFailed: () => onErrorRef.current(),
      // Continuar viendo: el salto al segundo guardado no llegó en 15 s; siguen los pasos (el panel desde ese segundo)
      resumeFailed: () => onErrorRef.current(),
      // el canal se detiene seguido: al panel una vez por canal con el estado del lector (bajada, descifrado, cortes)
      liveStalls: diag => {
        const ch = params.kind === 'live' ? params.channels[indexRef.current] || params.channel : null;
        reportError('warning', 'Canal en vivo se detiene seguido', 'canal=' + (ch?.name || '') + ' id=' + (ch?.id || '') + ' ' + diag, 'Reproductor');
      },
      // canal por HLS (lector propio) que no abrió: el siguiente formato
      liveFailed: why => {
        liveNote.current = 'HLS: ' + why;
        onErrorRef.current();
      },
    };
    const c = inherited ? inherited.c : new Playback(v, hooks);
    if (inherited) c.setHooks(hooks);
    ctl.current = c;
    let alive = true;
    let initialized = false;
    let initializing: Promise<void> | null = null;
    let released: Promise<void> = Promise.resolve();
    // canal (lista y primer segmento) o película (su principio) pedidos por adelantado: si se cierra antes, se corta
    let preUrl = '';

    // Los reintentos pertenecen al intento que los creó; otro canal o una
    // conexión más reciente invalida el temporizador y sus respuestas.
    // Película o episodio que ya sonaba y se quedó quieto 30 s sin pausa (p. ej. después de cambiar el idioma, con el
    // servidor tardando ~6 s en cada pedido): se abre otra vez en el segundo donde iba. Antes la imagen quedaba quieta
    // para siempre
    let lastT = -1;
    let lastMove = Date.now();
    let goodPos = 0;
    const stuckDog = live
      ? null
      : setInterval(() => {
        if (!alive || !ready.current || startDog.current || errorRef.current) return;
        const now = Date.now();
        const tNow = v.currentTime || 0;
        if (tNow !== lastT || v.paused || !c.hasPlayed() || c.panelActive()) {
          if (tNow !== lastT && c.hasPlayed()) goodPos = c.realPos();
          lastT = tNow;
          lastMove = now;
          return;
        }
        if (now - lastMove < 30000) return;
        lastMove = now;
        reportError('warning', 'Película o serie quieta 30 s (se abre otra vez donde iba)', 'kind=' + params.kind + ' pos=' + Math.round(goodPos) + ' modo=' + c.vodMode(), 'Reproductor');
        load(indexRef.current, Math.floor(goodPos));
      }, 5000);

    const retryLive = (i: number, delay: number) => {
      const revision = loadRev.current;
      setTimeout(() => {
        if (!alive || zapTimer.current || indexRef.current !== i || loadRev.current !== revision) return;
        // con un reproductor nuevo (como un cambio de canal): el nativo de Vega no admite otra dirección en el mismo
        zapping.current = true;
        setSession(x => x + 1);
      }, delay);
    };

    const onMeta = () => c.onMeta();
    const onTime = () => {
      c.onTime();
      // en modo directo Vega puede avisar solo timeupdate y no «playing» (Amazon): el canal que ya avanza cuenta como
      // sonando (si no, a los 25 s se daba por perdido y pasaba al lector de la app)
      if (live && !c.hasPlayed() && !v.paused && (v.currentTime || 0) > 0.3) onPlaying();
      const now = Date.now();
      if (now - lastUi.current < 1000) return;
      lastUi.current = now;
      save(false);
      // con el menú abierto la barra no se ve: no se redibuja el reproductor cada medio segundo (el menú se trababa);
      // en los canales no hay barra: sin redibujar, la app queda libre para bajar y descifrar el canal
      if (menuOpen.current || live) return;
      const remaining = c.duration() - c.realPos();
      const nextSoon = params.kind === 'episode' && indexRef.current + 1 < params.queue.length && remaining > 0 && remaining <= 20;
      if (!overlayVisible.current && !nextSoon) return;
      setPos(Math.floor(c.realPos()));
      setDur(c.duration());
    };
    const onPlaying = () => {
      if (!alive || zapTimer.current) return;
      if (startDog.current) clearTimeout(startDog.current);
      startDog.current = null;
      setBuffering(false);
      setPaused(false);
      setStatus('');
      rounds.current = 0;
      lineWaits.current = 0;
      liveRecon.current.ok = Date.now();
      if (!liveRecon.current.since) liveRecon.current.since = Date.now();
      // película o episodio que tardó más de 8 s en empezar: al panel con los tiempos y el camino que siguió (sin esto no
      // había cómo saber qué demora en cada equipo y servidor)
      const op = openAt.current;
      const url = urlFor(indexRef.current);
      if (!live && op.i === indexRef.current && op.t && Date.now() - op.t > 8000 && !slowSent.has(url)) {
        slowSent.add(url);
        const e = 'queue' in params ? params.queue[indexRef.current] : null;
        reportError('warning', 'Película o serie tardó en empezar', 'kind=' + params.kind + ' ext=' + (e?.ext || '') + ' total=' + ((Date.now() - op.t) / 1000).toFixed(1) + 's hasta_cargar=' + ((op.load - op.t) / 1000).toFixed(1) + 's continuar=' + Math.round(firstResume.current) + ' modo=' + c.vodMode(), 'Reproductor');
      }
      op.t = 0;
      c.onPlaying();
      // por este protocolo entrega el video el servidor: los siguientes videos van primero por él
      setStreamFlip(flipped.current);
      // los idiomas del episodio siguiente, para que también empiece con el idioma elegido
      if (params.kind === 'episode' && indexRef.current + 1 < params.queue.length) warmTracks(urlFor(indexRef.current + 1));
    };
    const onWaiting = () => alive && !zapTimer.current && setBuffering(true);
    const onPause = () => {
      if (!alive || zapTimer.current) return;
      // el lector del canal juntando margen: se ve «cargando», no la pausa
      if (c.liveHolding()) {
        setBuffering(true);
        return;
      }
      setPaused(true);
      save(true);
    };
    const onEnded = () => {
      if (!alive || zapTimer.current) return;
      // se cortó antes del final (servidor, audio del panel): no es el fin del capítulo, se trata como error
      const d = c.duration();
      const p = c.realPos();
      if (params.kind !== 'live' && (d > 0 ? p < d - 90 && p < d * 0.9 : p < 60)) {
        onError();
        return;
      }
      save(true);
      if (!next()) {
        if (params.kind === 'live') load(indexRef.current);
        else nav.pop();
      }
    };
    // aviso final y reporte al panel (con cada intento y lo que contestó el servidor)
    const failVod = (text: string) => {
      const vs = vod.current;
      setBuffering(false);
      setStatus('');
      setError(text);
      const base = 'kind=' + params.kind + ' ext=' + (entry?.ext || '') + ' servidor=' + vs.srv + vs.acct + ' intentos=[' + vs.attempts.join(' | ') + ']';
      if (params.kind === 'live') {
        reportError('playback', 'No se pudo reproducir (' + params.kind + ')', base, 'Reproductor');
        return;
      }
      // ya sin reproductor: qué trae el archivo (códec del video y de los audios, índice del MP4 al final) para saber por
      // qué el equipo no lo abre directo
      probeTracks(urlFor(indexRef.current))
        .catch(() => null)
        .then(p => {
          const file = p && p.headOk ? ' archivo=' + (p.container || '?') + ' video=' + (p.video || '?') + ' audio=' + (p.audio.map(a => a.codec + (a.lang ? '(' + a.lang + ')' : '')).join(',') || '?') + (p.container === 'mp4' ? ' moov=' + (p.moovEnd ? 'final' : 'inicio') : '') : ' archivo=sin leer';
          reportError('playback', 'No se pudo reproducir (' + params.kind + ')', base + file, 'Reproductor');
        });
    };
    const failText = (): string => {
      const vs = vod.current;
      if (vs.xui) return serverText(vs.xui, false) + (vs.xui.xui ? '\n' + vs.xui.xui + (vs.xui.xuiText ? ' · ' + vs.xui.xuiText : '') : '');
      if (vs.gone || vs.srv === 404 || vs.srv === 410) return t('Video no disponible');
      if (vs.inUse) return t('Línea en uso en otro equipo');
      if (vs.stage >= 2) return t('No se pudo continuar donde quedó');
      if (vs.srv >= 400) return t('Error de comunicación con el servidor');
      // el equipo no lo abre de ninguna forma y el servidor (VPS / VDS) está apagado o sin permiso: se dice qué falta
      if (engineDenied()) return t('Este video no se puede abrir en este equipo: es necesario encender el servidor.');
      return t('No se pudo reproducir este contenido.');
    };
    // película o episodio que todavía no sonó (Roku: onError → streamCheck, Continuar viendo por pasos)
    const vodError = (): boolean => {
      const vs = vod.current;
      const i = indexRef.current;
      const e = params.kind === 'live' ? null : params.queue[i];
      if (!e || c.hasPlayed() || c.panelActive()) return false;
      const err: any = (v as any).error;
      if (vs.attempts.length < 12) vs.attempts.push((flipped.current ? 'otro protocolo' : 'directo') + ': ' + (err?.code ?? '') + ' ' + String(err?.message || '').slice(0, 80) + (c.mp4Note() ? ' (lector MP4: ' + c.mp4Note() + ')' : ''));
      const at = c.resumePos();
      // 1) una vez: qué contesta el servidor (código, cuenta, si la película sigue y con qué extensión)
      if (!vs.checked) {
        vs.checked = true;
        setStatus(t('Cargando…'));
        streamCheck(urlFor(i), getState().session!, params.kind === 'movie' ? e.id : '', true).then(r => {
          if (!alive || indexRef.current !== i) return;
          vs.srv = r.code;
          if (r.status !== undefined) vs.acct = ' cuenta=' + r.status + ' conexiones=' + r.active + '/' + r.max;
          vs.inUse = r.code >= 400 && !!r.max && (r.active || 0) >= r.max;
          // el servidor sí entrega el video y el equipo no lo abre: es el formato; directo al panel (sin el otro
          // protocolo, el DNS ni otra vuelta: antes el panel lo preparaba hasta 3 veces y tardaba mucho)
          vs.format = r.code >= 200 && r.code < 300 && !r.html && /video|octet|matroska|mp4|msvideo|mpeg/i.test(r.type || '');
          vs.attempts.push('servidor: ' + r.code + ' tipo=' + (r.type || '?') + (r.size ? ' tamaño=' + Math.round(r.size / 1048576) + 'MB' : '') + (r.ranges ? ' rangos=' + r.ranges : '') + (r.moved ? ' redirige=' + r.moved : '') + (r.xui ? ' xui=' + r.xui + ' (' + (r.xuiText || '') + ')' : r.html ? ' html=«' + (r.page || '') + '»' : '') + vs.acct + (r.exists !== undefined ? ' existe=' + r.exists + ' ext=' + r.ext : ''));
          if (r.xui) {
            // el servidor contestó con la página de error de XUI («Debug Mode»): el motivo exacto, sin insistir
            vs.xui = r;
            return failVod(failText());
          }
          if (r.exists === false) {
            // la película ya no está en el servidor (el catálogo guardado quedó viejo)
            vs.gone = true;
            return failVod(failText());
          }
          if (r.ext && e.ext && r.ext !== e.ext.toLowerCase() && !vs.extFixed) {
            // el servidor la tiene con otra extensión: se abre con la de verdad
            vs.extFixed = true;
            vs.checked = false;
            e.ext = r.ext;
            setTimeout(() => alive && load(i, at), 1000);
            return;
          }
          if (r.code === 404 || r.code === 410) return failVod(failText());
          if (r.status && r.status !== 'active') return failVod(t('Línea no activa'));
          if (r.code >= 400 && !vs.waited) {
            // 403 de una línea de pocas conexiones: el servidor sigue contando el intento anterior unos segundos
            vs.waited = true;
            setStatus(t('Reintentando…'));
            setTimeout(() => alive && load(i, at), 10000);
            return;
          }
          onErrorRef.current();
        });
        return true;
      }
      // 2) Continuar viendo: nunca empieza solo desde el principio (eso es el botón «Desde el principio»)
      if (at > 5 && c.seeking()) {
        if (vs.stage === 0) {
          vs.stage = 1;
          setStatus(t('Preparando desde donde quedó…'));
          setTimeout(() => {
            if (!alive) return;
            c.panelOpen(at).then(ok => !ok && alive && onErrorRef.current());
            // el panel tampoco empieza a sonar en 60 s (antes quedaba en «Preparando desde donde quedó…» sin fin): se
            // deja y sigue el último paso (otra vez directo en el segundo guardado; si no, el aviso)
            setTimeout(() => {
              if (!alive || indexRef.current !== i || vod.current.stage !== 1 || c.hasPlayed()) return;
              c.panelStop();
              onErrorRef.current();
            }, 60000);
          }, 4000);
          return true;
        }
        if (vs.stage === 1) {
          // el panel no pudo (o no está): otra vez directo en el segundo guardado 10 s después
          vs.stage = 2;
          setStatus(t('Preparando desde donde quedó…'));
          setTimeout(() => alive && load(i, at), 10000);
          return true;
        }
        failVod(failText());
        return true;
      }
      return false;
    };
    // canal que no abrió de ninguna forma: se le pregunta al servidor qué pasa y el aviso dice el motivo (igual que
    // Roku); al panel va cada intento (formato, protocolo, lo que dijo el reproductor) y lo que contestó el servidor
    // canal que no abrió: el aviso dice el motivo (igual que Roku) según lo que contestó el servidor; al panel va cada
    // intento (formato, protocolo, lo que dijo el reproductor) y la respuesta del servidor (código, página de XUI, cuenta)
    const showLive = (r: StreamCheck) => {
      const vs = vod.current;
      const i = indexRef.current;
      const ch = params.kind === 'live' ? params.channels[i] || params.channel : null;
      const acct = r.status !== undefined ? ' cuenta=' + r.status + ' conexiones=' + r.active + '/' + r.max : '';
      let text: string;
      if (r.xui) text = serverText(r, true);
      else if (r.status && r.status !== 'active') text = t('Línea no activa');
      else if (r.max && (r.active || 0) >= r.max) text = t('Línea en uso en otro equipo');
      else if (r.code === 404 || r.code === 410) text = t('Canal no disponible en el servidor');
      else if (r.code === 401 || r.code === 403) text = t('El servidor rechazó el canal ({x})', { x: String(r.code) });
      else if (r.code >= 500) text = t('El servidor del canal tiene problemas ({x})', { x: String(r.code) });
      else if (r.code === 0) text = t('Sin conexión con el servidor del canal');
      else if (r.code >= 400) text = t('Error de comunicación con el servidor');
      else text = t('El equipo no pudo abrir el video de este canal');
      setBuffering(false);
      setStatus('');
      setError(text + (r.xui ? '\n' + r.xui + (r.xuiText ? ' · ' + r.xuiText : '') : ''));
      reportError(
        'playback',
        'No se pudo reproducir (live): ' + text,
        'canal=' + (ch?.name || '') + ' id=' + (ch?.id || '') + ' servidor=' + r.code + ' tipo=' + (r.type || '') + (r.xui ? ' xui=' + r.xui + ' (' + (r.xuiText || '') + ')' : r.html ? ' html=«' + (r.page || '') + '»' : '') + acct +
          ' formatos=' + LIVE_FORMATS.join(',') + ' dnsElegido=' + (dnsUrl.current?.i === i) + ' intentos=[' + vs.attempts.join(' | ') + ']',
        'Reproductor',
      );
    };
    const failLive = () => {
      const vs = vod.current;
      if (vs.live) return showLive(vs.live);
      const i = indexRef.current;
      const revision = loadRev.current;
      setStatus(t('Revisando el canal…'));
      streamCheck(urlFor(i), getState().session!, '', true).then(r => alive && indexRef.current === i && loadRev.current === revision && showLive(r));
    };
    // siguiente forma de abrir el canal: los otros formatos, luego el otro protocolo (http / https) con los formatos
    // otra vez y, si hay un DNS elegido, por él. Sin vueltas extra: muchos intentos seguidos hacen que el servidor
    // (XUI) bloquee el equipo un rato y luego tampoco abren las películas
    const nextLive = () => {
      const i = indexRef.current;
      if (fmtAt.current < LIVE_FORMATS.length - 1) {
        fmtAt.current++;
        setStatus(t('Reintentando…'));
        retryLive(i, 1000);
        return;
      }
      // el servidor contestó y entregó el canal (200): el otro protocolo o el DNS no cambian nada (2.0.15; antes, tras 40 s,
      // se probaba https en un servidor que solo da http y terminaba en «error 0»). Una vez más con un reproductor nuevo
      // y, si tampoco, el aviso
      const reached = !!vod.current.live && vod.current.live.code >= 200 && vod.current.live.code < 400;
      if (reached) {
        if (!vod.current.retried) {
          vod.current.retried = true;
          setStatus(t('Reintentando…'));
          retryLive(i, 1500);
          return;
        }
        failLive();
        return;
      }
      if (!triedOther.current) {
        triedOther.current = true;
        flipped.current = !flipped.current;
        fmtAt.current = 0;
        setStatus(t('Reintentando…'));
        retryLive(i, 1500);
        return;
      }
      if (!triedDns.current) {
        triedDns.current = true;
        const revision = loadRev.current;
        viaDns(urlFor(i)).then(url => {
          if (!alive || indexRef.current !== i || loadRev.current !== revision) return;
          if (!url) return failLive();
          dnsUrl.current = { i, url };
          setStatus(t('Reintentando con el DNS elegido…'));
          load(i);
        });
        return;
      }
      failLive();
    };
    const onError = () => {
      if (!alive || zapTimer.current) return;
      if (startDog.current) clearTimeout(startDog.current);
      startDog.current = null;
      if (c.adaptiveFallback()) return;
      if (params.kind === 'live') {
        // el reproductor rechazó el video convertido por el lector (MP4): el mismo canal otra vez en MPEG-TS
        const before = c.liveDiag();
        const nx = c.liveNext();
        // otra vez con un reproductor nuevo, como abre la miniatura (2.0.15): un fallo suelto del nativo al cambiar de canal
        // (el anterior todavía soltaba el decodificador) o un canal que el lector no muestra y el nativo sí
        if (nx === 'fresh') {
          const vs = vod.current;
          if (vs.attempts.length < 16) vs.attempts.push('otra vez con un reproductor nuevo: ' + (liveNote.current || 'error del reproductor') + (before ? ' · ' + before : ''));
          liveNote.current = '';
          setStatus(t('Conectando con el canal…'));
          setBuffering(true);
          retryLive(indexRef.current, 600);
          return;
        }
        if (nx === 'here') {
          const ch = params.channels[indexRef.current] || params.channel;
          reportError('warning', 'Canal en vivo: el equipo no aceptó el MP4 del lector (se vuelve a abrir en MPEG-TS o solo con el video)', 'canal=' + (ch?.name || '') + ' id=' + (ch?.id || '') + ' motivo=' + (liveNote.current || 'error del reproductor') + ' · ' + before, 'Reproductor');
          liveNote.current = '';
          setStatus(t('Reconectando…'));
          setBuffering(true);
          return;
        }
        // qué pasó en este intento (formato, protocolo, código del reproductor o motivo del lector HLS)
        const vs = vod.current;
        const err: any = (v as any).error;
        const diag = c.liveDiag();
        const why = (liveNote.current || (err ? 'error ' + (err.code ?? '') + ' ' + String(err.message || '').slice(0, 80) : 'error')) + (diag ? ' · ' + diag : '');
        liveNote.current = '';
        // El canal ya se estaba viendo y se cortó (servidor, token vencido, red): se vuelve a conectar igual (mismo
        // formato y protocolo, que funcionaban), sin aviso, como cualquier app IPTV. Hasta 5 veces seguidas; si volvió
        // a sonar más de 90 s, la cuenta empieza de nuevo. Antes se trataba como un canal que no abre: probaba otras
        // formas y terminaba en «El equipo no pudo abrir el video de este canal».
        const rc = liveRecon.current;
        if (c.hasPlayed() && Date.now() - rc.ok > 90000) rc.n = 0;
        if ((c.hasPlayed() || rc.n > 0) && rc.n < 5) {
          rc.n++;
          if (rc.n === 1) {
            const ch = params.channels[indexRef.current] || params.channel;
            reportError('warning', 'Canal cortado mientras se veía (se reconecta solo)', 'canal=' + (ch?.name || '') + ' id=' + (ch?.id || '') + ' minutos=' + Math.round((Date.now() - (rc.since || Date.now())) / 60000) + ' motivo=' + why, 'Reproductor');
          }
          setStatus(t('Reconectando…'));
          setBuffering(true);
          const i = indexRef.current;
          retryLive(i, [300, 1000, 2000, 4000, 8000][rc.n - 1]);
          return;
        }
        if (vs.attempts.length < 16) vs.attempts.push(LIVE_FORMATS[fmtAt.current] + (flipped.current ? ' (otro protocolo)' : '') + (dnsUrl.current ? ' (DNS)' : '') + ': ' + why);
        // al primer fallo se le pregunta una vez al servidor: si contesta con un error (página de XUI, 4xx, cuenta no
        // activa) no se insiste, se dice el motivo
        if (!vs.checked) {
          vs.checked = true;
          const i = indexRef.current;
          const revision = loadRev.current;
          setStatus(t('Revisando el canal…'));
          streamCheck(urlFor(i), getState().session!, '', true).then(r => {
            if (!alive || indexRef.current !== i || loadRev.current !== revision) return;
            vs.live = r;
            // La línea tiene todas sus conexiones ocupadas (otros equipos, o canales recién dejados que el servidor sigue
            // contando un rato): por eso contesta una página vacía. Se espera a que se libere una y se pide otra vez el
            // mismo canal (hasta 2 veces), sin probar el otro protocolo ni el DNS; después, «Línea en uso en otro
            // equipo». Antes terminaba en «el equipo no pudo abrir el video» con un canal que sí abre
            const full = !!r.max && (r.active || 0) >= r.max;
            if (full && !r.xui && lineWaits.current < 2) {
              lineWaits.current++;
              vs.checked = false;
              setStatus(t('Línea ocupada ({a}/{m}): esperando una conexión libre…', { a: String(r.active), m: String(r.max) }));
              retryLive(i, 8000);
              return;
            }
            // una página sin código de XUI no dice el motivo: se siguen probando las otras formas
            if (full || r.xui || r.code >= 400 || (r.status && r.status !== 'active')) return showLive(r);
            nextLive();
          });
          return;
        }
        nextLive();
        return;
      }
      // el MP4 que lee la app no le gustó al reproductor: el modo directo de siempre (y sus pasos) con este video; con su
      // plazo para empezar (si no, quedaba cargando sin fin)
      if (c.mp4Fallback()) {
        if (!c.hasPlayed()) vodFinal(indexRef.current);
        return;
      }
      if (vodError()) return;
      if (vod.current.format) {
        triedOther.current = true;
        triedDns.current = true;
      }
      if (!triedOther.current) {
        triedOther.current = true;
        flipped.current = !flipped.current;
        setStatus(t('Reintentando…'));
        const at = Math.floor(c.resumePos());
        // 2 s después: el servidor suelta la conexión del intento anterior
        setTimeout(() => alive && load(indexRef.current, at), 2000);
        return;
      }
      // audio que el equipo no decodifica (DTS…): lo prepara el panel
      const giveUp = () =>
        c.onError().then(handled => {
          if (!alive || handled) return;
          // una vuelta más tras una pausa (no más: muchos intentos seguidos y el servidor bloquea el equipo)
          if (rounds.current < 1 && !vod.current.format) {
            // otra vuelta sola tras una pausa (el servidor pudo cortar un momento)
            rounds.current++;
            retried.current = false;
            triedOther.current = false;
            triedDns.current = false;
            setStatus(t('Reconectando…'));
            const at = Math.floor(c.resumePos());
            setTimeout(() => alive && load(indexRef.current, at), 5000);
            return;
          }
          failVod(failText());
        });
      if (!triedDns.current) {
        triedDns.current = true;
        const i = indexRef.current;
        const at = Math.floor(c.resumePos());
        viaDns(urlFor(i)).then(url => {
          if (!alive) return;
          if (!url) return giveUp();
          dnsUrl.current = { i, url };
          setStatus(t('Reintentando con el DNS elegido…'));
          load(i, at);
        });
        return;
      }
      giveUp();
    };
    onErrorRef.current = onError;
    const onTrack = () => {
      c.schedulePrefs();
      if (menuOpen.current) showMenu(c.menu());
    };

    // heredado de la miniatura: ya iniciado y sonando (sin cerrar la miniatura, pedir nada ni iniciar otro reproductor)
    if (inherited) initialized = true;
    // cambio de canal en pantalla grande: la lista y el primer segmento del canal nuevo se piden ya, mientras se cierra el
    // reproductor anterior y se inicia el nuevo (la conexión del anterior ya se cortó). La primera vez no: la miniatura
    // todavía tiene su conexión y puede dejarle lo que bajó a la pantalla grande
    const zapFirst = session > 0 && live ? urlFor(indexRef.current) : '';
    if (zapFirst && /\.m3u8(\?|$)/i.test(zapFirst) && !nativeLivePlanned(zapFirst)) {
      preUrl = zapFirst;
      prefetchList(zapFirst);
    }
    // (un reproductor que volvía a la miniatura y nadie tomó se cierra antes de abrir este)
    if (!inherited) dropReturn();
    // conexiones de la línea, antes del primer pedido por adelantado (en una línea de una conexión es uno solo)
    setLineMax(Number(getState().session?.max) || 0);
    const begin: Promise<void> = inherited
      ? Promise.resolve()
      : stopLivePreview().then(waitForLivePreview).then(() => {
        if (!alive) return;
        // el primer pedido del video va mientras el reproductor se inicia (antes esperaba a que terminara)
        const first = dnsUrl.current && dnsUrl.current.i === indexRef.current ? dnsUrl.current.url : urlFor(indexRef.current);
        // con lo que dejó la miniatura de este canal (o con el reproductor nativo) no hace falta pedir nada por adelantado;
        // en un cambio de canal ya se pidió (preUrl)
        if (preUrl) {
          // nada
        } else if (live && /\.m3u8(\?|$)/i.test(first) && !hasHandoff(first) && !nativeLivePlanned(first)) {
          preUrl = first;
          prefetchList(first);
        }
        // películas y series: la cabecera (los idiomas). MKV desde el principio: también su primer tramo del video (1 MB) en un
        // segundo pedido apenas llega la cabecera; el MP4 ya pide el principio del video a la vez que su índice
        // con el reproductor nativo el archivo lo pide él: nada por adelantado (sería otra conexión a la vez)
        else if (!live && c.nativeVodPlanned(first, firstResume.current)) {
          // nada
        } else if (!live && vodKnown(first)) {
          // el índice ya está en el equipo o lo viene leyendo la ficha: el lector pide directo el video
        } else if (!live && /\.mkv(\?|$)/i.test(first)) {
          preUrl = first;
          prefetchRange(first, 0, 262144, firstResume.current > 5 ? 0 : 1048576);
        } else if (!live && /\.(mp4|m4v|mov)(\?|$)/i.test(first) && !mp4Spot(first)) {
          // lo mismo que pide primero el lector (mp4mse.ts): en una línea de una conexión, desde el principio, también el
          // principio del video (un solo pedido); si no, la cabecera (el principio del video lo pide el lector a la vez)
          preUrl = first;
          prefetchRange(first, 0, firstResume.current <= 5 && singleFor(first) ? MP4_HEAD : 65536);
        }
        initializing = v.initialize().then(() => { initialized = true; });
        return initializing;
      });
    begin
      .then(async () => {
        if (!alive) return;
        // la superficie del video antes de darle el video (Amazon: sin ella, error 4 en modo directo); como mucho 3 s
        for (let i = 0; i < 30 && alive && !surface.current; i++) await new Promise<void>(r => setTimeout(r, 100));
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
        (v as any).audioTracks?.addEventListener?.('change', onTrack);
        (v as any).textTracks?.addEventListener?.('addtrack', onTrack);
        if (surface.current) v.setSurfaceHandle(surface.current);
        if (captions.current) v.setCaptionViewHandle(captions.current);
        if (inherited) {
          // ya suena: se quita el «cargando» y sigue igual (si Vega lo pausó al cambiar de superficie, sigue: abrirlo otra
          // vez pedía el canal con la conexión de la miniatura todavía contada)
          if (c.hasPlayed()) {
            if (v.paused) v.play();
            onPlaying();
            return;
          }
          // la miniatura todavía conectaba: sigue con esa misma conexión; si en 25 s no suena, los pasos de siempre
          setBuffering(true);
          setStatus(t('Conectando con el canal…'));
          startDog.current = setTimeout(() => {
            startDog.current = null;
            if (alive && ctl.current && !ctl.current.hasPlayed()) onErrorRef.current();
          }, 25000);
          return;
        }
        load(indexRef.current, firstResume.current);
      })
      .catch(() => alive && setError(t('No se pudo iniciar el reproductor.')));

    return () => {
      const zap = zapping.current;
      alive = false;
      loadRev.current++;
      if (preUrl) dropPrefetch(preUrl);
      if (params.kind === 'live' && !zap) setLastLive((params.channels[indexRef.current] || params.channel)?.id || '');
      // Se vuelve a TV en vivo con el canal sonando: la miniatura se queda con este mismo reproductor (solo cambia de
      // superficie, como Roku): el canal no se corta ni se abre otra vez (preview-session.ts, 2.0.14)
      const backCh = params.kind === 'live' && !zap && fromLive && initialized && ready.current && !errorRef.current && c.hasPlayed() ? params.channels[indexRef.current] || params.channel : null;
      if (backCh) {
        if (stuckDog) clearInterval(stuckDog);
        if (hideTimer.current) clearTimeout(hideTimer.current);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        if (zapTimer.current) clearTimeout(zapTimer.current);
        zapTimer.current = null;
        if (startDog.current) clearTimeout(startDog.current);
        startDog.current = null;
        try {
          v.removeEventListener('loadedmetadata', onMeta);
          v.removeEventListener('timeupdate', onTime);
          v.removeEventListener('playing', onPlaying);
          v.removeEventListener('waiting', onWaiting);
          v.removeEventListener('pause', onPause);
          v.removeEventListener('ended', onEnded);
          v.removeEventListener('error', onError);
          (v as any).audioTracks?.removeEventListener?.('addtrack', onTrack);
          (v as any).audioTracks?.removeEventListener?.('change', onTrack);
          (v as any).textTracks?.removeEventListener?.('addtrack', onTrack);
          if (surface.current) v.clearSurfaceHandle(surface.current);
        } catch {
          // sigue igual
        }
        offerReturn(backCh.id, v, c);
        video.current = null;
        ctl.current = null;
        ready.current = false;
        return;
      }
      try {
        save(true);
        released = c.destroy();
      } catch {
        // nada que guardar o el motor ya estaba cerrado
      }
      if (stuckDog) clearInterval(stuckDog);
      if (!zap) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        if (toastTimer.current) clearTimeout(toastTimer.current);
        if (zapTimer.current) clearTimeout(zapTimer.current);
        zapTimer.current = null;
      }
      try {
        if (initialized) {
          v.removeEventListener('loadedmetadata', onMeta);
          v.removeEventListener('timeupdate', onTime);
          v.removeEventListener('playing', onPlaying);
          v.removeEventListener('waiting', onWaiting);
          v.removeEventListener('pause', onPause);
          v.removeEventListener('ended', onEnded);
          v.removeEventListener('error', onError);
          (v as any).audioTracks?.removeEventListener?.('addtrack', onTrack);
          (v as any).audioTracks?.removeEventListener?.('change', onTrack);
          (v as any).textTracks?.removeEventListener?.('addtrack', onTrack);
          v.pause();
          if (surface.current) v.clearSurfaceHandle(surface.current);
        }
      } catch {
        // el reproductor ya estaba cerrado
      }
      // se libera en segundo plano: deinitializeSync() bloqueaba la app hasta 3 s al salir de un canal que
      // todavía conectaba (deportes) y los Atrás que se apretaban mientras tanto llegaban después a la pantalla de abajo
      try {
        playerClosing(Promise.all([released, initializing?.catch(() => {})]).then(() => (initialized ? v.deinitialize() : undefined)));
      } catch {
        // el reproductor ya estaba cerrado
      }
      video.current = null;
      ctl.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // guía del canal actual
  useEffect(() => {
    if (!channel) return;
    let alive = true;
    const s = getState().session;
    // Un barrido con las flechas no necesita descargar la guía de cada paso.
    const timer = setTimeout(() => {
      if (s) channelEpg(s, { id: channel.id, epg: channel.epg, name: channel.name }).then(l => alive && setEpg(l)).catch(() => {});
    }, 350);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [channel]);

  useEffect(() => {
    showOverlay();
  }, [showOverlay]);

  // Atrás: cierra el menú de pistas o sale del reproductor (una sola vez: los Atrás repetidos no pasan a la pantalla de abajo).
  // Se registra una sola vez y lee el estado por referencias: antes se volvía a registrar con cada cambio del menú y un
  // Atrás que llegaba en ese momento lo tomaba el sistema y cerraba la app
  const leaving = useRef(false);
  const askRef = useRef(false);
  askRef.current = askExit;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (leaving.current) return true;
      if (chListRef.current) {
        chListRef.current = false;
        setChList(false);
        return true;
      }
      if (menuOpen.current) {
        menuOpen.current = false;
        menuSig.current = '';
        setMenu(null);
        showOverlay();
        return true;
      }
      if (controlsFocus.current) {
        setControlsFocused(false);
        showOverlay();
        return true;
      }
      if (askRef.current) {
        askRef.current = false;
        setAskExit(false);
        return true;
      }
      // película o capítulo: se pregunta antes de salir; en vivo sale directo
      if (!live) {
        askRef.current = true;
        setAskExit(true);
        return true;
      }
      leave();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leave = () => {
    leaving.current = true;
    try {
      if (ready.current) video.current?.pause();
    } catch {
      // ya estaba detenido
    }
    nav.pop();
  };

  // siguiente capítulo como Netflix: aviso en los últimos 15 s; Ver ahora pasa ya, Cancelar deja ver el final y al
  // terminar pasa solo (onEnded)
  const left = dur - pos;
  const nextSecs =
    params.kind === 'episode' && index + 1 < params.queue.length && nextOff !== index && !error && dur > 120 && pos > 60 && left > 0 && left <= 15
      ? Math.ceil(left)
      : 0;

  const openMenu = (mode: 'audio' | 'all' = 'all') => {
    if (!ctl.current || !ready.current) return;
    setMenuMode(mode);
    setControlsFocused(false);
    showMenu(ctl.current.menu());
  };

  const chanRef = useRef(channel);
  chanRef.current = channel;
  const onFav = useCallback(() => {
    const ch = chanRef.current;
    if (!ch) return;
    toggleFav('live', ch.id, ch.name, ch.poster, ch.cat);
    menuSig.current = '';
    if (ctl.current) setMenu(ctl.current.menu());
  }, []);
  const onPick = useCallback((m: MenuItem) => {
    ctl.current?.select(m);
    if (m.kind === 'audio') {
      showMenu(null);
      showOverlay();
    } else if (ctl.current) showMenu(ctl.current.menu());
  }, [showMenu, showOverlay]);

  const seek = (delta: number) => {
    const c = ctl.current;
    if (!c || !ready.current || live) return;
    flashKey(delta < 0 ? 'back' : 'fwd');
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
    if (!v || !ready.current) return;
    flashKey('play');
    if (v.paused) v.play();
    else v.pause();
    showOverlay();
  };

  // OK: reintentar tras un error; en vivo, la barra del canal (nombre y guía) y la lista de canales a la izquierda;
  // en películas y capítulos, pausa
  const onSelect = () => {
    if (error) {
      retried.current = false;
      load(indexRef.current, Math.floor(pos));
    } else if (live) {
      showOverlay();
      if (params.kind === 'live' && params.channels.length > 1) {
        chScroll.reset(Math.max(0, indexRef.current - 3) * px(CH_ROW));
        setChList(true);
      }
    } else togglePause();
  };
  // ancla de foco: un botón invisible a pantalla completa que tiene el foco mientras no hay menú ni aviso. Sin él, al
  // abrir un canal desde la lista el foco se quedaba en la lista de abajo (oculta) y OK, ▲ y ▼ no llegaban al reproductor
  const anchorOn = !menu && !askExit && !chList && !(nextSecs > 0) && !controlsFocused;
  useTVEventHandler((evt: HWEvent) => {
    if (evt.eventKeyAction !== undefined && evt.eventKeyAction !== 0) return;
    if (menu || askExit || nextSecs > 0 || chList) return; // menú, lista de canales, aviso del siguiente y «¿Salir?» usan el foco normal
    if (controlsFocused) {
      if (evt.eventType === 'down') { setControlsFocused(false); showOverlay(); }
      if (['menu', 'info', 'more', 'context_menu'].includes(evt.eventType)) openMenu();
      return;
    }
    // en vivo solo OK (lista de canales), ▲▼ (cambiar de canal) y MENÚ: pausa, ◀▶ y adelantar no hacen nada (pausar un
    // canal en vivo lo dejaba trabado)
    if (live && !['select', 'up', 'down', 'channel_up', 'channel_down', 'menu', 'info', 'more', 'context_menu'].includes(evt.eventType)) return;
    switch (evt.eventType) {
      case 'select':
        // OK lo atiende el ancla de foco (onSelect); aquí solo si no está (no se hace dos veces)
        if (!anchorOn) onSelect();
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
        if (live) zap(-1);
        else {
          showOverlay();
          // solo las series tienen botones (capítulo anterior / siguiente)
          if (params.kind === 'episode') setControlsFocused(true);
        }
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
  // el reproductor de Vega no siempre da la duración (la barra quedaba en 0 % aunque el tiempo avanzara): la del
  // servidor, como el avance de Continuar viendo
  const total = dur || (params.kind !== 'live' ? params.queue[index]?.dur || 0 : 0);
  const pct = total > 0 ? Math.min(100, (pos / total) * 100) : 0;

  return (
    <View style={s.root}>
      <KeplerVideoSurfaceView
        style={s.video}
        onSurfaceViewCreated={(h: string) => {
          surface.current = h;
          if (ready.current) video.current?.setSurfaceHandle(h);
        }}
        onSurfaceViewDestroyed={(h: string) => {
          // solo si es la superficie que usa el video (si ya se creó otra, no se le quita)
          if (h !== surface.current) return;
          video.current?.clearSurfaceHandle(h);
          surface.current = '';
        }}
      />
      {/* en vivo sin capa de subtítulos: con ella, los canales que traen subtítulos ocultos (CC) en el video (HBO,
          Warner…) se congelaban en pantalla grande con el audio sonando; la miniatura, sin esa capa, iba bien */}
      {live ? null : (
        <KeplerCaptionsView
          style={s.captions}
          onCaptionViewCreated={(h: string) => {
            captions.current = h;
            if (ready.current) video.current?.setCaptionViewHandle(h);
          }}
        />
      )}

      {/* subtítulos que prepara el panel (WebVTT) */}
      {sub ? (
        <View style={[s.subBox, (overlay || paused) && !live && s.subBoxUp]} pointerEvents="none">
          <Text style={s.subText}>{sub}</Text>
        </View>
      ) : null}

      {buffering && !error ? (
        <View style={s.center}>
          <Loader />
          {status || work ? <Text style={s.status}>{work || status}</Text> : null}
        </View>
      ) : null}

      {nextSecs > 0 && !askExit ? (
        <View style={s.nextCard}>
          <Text style={s.nextTitle}>{t('Siguiente episodio')}</Text>
          <Text style={s.hint}>{t('Empieza en {x} s', { x: nextSecs })}</Text>
          <View style={s.nextRow}>
            <Button label={t('Ver ahora')} primary preferred onPress={() => next()} />
            <Button label={t('Cancelar')} onPress={() => setNextOff(index)} />
          </View>
        </View>
      ) : null}

      {/* sobre negro: la imagen de lo anterior (otro canal, el video que falló) no queda detrás de las letras */}
      {error && !askExit ? (
        <View style={[s.center, s.errorShade]}>
          <Text style={s.error}>{error}</Text>
          <Text style={s.hint}>{t('Atrás para salir')}</Text>
        </View>
      ) : null}

      {anchorOn ? <Focusable preferred onPress={onSelect} style={s.anchor}>{null}</Focusable> : null}
      {/* series: solo capítulo anterior |◀ y siguiente ▶| (adelantar, atrasar y pausa van con ◀ ▶ y OK del control, sin
          botones en pantalla); con ▲ se eligen (◀ ▶ para moverse, OK para usar, ▼ vuelve) */}
      {params.kind === 'episode' && (overlay || paused) && !buffering && !error && !menu && !askExit && !(nextSecs > 0) ? (
        <View style={s.centerCtl} pointerEvents={controlsFocused ? 'auto' : 'none'}>
          <CtlButton icon="prev" on={false} focusable={controlsFocused} disabled={index === 0} onPress={prevEp} />
          <CtlButton icon="next" on={false} focusable={controlsFocused} preferred disabled={index + 1 >= params.queue.length} onPress={() => next()} />
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
            {/* sin botón de audio arriba: los idiomas salen con ▼ (películas y series) o MENÚ (canales) */}
          </View>
          <View style={s.bottom}>
            {live ? (
              <>
                {cur ? (
                  <>
                    <Text style={s.now}>
                      {t('AHORA')} · {clock(cur.s)} - {clock(cur.e)}
                    </Text>
                    <Text style={s.prog} numberOfLines={1}>
                      {cur.t}
                    </Text>
                    <ProgressBar pct={Math.min(100, ((now - cur.s) / Math.max(1, cur.e - cur.s)) * 100)} />
                  </>
                ) : null}
                <Text style={s.hint}>
                  {t('▲▼ cambiar canal ({x}/{y}) · OK lista de canales · MENÚ audio y subtítulos', { x: index + 1, y: params.kind === 'live' ? params.channels.length : 1 })}
                </Text>
              </>
            ) : (
              <>
                <ProgressBar pct={pct} />
                <View style={s.times}>
                  <Text style={s.time}>{hms(pos)}</Text>
                  <Text style={s.time}>{paused ? '❚❚ ' + t('En pausa') : ''}</Text>
                  <Text style={s.time}>{dur > 0 ? '-' + hms(Math.max(0, dur - pos)) : ''}</Text>
                </View>
                <Text style={s.hint}>{t('◀▶ 10 s · OK pausa · ▼ audio y subtítulos')}{params.kind === 'episode' && index + 1 < params.queue.length ? ' · ' + t('al terminar sigue el próximo episodio') : ''}</Text>
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
          audioOnly={menuMode === 'audio'}
          favLabel={live && channel ? (isFav('live', channel.id) ? '★ ' + t('Quitar de favoritos') : '☆ ' + t('Agregar a favoritos')) : ''}
          onFav={onFav}
          onPick={onPick}
        />
      ) : null}
      {chList && params.kind === 'live' ? (
        <View style={s.chPanel}>
          <Text style={s.chHead} numberOfLines={1}>
            {t('Canales')} · {index + 1}/{params.channels.length}
          </Text>
          <FlatList
            ref={chScroll.ref}
            data={params.channels}
            keyExtractor={(c, i) => c.id + ':' + i}
            initialScrollIndex={Math.max(0, index - 3)}
            getItemLayout={(_, i) => ({ length: px(CH_ROW), offset: px(CH_ROW) * i, index: i })}
            initialNumToRender={14}
            windowSize={7}
            // la mueve la app al cambiar el foco (src/lib/listscroll.ts)
            scrollEnabled={false}
            onLayout={chScroll.onLayout}
            onScroll={chScroll.onScroll}
            extraData={index}
            renderItem={({ item: c, index: i }) => <ChRow c={c} i={i} on={i === index} pick={pickCh} focus={chScroll.show} />}
          />
        </View>
      ) : null}
      {/* «¿Salir del video?» al frente de todo (aviso de error, barra, menú) con fondo oscuro: antes el aviso de error
          se dibujaba encima y los dos textos se mezclaban */}
      {askExit ? (
        <View style={s.exitShade}>
          <View style={s.exitBox}>
            <Text style={s.nextTitle}>{t('¿Salir del video?')}</Text>
            <View style={s.nextRow}>
              <Button label={t('Salir')} onPress={leave} />
              <Button label={t('Seguir viendo')} primary preferred onPress={() => setAskExit(false)} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// Iconos de reproductor dibujados con formas (triángulos con bordes y barras): se ven igual en todo Fire TV, sin
// depender de los símbolos de la fuente
type CtlIconKind = 'play' | 'pause' | 'rew' | 'ffw' | 'prev' | 'next';
function Tri({ dir, size, color }: { dir: 'l' | 'r'; size: number; color: string }) {
  const h = px(size);
  const w = Math.round(h * 0.87);
  return (
    <View style={{ width: 0, height: 0, borderTopWidth: h / 2, borderBottomWidth: h / 2, borderTopColor: 'transparent', borderBottomColor: 'transparent',
      ...(dir === 'r' ? { borderLeftWidth: w, borderLeftColor: color } : { borderRightWidth: w, borderRightColor: color }) }} />
  );
}
function Bar({ size, color }: { size: number; color: string }) {
  return <View style={{ width: px(size * 0.22), height: px(size), backgroundColor: color, borderRadius: px(2) }} />;
}
function CtlIcon({ kind, color, big }: { kind: CtlIconKind; color: string; big?: boolean }) {
  const n = big ? 56 : 36;
  const row = { flexDirection: 'row' as const, alignItems: 'center' as const };
  if (kind === 'play') return <View style={{ marginLeft: px(8) }}><Tri dir="r" size={n} color={color} /></View>;
  if (kind === 'pause') return <View style={[row, { gap: px(n * 0.22) }]}><Bar size={n} color={color} /><Bar size={n} color={color} /></View>;
  if (kind === 'rew') return <View style={row}><Tri dir="l" size={n} color={color} /><Tri dir="l" size={n} color={color} /></View>;
  if (kind === 'ffw') return <View style={row}><Tri dir="r" size={n} color={color} /><Tri dir="r" size={n} color={color} /></View>;
  if (kind === 'prev') return <View style={row}><Bar size={n} color={color} /><Tri dir="l" size={n} color={color} /></View>;
  return <View style={row}><Tri dir="r" size={n} color={color} /><Bar size={n} color={color} /></View>;
}
function CtlButton({ icon, big, on, focusable, preferred, disabled, onPress }: { icon: CtlIconKind; big?: boolean; on: boolean; focusable: boolean; preferred?: boolean; disabled?: boolean; onPress: () => void }) {
  const face = (f: boolean) => {
    const lit = (f || on) && !disabled;
    return (
      <View style={[s.ctlBtn, big && s.ctlBig, lit && s.ctlBtnOn, disabled && s.ctlOff]}>
        <CtlIcon kind={icon} big={big} color={lit ? '#000' : '#fff'} />
      </View>
    );
  };
  if (!focusable) return face(false);
  return (
    <Focusable preferred={preferred} disabled={disabled} onPress={() => !disabled && onPress()}>
      {(f: boolean) => face(f)}
    </Focusable>
  );
}

// Barra de avance con un punto grande donde va el video. Todo en píxeles fijos (ancho de diseño 1760 = 1920 menos los
// márgenes), sin porcentajes, sin flex y sin medir: sobre el video de Vega ninguna de esas formas pintaba el relleno.
// El punto va en el flujo normal (margen izquierdo) y sube sobre la barra con un margen negativo.
const BAR_W = 1760;
const DOT = 30;
function ProgressBar({ pct }: { pct: number }) {
  const p = Math.max(0, Math.min(100, pct || 0));
  const fill = Math.round((px(BAR_W) * p) / 100);
  return (
    <View style={s.barWrap}>
      <View style={s.bar}>
        <View style={[s.barFill, { width: fill }]} />
      </View>
      <View style={[s.dot, { marginLeft: Math.max(0, Math.min(px(BAR_W) - px(DOT), fill - px(DOT / 2))) }]} />
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
    status: { color: C.green, fontSize: px(28), marginTop: px(20) },
    error: { color: '#fff', fontSize: px(38), fontWeight: '700', textAlign: 'center' },
    errorShade: { backgroundColor: '#000' },
    overlay: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, justifyContent: 'space-between', zIndex: 6 },
    topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: px(80), paddingTop: px(50), paddingBottom: px(40), backgroundColor: alpha(C.bg, 0.6) },
    chLogo: { width: px(130), height: px(74), marginRight: px(24) },
    title: { color: C.text, fontSize: px(44), fontWeight: '800', flex: 1 },
    star: { color: '#f5c518', fontSize: px(40) },
    audioButton: { marginLeft: px(24), minWidth: px(180) },
    bottom: { paddingHorizontal: px(80), paddingBottom: px(60), paddingTop: px(40), backgroundColor: alpha(C.bg, 0.65) },
    barWrap: { width: px(BAR_W), height: px(DOT), marginTop: px(12) },
    bar: { width: px(BAR_W), height: px(8), marginTop: px((DOT - 8) / 2), backgroundColor: alpha(C.text, 0.3), borderRadius: px(4) },
    barFill: { height: px(8), backgroundColor: C.red, borderRadius: px(4) },
    dot: { width: px(DOT), height: px(DOT), marginTop: -px((DOT + 8) / 2), borderRadius: px(DOT / 2), backgroundColor: C.red, borderWidth: px(3), borderColor: '#fff' },
    times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: px(10) },
    time: { color: C.text, fontSize: px(28) },
    now: { color: C.red, fontSize: px(26), fontWeight: '800' },
    prog: { color: C.text, fontSize: px(34), fontWeight: '700', marginTop: px(4) },
    hint: { color: C.sub, fontSize: px(24), marginTop: px(14) },
    workBox: { position: 'absolute', top: px(60), alignSelf: 'center', backgroundColor: alpha(C.bg2, 0.92), borderRadius: px(12), paddingHorizontal: px(30), paddingVertical: px(14), zIndex: 8 },
    workText: { color: C.text, fontSize: px(26), fontWeight: '700' },
    toast: { position: 'absolute', bottom: px(200), alignSelf: 'center', maxWidth: px(1300), backgroundColor: alpha(C.bg2, 0.95), borderRadius: px(12), borderLeftWidth: px(6), borderLeftColor: C.red, paddingHorizontal: px(30), paddingVertical: px(16), zIndex: 9 },
    toastText: { color: C.text, fontSize: px(26) },
    nextCard: { position: 'absolute', right: px(80), bottom: px(140), backgroundColor: alpha(C.bg2, 0.95), borderRadius: px(12), padding: px(30), zIndex: 10 },
    chPanel: { position: 'absolute', left: 0, top: 0, bottom: 0, width: px(620), zIndex: 40, backgroundColor: alpha(C.bg, 0.94), paddingTop: px(40), paddingHorizontal: px(20) },
    chHead: { color: C.text, fontSize: px(32), fontWeight: '800', marginLeft: px(16), marginBottom: px(16) },
    chRow: { height: px(CH_ROW - 8), marginBottom: px(8), flexDirection: 'row', alignItems: 'center', borderRadius: px(8), paddingHorizontal: px(16), borderWidth: px(3), borderColor: 'transparent' },
    chRowOn: { backgroundColor: alpha(C.text, 0.1) },
    chRowF: { backgroundColor: C.focus, borderColor: C.focus },
    chNum: { color: C.sub, fontSize: px(26), width: px(70) },
    chRowLogo: { width: px(80), height: px(50), marginRight: px(16) },
    chName: { color: C.text, fontSize: px(28), flex: 1 },
    chTextF: { color: C.onFocus },
    centerCtl: { position: 'absolute', left: 0, right: 0, top: px(430), flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: px(70), zIndex: 7 },
    ctlBtn: { width: px(130), height: px(130), borderRadius: px(65), backgroundColor: 'rgba(0,0,0,0.45)', borderWidth: px(3), borderColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' },
    ctlBig: { width: px(170), height: px(170), borderRadius: px(85) },
    ctlBtnOn: { backgroundColor: C.text, borderColor: C.text, transform: [{ scale: 1.08 }] },
    ctlOff: { opacity: 0.35 },
    anchor: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 1 },
    exitShade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'center', alignItems: 'center' },
    exitBox: { backgroundColor: alpha(C.bg2, 0.97), borderRadius: px(12), padding: px(40), alignItems: 'center' },
    nextTitle: { color: C.text, fontSize: px(34), fontWeight: '800' },
    nextRow: { flexDirection: 'row', gap: px(20), marginTop: px(24) },
  }),
);
