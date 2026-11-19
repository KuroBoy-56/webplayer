// Degradado del color de fondo del tema sobre las imágenes grandes (portada, ficha, «Ver todo»): 'left' opaco a la
// izquierda, 'bottom' opaco abajo. En los televisores con la app web (LG, Samsung) es un degradado CSS suave: la imagen
// teñida (tintColor) de react-native-web es un filtro SVG que la tele dibuja por bloques (líneas rectas y recuadros
// sombreados), y la rampa lineal marcaba una línea donde empezaba. En Vega, la imagen del paquete teñida como siempre.
import React from 'react';
import { Image, ImageStyle, Platform, StyleProp, View } from 'react-native';
import { alpha, C } from '../theme';

const IMG = { left: require('../../assets/image/grad_left.png'), bottom: require('../../assets/image/grad_bottom.png'), top: require('../../assets/image/grad_top.png') };

// curva suave (smoothstep): sin escalón visible donde empieza ni donde termina el degradado
const STOPS = [0, 0.12, 0.25, 0.38, 0.5, 0.62, 0.75, 0.88, 1];

export function shadeCss(side: 'left' | 'bottom' | 'top', color: string): string {
  const steps = STOPS.map(t => {
    const s = t * t * (3 - 2 * t);
    const a = side === 'bottom' ? s : 1 - s;
    return alpha(color, Math.round(a * 1000) / 1000) + ' ' + Math.round(t * 100) + '%';
  });
  return 'linear-gradient(' + (side === 'left' ? 'to right' : 'to bottom') + ', ' + steps.join(', ') + ')';
}

export function Shade({ side, style }: { side: 'left' | 'bottom' | 'top'; style: StyleProp<ImageStyle> }) {
  // en Vega la imagen va dentro de una caja con el tamaño pedido: una imagen del paquete sin alto (o ancho) en su estilo
  // toma el de su archivo (4 px) aunque tenga top y bottom, y el degradado no se veía
  if (Platform.OS !== 'web') {
    return (
      <View pointerEvents="none" style={style as any}>
        <Image source={IMG[side]} style={{ width: '100%', height: '100%', tintColor: C.bg }} resizeMode="stretch" />
      </View>
    );
  }
  return <View pointerEvents="none" style={[style as any, { backgroundImage: shadeCss(side, C.bg) } as any]} />;
}
