// Pantalla principal: menú superior (Inicio, Series, Películas, TV en vivo, Deportes, Mi lista,
// Buscar, Cuenta, Salir) y la sección elegida. Atrás vuelve a Inicio y, en Inicio, pregunta si salir
// (igual que Roku: «¿Salir de …?», «Puedes volver cuando quieras.», Salir / Cancelar).
import { useKeplerBackHandler } from '@amazon-devices/react-native-kepler';
import React, { useEffect, useState } from 'react';
import { BackHandler, Modal, StyleSheet, Text, View } from 'react-native';
import { Button, Focusable, Logo } from '../components/ui';
import { Key, langChanged, t } from '../lib/i18n';
import { brandName, features, useBrandRev } from '../lib/tenant';
import { useAppState } from '../state';
import { alpha, C, px, SIDE, themed } from '../theme';
import Account from './Account';
import Browse from './Browse';
import Live from './Live';
import MyList from './MyList';
import Search from './Search';
import Sports from './Sports';

type Section = 'home' | 'series' | 'movies' | 'live' | 'sports' | 'mylist' | 'search' | 'account';

// los nombres se traducen al dibujar el menú
const MENU: [Section, Key][] = [
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
  // tras cambiar el idioma se vuelve a Cuenta
  const [section, setSection] = useState<Section>(() => (langChanged() ? 'account' : 'home'));
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
              {f => (
                <>
                  <Text style={[s.itemText, key === section && s.itemOn, f && s.itemTextF]}>{t(label)}</Text>
                  {key === section && !f ? <View style={s.itemBar} /> : null}
                </>
              )}
            </Focusable>
          ))}
          <Focusable onPress={() => setExitAsk(true)} style={f => [s.item, f && s.itemF]}>
            {f => <Text style={[s.itemText, f && s.itemTextF]}>{t('Salir')}</Text>}
          </Focusable>
        </View>
        {st.loading ? <Text style={s.loading}>{t(st.loading === 'vod' ? 'Cargando películas…' : st.loading === 'series' ? 'Cargando series…' : 'Cargando canales…')}</Text> : null}
      </View>
      <Modal visible={exitAsk} transparent animationType="fade" onRequestClose={() => setExitAsk(false)}>
        <View style={s.dlgBack}>
          <View style={s.dlg}>
            <Text style={s.dlgTitle}>{t('¿Salir de {x}?', { x: brandName() })}</Text>
            <Text style={s.dlgText}>{t('Puedes volver cuando quieras.')}</Text>
            <View style={s.dlgBtns}>
              <Button label={t('Salir')} primary onPress={() => back.exitApp()} />
              <Button label={t('Cancelar')} preferred last onPress={() => setExitAsk(false)} />
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
    menu: { position: 'absolute', left: 0, top: 0, right: 0, height: px(110), flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, backgroundColor: alpha(C.bg, 0.7) },
    items: { flexDirection: 'row', marginLeft: px(40), flex: 1 },
    item: { paddingHorizontal: px(20), height: px(56), justifyContent: 'center', alignItems: 'center', borderRadius: px(28), marginRight: px(4) },
    itemF: { backgroundColor: C.focus },
    itemText: { color: C.sub, fontSize: px(28) },
    itemOn: { color: C.text, fontWeight: '800' },
    itemTextF: { color: C.onFocus },
    itemBar: { position: 'absolute', left: px(20), right: px(20), bottom: px(4), height: px(4), borderRadius: px(2), backgroundColor: C.red },
    loading: { color: C.sub, fontSize: px(22) },
    dlgBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
    dlg: { backgroundColor: C.bg2, borderRadius: px(12), padding: px(50), width: px(760) },
    dlgTitle: { color: C.text, fontSize: px(38), fontWeight: '800', marginBottom: px(14) },
    dlgText: { color: C.sub, fontSize: px(28), marginBottom: px(30) },
    dlgBtns: { flexDirection: 'row' },
  }),
);
