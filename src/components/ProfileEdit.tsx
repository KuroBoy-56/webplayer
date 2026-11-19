// Agregar o editar un perfil (docs/PERFILES.md del panel): avatar de la lista del panel, nombre con el teclado de la app,
// «Perfil infantil» solo al crear, bloquear / cambiar / quitar el PIN y «Eliminar perfil» (nunca el principal).
import React, { useEffect, useState } from 'react';
import { BackHandler, Image, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Profile, profileAction, ProfilesData } from '../api/profiles';
import { t } from '../lib/i18n';
import { alpha, C, px, themed } from '../theme';
import KeyboardModal from './KeyboardModal';
import ProfilePin from './ProfilePin';
import { Button, Focusable } from './ui';

const EDIT = require('../../assets/image/ic_edit.png');

// fila de ajuste (etiqueta a la izquierda, valor a la derecha), una debajo de otra
function Field(props: { label: string; value: string; onPress: () => void; preferred?: boolean }) {
  return (
    <View style={s.field}>
      <Button {...props} big last width={px(860)} />
    </View>
  );
}

type Props = {
  p: Profile | null; // null = agregar
  data: ProfilesData;
  pin: string; // PIN ya comprobado de un perfil bloqueado ('' si no tiene)
  onSaved: (d: ProfilesData, id: string, pin: string) => void;
  onDeleted: (d: ProfilesData, id: string) => void;
  onClose: () => void;
};

