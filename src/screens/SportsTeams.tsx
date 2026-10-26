// Deportes › Equipos y Selecciones (igual que Roku). Equipos: «Buscar equipo» y los últimos 5 buscados; los próximos
// partidos de un equipo (local o visitante, también en español: «Alemania» = «Germany») o de un país escrito
// completo («Panamá»: la selección y las ligas de ese país). Selecciones: los partidos de las selecciones
// nacionales, «Todas», cada competición y al final «Selección femenina». Del JSON de 21 días que prepara el panel
// (guardado en el equipo): buscar es instantáneo. Solo se abre lo que está en vivo.
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import { Chip, EventRow, EvRow, InputModal } from '../components/SportsUi';
import { Message, Spinner } from '../components/ui';
import { aliasMap, Ev, evEnd, Fixtures, nations, searchTeam } from '../data/sportsPanel';
import { t } from '../lib/i18n';
import { readJson, writeJson } from '../lib/storage';
import { nowSec } from '../lib/util';
import { px, SIDE, themed } from '../theme';

// lo último buscado se recuerda mientras la app está abierta
let lastQuery = '';
let lastComp = '';

const recent = (): string[] => {
  const r = readJson<string[]>('sp_team_recent');
  return Array.isArray(r) ? r.filter(x => typeof x === 'string') : [];
};

export default function SportsTeams({
  mode,
  fx,
  loading,
  match,
  minutes,
  rowOf,
  onOpen,
  onMatch,
  say,
}: {
  mode: 'teams' | 'nations';
  fx: Fixtures | null;
  loading: boolean;
  match: any;
  minutes: (sp: string) => number;
  rowOf: (e: Ev, withDate: boolean) => EvRow;
  onOpen: (e: Ev) => void;
  onMatch: (events: Ev[]) => void;
  say: (text: string) => void;
}) {
  const [query, setQuery] = useState(lastQuery);
  const [ask, setAsk] = useState(mode === 'teams' && !lastQuery);
  const [comp, setComp] = useState(lastComp);
  const [recents, setRecents] = useState(recent);
  const alias = useMemo(() => aliasMap(match), [match]);

  const search = (q: string) => {
    lastQuery = q;
    setQuery(q);
    const out = [q, ...recent().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 5);
    writeJson('sp_team_recent', out);
    setRecents(out);
  };

  const list = useMemo<Ev[]>(() => {
    if (!fx) return [];
    if (mode === 'teams') return query ? searchTeam(fx, query, alias, minutes) : [];
    return nations(fx, comp, minutes).list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, mode, query, comp, alias]);
  const nat = useMemo(() => (fx && mode === 'nations' ? nations(fx, '', minutes) : null), [fx, mode, minutes]);

  // canal de cada partido con las mismas reglas que la agenda (los primeros 60)
  useEffect(() => {
    if (list.length) onMatch(list.slice(0, 60));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);

  const rows = useMemo(() => list.map(e => rowOf(e, true)), [list, rowOf]);

  const open = (e: Ev) => {
    const now = nowSec();
    if (!(e.s > 0 && e.s <= now && now < evEnd(e, minutes) && e.pp !== true)) return say(t('El evento aún no está en línea'));
    onOpen(e);
  };

  const chips =
    mode === 'teams'
      ? [{ k: '?', label: t('Buscar equipo') }, ...recents.map(r => ({ k: r, label: r }))]
      : [{ k: '', label: t('Todas') }, ...(nat?.chips || []).map(c => ({ k: c.id, label: c.n })), ...(nat?.women ? [{ k: 'w', label: t('Selección femenina') }] : [])];
  const isOn = (k: string) => (mode === 'teams' ? k === query : k === comp);
  const pick = (k: string) => {
    if (mode === 'teams') {
      if (k === '?') setAsk(true);
      else search(k);
    } else {
      lastComp = k;
      setComp(k);
    }
  };

  let empty = '';
  if (!fx) empty = loading ? '' : t('No se pudieron cargar los partidos.');
  else if (mode === 'teams') empty = query ? t('No hay partidos de «{x}» en los próximos días.', { x: query }) : t('Escribe el nombre de un equipo para ver sus próximos partidos.');
  else empty = t('No hay partidos de selecciones en los próximos días.');

  return (
    <View style={s.root}>
      <FlatList
        horizontal
        style={s.chips}
        data={chips}
        keyExtractor={c => c.k || 'all'}
        contentContainerStyle={s.chipsIn}
        renderItem={({ item: c }) => <Chip label={c.label} on={isOn(c.k)} onPress={() => pick(c.k)} />}
      />
      {!fx && loading ? (
        <Spinner label={t('Cargando los partidos…')} />
      ) : rows.length ? (
        <FlatList
          data={rows}
          key={mode + '|' + query + '|' + comp}
          keyExtractor={r => r.key}
          initialNumToRender={8}
          contentContainerStyle={{ paddingHorizontal: SIDE, paddingBottom: px(100) }}
          renderItem={({ item: r }) => <EventRow r={r} onPress={() => open(r.e)} />}
        />
      ) : (
        <Message text={empty} />
      )}
      {ask ? <InputModal title={t('Nombre del equipo')} initial={query} onSubmit={search} onClose={() => setAsk(false)} /> : null}
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1 },
    chips: { flexGrow: 0, height: px(76), minHeight: px(76), marginBottom: px(16) },
    chipsIn: { paddingHorizontal: SIDE, paddingVertical: px(6), alignItems: 'center' },
  }),
);
