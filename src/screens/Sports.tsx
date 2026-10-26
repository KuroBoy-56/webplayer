// Deportes (igual que Roku): Hoy / Mañana con el canal encontrado automáticamente y, si el panel los ofrece,
// Tablas, Selecciones y Equipos. La agenda guardada sale al instante y la del panel la reemplaza al llegar; las
// tablas y los partidos se piden ya por detrás. Orden: en vivo, después por hora y al final los terminados. El
// canal de cada partido: el que lo transmite (TheSportsDB) si el cliente lo tiene, el de la guía del panel o el de
// los equipos; con «Solo los canales del servidor IPTV» (panel) solo se nombran los que el cliente tiene.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { openItem } from '../actions';
import { Chip, EventRow, EvRow, InputModal, MenuModal, MenuOpt } from '../components/SportsUi';
import { Message, Spinner } from '../components/ui';
import { Item } from '../data/catalog';
import { matchSports, panelToday, SportMatch, SportsData } from '../data/sports';
import { Ev, fetchSports, fetchTables, Fixtures, League, liveById, loadFixtures, localSports, localTables, searchChannels, sportsEpg } from '../data/sportsPanel';
import { int, nowSec, str } from '../lib/util';
import { useNav } from '../nav';
import { useAppState } from '../state';
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

// 0 Hoy, 1 Mañana, 2 Tablas, 3 Equipos, 4 Selecciones
type Tab = 0 | 1 | 2 | 3 | 4;

