// Deportes (igual que Roku): Hoy / Mañana con el canal encontrado automáticamente y, si el panel los ofrece,
// Tablas, Selecciones y Equipos. La agenda guardada sale al instante y la del panel la reemplaza al llegar; las
// tablas y los partidos se piden ya por detrás. Orden: en vivo, después por hora y al final los terminados. El
// canal de cada partido: el que lo transmite (TheSportsDB) si el cliente lo tiene, el de la guía del panel o el de
// los equipos; con «Solo los canales del servidor IPTV» (panel) solo se nombran los que el cliente tiene.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { openItem } from '../actions';
import { Chip, EventRow, EvRow, InputModal, MenuModal, MenuOpt, ReadModal } from '../components/SportsUi';
import { alertsBrand, cloudAlerts, favoritesFirst, isReminded, liveTvOn, setReminder, tooLate } from '../data/liveTv';
import { alpha, C } from '../theme';
import { Shade } from '../components/Shade';

// fondo de Deportes con perfiles: estadio de noche en 4K, sin personas (bajo el degradado del color de la app)
const STADIUM = require('../../assets/image/sports_bg.jpg');
import { Message, Spinner } from '../components/ui';
import { Item } from '../data/catalog';
import { matchSports, panelToday, SportMatch, SportsData } from '../data/sports';
import { Ev, fetchSports, fetchTables, Fixtures, League, liveById, loadFixtures, localSports, localTables, searchChannels, sportsEpg } from '../data/sportsPanel';
import { int, nowSec, str } from '../lib/util';
import { useNav } from '../nav';
import { useAppSelector } from '../state';
import { t } from '../lib/i18n';
import { px, SIDE, themed } from '../theme';
import SportsTables from './SportsTables';
import SportsTeams from './SportsTeams';

let cache: { data: SportsData; at: number } | null = null;
let tablesMem: League[] | null = null;
let fixMem: { rev: number; fx: Fixtures } | null = null;

// borrado de caché pedido por el panel
export function clearSportsCache(): void {
  cache = null;
  tablesMem = null;
  fixMem = null;
}

const isFinal = (st: string) => {
  const s = st.toLowerCase();
  return s === 'ft' || s === 'aet' || s === 'pen' || s.includes('finish') || s.includes('final') || s === 'ended';
};

// 0 Hoy, 1 Mañana, 2 Tablas, 3 Equipos, 4 Selecciones, 5 Finalizados (solo con perfiles)
type Tab = 0 | 1 | 2 | 3 | 4 | 5;

