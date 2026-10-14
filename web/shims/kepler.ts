// @amazon-devices/react-native-kepler en el televisor: eventos del control remoto y salir de la app.
import { useEffect, useRef } from 'react';
import { exitApp } from '../back';
import { onRemote } from '../remote';

export type HWEvent = { eventType: string; eventKeyAction?: number };

export function useTVEventHandler(h: (e: HWEvent) => void): void {
  const ref = useRef(h);
  ref.current = h;
  useEffect(() => onRemote(e => ref.current(e)), []);
}

export function useKeplerBackHandler() {
  return { exitApp };
}

// idioma del televisor para «Automático» (src/lib/i18n.ts): el LOCALE de tizen.systeminfo ("es_MX")
// cuando ya respondió; antes, navigator.language (el del sistema en el navegador de Tizen)
let tvLocale = '';
try {
  (globalThis as any).tizen?.systeminfo?.getPropertyValue?.('LOCALE', (l: any) => {
    tvLocale = String(l?.language || '');
  });
} catch {
  // fuera del televisor
}
export const I18nManager = {
  getSystemLocale: (): string => tvLocale || (typeof navigator !== 'undefined' ? navigator.language : '') || '',
};