export default function Sports() {
  const nav = useNav();
  const st = useAppState();
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
    if (!data || !st.loaded.live) return null;
    const now = nowSec();
    const today = panelToday(data, now);
    const events = (data.events as Ev[]).filter(e => {
      const d = e.dy - today;
      return e.s > 0 && (d === 0 || d === 1 || (e.s <= now && now < e.s + minutes(str(e.sp)) * 60));
    });
    return matchSports({ ...data, events });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, st.loaded.live, st.catalogRev]);

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
      const tvBest = m.tv.find(x => x.ch)?.ch || null;
      return { ...m, epg, best: tvBest || epg[0] || m.teams };
    },
    [found, extra, epgMap],
  );

  // los partidos de Equipos / Selecciones también buscan su canal (mismas reglas)
  const matchMore = useCallback(
    (events: Ev[]) => {
      if (!data || !st.loaded.live) return;
      const want = events.filter(e => !found?.map[str(e.id)] && !extra[str(e.id)]);
      if (!want.length) return;
      const r = matchSports({ ...data, events: want });
      setExtra(x => ({ ...x, ...r.map }));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, st.loaded.live, found, extra],
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
      if (!st.loaded.live || !found) chan = t('Buscando…');
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
    [data, resolve, fx, iptv, st.loaded.live, found],
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

  const playable = (e: Ev) => {
    const now = nowSec();
    const ending = e.s + minutes(str(e.sp)) * 60;
    if (e.pp === true) return say(t('El evento está aplazado')), false;
    if (isFinal(str(e.st)) || (e.s && now >= ending)) return say(t('Este evento ya terminó')), false;
    if (e.s && e.dy !== panelToday(data, now) && !(e.s <= now && now < ending)) return say(t('El evento aún no está en línea')), false;
    return true;
  };

  // menú del partido: el automático, los canales que lo transmiten, los de la guía y los equipos (en verde los que
  // tiene el cliente), buscar por el nombre de cada equipo y escribir otro nombre
  const open = (e: Ev) => {
    if (!playable(e)) return;
    if (!found) return say(t('Buscando los canales, un momento…'));
    const m = resolve(e);
    const opts: MenuOpt[] = [
      {
        title: '▶  ' + t('Ver el evento (canal automático)'),
        sub: m?.best ? m.best.name : t('Busca el mejor canal automáticamente'),
        green: !!m?.best,
        onPress: () => (setMenu(null), m?.best ? openItem(nav, m.best) : folder(t('Aún no aparece el canal exacto; '))),
      },
    ];
    const seen = new Set<string>();
    for (const tv of m?.tv || []) {
      if (tv.ch && seen.has(tv.ch.id)) continue;
      if (iptv && !tv.ch) continue;
      if (tv.ch) seen.add(tv.ch.id);
      opts.push({
        title: iptv && tv.ch ? tv.ch.name : tv.n + (tv.c ? ' (' + tv.c + ')' : ''),
        sub: tv.ch ? t('en tu lista: {x}', { x: tv.ch.name }) : t('no está en tu lista: se busca el evento'),
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
    setMenu({ title: str(e.h) && str(e.a) ? (str(e.hn) || str(e.h)) + ' vs ' + (str(e.an) || str(e.a)) : str(e.ev), sub: t('¿Dónde quieres verlo?'), opts });
  };

  const sportKeys = useMemo(() => {
    const keys: string[] = [];
    for (const e of data?.events || []) if (str(e.sp) && !keys.includes(str(e.sp))) keys.push(str(e.sp));
    return keys;
  }, [data]);

  // orden: en vivo, después los que vienen por hora y al final los terminados (y aplazados)
  const rows = useMemo(() => {
    if (!data || tab > 1) return [];
    const now = nowSec();
    const today = panelToday(data, now);
    const liveL: EvRow[] = [];
    const nextL: EvRow[] = [];
    const doneL: EvRow[] = [];
    const evs = (data.events as Ev[]).filter(e => e.s > 0 && (!sport || str(e.sp) === sport)).sort((a, b) => a.s - b.s);
    for (const e of evs) {
      const ending = e.s + minutes(str(e.sp)) * 60;
      const live = e.s <= now && now < ending && !isFinal(str(e.st)) && e.pp !== true;
      const dayIdx = e.dy - today;
      if (!((tab === 0 && (dayIdx === 0 || live)) || (tab === 1 && dayIdx === 1))) continue;
      const r = rowOf(e, false);
      if (live) liveL.push(r);
      else if (isFinal(str(e.st)) || e.pp === true || now >= ending) doneL.push(r);
      else nextL.push(r);
    }
    return [...liveL, ...nextL, ...doneL];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, tab, sport, rowOf]);

  if (!data) return err ? <Message text={err} /> : <Spinner label={t('Cargando la agenda deportiva…')} />;

  const tabs: { id: Tab; label: string }[] = [
    { id: 0, label: t('Hoy') },
    { id: 1, label: t('Mañana') },
    ...(tablesOn ? [{ id: 2 as Tab, label: t('Tablas') }] : []),
    ...(natOn ? [{ id: 4 as Tab, label: t('Selecciones') }] : []),
    ...(fixOn ? [{ id: 3 as Tab, label: t('Equipos') }] : []),
  ];

  return (
    <View style={s.root}>
      <View style={s.chips}>
        {tabs.map((x, i) => (
          <Chip key={x.id} label={x.label} on={tab === x.id} preferred={i === 0} onPress={() => (setTab(x.id), setSport(''))} />
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
          <FlatList
            horizontal
            style={s.sports}
            data={['', ...sportKeys]}
            keyExtractor={k => k || 'all'}
            contentContainerStyle={{ paddingHorizontal: SIDE, paddingVertical: px(6), alignItems: 'center' }}
            renderItem={({ item: k }) => <Chip label={k ? label(k) : t('Todos')} on={sport === k} onPress={() => setSport(k)} />}
          />
          {rows.length ? (
            <FlatList
              // otro día u otra disciplina: la lista empieza arriba; si solo se actualizó, queda donde estaba
              key={tab + '|' + sport}
              data={rows}
              keyExtractor={r => r.key}
              initialNumToRender={8}
              windowSize={7}
              contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: px(100) }}
              renderItem={({ item: r }) => <EventRow r={r} onPress={() => open(r.e)} />}
            />
          ) : (
            <Message text={t('No hay partidos para mostrar.')} />
          )}
        </>
      )}
      {menu ? <MenuModal title={menu.title} sub={menu.sub} opts={menu.opts} onClose={() => setMenu(null)} /> : null}
      {typing !== null ? <InputModal title={t('Canal, equipo o evento')} initial={typing} onSubmit={findChans} onClose={() => setTyping(null)} /> : null}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, paddingTop: px(145) },
    chips: { flexDirection: 'row', paddingHorizontal: SIDE, marginBottom: px(22) },
    sports: { flexGrow: 0, height: px(76), minHeight: px(76), marginBottom: px(20) },
    toast: { color: '#e87c03', fontSize: px(26), marginLeft: SIDE, marginBottom: px(10) },
  }),
);
