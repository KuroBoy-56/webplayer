// Pantalla principal: menú superior (Inicio, Series, Películas, TV en vivo, Deportes, Mi lista,
// Buscar, Cuenta) y la sección elegida. Atrás vuelve a Inicio y, en Inicio, pregunta si salir.
import { useKeplerBackHandler } from '@amazon-devices/react-native-kepler';
import React, { useEffect, useState } from 'react';
import { BackHandler, Modal, StyleSheet, Text, View } from 'react-native';
import { Button, Focusable, Logo } from '../components/ui';
import { brandName, features, useBrandRev } from '../lib/tenant';
import { useAppState } from '../state';
import { C, px, SIDE, themed } from '../theme';
import Account from './Account';
import Browse from './Browse';
import Live from './Live';
import MyList from './MyList';
import Search from './Search';
import Sports from './Sports';

type Section = 'home' | 'series' | 'movies' | 'live' | 'sports' | 'mylist' | 'search' | 'account';

const MENU: [Section, string][] = [
  ['home', 'Inicio'],
  ['series', 'Series'],
  ['movies', 'Películas'],
  ['live', 'TV en vivo'],
  ['sports', 'Deportes'],
  ['mylist', 'Mi lista'],
  ['search', 'Buscar'],
  ['account', 'Cuenta'],
];

export default function Main({ active }: { active: boolean }) {
  const st = useAppState();
  const back = useKeplerBackHandler();
  const [section, setSection] = useState<Section>('home');
  const [exitAsk, setExitAsk] = useState(false);
  useBrandRev();
  // el distribuidor puede no tener deportes
  const menu = features().sports ? MENU : MENU.filter(m => m[0] !== 'sports');

  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (exitAsk) {
        setExitAsk(false);
        return true;
      }
      if (section !== 'home') setSection('home');
      else setExitAsk(true);
      return true;
    });
    return () => sub.remove();
  }, [active, section, exitAsk]);

  return (
    <View style={s.root}>
      <View style={s.content}>
        {section === 'home' || section === 'series' || section === 'movies' ? <Browse key={section} section={section} /> : null}
        {section === 'live' ? <Live /> : null}
        {section === 'sports' ? <Sports /> : null}
        {section === 'mylist' ? <MyList /> : null}
        {section === 'search' ? <Search /> : null}
        {section === 'account' ? <Account /> : null}
      </View>
      <View style={s.menu}>
        <Logo size={64} />
        <View style={s.items}>
          {menu.map(([key, label]) => (
            <Focusable key={key} onPress={() => setSection(key)} style={f => [s.item, f && s.itemF]}>
              {f => <Text style={[s.itemText, key === section && s.itemOn, f && s.itemTextF]}>{label}</Text>}
            </Focusable>
          ))}
        </View>
        {st.loading ? <Text style={s.loading}>Cargando {st.loading === 'vod' ? 'películas' : st.loading === 'series' ? 'series' : 'canales'}…</Text> : null}
      </View>
      <Modal visible={exitAsk} transparent animationType="fade" onRequestClose={() => setExitAsk(false)}>
        <View style={s.dlgBack}>
          <View style={s.dlg}>
            <Text style={s.dlgTitle}>¿Quieres salir de {brandName()}?</Text>
            <View style={s.dlgBtns}>
              <Button label="Salir" primary onPress={() => back.exitApp()} />
              <Button label="Cancelar" preferred onPress={() => setExitAsk(false)} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg },
    content: { flex: 1 },
    menu: { position: 'absolute', left: 0, top: 0, right: 0, height: px(110), flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, backgroundColor: 'rgba(0,0,0,0.6)' },
    items: { flexDirection: 'row', marginLeft: px(40), flex: 1 },
    item: { paddingHorizontal: px(20), height: px(56), justifyContent: 'center', borderRadius: px(28), marginRight: px(4) },
    itemF: { backgroundColor: '#fff' },
    itemText: { color: '#e5e5e5', fontSize: px(28) },
    itemOn: { color: '#fff', fontWeight: '800' },
    itemTextF: { color: '#000' },
    loading: { color: C.sub, fontSize: px(22) },
    dlgBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
    dlg: { backgroundColor: C.bg2, borderRadius: px(12), padding: px(50), width: px(760) },
    dlgTitle: { color: '#fff', fontSize: px(38), fontWeight: '800', marginBottom: px(30) },
    dlgBtns: { flexDirection: 'row' },
  }),
);
