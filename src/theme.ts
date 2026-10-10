import { Dimensions } from 'react-native';

// el diseño está hecho para 1920x1080 y se escala al tamaño real de la pantalla
const { width } = Dimensions.get('window');
const k = width > 0 ? width / 1920 : 1;
export const px = (n: number) => Math.round(n * k);

const BASE = {
  bg: '#141414',
  bg2: '#1f1f1f',
  card: '#2a2a2a',
  red: '#E50914',
  onAccent: '#ffffff',
  text: '#ffffff',
  sub: '#b3b3b3',
  dim: '#808080',
  // anillo y fondo del elemento enfocado, y el texto encima de ese fondo
  focus: '#ffffff',
  onFocus: '#000000',
  green: '#46d369',
};

// Colores de la app. Son mutables: los colores del distribuidor (panel) se aplican con
// setPalette() antes de la primera pantalla.
export const C = { ...BASE };

export const SIDE = px(80);

// Colores del distribuidor (hex #RRGGBB). null = los de la app.
export type Palette = { accent: string; bg: string; surface: string; text: string };

const HEX = /^#[0-9A-Fa-f]{6}$/;

export function validPalette(p: any): Palette | null {
  if (!p || typeof p !== 'object') return null;
  for (const key of ['accent', 'bg', 'surface', 'text']) if (typeof p[key] !== 'string' || !HEX.test(p[key])) return null;
  return { accent: p.accent, bg: p.bg, surface: p.surface, text: p.text };
}

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

// luminancia relativa WCAG
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// texto negro o blanco sobre el color de acento (el de más contraste)
export function onAccentFor(accent: string): string {
  const l = luminance(accent);
  return (l + 0.05) / 0.05 > 1.05 / (l + 0.05) ? '#000000' : '#ffffff';
}

export function alpha(hex: string, a: number): string {
  const [r, g, b] = rgb(hex);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

// a mezclado t (0..1) hacia b
export function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  return '#' + x.map((v, i) => hex2(v + (y[i] - v) * t)).join('');
}

export function paletteColors(p: Palette | null): typeof BASE {
  if (!p) return { ...BASE };
  return {
    ...BASE,
    bg: p.bg,
    bg2: p.surface,
    card: mix(p.surface, p.text, 0.08),
    red: p.accent,
    onAccent: onAccentFor(p.accent),
    text: p.text,
    sub: alpha(p.text, 0.65),
    dim: alpha(p.text, 0.45),
    focus: p.text,
    onFocus: p.bg,
  };
}

// Estilos que dependen de C: se vuelven a crear cuando cambian los colores.
const sheets: { obj: Record<string, any>; make: () => Record<string, any> }[] = [];

export function themed<T extends Record<string, any>>(make: () => T): T {
  const obj = make();
  sheets.push({ obj, make });
  return obj;
}

let applied = '';
// devuelve true si los colores cambiaron
export function setPalette(p: Palette | null): boolean {
  const sig = p ? [p.accent, p.bg, p.surface, p.text].join() : '';
  if (sig === applied) return false;
  applied = sig;
  Object.assign(C, paletteColors(p));
  for (const sh of sheets) Object.assign(sh.obj, sh.make());
  return true;
}
