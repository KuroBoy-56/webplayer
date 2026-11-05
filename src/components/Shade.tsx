// Degradado del color de fondo del tema sobre las imágenes grandes (portada, ficha, «Ver todo»): 'left' opaco a la
// izquierda, 'bottom' opaco abajo. En los televisores con la app web (LG, Samsung) es un degradado CSS suave: la imagen
// teñida (tintColor) de react-native-web es un filtro SVG que la tele dibuja por bloques (líneas rectas y recuadros
// sombreados), y la rampa lineal marcaba una línea donde empezaba. En Vega, la imagen del paquete teñida como siempre.
import React from 'react';
import { Image, ImageStyle, Platform, StyleProp, View } from 'react-native';
import { alpha, C } from '../theme';

const IMG = { left: require('../../assets/image/grad_left.png'), bottom: require('../../assets/image/grad_bottom.png') };

// curva suave (smoothstep): sin escalón visible donde empieza ni donde termina el degradado
const STOPS = [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 1];

export function shadeCss(side: 'left' | 'bottom', color: string): string {
  const steps = STOPS.map(t => {
    const s = t * t * (3 - 2 * t);
    const a = side === 'left' ? 1 - s : s;
    return alpha(color, Math.round(a * 1000) / 1000) + ' ' + Math.round(t * 100) + '%';
  });
  return 'linear-gradient(' + (side === 'left' ? 'to right' : 'to bottom') + ', ' + steps.join(', ') + ')';
}

export function Shade({ side, style }: { side: 'left' | 'bottom'; style: StyleProp<ImageStyle> }) {
  if (Platform.OS !== 'web') return <Image source={IMG[side]} style={[style, { tintColor: C.bg }]} resizeMode="stretch" />;
  return <View pointerEvents="none" style={[style as any, { backgroundImage: shadeCss(side, C.bg) } as any]} />;
}
