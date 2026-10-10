// Piezas de interfaz con foco para el control remoto.
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { brand, brandLogo, brandName, useBrandRev } from '../lib/tenant';
import { alpha, C, px, themed } from '../theme';

type FocusProps = {
  onPress?: () => void;
  onFocus?: () => void;
  style?: StyleProp<ViewStyle> | ((focused: boolean) => StyleProp<ViewStyle>);
  children: React.ReactNode | ((focused: boolean) => React.ReactNode);
  preferred?: boolean;
  disabled?: boolean;
};

export function Focusable({ onPress, onFocus, style, children, preferred, disabled }: FocusProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      focusable={!disabled}
      hasTVPreferredFocus={preferred}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => setFocused(false)}
      style={typeof style === 'function' ? style(focused) : style}>
      {typeof children === 'function' ? children(focused) : children}
    </Pressable>
  );
}

// Botón de la app (igual que Roku, Windows y la web): principal = color del distribuidor (rojo
// sin distribuidor) con texto de contraste; secundario = blanco translúcido con borde fino.
// Con el foco del control: borde de 3 px y crece un 5 % con una animación corta.
export type ButtonProps = {
  label: string;
  onPress: () => void;
  primary?: boolean;
  preferred?: boolean;
  icon?: string;
  small?: boolean;
  // fila de ajustes: etiqueta a la izquierda y valor a la derecha
  value?: string;
  // texto a la izquierda (listas de opciones)
  left?: boolean;
  width?: number;
  // más alto (teclado en pantalla, filas de ajustes)
  big?: boolean;
  fontSize?: number;
  last?: boolean;
  disabled?: boolean;
  onFocus?: () => void;
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
};

const BORDER = 3;

export function Button({ label, onPress, primary, preferred, icon, small, value, left, width, big, fontSize, last, disabled, onFocus, ...next }: ButtonProps) {
  useBrandRev();
  const [focused, setFocused] = useState(false);
  const scale = useRef(new Animated.Value(1)).current;
  const grow = (f: boolean) => {
    setFocused(f);
    Animated.timing(scale, { toValue: f ? (value !== undefined || left ? 1.02 : 1.05) : 1, duration: 130, useNativeDriver: true }).start();
  };
  const textColor = primary ? C.onAccent : C.text;
  const row = value !== undefined;
  return (
    <Animated.View style={[!last && s.btnGap, width ? { width } : null, { transform: [{ scale }] }]}>
      <Pressable
        focusable={!disabled}
        hasTVPreferredFocus={preferred}
        onPress={disabled ? undefined : onPress}
        onFocus={() => {
          grow(true);
          onFocus?.();
        }}
        onBlur={() => grow(false)}
        {...next}
        style={[
          s.btn,
          small && s.btnSmall,
          big && s.btnBig,
          primary ? s.btnPrimary : focused ? s.btnGhostF : s.btnGhost,
          (row || left) && s.btnRow,
          disabled && s.btnDisabled,
        ]}>
        <Text style={[s.btnText, small && s.btnTextSmall, fontSize ? { fontSize } : null, { color: textColor }, row && s.btnTextRow]} numberOfLines={1}>
          {icon ? icon + '  ' : ''}
          {label}
        </Text>
        {row && value ? (
          <Text style={[s.btnValue, { color: primary ? C.onAccent : C.sub }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {/* el borde va encima y no ocupa lugar: al enfocar no se mueve el texto */}
        <View pointerEvents="none" style={[s.ring, focused ? s.ringF : primary ? s.ringPrimary : s.ringGhost]} />
      </Pressable>
    </Animated.View>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <View style={s.center}>
      <ActivityIndicator size="large" color={C.red} />
      {label ? <Text style={s.spinText}>{label}</Text> : null}
    </View>
  );
}

export function Message({ text }: { text: string }) {
  return (
    <View style={s.center}>
      <Text style={s.msg}>{text}</Text>
    </View>
  );
}

// logo de la app o el del distribuidor. Un distribuidor sin logo (o si no carga) muestra su
// nombre: nunca el logo de la app.
export function Logo({ size = 120 }: { size?: number }) {
  useBrandRev();
  const uri = brandLogo();
  const [failed, setFailed] = useState('');
  const style = { width: px(size), height: px(size * 0.946) };
  if (uri && failed !== uri) return <Image source={{ uri }} style={style} resizeMode="contain" onError={() => setFailed(uri)} />;
  if (brand()) {
    return (
      <View style={[style, s.nameBox]}>
        <Text style={[s.name, { fontSize: px(Math.max(22, size / 4)) }]} numberOfLines={2} adjustsFontSizeToFit>
          {brandName()}
        </Text>
      </View>
    );
  }
  return <Image source={require('../../assets/image/logo.png')} style={style} resizeMode="contain" />;
}

const s = themed(() =>
  StyleSheet.create({
    btnGap: { marginRight: px(18) },
    btn: { paddingHorizontal: px(34), height: px(56), borderRadius: px(12), justifyContent: 'center', alignItems: 'center', flexDirection: 'row' },
    btnSmall: { height: px(48), paddingHorizontal: px(24) },
    btnBig: { height: px(76) },
    btnRow: { justifyContent: 'space-between', paddingHorizontal: px(28) },
    btnPrimary: { backgroundColor: C.red },
    btnGhost: { backgroundColor: alpha(C.focus, 0.15) },
    btnGhostF: { backgroundColor: alpha(C.focus, 0.25) },
    ring: { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: px(12) },
    ringPrimary: { borderWidth: 0 },
    ringGhost: { borderWidth: 1, borderColor: alpha(C.focus, 0.2) },
    ringF: { borderWidth: BORDER, borderColor: C.focus },
    btnDisabled: { opacity: 0.5 },
    btnText: { fontSize: px(28), fontWeight: '700' },
    btnTextSmall: { fontSize: px(24) },
    btnTextRow: { flexShrink: 1 },
    btnValue: { fontSize: px(26), marginLeft: px(20), flexShrink: 1 },
    nameBox: { justifyContent: 'center' },
    name: { color: C.red, fontWeight: '900' },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: px(40) },
    spinText: { color: C.sub, fontSize: px(28), marginTop: px(24) },
    msg: { color: C.sub, fontSize: px(30), textAlign: 'center' },
  }),
);
