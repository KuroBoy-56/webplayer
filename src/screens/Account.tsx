// Cuenta y ajustes.
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import ChangePinDialog from '../components/ChangePinDialog';
import PinDialog from '../components/PinDialog';
import { Button } from '../components/ui';
import { catalog } from '../data/catalog';
import { panelSubmit } from '../api/panel';
import { hasMasterKey } from '../lib/aes';
import { Key, Lang, langChoice, setLang, t, takeLangChanged } from '../lib/i18n';
import { pref, setPref } from '../lib/storage';
import { brand, brandName, distChoice, expiryText } from '../lib/tenant';
import { dateText, dateTimeText, demoLength } from '../lib/util';
import { useNav } from '../nav';
import { deviceId, loadCatalog, loadCloud, logout, refreshCatalog, resetTenant, useAppState } from '../state';
import { C, px, SIDE, themed } from '../theme';

// los nombres se traducen al mostrarlos
const AUDIO: [string, Key][] = [
  ['es', 'Español'],
  ['en', 'Inglés'],
  ['', 'Original del archivo'],
];
const SUBS: [string, Key][] = [
  ['off', 'Desactivados'],
  ['es', 'Español'],
  ['en', 'Inglés'],
];
// idioma de la app: cada idioma con su propio nombre (no se traduce)
const APP_LANGS: ['auto' | Lang, string][] = [
  ['auto', ''],
  ['es', 'Español'],
  ['en', 'English'],
  ['pt', 'Português'],
  ['fr', 'Français'],
];
const langLabel = (k: string) => (k === 'auto' ? t('Automático (idioma del equipo)') : APP_LANGS.find(l => l[0] === k)?.[1] || '');

function Setting({ label, value, onPress, preferred }: { label: string; value: string; onPress: () => void; preferred?: boolean }) {
  return (
    <View style={s.set}>
      <Button label={label} value={value} width={px(1000)} big last preferred={preferred} onPress={onPress} />
    </View>
  );
}

