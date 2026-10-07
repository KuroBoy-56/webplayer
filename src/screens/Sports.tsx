// Deportes: partidos de hoy y mañana con el canal encontrado automáticamente.
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { openItem } from '../actions';
import { Focusable, Message, Spinner } from '../components/ui';
import { Item } from '../data/catalog';
import { loadSports, matchSports, SportsData } from '../data/sports';
import { clock, int, localDay, nowSec, parseIso, str } from '../lib/util';
import { useNav } from '../nav';
import { useAppState } from '../state';
import { C, px, SIDE } from '../theme';

let cache: { data: SportsData; at: number } | null = null;

const isFinal = (st: string) => {
  const s = st.toLowerCase();
  return s === 'ft' || s === 'aet' || s === 'pen' || s.includes('finish') || s.includes('final') || s === 'ended';
};

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Focusable onPress={onPress} onFocus={onPress} style={f => [s.chip, on && s.chipOn, f && s.chipF]}>
      {f => <Text style={[s.chipText, f && { color: '#000' }]}>{label}</Text>}
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
      } else setErr('No se pudo cargar la agenda deportiva. Inténtalo más tarde.');
    });
  }, []);

  const map = useMemo<Record<string, Item> | null>(() => (data && st.loaded.live ? matchSports(data) : null), [data, st.loaded.live, st.catalogRev]);

  const label = (k: string) => str(data?.sports?.[k]?.label) || k;
  const minutes = (k: string) => int(data?.sports?.[k]?.minutes) || 120;

  const sportKeys = useMemo(() => {
    const keys: string[] = [];
    for (const e of data?.events || []) if (str(e.sp) && !keys.includes(str(e.sp))) keys.push(str(e.sp));
    return keys;
  }, [data]);

  const rows = useMemo(() => {
    if (!data) return [];
    const now = nowSec();
    const today = localDay(now);
    const out: any[] = [];
    for (const e of data.events) {
      const start = parseIso(str(e.ts));
      if (!start || (sport && str(e.sp) !== sport)) continue;
      const dayIdx = localDay(start) - today;
      const ending = start + minutes(str(e.sp)) * 60;
      const live = start <= now && now < ending && !isFinal(str(e.st)) && e.pp !== true;
      if (!((day === 0 && (dayIdx === 0 || live)) || (day === 1 && dayIdx === 1))) continue;
      let time = live ? 'EN VIVO' : clock(start);
      if (e.pp === true) time = 'Aplazado';
      if (isFinal(str(e.st)) || (now >= ending && str(e.hs))) time = 'Final';
      const score = str(e.hs) && str(e.as) && (live || time === 'Final') ? str(e.hs) + ' - ' + str(e.as) : 'vs';
      out.push({ e, start, time, live, score });
    }
    return out.sort((a, b) => Number(b.live) - Number(a.live) || a.start - b.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, day, sport]);

  if (!data) return err ? <Message text={err} /> : <Spinner label="Cargando la agenda deportiva…" />;

  return (
    <View style={s.root}>
      <View style={s.chips}>
        <Chip label="Hoy" on={day === 0} onPress={() => setDay(0)} />
        <Chip label="Mañana" on={day === 1} onPress={() => setDay(1)} />
      </View>
      <FlatList
        horizontal
        style={s.sports}
        data={['', ...sportKeys]}
        keyExtractor={k => k || 'all'}
        contentContainerStyle={{ paddingHorizontal: SIDE }}
        renderItem={({ item: k }) => <Chip label={k ? label(k) : 'Todos'} on={sport === k} onPress={() => setSport(k)} />}
      />
      {toast ? <Text style={s.toast}>{toast}</Text> : null}
      {rows.length ? (
        <FlatList
          data={rows}
          keyExtractor={r => str(r.e.id)}
          contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: px(100) }}
          renderItem={({ item: r }) => {
            const e = r.e;
            const ch = map ? map[str(e.id)] : undefined;
            const home = str(e.h) || str(e.ev);
            const away = str(e.a);
            return (
              <Focusable
                onPress={() => {
                  if (ch) openItem(nav, ch);
                  else {
                    setToast('No se encontró un canal para este partido');
                    setTimeout(() => setToast(''), 3000);
                  }
                }}
                style={f => [s.ev, f && s.evF]}>
                {f => (
                  <>
                    <Text style={[s.time, r.live && s.timeLive, f && !r.live && { color: '#000' }]}>{r.time}</Text>
                    <View style={s.mid}>
                      <Text style={[s.league, f && { color: '#555' }]} numberOfLines={1}>
                        {str(e.lg) || label(str(e.sp))}
                      </Text>
                      <View style={s.teams}>
                        {str(e.hb) ? <Image source={{ uri: str(e.hb) }} style={s.badge} /> : null}
                        <Text style={[s.team, f && { color: '#000' }]} numberOfLines={1}>
                          {home}
                        </Text>
                        {away ? <Text style={[s.score, f && { color: '#000' }]}>{r.score}</Text> : null}
                        {away ? (
                          <Text style={[s.team, f && { color: '#000' }]} numberOfLines={1}>
                            {away}
                          </Text>
                        ) : null}
                        {str(e.ab) ? <Image source={{ uri: str(e.ab) }} style={s.badge} /> : null}
                      </View>
                    </View>
                    <Text style={[s.chan, !ch && s.chanNone, f && { color: '#000' }]} numberOfLines={1}>
                      {map === null ? 'Buscando…' : ch ? '▶ ' + ch.name : 'Sin canal'}
                    </Text>
                  </>
                )}
              </Focusable>
            );
          }}
        />
      ) : (
        <Message text="No hay partidos para mostrar." />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, paddingTop: px(130) },
  chips: { flexDirection: 'row', paddingHorizontal: SIDE, marginBottom: px(14) },
  sports: { flexGrow: 0, marginBottom: px(20) },
  chip: { height: px(56), paddingHorizontal: px(28), borderRadius: px(28), justifyContent: 'center', marginRight: px(14), backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: px(3), borderColor: 'transparent' },
  chipOn: { borderColor: C.red },
  chipF: { backgroundColor: '#fff' },
  chipText: { color: '#fff', fontSize: px(26), fontWeight: '700' },
  toast: { color: '#e87c03', fontSize: px(26), marginLeft: SIDE, marginBottom: px(10) },
  ev: { height: px(110), flexDirection: 'row', alignItems: 'center', backgroundColor: C.bg2, borderRadius: px(8), marginBottom: px(10), paddingHorizontal: px(24) },
  evF: { backgroundColor: '#fff', transform: [{ scale: 1.02 }] },
  time: { color: '#fff', fontSize: px(28), fontWeight: '800', width: px(170) },
  timeLive: { color: C.red },
  mid: { flex: 1 },
  league: { color: C.sub, fontSize: px(22) },
  teams: { flexDirection: 'row', alignItems: 'center', marginTop: px(6) },
  badge: { width: px(42), height: px(42), marginHorizontal: px(10) },
  team: { color: '#fff', fontSize: px(30), fontWeight: '700', maxWidth: px(480) },
  score: { color: '#fff', fontSize: px(30), fontWeight: '800', marginHorizontal: px(20) },
  chan: { color: C.green, fontSize: px(24), fontWeight: '700', width: px(420), textAlign: 'right' },
  chanNone: { color: C.dim },
});