// active: la pantalla vuelve a verse (se cerró el canal); back: Atrás llevó el foco al menú de arriba
export default function Sports({ active = true, back = 0 }: { active?: boolean; back?: number }) {
  const nav = useNav();
  // el último evento con el foco: al volver del canal (o al bajar desde el menú de arriba) el foco vuelve a él. Se
  // olvida al cambiar de día o disciplina; al cambiar de sección (TV en vivo, Películas…) Deportes empieza de cero
  const lastKey = useRef('');
  // el evento al que se devuelve el foco: se vuelve a montar (clave nueva) con «preferred», solo en ese momento
  const [target, setTarget] = useState({ key: '', n: 0 });
  const refocus = () => lastKey.current && setTarget(x => ({ key: lastKey.current, n: x.n + 1 }));
  const forget = () => {
    lastKey.current = '';
    setTarget(x => ({ key: '', n: x.n }));
  };
  const toRow = useRef(false);
  const focusKey = useCallback((k: string) => {
    lastKey.current = k;
    toRow.current = false;
  }, []);
  useEffect(() => {
    if (active) refocus();
  }, [active]);
  useEffect(() => {
    if (back && lastKey.current) toRow.current = true;
  }, [back]);
  // bajando desde el menú de arriba el foco cae en las fichas: sigue hasta el evento donde se quedó
  const chipFocus = () => {
    if (toRow.current) {
      toRow.current = false;
      refocus();
    }
  };
  // solo lo que usa (antes cualquier cambio del estado, p. ej. un aviso, volvía a dibujar toda la agenda)
  const liveLoaded = useAppSelector(x => x.loaded.live);
  const catalogRev = useAppSelector(x => x.catalogRev);
  const [data, setData] = useState<SportsData | null>(cache?.data || null);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<Tab>(0);
  const [sport, setSport] = useState('');
  const [toast, setToast] = useState('');
  const [tables, setTables] = useState<League[] | null>(tablesMem);
  const [tblState, setTblState] = useState({ loading: false, partial: false, failed: false });
  const [fx, setFx] = useState<Fixtures | null>(fixMem?.fx || null);
  const [fxLoading, setFxLoading] = useState(false);
  const [epgMap, setEpgMap] = useState<Record<string, string[]>>({});
  const [extra, setExtra] = useState<Record<string, SportMatch>>({});
  const [menu, setMenu] = useState<{ title: string; sub?: string; opts: MenuOpt[] } | null>(null);
  const [typing, setTyping] = useState<string | null>(null);
  const [note, setNote] = useState<{ title: string; text: string } | null>(null);
  const stadium = liveTvOn();
  // los recordatorios ya guardados en la nube (para ofrecer «Quitar el recordatorio»)
  useEffect(() => {
    if (stadium) cloudAlerts();
  }, [stadium]);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  // agenda: la guardada al instante y la del panel al llegar (se vuelve a pedir si pasaron más de 10 minutos)
  useEffect(() => {
    if (cache && nowSec() - cache.at < 600) return;
    if (!data) {
      const local = localSports();
      if (local) setData(local);
    }
    fetchSports().then(d => {
      if (!alive.current) return;
      if (d) {
        cache = { data: d, at: nowSec() };
        setData(d);
      } else if (!cache) setErr(t('No se pudo cargar la agenda deportiva. Inténtalo más tarde.'));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = (k: string) => str(data?.sports?.[k]?.label) || k;
  const minutes = useCallback((k: string) => int((data as any)?.sports?.[k]?.minutes) || 120, [data]);
  const dd = data as any;
  const tablesOn = dd?.tables?.on === true;
  const fixOn = dd?.fixtures?.on === true;
  const natOn = fixOn && dd?.fixtures?.nat !== false;
  const iptv = str(dd?.chan) === 'iptv';

  // tablas: primero las guardadas, luego las del panel (si está armando, se vuelve a preguntar cada 20 s)
  const loadTables = useCallback(
    (tries = 0) => {
      const rev = int(dd?.tables?.t);
      if (tries === 0 && !tablesMem) {
        const local = localTables(rev);
        if (local) {
          tablesMem = local.leagues;
          setTables(local.leagues);
          if (local.fresh) return;
        }
      }
      setTblState(x => ({ ...x, loading: true }));
      fetchTables().then(r => {
        if (!alive.current) return;
        if (r.leagues.length) {
          tablesMem = r.leagues;
          setTables(r.leagues);
        }
        setTblState({ loading: false, partial: !!r.partial, failed: !r.ok });
        if (r.partial && tries < 12) setTimeout(() => alive.current && loadTables(tries + 1), 20000);
      });
    },
    [dd],
  );

  const loadFx = useCallback(
    (tries = 0) => {
      const rev = int(dd?.fixtures?.t);
      if (fixMem && fixMem.rev === rev && rev > 0) return;
      setFxLoading(true);
      loadFixtures(rev, dd?.match).then(r => {
        if (!alive.current) return;
        setFxLoading(false);
        if (r.events.length) {
          fixMem = { rev: r.partial ? -1 : rev, fx: r };
          setFx(r);
        }
        if (r.partial && tries < 12) setTimeout(() => alive.current && loadFx(tries + 1), 25000);
      });
    },
    [dd],
  );

  // apenas llega la agenda, Tablas y los partidos se piden por detrás: al entrar a esas pestañas están listos
  useEffect(() => {
    if (!data) return;
    if (tablesOn && !tablesMem) loadTables();
    if (fixOn) loadFx();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // canal de cada partido (agenda de hoy y mañana y en vivo)
  const found = useMemo(() => {
    if (!data || !liveLoaded) return null;
    const now = nowSec();
    const today = panelToday(data, now);
    const events = (data.events as Ev[]).filter(e => {
      const d = e.dy - today;
      return e.s > 0 && (d === 0 || d === 1 || (e.s <= now && now < e.s + minutes(str(e.sp)) * 60));
    });
    return matchSports({ ...data, events });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, liveLoaded, catalogRev]);

  // además, la guía del panel: el canal que tiene el partido en su programación a esa hora
  useEffect(() => {
    if (!found?.epgChans.length) return;
    sportsEpg(found.epgChans).then(m => alive.current && setEpgMap(m));
  }, [found]);

  const resolve = useCallback(
    (e: any): SportMatch | undefined => {
      const id = str(e.id);
      const m = found?.map[id] || extra[id];
      if (!m) return undefined;
      const ids = epgMap[id];
      if (!ids?.length) return m;
      const epg = ids.map(liveById).filter(Boolean) as Item[];
      const tvBest = m.tv.find(x => x.ch && !x.u)?.ch || null;
      return { ...m, epg, best: tvBest || epg[0] || m.teams, guess: false };
    },
    [found, extra, epgMap],
  );

  // los partidos de Equipos / Selecciones también buscan su canal (mismas reglas)
  const matchMore = useCallback(
    (events: Ev[]) => {
      if (!data || !liveLoaded) return;
      const want = events.filter(e => !found?.map[str(e.id)] && !extra[str(e.id)]);
      if (!want.length) return;
      const r = matchSports({ ...data, events: want });
      setExtra(x => ({ ...x, ...r.map }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, liveLoaded, found, extra],
  );

  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (sayTimer.current) clearTimeout(sayTimer.current);
  }, []);
  const say = useCallback((text: string) => {
    setToast(text);
    if (sayTimer.current) clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => setToast(''), 3500);
  }, []);

  // canales del partido en la lista del cliente (el automático primero, los de la agenda, la guía y los equipos)
  const owned = (m: SportMatch | undefined): Item[] => {
    if (!m) return [];
    const out: Item[] = [];
    const seen = new Set<string>();
    for (const c of [m.best, ...m.tv.map(x => x.ch), ...(m.epg || []), m.teams]) {
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
    return out;
  };

  // "En TV: ESPN 2 · TUDN · Fox Sports +3": los de la agenda o, en modo "iptv", solo los que tiene el cliente
  const chanLine = (e: any, m: SportMatch | undefined): string => {
    const names = iptv ? owned(m).map(c => c.name) : (Array.isArray(e.tv) ? e.tv : []).map((x: any) => str(x.n));
    if (!names.length) return '';
    return t('En TV:') + ' ' + names.slice(0, 4).join(' · ') + (names.length > 4 ? '  +' + (names.length - 4) : '');
  };

  const rowOf = useCallback(
    (e: Ev, withDate: boolean): EvRow => {
      const now = nowSec();
      const today = panelToday(data, now);
      const ending = e.s + minutes(str(e.sp)) * 60;
      const live = e.s <= now && now < ending && !isFinal(str(e.st)) && e.pp !== true;
      const ended = isFinal(str(e.st)) || (now >= ending && !!str(e.hs));
      const dayIdx = e.dy - today;
      let time = e.ck;
      if (withDate) time = (dayIdx === 0 ? t('Hoy') : dayIdx === 1 ? t('Mañana') : e.dt) + ' ' + e.ck;
      if (live) time = t('EN VIVO');
      if (e.pp === true) time = t('Aplazado');
      if (ended && !withDate) time = t('Final');
      const m = resolve(e);
      const lgInfo = fx?.leagues?.[str(e.l)];
      const ch = m?.best || null;
      let chan = t('Sin canal');
      if (!liveLoaded || !found) chan = t('Buscando…');
      else if (ch) chan = ch.name;
      else if (withDate) chan = t('Por confirmar');
      return {
        key: str(e.id),
        e,
        time,
        live,
        league: str(e.lg) || str(lgInfo?.n) || label(str(e.sp)),
        lb: str(e.lb) || str(lgInfo?.b),
        home: str(e.hn) || str(e.h) || str(e.ev),
        away: str(e.an) || str(e.a),
        hb: str(e.hb),
        ab: str(e.ab),
        score: str(e.hs) && str(e.as) && (live || ended) && !withDate ? str(e.hs) + ' - ' + str(e.as) : 'vs',
        chan,
        hasChan: !!ch,
        tv: chanLine(e, m),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, resolve, fx, iptv, liveLoaded, found],
  );

  const folder = (prefix: string) => {
    if (found?.folder) {
      say(prefix + t('te mostramos los eventos ({x})', { x: found.folder.name }));
      openItem(nav, found.folder);
    } else say(t('No encontramos un canal para este evento'));
  };
  const play = (ch: Item) => {
    setMenu(null);
    openItem(nav, ch);
  };

  // buscar en la lista del cliente por un nombre (canal, equipo o evento); todos en verde: son del servidor
  const findChans = (q: string) => {
    const list = searchChannels(q);
    if (!list.length) return say(t('No hay canales con «{x}» en tu lista', { x: q }));
    setMenu({ title: t('Canales con «{x}»', { x: q }), opts: list.map(c => ({ title: c.name, green: true, onPress: () => play(c) })) });
  };

  const playable = (e: Ev, quiet = false) => {
    const now = nowSec();
    const ending = e.s + minutes(str(e.sp)) * 60;
    const no = (m: string) => (quiet || say(m), false);
    if (e.pp === true) return no(t('El evento está aplazado'));
    if (isFinal(str(e.st)) || (e.s && now >= ending)) return no(t('Este evento ya terminó'));
    if (e.s && e.dy !== panelToday(data, now) && !(e.s <= now && now < ending)) return no(t('El evento aún no está en línea'));
    return true;
  };

  // recordatorio en la nube (solo con perfiles): el celular de la misma línea y perfil avisa 30 y 10 min antes y al empezar
  const remind = async (e: Ev, on: boolean) => {
    setMenu(null);
    // activar solo con más de 5 minutos para empezar (quitarlo, siempre)
    if (on && tooLate(e)) return setNote({ title: t('No se puede activar'), text: t('Los recordatorios solo se pueden activar en partidos que empiezan en más de 5 minutos.') });
    const ok = await setReminder(e, on);
    if (!alive.current) return;
    if (!ok) return say(t('No se pudo guardar el recordatorio. Inténtalo otra vez.'));
    setNote({
      title: on ? t('Recordatorio guardado') : t('Recordatorio quitado'),
      text: t('Para recibir las notificaciones de tus partidos y equipos favoritos debes tener la app {x} instalada en tu celular.', { x: alertsBrand() }),
    });
  };
  const remindOpt = (e: Ev): MenuOpt | null => {
    if (!stadium || e.pp === true || isFinal(str(e.st)) || !e.s || nowSec() >= e.s + minutes(str(e.sp)) * 60) return null;
    const on = isReminded(str(e.id));
    return { title: '🔔  ' + (on ? t('Quitar el recordatorio') : t('Recordarme este partido')), sub: t('Te avisaremos en tu celular 30 min y 10 min antes y al empezar'), onPress: () => remind(e, !on) };
  };
  const evTitle = (e: Ev) => (str(e.h) && str(e.a) ? (str(e.hn) || str(e.h)) + ' vs ' + (str(e.an) || str(e.a)) : str(e.ev));

  // menú del partido: el automático, los canales que lo transmiten, los de la guía y los equipos (en verde los que
  // tiene el cliente), buscar por el nombre de cada equipo y escribir otro nombre
  const open = (e: Ev) => {
    const rem = remindOpt(e);
    // un partido de otro día: con perfiles, solo el recordatorio
    if (!playable(e, !!rem)) {
      if (rem) setMenu({ title: evTitle(e), sub: t('El evento aún no está en línea'), opts: [rem] });
      return;
    }
    if (!found) return say(t('Buscando los canales, un momento…'));
    const m = resolve(e);
    const opts: MenuOpt[] = [
      {
        title: '▶  ' + t('Ver el evento (canal automático)'),
        sub: m?.best ? m.best.name : t('Busca el mejor canal automáticamente'),
        green: !!m?.best,
        onPress: () => (setMenu(null), m?.best ? openItem(nav, m.best) : folder(t('Aún no aparece el canal exacto; '))),
      },
      ...(rem ? [rem] : []),
    ];
    const seen = new Set<string>();
    for (const tv of m?.tv || []) {
      if (tv.ch && seen.has(tv.ch.id)) continue;
      if (iptv && !tv.ch) continue;
      if (tv.ch) seen.add(tv.ch.id);
      opts.push({
        title: iptv && tv.ch ? tv.ch.name : tv.n + (tv.c ? ' (' + tv.c + ')' : ''),
        sub: (tv.u ? t('suele transmitirlo') + ' · ' : '') + (tv.ch ? t('en tu lista: {x}', { x: tv.ch.name }) : t('no está en tu lista: se busca el evento')),
        green: !!tv.ch,
        onPress: () => (tv.ch ? play(tv.ch) : m?.teams ? (say(t('No tienes {x}; te mostramos {y}', { x: tv.n, y: m.teams.name })), play(m.teams)) : (setMenu(null), folder(t('No tienes {x}; ', { x: tv.n })))),
      });
    }
    for (const [c, why] of [...(m?.epg || []).map(c => [c, t('en la guía')] as const), ...(m?.teams ? [[m.teams, t('por equipos')] as const] : [])]) {
      if (seen.has(c.id) || opts.length > 10) continue;
      seen.add(c.id);
      opts.push({ title: c.name + ' · ' + why, green: true, onPress: () => play(c) });
    }
    const names = [str(e.hn) || str(e.h), str(e.an) || str(e.a)].filter(Boolean);
    if (!names.length && str(e.ev)) names.push(str(e.ev));
    for (const n of names) opts.push({ title: t('Buscar canales: «{x}»', { x: n }), onPress: () => (setMenu(null), findChans(n)) });
    opts.push({ title: t('Buscar canal, equipo o evento…'), onPress: () => (setMenu(null), setTyping(names[0] || '')) });
    setMenu({ title: evTitle(e), sub: t('¿Dónde quieres verlo?'), opts });
  };
  // la misma función para todas las filas (lee la versión actual de open): la agenda no vuelve a dibujar sus filas por nada
  const openRef = useRef(open);
  openRef.current = open;
  const openRow = useCallback((r: EvRow) => openRef.current(r.e), []);
  const renderEvent = useCallback(
    ({ item: r }: { item: EvRow }) => <EventRow r={r} preferred={r.key === target.key} onFocusKey={focusKey} onOpen={openRow} />,
    [target, focusKey, openRow],
  );

  // todas las disciplinas que encendió el dueño o el distribuidor («sports» de api/sports.php), aunque hoy no tengan
  // partidos (antes solo las de la agenda: fútbol, béisbol y básquetbol casi siempre). Primero las que tienen partidos,
  // en el orden del panel; después el resto.
  const sportKeys = useMemo(() => {
    const withEv: string[] = [];
    for (const e of data?.events || []) if (str(e.sp) && !withEv.includes(str(e.sp))) withEv.push(str(e.sp));
    const all = Object.keys(data?.sports || {}).filter(k => k !== '');
    return [...all.filter(k => withEv.includes(k)), ...withEv.filter(k => !all.includes(k)), ...all.filter(k => !withEv.includes(k))];
  }, [data]);

  // orden: en vivo, después los que vienen por hora y al final los terminados (y aplazados)
  const rows = useMemo(() => {
    if (!data || (tab > 1 && tab !== 5)) return [];
    const now = nowSec();
    const today = panelToday(data, now);
    const liveL: { r: EvRow; e: Ev }[] = [];
    const nextL: EvRow[] = [];
    const doneL: EvRow[] = [];
    const evs = (data.events as Ev[]).filter(e => e.s > 0 && (!sport || str(e.sp) === sport)).sort((a, b) => a.s - b.s);
    for (const e of evs) {
      const ending = e.s + minutes(str(e.sp)) * 60;
      const live = e.s <= now && now < ending && !isFinal(str(e.st)) && e.pp !== true;
      const dayIdx = e.dy - today;
      const over = !live && e.pp !== true && (isFinal(str(e.st)) || now >= ending);
      // con perfiles: Finalizados = los de hoy ya terminados (el último primero; a las 00:00 del panel se vacía) y Hoy sin ellos
      if (tab === 5) {
        if (dayIdx === 0 && over) doneL.unshift(rowOf(e, false));
        continue;
      }
      if (stadium && tab === 0 && over) continue;
      if (!((tab === 0 && (dayIdx === 0 || live)) || (tab === 1 && dayIdx === 1))) continue;
      const r = rowOf(e, false);
      if (live) liveL.push({ r, e });
      else if (isFinal(str(e.st)) || e.pp === true || now >= ending) doneL.push(r);
      else nextL.push(r);
    }
    // los en vivo de los eventos favoritos primero, después los del deporte favorito y luego lo demás
    return [...favoritesFirst(liveL, x => x.e).map(x => x.r), ...nextL, ...doneL];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab, sport, rowOf, stadium]);

  if (!data) return err ? <Message text={err} /> : <Spinner label={t('Cargando la agenda deportiva…')} />;

  const tabs: { id: Tab; label: string }[] = [
    { id: 0, label: t('Hoy') },
    { id: 1, label: t('Mañana') },
    ...(stadium ? [{ id: 5 as Tab, label: t('Finalizados') }] : []),
    ...(tablesOn ? [{ id: 2 as Tab, label: t('Tablas') }] : []),
    ...(natOn ? [{ id: 4 as Tab, label: t('Selecciones') }] : []),
    ...(fixOn ? [{ id: 3 as Tab, label: t('Equipos') }] : []),
  ];

  return (
    <View style={s.root}>
      {stadium ? (
        <View pointerEvents="none" style={s.bg}>
          <Image source={STADIUM} style={s.bgImg} resizeMode="cover" />
          <View style={[s.bgImg, { backgroundColor: alpha(C.bg, 0.62) }]} />
          <Shade side="bottom" style={s.bgShade} />
        </View>
      ) : null}
      <View style={s.chips}>
        {tabs.map((x, i) => (
          <Chip key={x.id} label={x.label} on={tab === x.id} preferred={i === 0} onFocus={chipFocus} onPress={() => (forget(), setTab(x.id), setSport(''))} />
        ))}
      </View>
      {toast ? <Text style={s.toast}>{toast}</Text> : null}
      {tab === 2 ? (
        <SportsTables leagues={tables} loading={tblState.loading} partial={tblState.partial} failed={tblState.failed} />
      ) : tab === 3 || tab === 4 ? (
        <SportsTeams
          key={tab}
          mode={tab === 3 ? 'teams' : 'nations'}
          fx={fx}
          loading={fxLoading}
          match={dd?.match}
          minutes={minutes}
          rowOf={rowOf}
          onOpen={open}
          onMatch={matchMore}
          say={say}
        />
      ) : (
        <>
          {/* un recuadro translúcido con todos los deportes en varias líneas (como el escritorio), no una fila larga */}
          <View style={s.sportBox}>
            {['', ...sportKeys].map(k => (
              <Chip key={k || 'all'} box label={k ? label(k) : t('Todos')} on={sport === k} onFocus={chipFocus} onPress={() => (forget(), setSport(k))} />
            ))}
          </View>
          {rows.length ? (
            <FlatList
              // otro día u otra disciplina: la lista empieza arriba; si solo se actualizó, queda donde estaba
              key={tab + '|' + sport}
              data={rows}
              // el evento al que vuelve el foco se monta otra vez con «preferred» (así el foco llega a él)
              keyExtractor={r => (r.key === target.key ? r.key + ':' + target.n : r.key)}
              initialNumToRender={8}
              windowSize={7}
              contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: px(100) }}
              extraData={target}
              renderItem={renderEvent}
            />
          ) : (
            <Message text={tab === 5 ? t('Todavía no terminó ningún evento hoy. Aquí aparecen los de hoy cuando terminan (se vacía a las 00:00).') : t('No hay partidos para mostrar.')} />
          )}
        </>
      )}
      {menu ? <MenuModal title={menu.title} sub={menu.sub} opts={menu.opts} onClose={() => setMenu(null)} /> : null}
      {typing !== null ? <InputModal title={t('Canal, equipo o evento')} initial={typing} onSubmit={findChans} onClose={() => setTyping(null)} /> : null}
      {note ? <ReadModal title={note.title} image="" text={note.text} onClose={() => setNote(null)} /> : null}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, paddingTop: px(145) },
    // con ancho y alto fijos (Vega dibuja las imágenes del paquete a su tamaño real si solo se estiran)
    bg: { position: 'absolute', left: 0, top: 0, width: px(1920), height: px(1080) },
    bgImg: { position: 'absolute', left: 0, top: 0, width: px(1920), height: px(1080) },
    bgShade: { position: 'absolute', left: 0, top: px(420), width: px(1920), height: px(660) },
    chips: { flexDirection: 'row', paddingHorizontal: SIDE, marginBottom: px(22) },
    sportBox: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      marginHorizontal: SIDE,
      marginBottom: px(20),
      paddingTop: px(14),
      paddingHorizontal: px(14),
      paddingBottom: px(4),
      borderRadius: px(12),
      backgroundColor: alpha(C.bg2, 0.55),
      borderWidth: px(1),
      borderColor: alpha(C.text, 0.14),
    },
    toast: { color: '#e87c03', fontSize: px(26), marginLeft: SIDE, marginBottom: px(10) },
  }),
);