// lista de idiomas de la app; al elegir uno se aplica enseguida (App vuelve a montar las pantallas)
function LangPicker({ onClose }: { onClose: () => void }) {
  const cur = langChoice();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.pickShade}>
        <View style={s.pickBox}>
          <Text style={s.pickTitle}>{t('Idioma de la app')}</Text>
          {APP_LANGS.map(([k]) => (
            <View key={k} style={s.set}>
              <Button
                label={(k === cur ? '✓  ' : '     ') + langLabel(k)}
                left
                last
                preferred={k === cur}
                onPress={() => {
                  onClose();
                  setLang(k);
                }}
              />
            </View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

function cycle(list: string[][], cur: string): string {
  const i = list.findIndex(x => x[0] === cur);
  return list[(i + 1) % list.length][0];
}

export default function Account() {
  const nav = useNav();
  const st = useAppState();
  const [, force] = useState(0);
  const [pin, setPin] = useState(false);
  const [changePin, setChangePin] = useState(false);
  const [pinMsg, setPinMsg] = useState('');
  const [reg, setReg] = useState('');
  const [langOpen, setLangOpen] = useState(false);
  // recién cambiado el idioma: el foco vuelve a esa fila
  const [langFocus] = useState(takeLangChanged);
  const s0 = st.session;
  const audio = pref('audio_lang', 'es');
  const subs = pref('subs_lang', 'off');
  const hideAdult = pref('hide_adult', '1') === '1';
  const dist = brand();
  const distDate = dist ? expiryText(dist) : '';
  // cantidad de contenido del servidor ("…" mientras se carga esa lista)
  const count = (k: 'live' | 'vod' | 'series') => (st.loaded[k] ? String(catalog.k[k]?.index.size ?? 0) : '…');
  const missing = !st.loaded.live || !st.loaded.vod || !st.loaded.series;
  useEffect(() => {
    if (s0 && missing && !st.loading) loadCatalog();
  }, [s0, missing, st.loading]);

  return (
    <ScrollView contentContainerStyle={s.root}>
      <Text style={s.title}>{t('Cuenta')}</Text>
      {s0 ? (
        <View style={s.card}>
          {/* DEMO: nunca el usuario de la línea */}
          {st.demo ? <Text style={s.demo}>{t('Cuenta DEMO') + (demoLength(st.demoDuration) ? ' · ' + demoLength(st.demoDuration) : '')}</Text> : null}
          <Text style={s.row}>{t('Usuario:')} <Text style={s.val}>{st.demo ? 'DEMO' : s0.user}</Text></Text>
          {/* DEMO: solo el fin que dice el panel (hora exacta); nada de la línea demo del servidor */}
          {st.demo ? (
            <Text style={s.row}>{t('Vence:')} <Text style={s.val}>{st.demoExpires > 0 ? dateTimeText(st.demoExpires) : '—'}</Text></Text>
          ) : (
            <>
              <Text style={s.row}>{t('Servidor:')} <Text style={s.val}>{s0.dns}</Text></Text>
              <Text style={s.row}>{t('Vence:')} <Text style={s.val}>{dateText(s0.exp)}</Text></Text>
              <Text style={s.row}>{t('Conexiones:')} <Text style={s.val}>{t('{a} de {b}', { a: s0.active || '0', b: s0.max || '1' })}</Text></Text>
            </>
          )}
          <Text style={s.row}>{t('Canales en vivo:')} <Text style={s.val}>{count('live')}</Text></Text>
          <Text style={s.row}>{t('Películas:')} <Text style={s.val}>{count('vod')}</Text></Text>
          <Text style={s.row}>{t('Series:')} <Text style={s.val}>{count('series')}</Text></Text>
          <Text style={s.row}>{t('Código del equipo:')} <Text style={s.val}>{deviceId()}</Text></Text>
          {dist ? (
            <Text style={s.row}>
              {t('Distribuidor:')} <Text style={s.val}>{dist.name ? dist.name + ' (' + dist.code + ')' : dist.code}</Text>
            </Text>
          ) : null}
          {distDate ? <Text style={s.row}>{t('Vence el distribuidor:')} <Text style={s.val}>{t('{d} (hora de Panamá)', { d: distDate })}</Text></Text> : null}
        </View>
      ) : null}

      <Text style={s.sub}>{t('Ajustes')}</Text>
      <Setting label={t('Idioma de la app')} value={langLabel(langChoice())} preferred={langFocus} onPress={() => setLangOpen(true)} />
      <Setting
        label={t('Idioma de audio preferido')}
        value={t(AUDIO.find(a => a[0] === audio)?.[1] || 'Español')}
        onPress={() => {
          setPref('audio_lang', cycle(AUDIO, audio));
          force(x => x + 1);
        }}
      />
      <Setting
        label={t('Subtítulos')}
        value={t(SUBS.find(a => a[0] === subs)?.[1] || 'Desactivados')}
        onPress={() => {
          setPref('subs_lang', cycle(SUBS, subs));
          force(x => x + 1);
        }}
      />
      <Setting
        label={t('PIN de control parental')}
        value={pinMsg || t('Activado · lo administra el panel (Cambiar)')}
        onPress={() => setChangePin(true)}
      />
      <Setting
        label={t('Ocultar contenido para adultos')}
        value={hideAdult ? t('Sí') : t('No')}
        onPress={() => {
          if (hideAdult) setPin(true);
          else {
            setPref('hide_adult', '1');
            catalog.unlocked = false;
            refreshCatalog();
            force(x => x + 1);
          }
        }}
      />
      {hasMasterKey() && s0 ? (
        <Setting
          label={t('Registrar este equipo en el panel')}
          value={reg || t('Código {x}', { x: deviceId() })}
          onPress={() => {
            setReg(t('Registrando…'));
            panelSubmit(deviceId(), s0.user, s0.pass, s0.base).then(r => setReg(r.ok ? t('Equipo registrado') : r.error || t('No se pudo registrar')));
          }}
        />
      ) : null}
      <Setting
        label={t('Recargar catálogo')}
        value={t('Actualizar películas, series y canales')}
        onPress={() => {
          loadCatalog(true);
          loadCloud();
        }}
      />
      <Setting
        label={t('Cambiar distribuidor')}
        value={distChoice() === 'code' ? t('Número {x}', { x: dist?.code || '' }) : t('Escribir un número de distribuidor')}
        onPress={() => {
          resetTenant();
          nav.rebrand({ name: 'distributor' });
        }}
      />
      <Setting
        label={t('Cerrar sesión')}
        value=""
        onPress={() => {
          logout();
          nav.reset({ name: 'login' });
        }}
      />
      <Text style={s.ver}>{t('{x} para {p} · versión {v}', { x: brandName(), p: 'LG Smart TV (webOS)', v: '1.0.0' })}</Text>
      <ChangePinDialog
        visible={changePin}
        onClose={() => setChangePin(false)}
        onSaved={() => {
          setChangePin(false);
          setPinMsg(t('PIN guardado en el panel'));
        }}
      />
      <PinDialog
        visible={pin}
        onClose={() => setPin(false)}
        onOk={() => {
          setPin(false);
          setPref('hide_adult', '0');
          refreshCatalog();
          force(x => x + 1);
        }}
      />
      {langOpen ? <LangPicker onClose={() => setLangOpen(false)} /> : null}
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { paddingTop: px(130), paddingHorizontal: SIDE, paddingBottom: px(100) },
    title: { color: C.text, fontSize: px(48), fontWeight: '800' },
    card: { backgroundColor: C.bg2, borderRadius: px(12), padding: px(30), marginTop: px(20), width: px(1000) },
    row: { color: C.sub, fontSize: px(28), marginBottom: px(10) },
    val: { color: C.text, fontWeight: '700' },
    demo: { color: C.text, backgroundColor: C.red, alignSelf: 'flex-start', fontSize: px(26), fontWeight: '800', borderRadius: px(6), paddingHorizontal: px(14), paddingVertical: px(4), marginBottom: px(14) },
    sub: { color: C.text, fontSize: px(36), fontWeight: '800', marginTop: px(40), marginBottom: px(14) },
    set: { marginBottom: px(12) },
    ver: { color: C.dim, fontSize: px(22), marginTop: px(40) },
    pickShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' },
    pickBox: { width: px(760), backgroundColor: C.bg2, borderRadius: px(12), padding: px(50) },
    pickTitle: { color: C.text, fontSize: px(44), fontWeight: '800', marginBottom: px(24) },
  }),
);
