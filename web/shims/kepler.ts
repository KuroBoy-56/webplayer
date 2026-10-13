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
