// «¿Quién está viendo?» (perfiles del panel, docs/PERFILES.md sección 6): como la web player en horizontal, todo con el
// control remoto. Perfiles en columna a la izquierda (los 5 entran), «Salir» arriba a la izquierda, el logo arriba a la
// derecha, el título arriba al centro, «Administrar perfiles» debajo de los perfiles, de fondo lo más destacado de la
// semana de TMDB con solo su nombre y su calificación (abajo a la derecha) y la versión abajo a la izquierda.
// El fondo: 15 a 20 destacados que pasan cada 10 s (al final vuelve al primero, BackdropSlides) en una caja arriba a la
// derecha (1320×742, 16:9), con el color del tema entrando suave por su borde izquierdo (donde están los perfiles) y por
// abajo (la versión y el nombre del destacado quedan sobre el color liso). En Vega los degradados no se veían: Shade
// dibujaba la imagen del paquete de 4 px de alto (o de ancho) cuando el estilo no traía las dos medidas.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Modal, StyleSheet, Text, View } from 'react-native';
import { fetchProfiles, Profile, profileAction, ProfilesData } from '../api/profiles';
import { Highlight, weekHighlights } from '../api/tmdb';
import { BackdropSlides, SLIDE_MS } from '../components/BackdropSlides';
import KeyboardModal from '../components/KeyboardModal';
import ProfileEdit from '../components/ProfileEdit';
import ProfilePin from '../components/ProfilePin';
import { Shade } from '../components/Shade';
import { Button, Focusable, Logo } from '../components/ui';
import { t } from '../lib/i18n';
import { brandName } from '../lib/tenant';
import { useNav } from '../nav';
import { chooseProfile, getState, lastProfileId, logout, profilesNeeded, setProfiles, showNotice, useAppSelector } from '../state';
import { alpha, C, px, SIDE, themed } from '../theme';
import { APP_VERSION } from '../version';

const LOCK = require('../../assets/image/ic_lock.png');
const EDIT = require('../../assets/image/ic_edit.png');
const EXIT = require('../../assets/image/ic_exit.png');

type Ask = { p: Profile; then: 'select' | 'edit' };

