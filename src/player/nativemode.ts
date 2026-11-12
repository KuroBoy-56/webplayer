// Compatibilidad del modo URL de Vega. En VOD cada fuente tiene su propio intento.
import { read, readJson, write, writeJson } from '../lib/storage';
import { APP_VERSION } from '../version';

export type NativeKind = 'live' | 'vod';

const key = (k: NativeKind) => 'native_' + k + '_' + APP_VERSION;
let liveFails = 0;

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
  if (k === 'vod') return true;
  const v = read(key(k));
  return v !== 'no' && (v === 'ok' || liveFails < 3);
}

// el nativo ya abrió alguna vez en este equipo (con esta versión de la app)
export function nativeKnownGood(k: NativeKind): boolean {
  return read(key(k)) === 'ok';
}

export function nativeWorked(k: NativeKind): void {
  if (k === 'live') liveFails = 0;
  if (read(key(k)) !== 'ok') write(key(k), 'ok');
}

export function nativeFailedOnce(k: 'live'): void {
  if (!nativeKnownGood(k)) liveFails++;
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
