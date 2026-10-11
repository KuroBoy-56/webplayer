// Cambiar el PIN del control parental: pide el actual, el nuevo y la confirmación, y lo guarda en el
// panel (login.php set_pin). Si el panel no lo acepta, el PIN no cambia en el equipo.
import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { panelSetPin } from '../api/panel';
import { deviceId, parentalPin } from '../state';
import { C, px, themed } from '../theme';
import { Button } from './ui';

type Step = 'old' | 'new' | 'confirm';
const TITLES: Record<Step, string> = { old: 'Escribe el PIN actual (de fábrica 0000)', new: 'Escribe el nuevo PIN (4 números)', confirm: 'Confirma el nuevo PIN' };

export default function ChangePinDialog({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [step, setStep] = useState<Step>('old');
  const [pin, setPin] = useState('');
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setStep('old');
    setPin('');
    setOldPin('');
    setNewPin('');
    setErr('');
    setBusy(false);
  };
  const close = () => {
    reset();
    onClose();
  };
  const next = async () => {
    if (busy) return;
    if (pin.length !== 4) return setErr('El PIN tiene 4 números');
    setErr('');
    if (step === 'old') {
      if (pin !== parentalPin()) {
        setPin('');
        return setErr('PIN incorrecto');
      }
      setOldPin(pin);
      setPin('');
      return setStep('new');
    }
    if (step === 'new') {
      setNewPin(pin);
      setPin('');
      return setStep('confirm');
    }
    if (pin !== newPin) {
      setPin('');
      setStep('new');
      return setErr('Los PIN no coinciden');
    }
    setBusy(true);
    const r = await panelSetPin(deviceId(), oldPin, newPin);
    setBusy(false);
    if (r.ok) {
      reset();
      onSaved();
    } else {
      setPin('');
      setStep('new');
      setErr(r.error || 'No se pudo guardar el PIN en el panel');
    }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={s.back}>
        <View style={s.box}>
          <Text style={s.title}>Control parental</Text>
          <Text style={s.sub}>{busy ? 'Guardando el PIN en el panel…' : TITLES[step]}</Text>
          <TextInput
            key={step}
            style={s.input}
            value={pin}
            onChangeText={t => setPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
            keyboardType="number-pad"
            secureTextEntry
            hasTVPreferredFocus
            onSubmitEditing={next}
          />
          {err ? <Text style={s.err}>{err}</Text> : null}
          <View style={s.btns}>
            <Button label="Aceptar" primary onPress={next} />
            <Button label="Cancelar" last onPress={close} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
    box: { width: px(760), backgroundColor: C.bg2, borderRadius: px(12), padding: px(50) },
    title: { color: C.text, fontSize: px(44), fontWeight: '800' },
    sub: { color: C.sub, fontSize: px(26), marginTop: px(10), marginBottom: px(24) },
    input: { height: px(84), backgroundColor: C.card, color: C.text, fontSize: px(40), borderRadius: px(8), paddingHorizontal: px(24), letterSpacing: px(12) },
    err: { color: '#e87c03', fontSize: px(26), marginTop: px(12) },
    btns: { flexDirection: 'row', marginTop: px(28) },
  }),
);
