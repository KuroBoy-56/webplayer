// Aviso del panel (bienvenida o vencimiento). Un solo botón, enfocado de inicio; Atrás también cierra.
import React, { useEffect, useState } from 'react';
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
            {alert.images.length ? <AlertImages images={alert.images} interval={alert.interval} /> : null}
            <View style={s.btns}>
              <Button label={alert.button.toUpperCase()} primary preferred last onPress={onClose} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Imágenes del aviso (Alertas del panel): una sola, fija; varias, cambian cada interval s en el mismo lugar.
// Todas se cargan de inicio (encimadas), así el cambio nunca deja el recuadro vacío.
function AlertImages({ images, interval }: { images: string[]; interval: number }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (images.length < 2) return;
    const id = setInterval(() => setIdx(i => (i + 1) % images.length), Math.max(1, interval) * 1000);
    return () => clearInterval(id);
  }, [images, interval]);
  return (
    <View style={s.img}>
      {images.map((u, i) => (
        <Image key={i + u} source={{ uri: u }} style={[s.imgLayer, { opacity: i === idx ? 1 : 0 }]} resizeMode="contain" />
      ))}
    </View>
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
    img: { width: px(700), height: px(300), marginTop: px(26), borderRadius: px(8), overflow: 'hidden' },
    imgLayer: { position: 'absolute', left: 0, top: 0, width: px(700), height: px(300) },
    btns: { flexDirection: 'row', marginTop: px(34) },
  }),
);
