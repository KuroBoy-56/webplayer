// Deportes › Tablas (igual que Roku): las ligas y copas que eligió el dueño o el distribuidor en el panel. Arriba la
// región (Todas, Copas, Selecciones, Europa, América, Resto del mundo) y la división (1.ª por defecto, las que el
// panel habilitó y al final «Liga femenina»); a la izquierda las ligas y a la derecha la tabla de la enfocada
// (posición, escudo, PJ G E P GF GC DG PTS, racha y color de la zona con su leyenda). OK sobre un equipo abre su
// ficha. Las tablas salen del JSON del panel guardado en el equipo: cambiar de liga es instantáneo.
import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, View } from 'react-native';
import { Chip, ReadModal, TeamCard } from '../components/SportsUi';
import { Focusable, Message, Spinner } from '../components/ui';
import { fetchTeam, League } from '../data/sportsPanel';
import { t } from '../lib/i18n';
import { int, str } from '../lib/util';
import { alpha, C, px, SIDE, themed } from '../theme';

const REGIONS = ['intl', 'nat', 'eu', 'am', 'world'];
const WOMEN = 10;

// América junta Latinoamérica, Norteamérica y Suramérica (los paneles anteriores las mandaban aparte)
export function regionOf(lg: League): string {
  const k = str(lg.rg);
  if (k === 'latam' || k === 'na' || k === 'sa' || k === 'us' || k === 'am') return 'am';
  return k === 'intl' || k === 'nat' || k === 'eu' ? k : 'world';
}

function regionLabel(k: string): string {
  if (k === 'intl') return t('Copas');
  if (k === 'nat') return t('Selecciones');
  if (k === 'eu') return t('Europa');
  if (k === 'am') return t('América');
  return t('Resto del mundo');
}

// las femeninas van juntas en «Liga femenina»; las copas con la primera
const divisionOf = (lg: League) => (int(lg.w) === 1 ? WOMEN : Math.max(1, int(lg.d)));

const tiny = (u: string) => (u && u.includes('thesportsdb.com/') && !u.endsWith('/tiny') ? u + '/tiny' : u);
const ZONES: Record<string, [string, string]> = {
  p: ['#2EB85C', 'Clasificación'],
  s: ['#2F80ED', 'Otra copa o ascenso'],
  o: ['#F2994A', 'Repechaje'],
  r: ['#E53935', 'Descenso'],
};
const FORM: Record<string, string> = { W: '#2EB85C', D: '#808080', L: '#E53935' };

type TRow = { kind: 'group'; key: string; title: string } | { kind: 'row'; key: string; r: any };

