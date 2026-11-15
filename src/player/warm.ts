// Índice del video leído por adelantado desde la ficha del título (2.0.14).
//
// Abrir una película o capítulo por primera vez son tres pedidos seguidos al servidor IPTV (cabecera, índice y el primer
// tramo del video); con servidores que tardan ~6 s en contestar cada uno, ~20 s. La ficha ya pedía los idiomas apenas
// se abre (warmTracks); ahora también prepara el video que se va a ver (película: la de la ficha; serie: el capítulo de
// Continuar o el enfocado): lee su índice (queda en memoria y guardado en el equipo) y, en MP4, deja pedidos los
// primeros segundos del video en el punto donde va a abrir. Al pulsar Reproducir el lector ya preparado pasa al
// reproductor (Mp4Mse.open): si la ficha estuvo abierta lo suficiente no hay que esperar al servidor; si se pulsa antes,
// sigue con los mismos pedidos (no se pide nada dos veces). Al salir de la ficha sin ver nada, lo que estaba en camino
// se corta.
import { hasIndex } from './indexstore';
import { mkvKnown, preloadMkv } from './mkvmse';
import { mp4Known, preloadMp4 } from './mp4mse';
import { sharedKnown } from './sharedindex';
import { nativeVodAllowed, seedTitleLang, titleLangOf } from './playback';
import { isSingle, lineLimit } from './rangeget';

let current: { url: string; stop: () => void } | null = null;

// ¿el lector ya tiene (o está leyendo) el índice de este archivo? Entonces Player no pide la cabecera por adelantado
export function vodKnown(url: string): boolean {
  return hasIndex(url) || mp4Known(url) || mkvKnown(url) || sharedKnown(url);
}

// at: segundo donde se va a abrir (Continuar viendo) o 0; lang: idioma guardado para el título
export function warmIndex(url: string, at = 0, lang = ''): void {
  if (current?.url === url) return;
  warmStop();
  if (/\.mkv(\?|$)/i.test(url)) {
    if (mkvKnown(url)) return;
    current = { url, stop: preloadMkv(url).stop };
    return;
  }
  // (un «.mp4» que ya se supo que es MKV lo abre el lector de MKV con su cabecera guardada)
  if (!/\.(mp4|m4v|mov)(\?|$)/i.test(url) || mkvKnown(url)) return;
  const pre = preloadMp4(url, at, lang);
  const mine = { url, stop: pre.stop };
  current = mine;
  // un «.mp4» que en realidad es MKV: su cabecera como MKV
  pre.done.then(r => {
    if (r === 'mkv' && current === mine) current = { url, stop: preloadMkv(url).stop };
  }).catch(() => {});
}

// Desde la ficha: primero el idioma guardado para el título en otro equipo (hint: «play» del avance del panel), después
// el video preparado con ese idioma
// isFree (2.6.8): en líneas de una conexión, si el servidor dice que la línea está libre
export function warmVideo(url: string, at: number, hint?: { a?: string; ai?: number }, isFree?: () => Promise<boolean>): void {
  if (hint?.a) seedTitleLang(url, String(hint.a), typeof hint.ai === 'number' ? hint.ai : -1);
  // Con más conexiones se lee el índice mientras se mira la ficha: al pulsar Reproducir el lector solo pide el video
  // (2.1.3). En una línea de una conexión la ficha no la ocupaba (el reproductor de Amazon abría directo: cabecera,
  // índice y video, tres esperas de ~9 s con servidores lentos). 2.6.8: también, si el servidor dice que la línea no tiene
  // ninguna conexión en uso (otro equipo de la misma cuenta viendo no se corta); al pulsar Reproducir el lector sigue
  // con lo leído (Playback.nativeVodPlanned)
  if (nativeVodAllowed(url) && (lineLimit() <= 1 || isSingle(url))) {
    warmStop();
    if (!isFree || !/\.(mp4|m4v|mov|mkv)(\?|$)/i.test(url)) return;
    const my = ++asking;
    isFree().then(ok => {
      if (ok && my === asking) warmIndex(url, at, titleLangOf(url));
    }).catch(() => {});
    return;
  }
  warmIndex(url, at, titleLangOf(url));
}
// pregunta en curso a la línea (una nueva o warmStop la deja sin efecto)
let asking = 0;

// se salió de la ficha (o se enfocó otro capítulo): lo que no terminó se corta
export function warmStop(except?: string): void {
  if (!except || current?.url !== except) asking++;
  if (!current || current.url === except) return;
  const c = current;
  current = null;
  c?.stop();
}
