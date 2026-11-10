// ¿El reproductor nativo de Vega (modo directo, src = dirección) abre en este equipo? Amazon lo recomienda para MP4 / MKV
// y, desde Vega OS 2.0, para canales MPEG-TS en vivo: es lo que hacen Android, LG y Roku (rápido y sin trabajo de la app).
// Se aprende por equipo y versión de la app: si abre una vez, se sigue usando (un título o canal que falla vuelve al
// lector de la app, solo ese). Películas: si falla 2 veces seguidas sin haber abierto nunca, el lector de la app para
// todo. Canales: con 3 seguidas sin abrir nunca, el lector solo hasta cerrar la app (antes quedaba apagado para siempre
// por fallos pasajeros: canal caído, equipo ocupado, y los canales se quedaban en el lector de la app, con microcortes).
import { read, readJson, write, writeJson } from '../lib/storage';
import { APP_VERSION } from '../version';

export type NativeKind = 'live' | 'vod';

const key = (k: NativeKind) => 'native_' + k + '_' + APP_VERSION;
const fails: Record<NativeKind, number> = { live: 0, vod: 0 };
// Películas en un equipo donde el nativo ya abrió: las que seguidas no arrancan con él en esta sesión (servidor lento,
// índice al final del archivo). Con 2, el resto de la sesión va directo al lector de la app, sin esperarlo cada vez.
let vodMisses = 0;

// Canales que el reproductor nativo no pudo abrir 2 veces seguidas sin llegar a verse (p. ej. [IZZI] BABY TV: «error del
// reproductor» a los 0 s en dos aperturas): se recuerdan 2 días en el equipo y van directo al lector de la app. Antes
// cada apertura de ese canal repetía el intento fallido con el nativo (se olvidaba al cerrar la app). Un fallo suelto
// (canal caído un momento) no lo marca. 2.0.14
const BAD_KEY = 'native_live_bad_1';
const BAD_TTL = 2 * 86400000;
type Bad = { n: number; t: number };
let bad: Record<string, Bad> | null = null;
// servidor + número del canal (sin usuario ni clave, sin http/https ni formato)
const chanKey = (url: string) => {
  const m = /^https?:\/\/([^/]+)\/.*?(\d+)(?:\.[a-z0-9]+)?(?:\?.*)?$/i.exec(url);
  return m ? m[1].toLowerCase() + '/' + m[2] : '';
};
const bads = () => bad || (bad = readJson<Record<string, Bad>>(BAD_KEY) || {});
export function nativeLiveBad(url: string): boolean {
  const e = bads()[chanKey(url)];
  return !!e && e.n >= 2 && Date.now() - e.t < BAD_TTL;
}
// el nativo no llegó a mostrar el canal. sure: falló dos veces seguidas, cada una con un reproductor nuevo (2.0.15:
// playback.liveNext): ya es seguro, se marca de una vez
export function markNativeLiveBad(url: string, sure = false): void {
  const k = chanKey(url);
  if (!k) return;
  const all = bads();
  const e = all[k];
  const n = e && Date.now() - e.t < BAD_TTL ? e.n + 1 : 1;
  all[k] = { n: sure ? Math.max(2, n) : n, t: Date.now() };
  const ks = Object.keys(all);
  if (ks.length > 200) {
    ks.sort((x, y) => all[x].t - all[y].t);
    for (const x of ks.slice(0, ks.length - 200)) delete all[x];
  }
  writeJson(BAD_KEY, all);
}
// el nativo mostró el canal: se olvidan sus fallos
export function nativeLiveGood(url: string): void {
  const k = chanKey(url);
  const all = bads();
  if (!k || !all[k]) return;
  delete all[k];
  writeJson(BAD_KEY, all);
}

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
// true = recién se supo (la primera vez en la sesión)
export function nativeRejectedHttp(): boolean {
  if (httpRejected) return false;
  httpRejected = true;
  return true;
}
export function nativeHttpOk(url: string): boolean {
  return !(httpRejected && /^http:/i.test(url));
}
