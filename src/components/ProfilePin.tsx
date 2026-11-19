// PIN de 4 números de un perfil con el teclado de la app (nunca un campo del sistema que se quede con las flechas).
// Al completar los 4 números se comprueba solo (onSubmit devuelve el error para mostrar, o '' si está bien). El PIN no
// se guarda en el equipo.
import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Modal, StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { alpha, C, px, themed } from '../theme';
import { Button } from './ui';

// 'Borrar' se traduce al dibujar la tecla
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'Borrar', '0', '⌫'];

type Props = { title: string; sub?: string; onSubmit: (pin: string) => Promise<string>; onClose: () => void; onForgot?: () => void };

export default function ProfilePin({ title, sub, onSubmit, onClose, onForgot }: Props) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);

  const press = (k: string) => {
    if (busy) return;
    setErr('');
    if (k === '⌫') return setPin(p => p.slice(0, -1));
    if (k === 'Borrar') return setPin('');
    if (pin.length >= 4) return;
    const next = pin + k;
    setPin(next);
    if (next.length < 4) return;
    setBusy(true);
    onSubmit(next).then(e => {
      if (!alive.current) return;
      setBusy(false);
      if (e) {
        setErr(e);
        setPin('');
      }
    });
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.back}>
        <View style={s.box}>
          <Text style={s.title}>{title}</Text>
          {sub ? <Text style={s.sub}>{sub}</Text> : null}
          <View style={s.dots}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[s.dot, i < pin.length && s.dotOn]}>
                {i < pin.length ? <View style={s.dotFill} /> : null}
              </View>
            ))}
          </View>
          <Text style={s.err}>{busy ? t('Comprobando…') : err}</Text>
          <View style={s.pad}>
            {KEYS.map((k, i) => (
              <View key={k} style={s.key}>
                <Button label={k === 'Borrar' ? t('Borrar') : k} big fontSize={k.length === 1 ? px(36) : undefined} width={px(190)} last preferred={i === 0} onPress={() => press(k)} />
              </View>
            ))}
          </View>
          <View style={s.row}>
            {onForgot ? <Button label={t('¿Olvidaste el PIN?')} small onPress={onForgot} /> : null}
            <Button label={t('Cancelar')} small last onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    back: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
    box: { backgroundColor: C.bg2, borderRadius: px(14), paddingHorizontal: px(50), paddingVertical: px(40), width: px(760), alignItems: 'center' },
    title: { color: C.text, fontSize: px(36), fontWeight: '800', textAlign: 'center' },
    sub: { color: C.sub, fontSize: px(26), marginTop: px(10), textAlign: 'center' },
    dots: { flexDirection: 'row', marginTop: px(30) },
    dot: { width: px(76), height: px(90), borderRadius: px(10), borderWidth: px(3), borderColor: alpha(C.text, 0.35), marginHorizontal: px(10), justifyContent: 'center', alignItems: 'center' },
    dotOn: { borderColor: C.text },
    dotFill: { width: px(22), height: px(22), borderRadius: px(11), backgroundColor: C.text },
    err: { color: '#ff7b7b', fontSize: px(24), minHeight: px(34), marginTop: px(14), textAlign: 'center' },
    pad: { flexDirection: 'row', flexWrap: 'wrap', width: px(3 * 206), marginTop: px(6) },
    key: { width: px(206), alignItems: 'center', marginBottom: px(12) },
    row: { flexDirection: 'row', marginTop: px(14) },
  }),
);
