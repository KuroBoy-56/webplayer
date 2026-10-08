// Número de distribuidor (primera vez o "Cambiar distribuidor"): 6 dígitos con teclado en
// pantalla para el control remoto. "Omitir" deja la app como siempre y no vuelve a preguntar.
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { panelTenantConfig } from '../api/panel';
import { Button, Focusable, Logo } from '../components/ui';
import { chooseSkip, saveBrand } from '../lib/tenant';
import { nowSec } from '../lib/util';
import { useNav } from '../nav';
import { checkTenant, deviceId, getState } from '../state';
import { C, px, themed } from '../theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Borrar', '0', '⌫'];

function Key({ label, onPress, preferred }: { label: string; onPress: () => void; preferred?: boolean }) {
  return (
    <Focusable onPress={onPress} preferred={preferred} style={f => [s.key, f && s.keyF]}>
      {f => <Text style={[s.keyText, label.length > 1 && s.keyWord, f && s.keyTextF]}>{label}</Text>}
    </Focusable>
  );
}

export default function Distributor({ message }: { message?: string }) {
  const nav = useNav();
  const [code, setCode] = useState('');
  const [error, setError] = useState(message || '');
  const [busy, setBusy] = useState(false);

  const press = (k: string) => {
    if (busy) return;
    setError('');
    if (k === '⌫') setCode(c => c.slice(0, -1));
    else if (k === 'Borrar') setCode('');
    else setCode(c => (c.length < 6 ? c + k : c));
  };

  const next = () => nav.rebrand(getState().session ? { name: 'main' } : { name: 'login' });

  const go = async () => {
    if (busy) return;
    if (!/^\d{6}$/.test(code)) {
      setError('Escribe los 6 dígitos de tu número de distribuidor');
      return;
    }
    setBusy(true);
    setError('');
    const r = await panelTenantConfig(code, deviceId(), nowSec());
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    saveBrand(r.brand);
    next();
  };

  const skip = () => {
    if (busy) return;
    chooseSkip();
    next();
  };

  return (
    <View style={s.root}>
      <View style={s.top}>
        <Logo size={110} />
      </View>
      <View style={s.box}>
        <Text style={s.title}>Número de distribuidor</Text>
        <Text style={s.hint}>Escribe el número de 6 dígitos que te dio tu distribuidor.</Text>
        <View style={s.slots}>
          {[0, 1, 2, 3, 4, 5].map(i => (
            <View key={i} style={[s.slot, i === code.length && s.slotOn]}>
              <Text style={s.slotText}>{code[i] || ''}</Text>
            </View>
          ))}
        </View>
        <View style={s.pad}>
          {KEYS.map((k, i) => (
            <Key key={k} label={k} preferred={i === 0} onPress={() => press(k)} />
          ))}
        </View>
        {error ? <Text style={s.error}>{error}</Text> : null}
        {busy ? <Text style={s.busy}>Comprobando el número…</Text> : null}
        <View style={s.btns}>
          <Button label={busy ? 'Comprobando…' : 'Continuar'} primary onPress={go} />
          <Button label="Omitir" onPress={skip} />
        </View>
      </View>
    </View>
  );
}

// sin respuesta del panel hace más de 72 h: no se puede seguir con lo guardado
export function TenantRetry({ message }: { message: string }) {
  const nav = useNav();
  const [msg, setMsg] = useState(message);
  const [busy, setBusy] = useState(false);

  const retry = async () => {
    if (busy) return;
    setBusy(true);
    const g = await checkTenant();
    setBusy(false);
    if (g.kind === 'wiped') nav.rebrand({ name: 'distributor', message: g.message });
    else if (g.kind === 'retry') setMsg(g.message);
    else nav.rebrand(getState().session ? { name: 'main' } : { name: 'login' });
  };

  return (
    <View style={s.root}>
      <View style={s.top}>
        <Logo size={110} />
      </View>
      <View style={s.box}>
        <Text style={s.title}>Sin conexión</Text>
        <Text style={s.hint}>{msg}</Text>
        {busy ? <Text style={s.busy}>Comprobando…</Text> : null}
        <View style={s.btns}>
          <Button label={busy ? 'Comprobando…' : 'Reintentar'} primary preferred onPress={retry} />
        </View>
      </View>
    </View>
  );
}

const s = themed(() =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: '#000' },
    top: { position: 'absolute', left: px(80), top: px(40) },
    box: { alignSelf: 'center', marginTop: px(90), width: px(760), backgroundColor: C.bg2, borderRadius: px(10), padding: px(60) },
    title: { color: C.text, fontSize: px(52), fontWeight: '800', marginBottom: px(14) },
    hint: { color: C.sub, fontSize: px(26), marginBottom: px(30) },
    slots: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: px(30) },
    slot: { width: px(92), height: px(104), backgroundColor: '#333', borderRadius: px(6), alignItems: 'center', justifyContent: 'center', borderWidth: px(3), borderColor: 'transparent' },
    slotOn: { borderColor: C.red },
    slotText: { color: '#fff', fontSize: px(52), fontWeight: '800' },
    pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: px(10) },
    key: { width: px(204), height: px(76), borderRadius: px(8), backgroundColor: 'rgba(109,109,110,0.7)', alignItems: 'center', justifyContent: 'center', marginBottom: px(14) },
    keyF: { backgroundColor: '#fff', transform: [{ scale: 1.06 }] },
    keyText: { color: '#fff', fontSize: px(36), fontWeight: '700' },
    keyWord: { fontSize: px(26) },
    keyTextF: { color: '#000' },
    error: { color: '#e87c03', fontSize: px(26), marginBottom: px(14) },
    busy: { color: C.sub, fontSize: px(26), marginBottom: px(14) },
    btns: { flexDirection: 'row', marginTop: px(12) },
  }),
);
