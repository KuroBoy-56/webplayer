// Pantalla principal: menú superior como Roku (Inicio, Series, Películas, TV en vivo, Deportes, Mi lista; a la derecha
// la lupa del buscador, el ícono del perfil y la hora) y la sección elegida. Atrás dentro de una sección sube al menú
// (a la sección actual); Atrás en el menú pregunta si salir («¿Salir de …?», «Puedes volver cuando quieras.»).
// Solo BackHandler: useKeplerBackHandler crea un segundo receptor del Atrás que, sin manejadores propios, cerraba la
// app con cada Atrás (aunque la pantalla ya lo hubiera atendido).
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Modal, StyleSheet, Text, View } from 'react-native';
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
];
// a la derecha, como íconos (igual que Roku)
const ICONS: [Section, any][] = [
  ['search', require('../../assets/image/ic_search.png')],
  ['account', require('../../assets/image/ic_user.png')],
];

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
const clock = () => {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};

export default function Main({ active }: { active: boolean }) {
  const st = useAppState();
  // tras cambiar el idioma se vuelve a Cuenta
  const [section, setSection] = useState<Section>(() => (langChanged() ? 'account' : 'home'));
  const [exitAsk, setExitAsk] = useState(false);
  // Atrás dentro de la sección: el menú se vuelve a montar con el foco en la sección actual
  const [menuRev, setMenuRev] = useState(0);
  // el foco está en el menú de arriba (se marca al enfocar un botón del menú y se quita al salir de él)
  const inMenu = useRef(false);
  const [now, setNow] = useState(clock);
  useBrandRev();
  // el distribuidor puede no tener deportes
  const menu = features().sports ? MENU : MENU.filter(m => m[0] !== 'sports');

  useEffect(() => {
    const id = setInterval(() => setNow(clock()), 20000);
    return () => clearInterval(id);
  }, []);

  // estado leído por referencia: el Atrás se registra una sola vez por activación (sin huecos entre registros)
  const exitRef = useRef(false);
  exitRef.current = exitAsk;
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (exitRef.current) {
        exitRef.current = false;
        setExitAsk(false);
        return true;
      }
      if (inMenu.current) {
        exitRef.current = true;
        setExitAsk(true);
      } else setMenuRev(r => r + 1);
      return true;
    });
    return () => sub.remove();
  }, [active]);

  const focusProps = (key: Section) => ({
    preferred: menuRev > 0 && key === section,
    onFocus: () => (inMenu.current = true),
    onBlur: () => (inMenu.current = false),
  });

  return (
    <View style={s.root}>
      <View style={s.content}>
        {section === 'home' || section === 'series' || section === 'movies' ? <Browse key={section} section={section} /> : null}
        {section === 'live' ? <Live active={active} /> : null}
        {section === 'sports' ? <Sports /> : null}
        {section === 'mylist' ? <MyList /> : null}
        {section === 'search' ? <Search /> : null}
        {section === 'account' ? <Account /> : null}
      </View>
      <View style={s.menu}>
        <Logo size={64} />
        <View style={s.items}>
          {menu.map(([key, label]) => (
            <Focusable key={key + ':' + menuRev} {...focusProps(key)} onPress={() => setSection(key)} style={f => [s.item, f && s.itemF]}>
              {f => (
                <>
                  <Text style={[s.itemText, key === section && s.itemOn, f && s.itemTextF]}>{t(label)}</Text>
                  {key === section && !f ? <View style={s.itemBar} /> : null}
                </>
              )}
            </Focusable>
          ))}
        </View>
        {st.loading ? <Text style={s.loading}>{t(st.loading === 'vod' ? 'Cargando películas…' : st.loading === 'series' ? 'Cargando series…' : 'Cargando canales…')}</Text> : null}
        {ICONS.map(([key, src]) => (
          <Focusable
            key={key + ':' + menuRev}
            {...focusProps(key)}
            onPress={() => setSection(key)}
            style={f => [s.icon, key === 'account' ? s.iconUser : key === section && s.iconOn, f && (key === 'account' ? s.iconUserF : s.iconF)]}>
            {f => <Image source={src} style={[s.iconImg, { tintColor: f && key !== 'account' ? C.onFocus : key === 'account' ? C.onAccent : '#fff' }]} resizeMode="contain" />}
          </Focusable>
        ))}
        <Text style={s.clock}>{now}</Text>
      </View>
      <Modal visible={exitAsk} transparent animationType="fade" onRequestClose={() => setExitAsk(false)}>
        <View style={s.dlgBack}>
          <View style={s.dlg}>
            <Text style={s.dlgTitle}>{t('¿Salir de {x}?', { x: brandName() })}</Text>
            <Text style={s.dlgText}>{t('Puedes volver cuando quieras.')}</Text>
            <View style={s.dlgBtns}>
              <Button label={t('Salir')} primary onPress={() => BackHandler.exitApp()} />
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
    root: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' },
    content: { flex: 1, overflow: 'hidden' },
    menu: { position: 'absolute', left: 0, top: 0, right: 0, height: px(110), zIndex: 100, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, backgroundColor: alpha(C.bg, 0.7) },
    items: { flexDirection: 'row', marginLeft: px(40), flex: 1 },
    item: { paddingHorizontal: px(20), height: px(56), justifyContent: 'center', alignItems: 'center', borderRadius: px(28), marginRight: px(4) },
    itemF: { backgroundColor: C.focus },
    itemText: { color: C.sub, fontSize: px(28) },
    itemOn: { color: C.text, fontWeight: '800' },
    itemTextF: { color: C.onFocus },
    icon: { width: px(60), height: px(60), borderRadius: px(30), justifyContent: 'center', alignItems: 'center', marginLeft: px(16) },
    iconOn: { backgroundColor: 'rgba(255,255,255,0.2)' },
    iconF: { backgroundColor: C.focus },
    iconUser: { backgroundColor: C.red },
    iconUserF: { backgroundColor: C.red, transform: [{ scale: 1.15 }], borderWidth: px(3), borderColor: C.focus },
    iconImg: { width: px(36), height: px(36) },
    clock: { color: C.text, fontSize: px(28), marginLeft: px(28), minWidth: px(80), textAlign: 'right' },
    itemBar: { position: 'absolute', left: px(20), right: px(20), bottom: px(4), height: px(4), borderRadius: px(2), backgroundColor: C.red },
    loading: { color: C.sub, fontSize: px(22) },
    dlgBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
    dlg: { backgroundColor: C.bg2, borderRadius: px(12), padding: px(50), width: px(760) },
    dlgTitle: { color: C.text, fontSize: px(38), fontWeight: '800', marginBottom: px(14) },
    dlgText: { color: C.sub, fontSize: px(28), marginBottom: px(30) },
    dlgBtns: { flexDirection: 'row' },
  }),
);
