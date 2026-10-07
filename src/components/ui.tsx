// Piezas de interfaz con foco para el control remoto.
import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { C, px } from '../theme';

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

export function Button({
  label,
  onPress,
  primary,
  preferred,
  icon,
  small,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  preferred?: boolean;
  icon?: string;
  small?: boolean;
}) {
  return (
    <Focusable
      onPress={onPress}
      preferred={preferred}
      style={f => [
        s.btn,
        small && s.btnSmall,
        primary ? s.btnPrimary : s.btnGhost,
        f && (primary ? s.btnPrimaryF : s.btnGhostF),
      ]}>
      {f => (
        <Text style={[s.btnText, small && s.btnTextSmall, f && s.btnTextF]} numberOfLines={1}>
          {icon ? icon + '  ' : ''}
          {label}
        </Text>
      )}
    </Focusable>
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

export function Logo({ size = 120 }: { size?: number }) {
  return <Image source={require('../../assets/image/logo.png')} style={{ width: px(size), height: px(size * 0.946) }} resizeMode="contain" />;
}

const s = StyleSheet.create({
  btn: { paddingHorizontal: px(34), height: px(64), borderRadius: px(8), justifyContent: 'center', alignItems: 'center', marginRight: px(18), borderWidth: px(3), borderColor: 'transparent' },
  btnSmall: { height: px(52), paddingHorizontal: px(24) },
  btnPrimary: { backgroundColor: C.red },
  btnPrimaryF: { backgroundColor: '#ffffff', borderColor: '#ffffff', transform: [{ scale: 1.06 }] },
  btnGhost: { backgroundColor: 'rgba(109,109,110,0.7)' },
  btnGhostF: { backgroundColor: '#ffffff', borderColor: '#ffffff', transform: [{ scale: 1.06 }] },
  btnText: { color: '#ffffff', fontSize: px(28), fontWeight: '700' },
  btnTextSmall: { fontSize: px(24) },
  btnTextF: { color: '#000000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: px(40) },
  spinText: { color: C.sub, fontSize: px(28), marginTop: px(24) },
  msg: { color: C.sub, fontSize: px(30), textAlign: 'center' },
});