export default function Profiles({ from, manage, active }: { from: 'start' | 'menu'; manage: boolean; active: boolean }) {
  const nav = useNav();
  const data = useAppSelector(st => st.profiles);
  const [managing, setManaging] = useState(manage);
  const [edit, setEdit] = useState<{ p: Profile | null; pin: string } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [forgot, setForgot] = useState<Ask | null>(null);
  const [exitAsk, setExitAsk] = useState(false);
  const [hls, setHls] = useState<Highlight[]>([]);
  // el destacado que entra (cambia cada 10 s) y el que ya se ve (su nombre y su calificación, abajo a la derecha)
  const [hi, setHi] = useState(0);
  const [shownHi, setShownHi] = useState(-1);
  const [focusId, setFocusId] = useState(() => getState().profile?.id || lastProfileId());
  // vuelve a montar la lista para que el foco quede en focusId (al cerrar una ventana o cambiar de modo)
  const [rev, setRev] = useState(0);
  // PIN ya comprobado en esta pantalla (para editar un perfil bloqueado); nunca se guarda en el equipo
  const pins = useRef<Record<string, string>>({});
  const busy = useRef(false);

  useEffect(() => {
    weekHighlights().then(l => { setHls(l); setHi(0); }).catch(() => {});
    // desde la barra: la lista otra vez del panel (pudo cambiar en otro equipo)
    if (from === 'menu') {
      const ses = getState().session;
      fetchProfiles(Number(ses?.max) || 0).then(d => d && setProfiles(d)).catch(() => {});
    }
  }, [from]);

  // cada 10 s el siguiente destacado; después del último, otra vez el primero (solo con la pantalla a la vista)
  useEffect(() => {
    if (!active || hls.length < 2) return;
    const id = setInterval(() => setHi(i => (i + 1) % hls.length), SLIDE_MS);
    return () => clearInterval(id);
  }, [active, hls.length]);
  const hl = shownHi >= 0 ? hls[shownHi] || null : null;

  // los perfiles se apagaron en el panel o la línea quedó con una conexión: Inicio como siempre
  useEffect(() => {
    if (data && !profilesNeeded()) nav.reset({ name: 'main' });
  }, [data, nav]);

  const open = !!edit || !!ask || !!forgot || exitAsk;
  useEffect(() => {
    if (!active || open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (managing) {
        setManaging(false);
        setRev(r => r + 1);
        return true;
      }
      if (from === 'start') {
        setExitAsk(true);
        return true;
      }
      return false; // desde la barra: App vuelve a Inicio
    });
    return () => sub.remove();
  }, [active, open, managing, from]);

  const enter = useCallback((p: Profile) => {
    chooseProfile(p);
    nav.reset({ name: 'main' });
  }, [nav]);

  const refocus = (id: string) => {
    setFocusId(id);
    setRev(r => r + 1);
  };

  const pick = (p: Profile) => {
    if (busy.current) return;
    setFocusId(p.id);
    if (managing) {
      if (p.locked && pins.current[p.id] === undefined) setAsk({ p, then: 'edit' });
      else setEdit({ p, pin: pins.current[p.id] || '' });
    } else if (p.locked) setAsk({ p, then: 'select' });
    else enter(p);
  };

  // el PIN se comprueba en el panel (5 intentos equivocados = esperar 5 minutos)
  const checkPin = async (pin: string): Promise<string> => {
    const a = ask!;
    const r = await profileAction('pin_check', { id: a.p.id, pin });
    if (!r.ok) return r.error;
    setProfiles(r.data);
    pins.current[a.p.id] = pin;
    setAsk(null);
    const p = r.data.profiles.find(x => x.id === a.p.id) || a.p;
    if (a.then === 'select') enter(p);
    else setEdit({ p, pin });
    return '';
  };

  // PIN olvidado: la contraseña de la línea lo quita
  const resetPin = async (pass: string) => {
    const a = forgot!;
    setForgot(null);
    if (!pass) return refocus(a.p.id);
    const r = await profileAction('pin_reset', { id: a.p.id, pass });
    if (!r.ok) {
      showNotice(r.error);
      return refocus(a.p.id);
    }
    setProfiles(r.data);
    pins.current[a.p.id] = '';
    const p = r.data.profiles.find(x => x.id === a.p.id) || a.p;
    if (a.then === 'select') enter(p);
    else setEdit({ p, pin: '' });
  };

  const saved = (d: ProfilesData, id: string, pin: string) => {
    setProfiles(d);
    if (id) pins.current[id] = pin;
    setEdit(null);
    refocus(id || focusId);
  };
  const deleted = (d: ProfilesData, id: string) => {
    setProfiles(d);
    delete pins.current[id];
    setEdit(null);
    refocus(d.profiles[0]?.id || '');
  };

  const list = data?.profiles || [];
  const want = list.some(p => p.id === focusId) ? focusId : list[0]?.id;
  const rows = list.length + (data?.canCreate ? 1 : 0);
  const av = px(rows > 4 ? 132 : 150);

  return (
    <View style={s.root}>
      <View style={s.bgBox} pointerEvents="none">
        {hls.length ? <BackdropSlides items={hls} index={hi} onShown={setShownHi} /> : null}
      </View>
      <Shade side="left" style={s.shadeLeft} />
      <Shade side="bottom" style={s.shadeBottom} />
      <Shade side="top" style={s.shadeTop} />
      <View style={s.top}>
        <Focusable onPress={() => { logout(); nav.reset({ name: 'login' }); }} style={f => [s.exit, f && s.exitF]}>
          {f => (
            <>
              <Image source={EXIT} style={[s.exitImg, { tintColor: f ? C.onFocus : C.text }]} resizeMode="contain" />
              <Text style={[s.exitText, f && { color: C.onFocus }]}>{t('Salir')}</Text>
            </>
          )}
        </Focusable>
        <Logo size={70} />
      </View>
      <Text style={s.title} numberOfLines={1}>{managing ? t('Administrar perfiles') : t('¿Quién está viendo?')}</Text>
      <View style={s.side} key={rev + (managing ? 'm' : 'v')}>
        {list.map(p => (
          <Focusable key={p.id} preferred={p.id === want && !open} onPress={() => pick(p)} style={s.item}>
            {f => (
              <>
                <View style={[s.av, { width: av, height: av }, f && s.avF]}>
                  <Image source={{ uri: p.avatar }} style={s.avImg} />
                  {managing ? (
                    <View style={s.avEdit}>
                      <Image source={EDIT} style={s.avEditImg} resizeMode="contain" />
                    </View>
                  ) : null}
                  {p.kids ? <Text style={s.kids}>{t('Niños')}</Text> : null}
                </View>
                <Text style={[s.name, f && s.nameF]} numberOfLines={1}>{p.name}</Text>
                {p.locked ? <Image source={LOCK} style={[s.lock, f && { tintColor: C.text }]} resizeMode="contain" /> : null}
              </>
            )}
          </Focusable>
        ))}
        {data?.canCreate ? (
          <Focusable onPress={() => { setFocusId('add'); setEdit({ p: null, pin: '' }); }} preferred={want === undefined} style={s.item}>
            {f => (
              <>
                <View style={[s.av, s.add, { width: av, height: av }, f && s.addF]}>
                  <Text style={[s.addPlus, { fontSize: av * 0.42 }, f && { color: C.text }]}>+</Text>
                </View>
                <Text style={[s.name, f && s.nameF]}>{t('Agregar perfil')}</Text>
              </>
            )}
          </Focusable>
        ) : null}
        <View style={s.manage}>
          <Button label={managing ? t('Listo') : t('Administrar perfiles')} icon={managing ? undefined : '✎'} small primary={managing} last onPress={() => { setManaging(m => !m); setRev(r => r + 1); }} />
        </View>
      </View>
      {hl ? (
        <View style={s.hl} pointerEvents="none">
          <Text style={s.hlTitle} numberOfLines={2}>{hl.title}</Text>
          <View style={s.hlMeta}>
            {hl.rating > 0 ? <Text style={s.hlRate}>★ {hl.rating.toFixed(1)}</Text> : null}
            {hl.year ? <Text style={s.hlText}>{hl.year}</Text> : null}
            <Text style={s.hlText}>{hl.kind === 'tv' ? t('Serie') : t('Película')}</Text>
          </View>
        </View>
      ) : null}
      <Text style={s.ver}>{t('Versión {v}', { v: APP_VERSION })}</Text>

      {ask ? (
        <ProfilePin
          title={ask.then === 'select' ? t('Escribe el PIN para entrar a {n}', { n: ask.p.name }) : t('Escribe el PIN de {n}', { n: ask.p.name })}
          onSubmit={checkPin}
          onClose={() => { refocus(ask.p.id); setAsk(null); }}
          onForgot={() => { setForgot(ask); setAsk(null); }}
        />
      ) : null}
      {forgot ? (
        <KeyboardModal
          title={t('Contraseña de tu cuenta (quita el PIN de {n})', { n: forgot.p.name })}
          value=""
          secret
          onDone={resetPin}
          onClose={() => resetPin('')}
        />
      ) : null}
      {edit && data ? <ProfileEdit p={edit.p} data={data} pin={edit.pin} onSaved={saved} onDeleted={deleted} onClose={() => { setEdit(null); setRev(r => r + 1); }} /> : null}
      <Modal visible={exitAsk} transparent animationType="fade" onRequestClose={() => setExitAsk(false)}>
        <View style={s.dlgBack}>
          <View style={s.dlg}>
            <Text style={s.dlgTitle}>{t('¿Salir de {x}?', { x: brandName() })}</Text>
            <Text style={s.dlgText}>{t('Puedes volver cuando quieras.')}</Text>
            <View style={s.dlgBtns}>
              <Button label={t('Salir')} primary onPress={() => BackHandler.exitApp()} />
              <Button label={t('Cancelar')} preferred last onPress={() => { setExitAsk(false); setRev(r => r + 1); }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// la imagen de fondo: 16:9 arriba a la derecha (en una pantalla de 1920×1080 empieza en x = 600 y termina en y = 742)
const BG_W = 1320;
const BG_H = 742;

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg, overflow: 'hidden' },
    // el fondo (BackdropSlides) en una caja arriba a la derecha; los degradados con las dos medidas siempre (Shade) y
    // opacos justo en los bordes izquierdo e inferior de la imagen: nunca se ve un borde recto y los perfiles, la versión
    // y el nombre del destacado quedan sobre el color del tema
    bgBox: { position: 'absolute', top: 0, right: 0, width: px(BG_W), height: px(BG_H), overflow: 'hidden' },
    shadeLeft: { position: 'absolute', top: 0, right: px(BG_W - 760), width: px(760), height: px(BG_H) },
    shadeBottom: { position: 'absolute', top: px(BG_H - 400), right: 0, width: px(BG_W), height: px(400) },
    shadeTop: { position: 'absolute', top: 0, right: 0, width: px(BG_W), height: px(220), opacity: 0.8 },
    top: { position: 'absolute', top: px(36), left: SIDE, right: SIDE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    exit: { flexDirection: 'row', alignItems: 'center', height: px(60), paddingHorizontal: px(24), borderRadius: px(30), borderWidth: px(2), borderColor: alpha(C.text, 0.4), backgroundColor: alpha('#000000', 0.45) },
    exitF: { backgroundColor: C.focus, borderColor: C.focus, transform: [{ scale: 1.05 }] },
    exitImg: { width: px(30), height: px(30), marginRight: px(12) },
    exitText: { color: C.text, fontSize: px(26), fontWeight: '700' },
    title: { position: 'absolute', top: px(40), left: px(420), right: px(420), textAlign: 'center', color: C.text, fontSize: px(50), fontWeight: '800', lineHeight: px(70) },
    side: { position: 'absolute', left: SIDE, top: px(140), bottom: px(90), width: px(820), justifyContent: 'center' },
    item: { flexDirection: 'row', alignItems: 'center', marginBottom: px(18), alignSelf: 'flex-start', paddingRight: px(30) },
    av: { borderRadius: px(12), overflow: 'hidden', backgroundColor: C.card, borderWidth: px(4), borderColor: 'transparent' },
    avF: { borderColor: C.focus, transform: [{ scale: 1.08 }] },
    avImg: { width: '100%', height: '100%' },
    avEdit: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: alpha('#000000', 0.55), justifyContent: 'center', alignItems: 'center' },
    avEditImg: { width: '34%', height: '34%' },
    kids: { position: 'absolute', left: 0, right: 0, bottom: 0, textAlign: 'center', color: '#ffffff', fontSize: px(20), fontWeight: '800', paddingVertical: px(4), backgroundColor: alpha('#000000', 0.6) },
    name: { color: C.sub, fontSize: px(40), fontWeight: '600', marginLeft: px(30), maxWidth: px(520) },
    nameF: { color: C.text, fontWeight: '800' },
    lock: { width: px(30), height: px(30), marginLeft: px(16), tintColor: C.sub },
    add: { backgroundColor: alpha(C.text, 0.06), borderStyle: 'dashed', borderColor: alpha(C.text, 0.45), justifyContent: 'center', alignItems: 'center' },
    addF: { borderColor: C.focus, borderStyle: 'solid', transform: [{ scale: 1.08 }] },
    addPlus: { color: C.sub, fontWeight: '300' },
    manage: { marginTop: px(20), alignSelf: 'flex-start' },
    hl: { position: 'absolute', right: SIDE, bottom: px(70), maxWidth: px(900), alignItems: 'flex-end' },
    hlTitle: { color: C.text, fontSize: px(56), fontWeight: '800', textAlign: 'right', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: px(10) },
    hlMeta: { flexDirection: 'row', marginTop: px(10) },
    hlRate: { color: '#f5c518', fontSize: px(28), fontWeight: '700', marginLeft: px(22) },
    hlText: { color: '#e5e5e5', fontSize: px(28), fontWeight: '600', marginLeft: px(22) },
    ver: { position: 'absolute', left: SIDE, bottom: px(34), color: alpha(C.text, 0.5), fontSize: px(22) },
    dlgBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
    dlg: { backgroundColor: C.bg2, borderRadius: px(12), padding: px(50), width: px(760) },
    dlgTitle: { color: C.text, fontSize: px(38), fontWeight: '800', marginBottom: px(14) },
    dlgText: { color: C.sub, fontSize: px(28), marginBottom: px(30) },
    dlgBtns: { flexDirection: 'row' },
  }),
);
