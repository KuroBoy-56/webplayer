// Cuenta y ajustes.
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import PinDialog from '../components/PinDialog';
import { Focusable } from '../components/ui';
import { catalog } from '../data/catalog';
import { panelSubmit } from '../api/panel';
import { hasMasterKey } from '../lib/aes';
import { pref, setPref } from '../lib/storage';
import { brand, brandName, distChoice, expiryText } from '../lib/tenant';
import { dateText } from '../lib/util';
import { useNav } from '../nav';
import { deviceId, loadCatalog, loadCloud, logout, refreshCatalog, resetTenant, useAppState } from '../state';
import { C, px, SIDE, themed } from '../theme';

const AUDIO = [
  ['es', 'Español'],
  ['en', 'Inglés'],
  ['', 'Original del archivo'],
];
const SUBS = [
  ['off', 'Desactivados'],
  ['es', 'Español'],
  ['en', 'Inglés'],
];

function Setting({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Focusable onPress={onPress} style={f => [s.set, f && s.setF]}>
      {f => (
        <>
          <Text style={[s.setLabel, f && { color: '#000' }]}>{label}</Text>
          <Text style={[s.setValue, f && { color: '#333' }]}>{value}</Text>
        </>
      )}
    </Focusable>
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
  const [reg, setReg] = useState('');
  const s0 = st.session;
  const audio = pref('audio_lang', 'es');
  const subs = pref('subs_lang', 'off');
  const hideAdult = pref('hide_adult', '1') === '1';
  const dist = brand();
  const distDate = dist ? expiryText(dist) : '';

  return (
    <ScrollView contentContainerStyle={s.root}>
      <Text style={s.title}>Cuenta</Text>
      {s0 ? (
        <View style={s.card}>
          <Text style={s.row}>Usuario: <Text style={s.val}>{s0.user}</Text></Text>
          <Text style={s.row}>Servidor: <Text style={s.val}>{s0.dns}</Text></Text>
          <Text style={s.row}>Vence: <Text style={s.val}>{dateText(s0.exp)}</Text></Text>
          <Text style={s.row}>Conexiones: <Text style={s.val}>{s0.active || '0'} de {s0.max || '1'}</Text></Text>
          <Text style={s.row}>Código del equipo: <Text style={s.val}>{deviceId()}</Text></Text>
          {dist ? (
            <Text style={s.row}>
              Distribuidor: <Text style={s.val}>{dist.name ? dist.name + ' (' + dist.code + ')' : dist.code}</Text>
            </Text>
          ) : null}
          {distDate ? <Text style={s.row}>Vence el distribuidor: <Text style={s.val}>{distDate} (hora de Panamá)</Text></Text> : null}
        </View>
      ) : null}

      <Text style={s.sub}>Ajustes</Text>
      <Setting
        label="Idioma de audio preferido"
        value={AUDIO.find(a => a[0] === audio)?.[1] || 'Español'}
        onPress={() => {
          setPref('audio_lang', cycle(AUDIO, audio));
          force(x => x + 1);
        }}
      />
      <Setting
        label="Subtítulos"
        value={SUBS.find(a => a[0] === subs)?.[1] || 'Desactivados'}
        onPress={() => {
          setPref('subs_lang', cycle(SUBS, subs));
          force(x => x + 1);
        }}
      />
      <Setting
        label="Ocultar contenido para adultos"
        value={hideAdult ? 'Sí' : 'No'}
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
          label="Registrar este equipo en el panel"
          value={reg || 'Código ' + deviceId()}
          onPress={() => {
            setReg('Registrando…');
            panelSubmit(deviceId(), s0.user, s0.pass, s0.base).then(r => setReg(r.ok ? 'Equipo registrado' : r.error || 'No se pudo registrar'));
          }}
        />
      ) : null}
      <Setting
        label="Recargar catálogo"
        value="Actualizar películas, series y canales"
        onPress={() => {
          loadCatalog(true);
          loadCloud();
        }}
      />
      <Setting
        label="Cambiar distribuidor"
        value={distChoice() === 'code' ? 'Número ' + (dist?.code || '') : 'Escribir un número de distribuidor'}
        onPress={() => {
          resetTenant();
          nav.rebrand({ name: 'distributor' });
        }}
      />
      <Setting
        label="Cerrar sesión"
        value=""
        onPress={() => {
          logout();
          nav.reset({ name: 'login' });
        }}
      />
      <Text style={s.ver}>{brandName()} para Fire TV (Vega OS) · versión 1.0.0</Text>
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
    </ScrollView>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { paddingTop: px(130), paddingHorizontal: SIDE, paddingBottom: px(100) },
    title: { color: '#fff', fontSize: px(48), fontWeight: '800' },
    card: { backgroundColor: C.bg2, borderRadius: px(10), padding: px(30), marginTop: px(20), width: px(1000) },
    row: { color: C.sub, fontSize: px(28), marginBottom: px(10) },
    val: { color: '#fff', fontWeight: '700' },
    sub: { color: '#fff', fontSize: px(36), fontWeight: '800', marginTop: px(40), marginBottom: px(14) },
    set: { width: px(1000), height: px(84), flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: px(28), backgroundColor: C.bg2, borderRadius: px(8), marginBottom: px(10) },
    setF: { backgroundColor: '#fff' },
    setLabel: { color: '#fff', fontSize: px(28), fontWeight: '700' },
    setValue: { color: C.sub, fontSize: px(26) },
    ver: { color: C.dim, fontSize: px(22), marginTop: px(40) },
  }),
);
