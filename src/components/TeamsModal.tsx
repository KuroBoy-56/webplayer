// Cuenta › Equipos favoritos (solo con perfiles), como el celular: la lista de los elegidos (OK quita uno) y «Agregar
// equipo»: deporte → liga o selecciones → equipo, de los próximos partidos del panel (api/sports_fixtures.php). Se guardan
// en la nube (api/alerts.php set_teams): el celular de la misma línea y perfil avisa; en la TV se ven con la campanita.
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from './ui';
import { cloudAlerts, FavTeam, setTeams } from '../data/liveTv';
import { Fixtures, loadFixtures, localSports, localTables } from '../data/sportsPanel';
import { t } from '../lib/i18n';
import { C, px, themed } from '../theme';

type Row = { k: string; text: string; run: () => void };
// el nombre del deporte como lo da la agenda (en el idioma de la app); si no, el de TheSportsDB
const sportLabel = (sp: string) => String((localSports() as any)?.sports?.[sp]?.label || sp);

export default function TeamsModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0); // 0 lista, 1 deporte, 2 liga, 3 equipo
  const [sport, setSport] = useState('');
  const [league, setLeague] = useState('');
  const [teams, setList] = useState<FavTeam[]>([]);
  const [fx, setFx] = useState<Fixtures | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    cloudAlerts(true).then(c => setList(c?.teamList || []));
  }, []);
  useEffect(() => {
    if (step > 0 && !fx) loadFixtures(0, null).then(setFx);
  }, [step, fx]);
  const save = (list: FavTeam[]) =>
    setTeams(list).then(ok => {
      if (ok) setList(list);
      setErr(ok ? '' : t('No se pudo guardar. Inténtalo de nuevo.'));
    });
  const back = () => (step === 0 ? onClose() : setStep(step - 1));

  let title = t('Equipos favoritos');
  let rows: Row[] = [];
  if (step === 0) {
    rows = [{ k: 'add', text: t('+ Agregar equipo'), run: () => setStep(1) }, ...teams.map(x => ({ k: 'x' + x.n, text: '✕  ' + (x.l || x.n), run: () => save(teams.filter(y => y.n !== x.n)) }))];
  } else if (step === 1) {
    title = t('Elige el deporte');
    const sps = [...new Set(Object.values(fx?.leagues || {}).map((l: any) => String(l?.sp || '')).filter(Boolean))];
    rows = sps.map(sp => ({ k: sp, text: sportLabel(sp), run: () => (setSport(sp), setStep(2)) }));
  } else if (step === 2) {
    title = t('Elige la liga');
    const ls = Object.entries(fx?.leagues || {}).filter(([, l]: any) => String(l?.sp) === sport).sort((a: any, b: any) => String(a[1].n).localeCompare(String(b[1].n)));
    // primero las selecciones, después ligas y copas (como el celular)
    rows = [...ls.filter(([, l]: any) => l.rg === 'nat'), ...ls.filter(([, l]: any) => l.rg !== 'nat')].map(([id, l]: any) => ({
      k: id,
      text: (l.rg === 'nat' ? '🏳  ' : '') + String(l.n),
      run: () => (setLeague(id), setStep(3)),
    }));
  } else {
    title = t('Elige el equipo');
    rows = teamsOf(fx, league).map(x => ({
      k: x.n,
      text: x.l || x.n,
      run: () => {
        if (!teams.some(y => y.n === x.n)) save([...teams, x]);
        setStep(0);
      },
    }));
  }
  const empty = step > 0 && !fx ? t('Cargando…') : !rows.length ? t(step === 3 ? 'No hay equipos en esta liga.' : 'No hay partidos próximos para elegir equipos.') : '';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={back}>
      <View style={s.shade}>
        <View style={s.box}>
          <Text style={s.title}>{title}</Text>
          {step === 0 ? <Text style={s.note}>{t('Las notificaciones solo están disponibles en la app de celular (Android o iOS). Aquí se guardan en la nube y en la TV los ves con la campanita.')}</Text> : null}
          {err ? <Text style={s.err}>{err}</Text> : null}
          {empty ? <Text style={s.empty}>{empty}</Text> : null}
          <ScrollView style={s.list}>
            {rows.map((r, i) => (
              <View key={step + ':' + r.k} style={s.row}>
                <Button label={r.text} left last width={px(700)} preferred={i === 0} onPress={r.run} />
              </View>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** equipos de una liga: los de sus próximos partidos y los de su tabla (si el panel la tiene), como el celular */
function teamsOf(fx: Fixtures | null, league: string): FavTeam[] {
  const sp = String((fx?.leagues || {})[league]?.sp || '');
  const out = new Map<string, FavTeam>();
  for (const e of fx?.events || []) {
    if (String((e as any).l) !== league) continue;
    const ev = e as any;
    if (ev.h && !out.has(ev.h)) out.set(ev.h, { n: ev.h, l: ev.hn || '', b: ev.hb || '', lg: league, sp });
    if (ev.a && !out.has(ev.a)) out.set(ev.a, { n: ev.a, l: ev.an || '', b: ev.ab || '', lg: league, sp });
  }
  const tb = localTables(0)?.leagues?.find((l: any) => String(l.id) === league) as any;
  for (const g of tb?.g || []) for (const r of g?.r || []) if (r?.t && !out.has(r.t)) out.set(r.t, { n: r.t, l: '', b: r.b || '', lg: league, sp });
  return [...out.values()].sort((a, b) => (a.l || a.n).toLowerCase().localeCompare((b.l || b.n).toLowerCase()));
}

const s = themed(() =>
  StyleSheet.create({
    shade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
    box: { width: px(820), maxHeight: px(900), backgroundColor: C.bg2, borderRadius: px(12), padding: px(50) },
    title: { color: C.text, fontSize: px(44), fontWeight: '800', marginBottom: px(12) },
    note: { color: '#F5C518', fontSize: px(24), marginBottom: px(18) },
    err: { color: '#FF6B6B', fontSize: px(24), marginBottom: px(10) },
    empty: { color: C.sub, fontSize: px(28), marginVertical: px(20) },
    list: { maxHeight: px(620) },
    row: { marginBottom: px(12) },
  }),
);
