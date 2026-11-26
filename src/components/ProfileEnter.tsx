// Al elegir un perfil (como Netflix, Android y la app de computadora): su avatar va desde la columna de perfiles al
// centro de la pantalla, con el nombre y el circulito debajo, mientras se arma lo de ese perfil (en el infantil, el
// filtro del catálogo). Profiles.tsx la muestra y entra a Inicio cuando termina.
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { C, px } from '../theme';

export function ProfileEnter({ name, avatar }: { name: string; avatar: string }) {
  const t = useRef(new Animated.Value(0)).current;
  const { width } = useWindowDimensions();
  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [t]);
  const move = {
    opacity: t.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] }),
    transform: [
      { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [-width * 0.33, 0] }) },
      { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] }) },
    ],
  };
  const below = { opacity: t.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0, 0, 1] }) };
  return (
    <View style={[StyleSheet.absoluteFill, s.root, { backgroundColor: C.bg }]} pointerEvents="auto">
      <Animated.View style={move}>
        <Image source={{ uri: avatar }} style={s.av} resizeMode="cover" />
      </Animated.View>
      <Animated.View style={[s.below, below]}>
        <Text style={[s.name, { color: C.text }]} numberOfLines={1}>{name}</Text>
        <ActivityIndicator size="large" color={C.red} />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  av: { width: px(200), height: px(200), borderRadius: px(14), backgroundColor: '#333' },
  below: { alignItems: 'center', marginTop: px(26) },
  name: { fontSize: px(30), fontWeight: '700', marginBottom: px(26) },
});
