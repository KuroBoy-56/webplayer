// Reproductor nativo de Vega (W3C Media, modo URL: MP4, MKV, AVI, MOV, MPEG-TS…) sin límite de
// resolución ni de bitrate (4K si el equipo y el archivo lo tienen).
// Películas y episodios: continuar donde quedó, adelantar/retroceder, audio y subtítulos (con el
// motor del panel cuando el equipo no puede: player/playback.ts), siguiente episodio automático.
// TV en vivo: cambio de canal con arriba/abajo y guía.
import { HWEvent, useTVEventHandler } from '@amazon-devices/react-native-kepler';
import { KeplerCaptionsView, KeplerVideoSurfaceView, VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { reportError } from '../api/report';
import { warmTracks } from '../api/media';
import { viaDns } from '../lib/securedns';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { channelEpg, EpgEntry, episodeUrl, LIVE_FORMATS, liveUrl, movieUrl, otherScheme, setStreamFlip, streamFlip } from '../api/xtream';
import TrackMenu from '../components/TrackMenu';
import { Button, Focusable } from '../components/ui';
import { Item } from '../data/catalog';
import { clock, hms, nowSec } from '../lib/util';
import { PlayParams, useNav } from '../nav';
import { MenuItem, Playback } from '../player/playback';
import { StreamCheck, streamCheck } from '../player/streamcheck';
import { setPlayerOpen } from '../lib/cacheclear';
import { getState, isFav, saveProgress, toggleFav } from '../state';
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

// alto de cada canal de la lista (fijo: la lista abre ya en el canal que suena)
const CH_ROW = 76;

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
  // el menú se vuelve a dibujar solo si cambió algo (antes cada aviso del reproductor lo rehacía entero y, con el
  // video del panel, el control se trababa al moverse por el menú)
  const menuSig = useRef('');
  const showMenu = useCallback((items: MenuItem[] | null) => {
    const sig = items ? items.map(m => m.kind + m.key + (m.on ? '1' : '0') + m.label).join('|') : '';
    if (items && sig === menuSig.current && menuOpen.current) return;
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
  const onErrorRef = useRef<() => void>(() => {});
  // canal: motivo del último intento que no salió del reproductor (lector HLS, vigilante)
  const liveNote = useRef('');
  // canal que ya se estaba viendo y se cortó: reconexiones seguidas (n), cuándo sonó la última vez (ok) y desde cuándo
  // se ve el canal (since, para el reporte)
  const liveRecon = useRef({ n: 0, ok: 0, since: 0 });
  // la orden de borrar la caché del panel espera a que se cierre el reproductor
  useEffect(() => {
    setPlayerOpen(true);
    return () => {
      setPlayerOpen(false);
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
      setStatus(live ? t('Conectando con el canal…') : t('Cargando…'));
      if (vod.current.idx !== i) vod.current = { idx: i, checked: false, waited: false, extFixed: false, stage: 0, retried: false, gone: false, inUse: false, format: false, srv: 0, acct: '', attempts: [], live: null, xui: null };
      c.load(dnsUrl.current && dnsUrl.current.i === i ? dnsUrl.current.url : urlFor(i), resume, live);
      if (startDog.current) clearTimeout(startDog.current);
      startDog.current = null;
      // 20 s para empezar a sonar (15 s en Continuar viendo; 25 s en los canales: la app baja la lista y los primeros
      // segmentos); con el panel, sus propios plazos
      startDog.current = setTimeout(() => {
        startDog.current = null;
        if (!ctl.current || ctl.current.hasPlayed() || ctl.current.panelActive()) return;
        if (live) liveNote.current = 'sin imagen en 25 s';
        onErrorRef.current();
      }, live ? 25000 : resume > 0 ? 15000 : 20000);
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

  // canal n de la carpeta (▲▼ o la lista de canales)
  const goTo = useCallback(
    (n: number) => {
      if (params.kind !== 'live' || n === indexRef.current || !params.channels[n]) return;
      retried.current = false;
      triedDns.current = false;
      triedOther.current = false;
      fmtAt.current = 0;
      rounds.current = 0;
      liveRecon.current = { n: 0, ok: 0, since: 0 };
      setIndex(n);
      setEpg([]);
      load(n);
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

  useEffect(() => {
    const v = new VideoPlayer();
    video.current = v;
    const c = new Playback(v, {
      toast: showToast,
      status: setWork,
      changed: () => menuOpen.current && showMenu(c.menu()),
      subText: setSub,
      fatal: msg => {
        setBuffering(false);
        setError(msg);
      },
      // el panel no pudo preparar el video que el equipo no abrió: siguen los otros pasos
      panelFailed: () => onErrorRef.current(),
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
    });
    ctl.current = c;
    let alive = true;

    const onMeta = () => c.onMeta();
    const onTime = () => {
      const now = Date.now();
      if (now - lastUi.current < 500) return;
      lastUi.current = now;
      save(false);
      // con el menú abierto la barra no se ve: no se redibuja el reproductor cada medio segundo (el menú se trababa);
      // en los canales no hay barra: sin redibujar, la app queda libre para bajar y descifrar el canal
      if (menuOpen.current || live) return;
      setPos(c.realPos());
      setDur(c.duration());
    };
    const onPlaying = () => {
      if (startDog.current) clearTimeout(startDog.current);
      startDog.current = null;
      setBuffering(false);
      setPaused(false);
      setStatus('');
      rounds.current = 0;
      liveRecon.current.ok = Date.now();
      if (!liveRecon.current.since) liveRecon.current.since = Date.now();
      c.onPlaying();
      // por este protocolo entrega el video el servidor: los siguientes videos van primero por él
      setStreamFlip(flipped.current);
      // los idiomas del episodio siguiente, para que también empiece con el idioma elegido
      if (params.kind === 'episode' && indexRef.current + 1 < params.queue.length) warmTracks(urlFor(indexRef.current + 1));
    };
    const onWaiting = () => setBuffering(true);
    const onPause = () => {
      // el lector del canal juntando margen: se ve «cargando», no la pausa
      if (c.liveHolding()) {
        setBuffering(true);
        return;
      }
      setPaused(true);
      save(true);
    };
    const onEnded = () => {
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
      reportError('playback', 'No se pudo reproducir (' + params.kind + ')', 'kind=' + params.kind + ' ext=' + (entry?.ext || '') + ' servidor=' + vs.srv + vs.acct + ' intentos=[' + vs.attempts.join(' | ') + ']', 'Reproductor');
    };
    const failText = (): string => {
      const vs = vod.current;
      if (vs.xui) return serverText(vs.xui, false) + (vs.xui.xui ? '\n' + vs.xui.xui + (vs.xui.xuiText ? ' · ' + vs.xui.xuiText : '') : '');
      if (vs.gone || vs.srv === 404 || vs.srv === 410) return t('Video no disponible');
      if (vs.inUse) return t('Línea en uso en otro equipo');
      if (vs.stage >= 2) return t('No se pudo continuar donde quedó');
      if (vs.srv >= 400) return t('Error de comunicación con el servidor');
      return t('No se pudo reproducir este contenido.');
    };
    // película o episodio que todavía no sonó (Roku: onError → streamCheck, Continuar viendo por pasos)
    const vodError = (): boolean => {
      const vs = vod.current;
      const i = indexRef.current;
      const e = params.kind === 'live' ? null : params.queue[i];
      if (!e || c.hasPlayed() || c.panelActive()) return false;
      const err: any = (v as any).error;
      if (vs.attempts.length < 12) vs.attempts.push((flipped.current ? 'otro protocolo' : 'directo') + ': ' + (err?.code ?? '') + ' ' + String(err?.message || '').slice(0, 80));
      const at = c.resumePos();
      // 1) una vez: qué contesta el servidor (código, cuenta, si la película sigue y con qué extensión)
      if (!vs.checked) {
        vs.checked = true;
        setStatus(t('Cargando…'));
        streamCheck(urlFor(i), getState().session!, params.kind === 'movie' ? e.id : '').then(r => {
          if (!alive || indexRef.current !== i) return;
          vs.srv = r.code;
          if (r.status !== undefined) vs.acct = ' cuenta=' + r.status + ' conexiones=' + r.active + '/' + r.max;
          vs.inUse = r.code >= 400 && !!r.max && (r.active || 0) >= r.max;
          // el servidor sí entrega el video y el equipo no lo abre: es el formato; directo al panel (sin el otro
          // protocolo, el DNS ni otra vuelta: antes el panel lo preparaba hasta 3 veces y tardaba mucho)
          vs.format = r.code >= 200 && r.code < 300 && !r.html && /video|octet|matroska|mp4|msvideo|mpeg/i.test(r.type || '');
          vs.attempts.push('servidor: ' + r.code + (r.xui ? ' xui=' + r.xui + ' (' + (r.xuiText || '') + ')' : r.html ? ' html=«' + (r.page || '') + '»' : '') + vs.acct + (r.exists !== undefined ? ' existe=' + r.exists + ' ext=' + r.ext : ''));
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
      else if (r.code >= 400 && r.max && (r.active || 0) >= r.max) text = t('Línea en uso en otro equipo');
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
      setStatus(t('Revisando el canal…'));
      streamCheck(urlFor(i), getState().session!, '', true).then(r => alive && indexRef.current === i && showLive(r));
    };
    // siguiente forma de abrir el canal: los otros formatos, luego el otro protocolo (http / https) con los formatos
    // otra vez y, si hay un DNS elegido, por él. Sin vueltas extra: muchos intentos seguidos hacen que el servidor
    // (XUI) bloquee el equipo un rato y luego tampoco abren las películas
    const nextLive = () => {
      const i = indexRef.current;
      if (fmtAt.current < LIVE_FORMATS.length - 1) {
        fmtAt.current++;
        setStatus(t('Reintentando…'));
        setTimeout(() => alive && load(i), 1000);
        return;
      }
      if (!triedOther.current) {
        triedOther.current = true;
        flipped.current = !flipped.current;
        fmtAt.current = 0;
        setStatus(t('Reintentando…'));
        setTimeout(() => alive && load(i), 1500);
        return;
      }
      if (!triedDns.current) {
        triedDns.current = true;
        viaDns(urlFor(i)).then(url => {
          if (!alive) return;
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
      if (startDog.current) clearTimeout(startDog.current);
      startDog.current = null;
      if (params.kind === 'live') {
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
          setTimeout(() => alive && indexRef.current === i && load(i), [300, 1000, 2000, 4000, 8000][rc.n - 1]);
          return;
        }
        if (vs.attempts.length < 16) vs.attempts.push(LIVE_FORMATS[fmtAt.current] + (flipped.current ? ' (otro protocolo)' : '') + (dnsUrl.current ? ' (DNS)' : '') + ': ' + why);
        // al primer fallo se le pregunta una vez al servidor: si contesta con un error (página de XUI, 4xx, cuenta no
        // activa) no se insiste, se dice el motivo
        if (!vs.checked) {
          vs.checked = true;
          const i = indexRef.current;
          setStatus(t('Revisando el canal…'));
          streamCheck(urlFor(i), getState().session!, '', true).then(r => {
            if (!alive || indexRef.current !== i) return;
            vs.live = r;
            // una página sin código de XUI no dice el motivo: se siguen probando las otras formas
            if (r.xui || r.code >= 400 || (r.status && r.status !== 'active')) return showLive(r);
            nextLive();
          });
          return;
        }
        nextLive();
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
      .catch(() => alive && setError(t('No se pudo iniciar el reproductor.')));

    return () => {
      alive = false;
      try {
        save(true);
        c.destroy();
      } catch {
        // nada que guardar o el motor ya estaba cerrado
      }
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
      } catch {
        // el reproductor ya estaba cerrado
      }
      // se libera en segundo plano: deinitializeSync() bloqueaba la app hasta 3 s al salir de un canal que
      // todavía conectaba (deportes) y los Atrás que se apretaban mientras tanto llegaban después a la pantalla de abajo
      try {
        v.deinitialize().catch(() => {});
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
      video.current?.pause();
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

  const openMenu = () => ctl.current && showMenu(ctl.current.menu());

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
    setTimeout(() => menuOpen.current && ctl.current && showMenu(ctl.current.menu()), 300);
  }, [showMenu]);

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

  // OK: reintentar tras un error; en vivo, la barra del canal (nombre y guía) y la lista de canales a la izquierda;
  // en películas y capítulos, pausa
  const onSelect = () => {
    if (error) {
      retried.current = false;
      load(indexRef.current, Math.floor(pos));
    } else if (live) {
      showOverlay();
      if (params.kind === 'live' && params.channels.length > 1) setChList(true);
    } else togglePause();
  };
  // ancla de foco: un botón invisible a pantalla completa que tiene el foco mientras no hay menú ni aviso. Sin él, al
  // abrir un canal desde la lista el foco se quedaba en la lista de abajo (oculta) y OK, ▲ y ▼ no llegaban al reproductor
  const anchorOn = !menu && !askExit && !chList && !(nextSecs > 0);
  useTVEventHandler((evt: HWEvent) => {
    if (evt.eventKeyAction !== undefined && evt.eventKeyAction !== 0) return;
    if (menu || askExit || nextSecs > 0 || chList) return; // menú, lista de canales, aviso del siguiente y «¿Salir?» usan el foco normal
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

      {error && !askExit ? (
        <View style={s.center}>
          <Text style={s.error}>{error}</Text>
          <Text style={s.hint}>{t('Atrás para salir')}</Text>
        </View>
      ) : null}

      {anchorOn ? <Focusable preferred onPress={onSelect} style={s.anchor}>{null}</Focusable> : null}
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
            data={params.channels}
            keyExtractor={(c, i) => c.id + ':' + i}
            initialScrollIndex={Math.max(0, index - 3)}
            getItemLayout={(_, i) => ({ length: px(CH_ROW), offset: px(CH_ROW) * i, index: i })}
            initialNumToRender={14}
            windowSize={7}
            renderItem={({ item: c, index: i }) => (
              <Focusable
                preferred={i === index}
                onPress={() => {
                  setChList(false);
                  goTo(i);
                }}
                style={f => [s.chRow, i === index && s.chRowOn, f && s.chRowF]}>
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
            )}
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

// Barra de avance: el relleno se pinta en píxeles con el ancho medido de la barra (sobre el video de Vega un ancho en
// porcentaje no se aplicaba y la barra quedaba vacía aunque el tiempo avanzara)
function ProgressBar({ pct }: { pct: number }) {
  const [w, setW] = useState(0);
  const fill = w > 0 && pct > 0 ? Math.max(px(8), Math.round((w * Math.min(100, pct)) / 100)) : 0;
  return (
    <View style={s.bar} onLayout={e => setW(e.nativeEvent.layout.width)}>
      {fill > 0 ? <View style={[s.barFill, { width: fill }]} /> : null}
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
    barFill: { position: 'absolute', left: 0, top: 0, height: px(8), backgroundColor: C.red, borderRadius: px(4) },
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
    anchor: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 1 },
    exitShade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: 50, backgroundColor: 'rgba(0,0,0,0.82)', justifyContent: 'center', alignItems: 'center' },
    exitBox: { backgroundColor: alpha(C.bg2, 0.97), borderRadius: px(12), padding: px(40), alignItems: 'center' },
    nextTitle: { color: C.text, fontSize: px(34), fontWeight: '800' },
    nextRow: { flexDirection: 'row', gap: px(20), marginTop: px(24) },
  }),
);
