// Aviso del panel (bienvenida o vencimiento). Un solo botón, enfocado de inicio; Atrás también cierra.
import React from 'react';
import { Image, Modal, StyleSheet, Text, View } from 'react-native';
import { PanelAlert } from '../api/alerts';
import { alpha, C, px, themed } from '../theme';
import { Button, Logo } from './ui';

export default function AlertDialog({ alert, onClose }: { alert: PanelAlert | null; onClose: () => void }) {
  if (!alert) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.back}>
        <View style={s.box}>
          <View style={[s.accent, alert.expiry ? s.accentExpiry : s.accentWelcome]}>
            {alert.expiry ? null : <View style={s.gold} />}
          </View>
          <View style={s.body}>
            <Logo size={70} />
            <Text style={[s.title, alert.expiry && s.titleExpiry]}>{alert.title}</Text>
            {alert.message.trim() ? <Text style={s.msg}>{alert.message}</Text> : null}
            {alert.image ? <Image source={{ uri: alert.image }} style={s.img} resizeMode="contain" /> : null}
            <View style={s.btns}>
              <Button label={alert.button.toUpperCase()} primary preferred last onPress={onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
    box: { width: px(820), backgroundColor: C.bg2, borderRadius: px(16), borderWidth: 1, borderColor: alpha(C.text, 0.13), overflow: 'hidden' },
    accent: { height: px(6), flexDirection: 'row' },
    accentExpiry: { backgroundColor: C.red },
    accentWelcome: { backgroundColor: C.red },
    gold: { flex: 1, marginLeft: '50%', backgroundColor: '#F5C518' },
    body: { paddingHorizontal: px(56), paddingTop: px(40), paddingBottom: px(44), alignItems: 'center' },
    title: { color: C.text, fontSize: px(44), fontWeight: '800', textAlign: 'center', marginTop: px(20) },
    titleExpiry: { color: C.red },
    msg: { color: C.sub, fontSize: px(30), lineHeight: px(44), textAlign: 'center', marginTop: px(14) },
    img: { width: px(700), height: px(300), marginTop: px(26), borderRadius: px(8) },
    btns: { flexDirection: 'row', marginTop: px(34) },
  }),
);
