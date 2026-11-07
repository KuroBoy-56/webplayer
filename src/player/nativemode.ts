// ¿El reproductor nativo de Vega (modo directo, src = dirección) abre en este equipo? Amazon lo recomienda para MP4 / MKV
// y, desde Vega OS 2.0, para canales MPEG-TS en vivo: es lo que hacen Android, LG y Roku (rápido y sin trabajo de la app).
// Se aprende por equipo y versión de la app: si abre una vez, se sigue usando (un título o canal que falla vuelve al
// lector de la app, solo ese). Películas: si falla 2 veces seguidas sin haber abierto nunca, el lector de la app para
// todo. Canales: con 3 seguidas sin abrir nunca, el lector solo hasta cerrar la app (antes quedaba apagado para siempre
// por fallos pasajeros: canal caído, equipo ocupado, y los canales se quedaban en el lector de la app, con microcortes).
import { read, write } from '../lib/storage';
import { APP_VERSION } from '../version';

export type NativeKind = 'live' | 'vod';

const key = (k: NativeKind) => 'native_' + k + '_' + APP_VERSION;
const fails: Record<NativeKind, number> = { live: 0, vod: 0 };
// Películas en un equipo donde el nativo ya abrió: las que seguidas no arrancan con él en esta sesión (servidor lento,
// índice al final del archivo). Con 2, el resto de la sesión va directo al lector de la app, sin esperarlo cada vez.
let vodMisses = 0;

export function nativeAllowed(k: NativeKind): boolean {
  const v = read(key(k));
  if (v === 'no') return false;
  return k === 'vod' ? vodMisses < 2 : v === 'ok' || fails.live < 3;
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
  ++fails[k];
  if (k === 'vod' && fails.vod >= 2) write(key(k), 'no');
}

// Vega OS anterior a 2.0 rechaza al instante las direcciones http en modo directo (error 4, Amazon: arreglado en 2.0).
// Visto una vez, el resto de la sesión no se prueba el nativo con http (ni canales ni películas): sin el intento fallido
// ni el «Reconectando…» de cada canal. Con https se sigue probando.
let httpRejected = false;
export function nativeRejectedHttp(): void {
  httpRejected = true;
}
export function nativeHttpOk(url: string): boolean {
  return !(httpRejected && /^http:/i.test(url));
}