export default function ProfileEdit({ p, data, pin, onSaved, onDeleted, onClose }: Props) {
  const firstFree = () => data.avatars.find(a => !data.profiles.some(x => x.avatar === a)) || data.avatars[0] || '';
  const [name, setName] = useState(p ? p.name : '');
  const [avatar, setAvatar] = useState(p ? p.avatar : firstFree());
  const [kids, setKids] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [clearPin, setClearPin] = useState(false);
  const [view, setView] = useState<'form' | 'avatars' | 'delete'>('form');
  const [kb, setKb] = useState(false);
  const [pinStep, setPinStep] = useState<'' | 'new' | 'confirm'>('');
  const [firstPin, setFirstPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const sub = kb || !!pinStep;

  useEffect(() => {
    if (sub) return;
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      if (view !== 'form') setView('form');
      else onClose();
      return true;
    });
    return () => h.remove();
  }, [sub, view, onClose]);

  const save = async () => {
    if (busy) return;
    const n = name.replace(/\s+/g, ' ').trim();
    if (!n) return setErr(t('Escribe un nombre.'));
    setBusy(true);
    setErr('');
    let r;
    let id = p ? p.id : '';
    let cur = pin;
    if (!p) {
      r = await profileAction('create', { name: n, avatar, kids });
      if (r.ok && newPin) {
        const made = r.data.profiles.find(x => x.name === n);
        if (made) {
          id = made.id;
          r = await profileAction('pin_set', { id, new_pin: newPin });
          if (r.ok) cur = newPin;
        }
      } else if (r.ok) id = r.data.profiles.find(x => x.name === n)?.id || '';
    } else {
      const f: Record<string, unknown> = { id, pin: cur };
      if (n !== p.name) f.name = n;
      if (avatar !== p.avatar) f.avatar = avatar;
      r = 'name' in f || 'avatar' in f ? await profileAction('update', f) : { ok: true as const, data };
      if (r.ok && newPin) {
        r = await profileAction('pin_set', { id, new_pin: newPin, pin: cur });
        if (r.ok) cur = newPin;
      } else if (r.ok && clearPin) {
        r = await profileAction('pin_clear', { id, pin: cur });
        if (r.ok) cur = '';
      }
    }
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    onSaved(r.data, id, cur);
  };

  const remove = async () => {
    if (!p || busy) return;
    setBusy(true);
    const r = await profileAction('delete', { id: p.id, pin });
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    onDeleted(r.data, p.id);
  };

  const pinDone = async (v: string): Promise<string> => {
    if (pinStep === 'new') {
      setFirstPin(v);
      setPinStep('confirm');
      return '';
    }
    if (v !== firstPin) {
      setPinStep('new');
      return t('Los dos PIN no coinciden.');
    }
    setNewPin(v);
    setClearPin(false);
    setPinStep('');
    return '';
  };

  let body: React.ReactNode;
  if (view === 'avatars') {
    body = (
      <>
        <Text style={s.title}>{t('Elige un avatar')}</Text>
        <ScrollView style={s.gridBox} contentContainerStyle={s.grid}>
          {data.avatars.map((a, i) => (
            <Focusable key={a} preferred={a === avatar || (!avatar && i === 0)} onPress={() => { setAvatar(a); setView('form'); }} style={f => [s.opt, a === avatar && s.optOn, f && s.optF]}>
              <Image source={{ uri: a }} style={s.optImg} />
            </Focusable>
          ))}
        </ScrollView>
      </>
    );
  } else if (view === 'delete' && p) {
    body = (
      <>
        <Text style={s.title}>{t('¿Eliminar el perfil {n}?', { n: p.name })}</Text>
        <Text style={s.text}>{t('Se quitará de todos tus equipos. Durante 7 días puedes recuperarlo con su Continuar viendo y su Mi lista creando un perfil con el mismo nombre exacto; después se borra para siempre.')}</Text>
        <Text style={s.err}>{err}</Text>
        <View style={s.btns}>
          <Button label={t('Eliminar perfil')} primary onPress={remove} />
          <Button label={t('Cancelar')} preferred last onPress={() => setView('form')} />
        </View>
      </>
    );
  } else {
    const locked = !!p?.locked;
    const pinLabel = locked ? (clearPin ? t('Se quitará') : newPin ? t('Cambiado') : t('Sí')) : newPin ? t('Sí') : t('No');
    body = (
      <>
        <Text style={s.title}>{p ? t('Editar perfil') : t('Agregar perfil')}</Text>
        <View style={s.top}>
          <Focusable onPress={() => setView('avatars')} style={f => [s.av, f && s.avF]}>
            <Image source={{ uri: avatar }} style={s.avImg} />
            <View style={s.avEdit}>
              <Image source={EDIT} style={s.avEditImg} resizeMode="contain" />
            </View>
          </Focusable>
          <View style={s.fields}>
            <Field label={t('Nombre')} value={name || ' '} preferred onPress={() => setKb(true)} />
            {!p ? <Field label={t('Perfil infantil')} value={kids ? t('Sí') : t('No')} onPress={() => setKids(k => !k)} /> : null}
            {locked ? (
              <>
                <Field label={t('Cambiar el PIN')} value={newPin ? t('Cambiado') : ''} onPress={() => setPinStep('new')} />
                <Field label={t('Quitar el PIN')} value={clearPin ? t('Sí') : t('No')} onPress={() => { setClearPin(c => !c); setNewPin(''); }} />
              </>
            ) : (
              <Field label={t('Bloquear con PIN')} value={pinLabel} onPress={() => (newPin ? setNewPin('') : setPinStep('new'))} />
            )}
          </View>
        </View>
        <Text style={s.note}>
          {!p
            ? kids
              ? t('Solo contenido para niños y de Disney, sin Deportes. Se elige al crear el perfil y después no se cambia.')
              : t('Si eliminaste un perfil hace menos de 7 días, créalo con el mismo nombre exacto y volverá con su Continuar viendo y su Mi lista.')
            : p.kids
              ? t('Perfil infantil: solo contenido para niños y de Disney. Se elige al crear el perfil y después no se cambia.')
              : ''}
        </Text>
        <Text style={s.err}>{busy ? t('Guardando…') : err}</Text>
        <View style={s.btns}>
          <Button label={p ? t('Guardar') : t('Agregar')} primary onPress={save} />
          <Button label={t('Cancelar')} last={!p || p.main} onPress={onClose} />
          {p && !p.main ? <Button label={t('Eliminar perfil')} last onPress={() => { setErr(''); setView('delete'); }} /> : null}
        </View>
      </>
    );
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.back}>
        <View style={s.box}>{body}</View>
      </View>
      {kb ? <KeyboardModal title={t('Nombre')} value={name} onDone={v => { setName(v.slice(0, 20)); setKb(false); }} onClose={() => setKb(false)} /> : null}
      {pinStep ? (
        <ProfilePin key={pinStep} title={pinStep === 'new' ? t('Escribe el PIN nuevo (4 números)') : t('Repite el PIN')} onSubmit={pinDone} onClose={() => setPinStep('')} />
      ) : null}
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
    box: { backgroundColor: C.bg2, borderRadius: px(14), paddingHorizontal: px(56), paddingVertical: px(44), width: px(1240) },
    title: { color: C.text, fontSize: px(40), fontWeight: '800', marginBottom: px(28) },
    text: { color: C.sub, fontSize: px(28), lineHeight: px(40) },
    top: { flexDirection: 'row', alignItems: 'flex-start' },
    av: { width: px(220), height: px(220), borderRadius: px(14), overflow: 'hidden', borderWidth: px(4), borderColor: 'transparent', marginRight: px(44) },
    avF: { borderColor: C.focus, transform: [{ scale: 1.05 }] },
    avImg: { width: '100%', height: '100%' },
    avEdit: { position: 'absolute', right: px(10), bottom: px(10), width: px(56), height: px(56), borderRadius: px(28), backgroundColor: alpha('#000000', 0.65), justifyContent: 'center', alignItems: 'center' },
    avEditImg: { width: px(30), height: px(30) },
    fields: { flex: 1 },
    field: { marginBottom: px(16) },
    note: { color: C.sub, fontSize: px(24), lineHeight: px(34), marginTop: px(24), minHeight: px(34) },
    err: { color: '#ff7b7b', fontSize: px(26), minHeight: px(36), marginTop: px(10) },
    btns: { flexDirection: 'row', marginTop: px(14) },
    gridBox: { maxHeight: px(720) },
    grid: { flexDirection: 'row', flexWrap: 'wrap', padding: px(8) },
    opt: { width: px(124), height: px(124), borderRadius: px(12), overflow: 'hidden', margin: px(8), borderWidth: px(4), borderColor: 'transparent' },
    optOn: { borderColor: alpha(C.text, 0.6) },
    optF: { borderColor: C.focus, transform: [{ scale: 1.08 }] },
    optImg: { width: '100%', height: '100%' },
  }),
);