export default function SportsTables({ leagues, loading, partial, failed }: { leagues: League[] | null; loading: boolean; partial: boolean; failed: boolean }) {
  const [region, setRegion] = useState('');
  const [division, setDivision] = useState(1);
  const [focused, setFocused] = useState(0);
  const [card, setCard] = useState<{ title: string; image: string; text: string; full: string } | null>(null);
  const [read, setRead] = useState(false);
  const busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const all = leagues || [];
  const regions = useMemo(() => {
    const have = new Set(all.map(regionOf));
    const keys = REGIONS.filter(k => have.has(k));
    return keys.length > 1 ? ['', ...keys] : [''];
  }, [all]);
  const divisions = useMemo(() => {
    const have = new Set(all.map(divisionOf));
    const out: number[] = [];
    for (let d = 1; d <= WOMEN; d++) if (have.has(d)) out.push(d);
    return out;
  }, [all]);
  const div = divisions.length < 2 ? 0 : divisions.includes(division) ? division : divisions[0];
  const list = useMemo(() => all.filter(lg => (!region || regionOf(lg) === region) && (!div || divisionOf(lg) === div)), [all, region, div]);
  const league: League | undefined = list[Math.min(focused, Math.max(0, list.length - 1))];

  const rows = useMemo<TRow[]>(() => {
    const out: TRow[] = [];
    const groups = Array.isArray(league?.g) ? league!.g : [];
    groups.forEach((g, gi) => {
      if (groups.length > 1 || str(g.n)) out.push({ kind: 'group', key: 'g' + gi, title: str(g.n) });
      (Array.isArray(g.r) ? g.r : []).forEach((r, ri) => out.push({ kind: 'row', key: gi + '-' + ri, r }));
    });
    return out;
  }, [league]);
  const zones = useMemo(() => Object.keys(ZONES).filter(z => rows.some(x => x.kind === 'row' && str(x.r.z) === z)), [rows]);

  // al bajar rápido por las ligas la tabla se arma cuando el foco se detiene
  const focusLeague = (i: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFocused(i), 120);
  };

  const openTeam = async (r: any) => {
    const id = str(r.id);
    if (!id || busy.current) return;
    busy.current = true;
    const j = await fetchTeam(id);
    busy.current = false;
    if (!j) return;
    const facts: string[] = [];
    const place = [str(j.loc), str(j.c)].filter(Boolean).join(', ');
    if (str(j.y)) facts.push(t('Fundado en {x}', { x: str(j.y) }) + (place ? ' · ' + place : ''));
    else if (place) facts.push(place);
    if (str(j.st)) facts.push(t('Estadio: {x}', { x: str(j.st) }) + (int(j.cap) > 0 ? ' (' + str(j.cap) + ')' : ''));
    if (str(j.lg)) facts.push(t('Liga: {x}', { x: str(j.lg) }));
    const hon: any[] = Array.isArray(j.hon) ? j.hon : [];
    const total = hon.reduce((a, x) => a + int(x.n), 0);
    const named = hon.map(x => str(x.t) + ' ×' + str(x.n));
    const desc = str(j.d);
    let short = desc;
    if (desc.length > 260) {
      const cut = desc.slice(0, 260);
      const sp = cut.lastIndexOf(' ');
      short = (sp > 200 ? cut.slice(0, sp) : cut) + '…';
    }
    const summary = [...facts, ...(total ? [t('Títulos ({n}): {x}', { n: total, x: named.slice(0, 5).join(' · ') })] : []), ...(short ? ['', short] : [])];
    const full = [...facts, ...(total ? ['', t('Títulos ({n}):', { n: total }), ...named.map(x => '  • ' + x)] : []), ...(desc ? ['', desc] : [])];
    const b = str(j.b);
    setCard({ title: str(j.n), image: b && b.includes('thesportsdb.com/') && !b.endsWith('/small') ? b + '/small' : b, text: summary.join('\n'), full: full.join('\n') });
  };

  if (!leagues || !leagues.length) {
    if (loading || partial) return <Spinner label={partial ? t('Preparando las tablas… aparecen en unos segundos.') : t('Cargando las tablas…')} />;
    return <Message text={failed ? t('No se pudieron cargar las tablas. Inténtalo más tarde.') : t('No hay tablas para mostrar.')} />;
  }

  return (
    <View style={s.root}>
      {regions.length > 1 ? (
        <FlatList
          horizontal
          style={s.chips}
          data={regions}
          keyExtractor={k => k || 'all'}
          contentContainerStyle={s.chipsIn}
          renderItem={({ item: k }) => <Chip label={k ? regionLabel(k) : t('Todas')} on={region === k} onPress={() => (setRegion(k), setFocused(0))} />}
        />
      ) : null}
      {divisions.length > 1 ? (
        <View style={[s.chipsIn, s.divs]}>
          {divisions.map(d => (
            <Chip key={d} label={d === WOMEN ? t('Liga femenina') : t('{n}.ª División', { n: d })} on={div === d} onPress={() => (setDivision(d), setFocused(0))} />
          ))}
        </View>
      ) : null}
      <View style={s.body}>
        <FlatList
          style={s.leagues}
          data={list}
          key={region + '|' + div}
          keyExtractor={lg => lg.id}
          initialNumToRender={10}
          renderItem={({ item: lg, index }) => (
            <Focusable onFocus={() => focusLeague(index)} onPress={() => setFocused(index)} style={f => [s.lg, index === focused && s.lgOn, f && s.lgF]}>
              {f => (
                <>
                  {lg.b ? <Image source={{ uri: tiny(lg.b) }} style={s.lgBadge} resizeMode="contain" /> : <View style={s.lgBadge} />}
                  <View style={{ flex: 1 }}>
                    <Text style={[s.lgName, f && { color: C.onFocus }]} numberOfLines={1}>
                      {lg.n}
                    </Text>
                    <Text style={[s.lgSub, f && { color: C.onFocus }]} numberOfLines={1}>
                      {[lg.c, lg.s].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                </>
              )}
            </Focusable>
          )}
        />
        <View style={s.table}>
          {league ? (
            <>
              <View style={s.head}>
                {league.b ? <Image source={{ uri: tiny(league.b) }} style={s.headBadge} resizeMode="contain" /> : null}
                <View>
                  <Text style={s.title} numberOfLines={1}>
                    {league.n}
                  </Text>
                  <Text style={s.sub} numberOfLines={1}>
                    {[league.c, league.sl, league.s].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </View>
              <StandingHead />
              <FlatList
                data={rows}
                key={league.id}
                keyExtractor={x => x.key}
                initialNumToRender={12}
                renderItem={({ item }) =>
                  item.kind === 'group' ? <Text style={s.group}>{item.title}</Text> : <StandingRow r={item.r} onPress={() => openTeam(item.r)} />
                }
              />
              {zones.length ? (
                <View style={s.legend}>
                  {zones.map(z => (
                    <View key={z} style={s.legendItem}>
                      <View style={[s.dot, { backgroundColor: ZONES[z][0] }]} />
                      <Text style={s.legendText}>{t(ZONES[z][1] as any)}</Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
          ) : (
            <Message text={t('No hay tablas para mostrar.')} />
          )}
        </View>
      </View>
      {card && !read ? <TeamCard title={card.title} image={card.image} text={card.text} onMore={() => setRead(true)} onClose={() => setCard(null)} /> : null}
      {card && read ? <ReadModal title={card.title} image={card.image} text={card.full} onClose={() => setRead(false)} /> : null}
    </View>
  );
}

const COLS = ['PJ', 'G', 'E', 'P', 'GF', 'GC', 'DG', 'PTS'] as const;

function StandingHead() {
  return (
    <View style={[s.row, s.rowHead]}>
      <Text style={[s.rank, s.headText]}>#</Text>
      <View style={s.badge} />
      <Text style={[s.team, s.headText]}>{t('Equipo')}</Text>
      {COLS.map(c => (
        <Text key={c} style={[s.col, s.headText]}>
          {t(c)}
        </Text>
      ))}
      <Text style={[s.form, s.headText]}>{t('Racha')}</Text>
    </View>
  );
}

const StandingRow = memo(function StandingRow({ r, onPress }: { r: any; onPress: () => void }) {
  const z = ZONES[str(r.z)];
  const vals = [r.p, r.w, r.d, r.l, r.gf, r.ga, r.gd, r.pts].map(v => str(v));
  if (int(r.gd) > 0) vals[6] = '+' + vals[6];
  return (
    <Focusable onPress={onPress} style={f => [s.row, f && s.rowF]}>
      {f => (
        <>
          <View style={[s.zone, z && { backgroundColor: z[0] }]} />
          <Text style={[s.rank, f && { color: C.onFocus }]}>{str(r.r)}</Text>
          {r.b ? <Image source={{ uri: tiny(str(r.b)) }} style={s.badge} resizeMode="contain" /> : <View style={s.badge} />}
          <Text style={[s.team, f && { color: C.onFocus }]} numberOfLines={1}>
            {str(r.t)}
          </Text>
          {vals.map((v, i) => (
            <Text key={i} style={[s.col, i === 7 && s.pts, f && { color: C.onFocus }]}>
              {v}
            </Text>
          ))}
          <View style={[s.form, s.formDots]}>
            {str(r.f)
              .split('')
              .map((x, i) => (
                <View key={i} style={[s.formDot, { backgroundColor: FORM[x] || '#555' }]} />
              ))}
          </View>
        </>
      )}
    </Focusable>
  );
});

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1 },
    chips: { flexGrow: 0, height: px(76), minHeight: px(76) },
    chipsIn: { paddingHorizontal: SIDE, paddingVertical: px(6), alignItems: 'center' },
    divs: { flexDirection: 'row', marginBottom: px(6) },
    body: { flex: 1, flexDirection: 'row', paddingLeft: SIDE, paddingTop: px(10) },
    leagues: { width: px(520), flexGrow: 0, marginRight: px(30) },
    lg: { flexDirection: 'row', alignItems: 'center', height: px(88), paddingHorizontal: px(16), borderRadius: px(8), marginBottom: px(8), backgroundColor: C.bg2 },
    lgOn: { borderLeftWidth: px(6), borderLeftColor: C.red },
    lgF: { backgroundColor: C.focus },
    lgBadge: { width: px(52), height: px(52), marginRight: px(16) },
    lgName: { color: C.text, fontSize: px(26), fontWeight: '700' },
    lgSub: { color: C.sub, fontSize: px(20), marginTop: px(2) },
    table: { flex: 1, paddingRight: SIDE },
    head: { flexDirection: 'row', alignItems: 'center', marginBottom: px(10) },
    headBadge: { width: px(64), height: px(64), marginRight: px(18) },
    title: { color: C.text, fontSize: px(34), fontWeight: '800' },
    sub: { color: C.sub, fontSize: px(22), marginTop: px(2) },
    row: { flexDirection: 'row', alignItems: 'center', height: px(58), borderRadius: px(6), marginBottom: px(4), backgroundColor: alpha(C.text, 0.05) },
    rowHead: { backgroundColor: 'transparent' },
    rowF: { backgroundColor: C.focus },
    zone: { width: px(6), height: '70%', marginRight: px(8), borderRadius: px(3) },
    rank: { width: px(50), color: '#E5E5E5', fontSize: px(24), fontWeight: '800', textAlign: 'center' },
    badge: { width: px(38), height: px(38), marginHorizontal: px(10) },
    team: { flex: 1, color: C.text, fontSize: px(24), fontWeight: '700' },
    col: { width: px(62), color: '#CFCFCF', fontSize: px(22), textAlign: 'center' },
    pts: { color: C.text, fontWeight: '800', width: px(76) },
    headText: { color: '#9A9A9A', fontWeight: '700', fontSize: px(20) },
    form: { width: px(150), textAlign: 'center' },
    formDots: { flexDirection: 'row', justifyContent: 'center' },
    formDot: { width: px(18), height: px(18), borderRadius: px(3), marginHorizontal: px(3) },
    group: { color: C.red, fontSize: px(24), fontWeight: '800', marginTop: px(10), marginBottom: px(6) },
    legend: { flexDirection: 'row', flexWrap: 'wrap', marginTop: px(10), marginBottom: px(20) },
    legendItem: { flexDirection: 'row', alignItems: 'center', marginRight: px(30) },
    dot: { width: px(16), height: px(16), borderRadius: px(3), marginRight: px(8) },
    legendText: { color: '#9A9A9A', fontSize: px(20) },
  }),
);
