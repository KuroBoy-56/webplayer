// Teclado en pantalla de la app (como Roku): para escribir usuario y contraseña con el control remoto sin el teclado
// del sistema. En algunos Fire TV / el simulador de Vega un TextInput enfocado se quedaba con las flechas (el foco no
// llegaba a los botones) y al salir del campo sonaba el teclado del sistema. Letras, números, símbolos, mayúsculas,
// espacio, ⌫, Borrar y Listo; Atrás cierra sin cambiar nada.
import React, { useEffect, useState } from 'react';
import { BackHandler, Modal, StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/i18n';
import { alpha, C, px, themed } from '../theme';
import { Button } from './ui';

const LETTERS = ['1234567890', 'qwertyuiop', 'asdfghjkl@', 'zxcvbnm._-'];
const SYMBOLS = ['1234567890', '!#$%&*+=?/', '~^()[]{}<>', ":;,'|\\\"`._-"];

export default function KeyboardModal({ title, value, secret, onDone, onClose }: { title: string; value: string; secret?: boolean; onDone: (v: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const [upper, setUpper] = useState(false);
  const [sym, setSym] = useState(false);
  const [show, setShow] = useState(!secret);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose]);
  const rows = (sym ? SYMBOLS : LETTERS).map(r => (upper && !sym ? r.toUpperCase() : r).split(''));
  const shown = text ? (show ? text : '•'.repeat(text.length)) : '';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.shade}>
        <View style={s.box}>
          <Text style={s.title}>{title}</Text>
          <View style={s.field}>
            <Text style={[s.value, !text && s.placeholder]} numberOfLines={1}>
              {shown || title}
            </Text>
            <View style={s.caret} />
          </View>
          {rows.map((r, i) => (
            <View key={i} style={s.row}>
              {r.map((k, j) => (
                <View key={k + j} style={s.key}>
                  <Button label={k} big fontSize={px(32)} width={px(96)} last preferred={i === 1 && j === 0} onPress={() => setText(x => x + k)} />
                </View>
              ))}
            </View>
          ))}
          <View style={s.row}>
            <View style={s.key}>
              <Button label={sym ? 'abc' : upper ? 'abc' : 'ABC'} big width={px(140)} last onPress={() => (sym ? setSym(false) : setUpper(u => !u))} />
            </View>
            <View style={s.key}>
              <Button label={sym ? 'abc' : '#+='} big width={px(140)} last onPress={() => setSym(v => !v)} />
            </View>
            <View style={s.key}>
              <Button label={t('Espacio')} big width={px(200)} last onPress={() => setText(x => x + ' ')} />
            </View>
            <View style={s.key}>
              <Button label="⌫" big width={px(100)} last onPress={() => setText(x => x.slice(0, -1))} />
            </View>
            <View style={s.key}>
              <Button label={t('Borrar')} big width={px(180)} last onPress={() => setText('')} />
            </View>
            {secret ? (
              <View style={s.key}>
                <Button label={show ? t('Ocultar') : t('Mostrar')} big width={px(180)} last onPress={() => setShow(v => !v)} />
              </View>
            ) : null}
          </View>
          <View style={s.done}>
            <Button label={t('Listo')} primary big width={px(300)} last onPress={() => onDone(text)} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = themed(() =>
  StyleSheet.create({
    shade: { flex: 1, backgroundColor: alpha('#000000', 0.8), alignItems: 'center', justifyContent: 'center' },
    box: { backgroundColor: C.bg2, borderRadius: px(14), paddingHorizontal: px(40), paddingVertical: px(34), alignItems: 'center' },
    title: { color: C.text, fontSize: px(40), fontWeight: '800', marginBottom: px(16), alignSelf: 'flex-start' },
    field: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', height: px(80), backgroundColor: C.card, borderRadius: px(8), paddingHorizontal: px(24), marginBottom: px(20) },
    value: { color: C.text, fontSize: px(34), flexShrink: 1 },
    placeholder: { color: C.dim },
    caret: { width: px(3), height: px(40), backgroundColor: C.red, marginLeft: px(4) },
    row: { flexDirection: 'row', marginBottom: px(8) },
    key: { marginHorizontal: px(4) },
    done: { marginTop: px(14) },
  }),
);
