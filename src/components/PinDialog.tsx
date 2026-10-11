// PIN del control parental.
import React, { useState } from 'react';
import { Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { catalog } from '../data/catalog';
import { parentalPin } from '../state';
import { C, px, themed } from '../theme';
import { Button } from './ui';

export default function PinDialog({ visible, onClose, onOk }: { visible: boolean; onClose: () => void; onOk: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const check = () => {
    if (pin === parentalPin()) {
      catalog.unlocked = true;
      setPin('');
      setErr('');
      onOk();
    } else {
      setErr('PIN incorrecto');
      setPin('');
    }
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.back}>
        <View style={s.box}>
          <Text style={s.title}>Control parental</Text>
          <Text style={s.sub}>Escribe el PIN para ver este contenido</Text>
          <TextInput
            style={s.input}
            value={pin}
            onChangeText={t => setPin(t.replace(/[^0-9]/g, '').slice(0, 4))}
            keyboardType="number-pad"
            secureTextEntry
            hasTVPreferredFocus
            onSubmitEditing={check}
          />
          {err ? <Text style={s.err}>{err}</Text> : null}
          <View style={s.btns}>
            <Button label="Aceptar" primary onPress={check} />
            <Button label="Cancelar" last onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', alignItems: 'center' },
    box: { width: px(700), backgroundColor: C.bg2, borderRadius: px(12), padding: px(50) },
    title: { color: C.text, fontSize: px(44), fontWeight: '800' },
    sub: { color: C.sub, fontSize: px(26), marginTop: px(10), marginBottom: px(24) },
    input: { height: px(84), backgroundColor: C.card, color: C.text, fontSize: px(40), borderRadius: px(8), paddingHorizontal: px(24), letterSpacing: px(12) },
    err: { color: '#e87c03', fontSize: px(26), marginTop: px(12) },
    btns: { flexDirection: 'row', marginTop: px(28) },
  }),
);
