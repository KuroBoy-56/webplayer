// Deportes: partidos de hoy y mañana con el canal encontrado automáticamente.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, FlatList, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { openItem } from '../actions';
import { Focusable, Message, Spinner } from '../components/ui';
import { Item } from '../data/catalog';
import { evClock, evDay, loadSports, matchSports, panelToday, SportMatch, SportsData } from '../data/sports';
import { int, nowSec, parseIso, str } from '../lib/util';
import { useNav } from '../nav';
import { useAppState } from '../state';
import { t } from '../lib/i18n';
import { alpha, C, px, SIDE, themed } from '../theme';

let cache: { data: SportsData; at: number } | null = null;

// borrado de caché pedido por el panel
export function clearSportsCache(): void {
  cache = null;
}

const isFinal = (st: string) => {
  const s = st.toLowerCase();
  return s === 'ft' || s === 'aet' || s === 'pen' || s.includes('finish') || s.includes('final') || s === 'ended';
};

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Focusable onPress={onPress} onFocus={onPress} style={f => [s.chip, on && s.chipOn, f && s.chipF]}>
      {f => <Text style={[s.chipText, f && { color: C.onFocus }]}>{label}</Text>}
    </Focusable>
  );
}

export default function Sports() {
  const nav = useNav();
  const st = useAppState();
  const [data, setData] = useState<SportsData | null>(cache?.data || null);
  const [err, setErr] = useState('');
  const [day, setDay] = useState(0);
  const [sport, setSport] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    // la agenda se vuelve a pedir si pasaron más de 10 minutos
    if (cache && nowSec() - cache.at < 600) return;
    loadSports().then(d => {
      if (d) {
        cache = { data: d, at: nowSec() };
        setData(d);
      } else setErr(t('No se pudo cargar la agenda deportiva. Inténtalo más tarde.'));
    });
  }, []);

  const label = (k: string) => str(data?.sports?.[k]?.label) || k;
  const minutes = (k: string) => int(data?.sports?.[k]?.minutes) || 120;

  // solo los partidos que se pueden mostrar (en vivo, hoy y mañana)
  const found = useMemo<{ map: Record<string, SportMatch>; folder: Item | null } | null>(() => {
    if (!data || !st.loaded.live) return null;
    const now = nowSec();
    const today = panelToday(data, now);
    const events = data.events.filter(e => {
      const start = parseIso(str(e.ts));
      const d = evDay(e, start) - today;
      return start > 0 && (d === 0 || d === 1 || (start <= now && now < start + minutes(str(e.sp)) * 60));
    });
    return matchSports({ ...data, events });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, st.loaded.live, st.catalogRev]);
  const map = found ? found.map : null;

  // menú del partido: ver (automático), cada canal que lo transmite o buscar por equipos
  const [pick, setPick] = useState<any | null>(null);
  useEffect(() => {
    if (!pick) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setPick(null);
      return true;
    });
    return () => sub.remove();
  }, [pick]);
  // un solo temporizador: un aviso nuevo no se borra antes de tiempo por el anterior
  const sayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (sayTimer.current) clearTimeout(sayTimer.current);
  }, []);
  const say = (t: string) => {
    setToast(t);
    if (sayTimer.current) clearTimeout(sayTimer.current);
    sayTimer.current = setTimeout(() => setToast(''), 3500);
  };
  const playable = (e: any) => {
    const now = nowSec();
    const start = parseIso(str(e.ts));
    const ending = start + minutes(str(e.sp)) * 60;
    if (e.pp === true) return say(t('El evento está aplazado')), false;
    if (isFinal(str(e.st)) || (start && now >= ending)) return say(t('Este evento ya terminó')), false;
    if (start && evDay(e, start) !== panelToday(data, now) && !(start <= now && now < ending)) return say(t('El evento aún no está en línea')), false;
    return true;
  };
  const folder = (prefix: string) => {
    if (found?.folder) {
      say(prefix + t('te mostramos los eventos ({x})', { x: found.folder.name }));
      openItem(nav, found.folder);
    } else say(t('No encontramos un canal para este evento'));
  };
  const watch = (e: any, how: 'auto' | 'teams' | number) => {
    setPick(null);
    const m = map?.[str(e.id)];
    if (!m) return folder(t('Aún no aparece el canal exacto; '));
    if (how === 'auto') return m.best ? openItem(nav, m.best) : folder(t('Aún no aparece el canal exacto; '));
    if (how === 'teams') return m.teams ? openItem(nav, m.teams) : folder(t('No hay un canal con esos equipos; '));
    const tv = m.tv[how];
    if (tv?.ch) return openItem(nav, tv.ch);
    if (m.teams) {
      say(t('No tienes {x}; te mostramos {y}', { x: tv.n, y: m.teams.name }));
      return openItem(nav, m.teams);
    }
    folder(t('No tienes {x}; ', { x: tv.n }));
  };
  const open = (e: any) => {
    if (!playable(e)) return;
    if (!map) return say(t('Buscando los canales, un momento…'));
    const m = map[str(e.id)];
    if (m && m.tv.length) setPick(e);
    else watch(e, 'auto');
  };

  const sportKeys = useMemo(() => {
    const keys: string[] = [];
    for (const e of data?.events || []) if (str(e.sp) && !keys.includes(str(e.sp))) keys.push(str(e.sp));
    return keys;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const now = nowSec();
    const today = panelToday(data, now);
    const out: any[] = [];
    for (const e of data.events) {
      const start = parseIso(str(e.ts));
      if (!start || (sport && str(e.sp) !== sport)) continue;
      const dayIdx = evDay(e, start) - today;
      const ending = start + minutes(str(e.sp)) * 60;
      const live = start <= now && now < ending && !isFinal(str(e.st)) && e.pp !== true;
      if (!((day === 0 && (dayIdx === 0 || live)) || (day === 1 && dayIdx === 1))) continue;
      let time = live ? t('EN VIVO') : evClock(e, start);
      if (e.pp === true) time = t('Aplazado');
      const final = isFinal(str(e.st)) || (now >= ending && !!str(e.hs));
      if (final) time = t('Final');
      const score = str(e.hs) && str(e.as) && (live || final) ? str(e.hs) + ' - ' + str(e.as) : 'vs';
      out.push({ e, start, time, live, score });
    }
    return out.sort((a, b) => Number(b.live) - Number(a.live) || a.start - b.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, day, sport]);

  if (!data) return err ? <Message text={err} /> : <Spinner label={t('Cargando la agenda deportiva…')} />;

  return (
    <View style={s.root}>
      <View style={s.chips}>
        <Chip label={t('Hoy')} on={day === 0} onPress={() => setDay(0)} />
        <Chip label={t('Mañana')} on={day === 1} onPress={() => setDay(1)} />
      </View>
      <FlatList
        horizontal
        style={s.sports}
        data={['', ...sportKeys]}
        keyExtractor={k => k || 'all'}
        contentContainerStyle={{ paddingHorizontal: SIDE, paddingVertical: px(6), alignItems: 'center' }}
        renderItem={({ item: k }) => <Chip label={k ? label(k) : t('Todos')} on={sport === k} onPress={() => setSport(k)} />}
      />
      {toast ? <Text style={s.toast}>{toast}</Text> : null}
      {rows.length ? (
        <FlatList
          data={rows}
          keyExtractor={r => str(r.e.id)}
          contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: px(100) }}
          renderItem={({ item: r }) => {
            const e = r.e;
            const mm = map ? map[str(e.id)] : undefined;
            const ch = mm?.best || null;
            const tvList: any[] = Array.isArray(e.tv) ? e.tv : [];
            const tvText = tvList.length ? t('En TV:') + ' ' + tvList.slice(0, 4).map(x => str(x.n)).join(' · ') + (tvList.length > 4 ? '  +' + (tvList.length - 4) : '') : '';
            const home = str(e.h) || str(e.ev);
            const away = str(e.a);
            return (
              <Focusable
                onPress={() => open(e)}
                style={f => [s.ev, f && s.evF]}>
                {f => (
                  <>
                    <Text style={[s.time, r.live && s.timeLive, f && !r.live && { color: C.onFocus }]}>{r.time}</Text>
                    <View style={s.mid}>
                      <Text style={[s.league, f && { color: C.onFocus }]} numberOfLines={1}>
                        {str(e.lg) || label(str(e.sp))}
                      </Text>
                      <View style={s.teams}>
                        {str(e.hb) ? <Image source={{ uri: str(e.hb) }} style={s.badge} /> : null}
                        <Text style={[s.team, f && { color: C.onFocus }]} numberOfLines={1}>
                          {home}
                        </Text>
                        {away ? <Text style={[s.score, f && { color: C.onFocus }]}>{r.score}</Text> : null}
                        {away ? (
                          <Text style={[s.team, f && { color: C.onFocus }]} numberOfLines={1}>
                            {away}
                          </Text>
                        ) : null}
                        {str(e.ab) ? <Image source={{ uri: str(e.ab) }} style={s.badge} /> : null}
                      </View>
                      {tvText ? (
                        <Text style={[s.tv, f && { color: C.onFocus }]} numberOfLines={1}>
                          {tvText}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[s.chan, !ch && s.chanNone, f && { color: C.onFocus }]} numberOfLines={1}>
                      {map === null ? t('Buscando…') : ch ? '▶ ' + ch.name : t('Sin canal')}
                    </Text>
                  </>
                )}
              </Focusable>
            );
          }}
        />
      ) : (
        <Message text={t('No hay partidos para mostrar.')} />
      )}
      {pick ? (
        <View style={s.menuShade}>
          <View style={s.menu}>
            <Text style={s.menuTitle} numberOfLines={2}>
              {str(pick.h) && str(pick.a) ? str(pick.h) + ' vs ' + str(pick.a) : str(pick.ev)}
            </Text>
            <Text style={s.menuSub}>{t('¿Dónde quieres verlo?')}</Text>
            <ScrollView style={{ maxHeight: px(620) }}>
              <MenuRow title={'▶  ' + t('Ver el evento')} sub={t('Busca el mejor canal automáticamente')} first onPress={() => watch(pick, 'auto')} />
              {(map?.[str(pick.id)]?.tv || []).map((tv, i) => (
                <MenuRow key={i} title={tv.n} sub={(tv.c ? tv.c + ' · ' : '') + (tv.ch ? t('en tu lista: {x}', { x: tv.ch.name }) : t('no está en tu lista: se busca el evento'))} onPress={() => watch(pick, i)} />
              ))}
              <MenuRow title={t('Buscar por equipos')} sub={t('En las carpetas de eventos de tu lista')} onPress={() => watch(pick, 'teams')} />
            </ScrollView>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function MenuRow({ title, sub, first, onPress }: { title: string; sub: string; first?: boolean; onPress: () => void }) {
  return (
    <Focusable onPress={onPress} preferred={first} style={f => [s.menuRow, f && s.menuRowF]}>
      {f => (
        <>
          <Text style={[s.menuRowTitle, f && { color: C.onFocus }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[s.menuRowSub, f && { color: C.onFocus }]} numberOfLines={1}>
            {sub}
          </Text>
        </>
      )}
    </Focusable>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, paddingTop: px(145) },
    chips: { flexDirection: 'row', paddingHorizontal: SIDE, marginBottom: px(28) },
    sports: { flexGrow: 0, height: px(76), minHeight: px(76), marginBottom: px(24) },
    chip: { height: px(56), paddingHorizontal: px(28), borderRadius: px(28), justifyContent: 'center', marginRight: px(14), backgroundColor: alpha(C.text, 0.12), borderWidth: px(3), borderColor: 'transparent' },
    chipOn: { borderColor: C.red },
    chipF: { backgroundColor: C.focus },
    chipText: { color: C.text, fontSize: px(26), fontWeight: '700' },
    toast: { color: '#e87c03', fontSize: px(26), marginLeft: SIDE, marginBottom: px(10) },
    ev: { height: px(140), flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg2, borderRadius: px(8), marginBottom: px(10), paddingHorizontal: px(24) },
    evF: { backgroundColor: C.focus, transform: [{ scale: 1.02 }] },
    time: { color: C.text, fontSize: px(28), fontWeight: '800', width: px(170) },
    timeLive: { color: C.red },
    mid: { flex: 1 },
    league: { color: C.sub, fontSize: px(22) },
    teams: { flexDirection: 'row', alignItems: 'center', marginTop: px(6) },
    badge: { width: px(42), height: px(42), marginHorizontal: px(10) },
    team: { color: C.text, fontSize: px(30), fontWeight: '700', maxWidth: px(480) },
    score: { color: C.text, fontSize: px(30), fontWeight: '800', marginHorizontal: px(20) },
    chan: { color: C.green, fontSize: px(24), fontWeight: '700', width: px(420), textAlign: 'right' },
    chanNone: { color: C.dim },
    tv: { color: C.sub, fontSize: px(22), marginTop: px(6) },
    menuShade: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: alpha('#000000', 0.75), justifyContent: 'center', alignItems: 'center' },
    menu: { width: px(900), backgroundColor: C.bg2, borderRadius: px(14), padding: px(40) },
    menuTitle: { color: C.text, fontSize: px(36), fontWeight: '800' },
    menuSub: { color: C.sub, fontSize: px(24), marginTop: px(6), marginBottom: px(20) },
    menuRow: { paddingHorizontal: px(24), paddingVertical: px(16), borderRadius: px(8), marginBottom: px(10), backgroundColor: alpha(C.text, 0.1) },
    menuRowF: { backgroundColor: C.focus },
    menuRowTitle: { color: C.text, fontSize: px(28), fontWeight: '700' },
    menuRowSub: { color: C.sub, fontSize: px(22), marginTop: px(4) },
  }),
);
