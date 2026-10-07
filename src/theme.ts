import { Dimensions } from 'react-native';

// el diseño está hecho para 1920x1080 y se escala al tamaño real de la pantalla
const { width } = Dimensions.get('window');
const k = width > 0 ? width / 1920 : 1;
export const px = (n: number) => Math.round(n * k);

export const C = {
  bg: '#141414',
  bg2: '#1f1f1f',
  card: '#2a2a2a',
  red: '#E50914',
  text: '#ffffff',
  sub: '#b3b3b3',
  dim: '#808080',
  focus: '#ffffff',
  green: '#46d369',
};

export const SIDE = px(80);
