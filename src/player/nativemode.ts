// ¿El reproductor nativo de Vega (modo directo, src = dirección) abre en este equipo? Amazon lo recomienda para MP4 / MKV
// y, desde Vega OS 2.0, para canales MPEG-TS en vivo: es lo que hacen Android, LG y Roku (rápido y sin trabajo de la app).
// Se aprende por equipo y versión de la app: si abre una vez, se sigue usando (un título o canal que falla vuelve al
// lector de la app, solo ese); si falla 2 veces seguidas sin haber abierto nunca, el lector de la app para todo.
import { read, write } from '../lib/storage';
import { APP_VERSION } from '../version';

export type NativeKind = 'live' | 'vod';

const key = (k: NativeKind) => 'native_' + k + '_' + APP_VERSION;
const fails: Record<NativeKind, number> = { live: 0, vod: 0 };
// Películas en un equipo donde el nativo ya abrió: las que seguidas no arrancan con él en esta sesión (servidor lento,
// índice al final del archivo). Con 2, el resto de la sesión va directo al lector de la app, sin esperarlo cada vez.
let vodMisses = 0;

export function nativeAllowed(k: NativeKind): boolean {
  return read(key(k)) !== 'no' && (k !== 'vod' || vodMisses < 2);
}

export function nativeWorked(k: NativeKind): void {
  fails[k] = 0;
  if (k === 'vod') vodMisses = 0;
  if (read(key(k)) !== 'ok') write(key(k), 'ok');
}

export function nativeFailedOnce(k: NativeKind): void {
  if (read(key(k)) === 'ok') {
    if (k === 'vod') vodMisses++;
    return;
  }
  if (++fails[k] >= 2) write(key(k), 'no');
}
