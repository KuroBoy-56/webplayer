// Idioma de la app: español (textos originales), inglés, portugués (Brasil) y francés.
// La clave de cada texto es el texto en español: t('Cuenta') → 'Account'. «Automático» usa el idioma
// del equipo (las 2 primeras letras); si no es uno de los cuatro, español. Cuenta › Idioma de la app
// lo cambia (pref app_lang) y App vuelve a montar las pantallas con los textos nuevos.
import { I18nManager } from '@amazon-devices/react-native-kepler';
import en from '../i18n/en';
import fr from '../i18n/fr';
import pt from '../i18n/pt';
import { pref, setPref } from './storage';

export type Key = Extract<keyof typeof en, string>;
export type Lang = 'es' | 'en' | 'pt' | 'fr';
export const LANGS: Lang[] = ['es', 'en', 'pt', 'fr'];

const DICT: Record<Exclude<Lang, 'es'>, Record<Key, string>> = { en, pt, fr };

// idioma del sistema (Vega: I18nManager.getSystemLocale(); si no, Intl); '' si no se sabe
function deviceLocale(): string {
  try {
    const m: any = I18nManager;
    const v = m.getSystemLocale?.() || m.getAppLocale?.() || m.getConstants?.().localeIdentifier;
    if (v) return String(v);
  } catch {
    // sin el módulo nativo
  }
  try {
    const nav = (globalThis as any).navigator;
    if (nav?.language) return String(nav.language);
  } catch {
    // sin navigator
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || '';
  } catch {
    return '';
  }
}

let device: Lang | null = null;
export function deviceLang(): Lang {
  if (!device) {
    const c = deviceLocale().slice(0, 2).toLowerCase();
    device = (LANGS as string[]).includes(c) ? (c as Lang) : 'es';
  }
  return device;
}

// 'auto' o el elegido en Cuenta
export function langChoice(): 'auto' | Lang {
  const p = pref('app_lang', 'auto');
  return (LANGS as string[]).includes(p) ? (p as Lang) : 'auto';
}

export function lang(): Lang {
  const c = langChoice();
  return c === 'auto' ? deviceLang() : c;
}

let listener: () => void = () => {};
let justChanged = false;
export function onLangChange(fn: () => void): void {
  listener = fn;
}

export function setLang(choice: 'auto' | Lang): void {
  if (choice === langChoice()) return;
  setPref('app_lang', choice);
  justChanged = true;
  listener();
}

// recién cambiado el idioma: Main vuelve a abrir Cuenta (langChanged) y Cuenta pone el foco en
// esa fila (takeLangChanged, una sola vez)
export function langChanged(): boolean {
  return justChanged;
}
export function takeLangChanged(): boolean {
  const j = justChanged;
  justChanged = false;
  return j;
}

// texto en el idioma de la app; {x} se reemplaza con vars.x
export function t(key: Key, vars?: Record<string, string | number>): string {
  const l = lang();
  let s: string = l === 'es' ? key : DICT[l][key] || key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}
