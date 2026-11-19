// Pantalla principal: menú superior como Roku (Inicio, Series, Películas, TV en vivo, Deportes, Mi lista; a la derecha
// la lupa del buscador, el ícono del perfil y la hora) y la sección elegida. Atrás dentro de una sección sube al menú
// (a la sección actual); Atrás en el menú pregunta si salir («¿Salir de …?», «Puedes volver cuando quieras.»).
// Solo BackHandler: useKeplerBackHandler crea un segundo receptor del Atrás que, sin manejadores propios, cerraba la
// app con cada Atrás (aunque la pantalla ya lo hubiera atendido).
import React, { memo, useEffect, useRef, useState } from 'react';
import { Animated, BackHandler, Image, Modal, Platform, StyleSheet, Text, View } from 'react-native';
import { Shade } from '../components/Shade';
import { Button, Focusable, Logo } from '../components/ui';
import { catalog } from '../data/catalog';
import { Key, langChanged, t } from '../lib/i18n';
import { brandName, features, useBrandRev } from '../lib/tenant';
import { useNav } from '../nav';
import { profilesNeeded, setMenuHidden, useAppSelector } from '../state';
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

// Inicio, Series y Películas: el menú va encima del destacado, sin franja (solo un degradado suave) y se esconde
// mientras se recorren las filas, como Android TV; en las demás secciones va sobre el fondo de la app
const OVERLAY: Section[] = ['home', 'series', 'movies'];
const WEB = Platform.OS === 'web';
const MENU_H = 110;

const pad2 = (n: number) => (n < 10 ? '0' : '') + n;
const clock = () => {
  const d = new Date();
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
};

// El reloj y el foco del menú no deben volver a dibujar toda la sección.
const SectionContent = memo(function SectionContent({ section, active, back }: { section: Section; active: boolean; back: number }) {
  useBrandRev();
  if (section === 'home' || section === 'series' || section === 'movies') return <Browse key={section} section={section} active={active} />;
  if (section === 'live') return <Live active={active} />;
  if (section === 'sports') return <Sports active={active} back={back} />;
  if (section === 'mylist') return <MyList />;
  if (section === 'search') return <Search active={active} />;
  return <Account />;
});

export default function Main({ active }: { active: boolean }) {
  const nav = useNav();
  const loading = useAppSelector(st => st.loading);
  // perfiles (barra con el avatar a la izquierda, el menú al centro y el logo a la derecha)
  const profile = useAppSelector(st => st.profile);
  const withProfiles = useAppSelector(st => !!st.profile && profilesNeeded());
  const liveLoaded = useAppSelector(st => st.loaded.live);
  useAppSelector(st => st.catalogRev);
  const [profMenu, setProfMenu] = useState(false);
  // primero se cierra el menú del avatar y después se abre la pantalla de perfiles: mientras se cierra, la ventana se
  // queda con el foco y la pantalla nueva no podía poner el suyo (quedaba en «Salir»)
  const fromMenu = (manage: boolean) => {
    setProfMenu(false);
    setTimeout(() => nav.push({ name: 'profiles', from: 'menu', manage }), 350);
  };
  // la línea elige perfil y todavía no lo eligió (p. ej. al volver del distribuidor): primero «¿Quién está viendo?»
  useEffect(() => {
    if (active && profilesNeeded() && !profile) nav.reset({ name: 'profiles', from: 'start' });
  }, [active, profile, nav]);
  // tras cambiar el idioma se vuelve a Cuenta
  const [section, setSection] = useState<Section>(() => (langChanged() ? 'account' : 'home'));
  const [exitAsk, setExitAsk] = useState(false);
  // Atrás dentro de la sección: el menú se vuelve a montar con el foco en la sección actual
  const [menuRev, setMenuRev] = useState(0);
  // el foco está en el menú de arriba (se marca al enfocar un botón del menú y se quita al salir de él)
  const inMenu = useRef(false);
  const [now, setNow] = useState(clock);
  useBrandRev();
  // el distribuidor puede no tener deportes; el perfil infantil nunca los tiene, ni TV en vivo sin canales de niños
  const kids = !!profile?.kids;
  const noLive = kids && liveLoaded && catalog.visibleCats('live').length === 0;
  const menu = MENU.filter(m => !(m[0] === 'sports' && (!features().sports || kids)) && !(m[0] === 'live' && noLive));
  useEffect(() => {
    if ((section === 'sports' && kids) || (section === 'live' && noLive)) setSection('home');
  }, [section, kids, noLive]);

  // menú escondido mientras se recorren las filas (Browse lo marca); en las demás secciones siempre se ve
  // todo lo nuevo de la barra (sin franja, escondida al bajar) solo con los perfiles encendidos por el dueño en el panel;
  // apagados, la barra de siempre
  const profilesOn = useAppSelector(st => !!st.profiles?.enabled);
  const overlay = profilesOn && OVERLAY.includes(section);
  const hiddenState = useAppSelector(st => st.menuHidden);
  const hidden = overlay && hiddenState && active;
  useEffect(() => {
    if (!overlay) setMenuHidden(false);
  }, [overlay]);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!WEB) Animated.timing(anim, { toValue: hidden ? 1 : 0, duration: 260, useNativeDriver: true }).start();
  }, [hidden, anim]);
  const menuMove: any = WEB
    ? { transform: [{ translateY: hidden ? -px(MENU_H + 20) : 0 }], opacity: hidden ? 0 : 1, transitionProperty: 'transform, opacity', transitionDuration: '260ms' }
    : { transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -px(MENU_H + 20)] }) }], opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) };

  useEffect(() => {
    if (!active) return;
    setNow(clock());
    const id = setInterval(() => setNow(clock()), 20000);
    return () => clearInterval(id);
  }, [active]);

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
      } else {
        // el menú estaba escondido entre las filas: vuelve a verse con el foco en la sección
        setMenuHidden(false);
        setMenuRev(r => r + 1);
      }
      return true;
    });
    return () => sub.remove();
  }, [active]);

  const focusProps = (key: Section) => ({
    preferred: menuRev > 0 && key === section,
    onFocus: () => {
      inMenu.current = true;
      setMenuHidden(false);
    },
    onBlur: () => (inMenu.current = false),
  });
  const searchIcon = ICONS[0];
  const iconBtn = ([key, src]: [Section, any]) => (
    <Focusable
      key={key + ':' + menuRev}
      {...focusProps(key)}
      onPress={() => setSection(key)}
      style={f => [s.icon, key === 'account' ? s.iconUser : key === section && s.iconOn, f && (key === 'account' ? s.iconUserF : s.iconF)]}>
      {f => <Image source={src} style={[s.iconImg, { tintColor: f && key !== 'account' ? C.onFocus : key === 'account' ? C.onAccent : '#fff' }]} resizeMode="contain" />}
    </Focusable>
  );

  return (
    <View style={s.root}>
      <View style={s.content}>
        <SectionContent section={section} active={active} back={menuRev} />
      </View>
      <Animated.View testID="topbar" style={[s.menu, !profilesOn ? s.menuClassic : overlay ? s.menuOver : s.menuSolid, menuMove]} pointerEvents={hidden ? 'none' : 'auto'}>
        {overlay ? (
          <View style={s.menuShade} pointerEvents="none">
            <Shade side="top" style={StyleSheet.absoluteFill as any} />
          </View>
        ) : null}
        {withProfiles && profile ? (
          <Focusable key={'pf:' + menuRev} {...focusProps('account')} preferred={false} onPress={() => setProfMenu(true)} style={f => [s.pf, f && s.pfF]}>
            <Image source={{ uri: profile.avatar }} style={s.pfImg} />
          </Focusable>
        ) : (
          <Logo size={64} />
        )}
        <View style={[s.items, withProfiles && s.itemsCenter]}>
          {menu.map(([key, label]) => (
            <Focusable key={key + ':' + menuRev} {...focusProps(key)} onPress={() => setSection(key)} style={f => [s.item, f && s.itemF]}>
              {f => (
                <>
                  <Text style={[s.itemText, overlay && s.txtShadow, key === section && s.itemOn, f && s.itemTextF]}>{t(label)}</Text>
                  {key === section && !f ? <View style={s.itemBar} /> : null}
                </>
              )}
            </Focusable>
          ))}
          {withProfiles ? iconBtn(searchIcon) : null}
        </View>
        {loading ? <Text style={s.loading}>{t(loading === 'vod' ? 'Cargando películas…' : loading === 'series' ? 'Cargando series…' : 'Cargando canales…')}</Text> : null}
        {withProfiles ? null : ICONS.map(iconBtn)}
        <Text style={[s.clock, overlay && s.txtShadow]}>{now}</Text>
        {withProfiles ? (
          <View style={s.logoRight}>
            <Logo size={64} />
          </View>
        ) : null}
      </Animated.View>
      <Modal visible={profMenu} transparent animationType="fade" onRequestClose={() => setProfMenu(false)}>
        <View style={s.pmBack}>
          <View style={s.pm}>
            {profile ? <Text style={s.pmName} numberOfLines={1}>{profile.name}</Text> : null}
            <View style={s.pmItem}>
              <Button label={t('Cambiar perfil')} left width={px(460)} preferred last onPress={() => fromMenu(false)} />
            </View>
            <View style={s.pmItem}>
              <Button label={t('Administrar perfiles')} left width={px(460)} last onPress={() => fromMenu(true)} />
            </View>
            <View style={s.pmItem}>
              <Button label={t('Cuenta')} left width={px(460)} last onPress={() => { setProfMenu(false); setSection('account'); }} />
            </View>
          </View>
        </View>
      </Modal>
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
    root: { flex: 1, backgroundColor: C.bg },
    content: { flex: 1 },
    menu: { position: 'absolute', left: 0, top: 0, right: 0, height: px(MENU_H), zIndex: 100, flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE },
    // sin franja: encima del destacado solo un degradado suave detrás de las letras (como Android TV)
    menuOver: { backgroundColor: 'transparent' },
    // perfiles apagados: la barra de siempre (franja translúcida)
    menuClassic: { backgroundColor: alpha(C.bg, 0.7) },
    txtShadow: { textShadowColor: 'rgba(0,0,0,0.7)', textShadowRadius: px(6) },
    menuSolid: { backgroundColor: C.bg },
    menuShade: { position: 'absolute', left: 0, right: 0, top: 0, height: px(MENU_H + 60), opacity: 0.85 },
    items: { flexDirection: 'row', marginLeft: px(40), flex: 1 },
    itemsCenter: { justifyContent: 'center', alignItems: 'center', marginLeft: px(20) },
    pf: { width: px(64), height: px(64), borderRadius: px(8), overflow: 'hidden', borderWidth: px(3), borderColor: 'transparent' },
    pfF: { borderColor: C.focus, transform: [{ scale: 1.12 }] },
    pfImg: { width: '100%', height: '100%' },
    logoRight: { marginLeft: px(28) },
    pmBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
    pm: { position: 'absolute', top: px(100), left: SIDE, backgroundColor: alpha(C.bg2, 0.98), borderRadius: px(12), paddingVertical: px(24), paddingHorizontal: px(24), borderWidth: px(1), borderColor: alpha(C.text, 0.15) },
    pmName: { color: C.text, fontSize: px(30), fontWeight: '800', marginBottom: px(16), marginLeft: px(6), maxWidth: px(460) },
    pmItem: { marginBottom: px(10) },
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
