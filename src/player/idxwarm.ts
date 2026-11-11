// Índices de Continuar viendo leídos en segundo plano (2.1.0).
//
// Abrir una película o capítulo que este Fire TV todavía no abrió son dos o tres pedidos seguidos al servidor IPTV antes
// de la primera imagen (cabecera, índice y video): 10-15 s con servidores que tardan 3,5 s en contestar cada uno
// (avisos «tardó en empezar»). Los de Continuar viendo son los que más se abren, y muchos se empezaron en otro equipo
// (celular, Roku, otra tele). Mientras se mira el inicio sin ver nada, se leen sus índices de a uno (solo el índice, sin
// video) y quedan guardados en el equipo; al abrirlos el lector pide directo el video desde el segundo guardado: una
// sola espera del servidor. El tráfico es del servidor IPTV (unos MB por título, una vez), nada pasa por la VPS / VDS.
//
// Se detiene apenas se abre un video, una ficha o una miniatura de canal (idxWarmHold) y sigue 3 s después de cerrarlos.
// Solo cuando no se toca el control (2.1.1, keyidle.ts) y de a 2 MB: la navegación no se traba.
// Nunca en líneas de una conexión: otro equipo de la misma cuenta podría estar viendo y el servidor cortaría a uno.
import { hasIndex } from './indexstore';
import { mkvKnown, preloadMkv } from './mkvmse';
import { mp4Known, preloadIndex } from './mp4mse';
import { keyIdleMs } from '../lib/keyidle';

const MAX = 4;
let list: string[] = [];
let holds = 0;
let running: { url: string; stop: () => void } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
// los que no se pudieron leer en esta sesión (no se insiste)
const missed = new Set<string>();
const key = (u: string) => u.replace(/^https?:\/\//i, '');

function known(url: string): boolean {
  return hasIndex(url) || mp4Known(url) || mkvKnown(url);
}

function schedule(ms: number): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(run, ms);
}

// los primeros de Continuar viendo (direcciones de película o del capítulo en curso); maxConn: conexiones de la línea
export function idxWarmList(urls: string[], maxConn: number): void {
  list = maxConn === 1 ? [] : urls.filter(u => /\.(mp4|m4v|mov|mkv)(\?|$)/i.test(u)).slice(0, MAX);
  if (list.length) schedule(4000);
}

// on: se abre algo que usa la línea (reproductor, ficha, miniatura de canal); off: se cerró
export function idxWarmHold(on: boolean): void {
  holds = Math.max(0, holds + (on ? 1 : -1));
  if (holds > 0) {
    if (timer) clearTimeout(timer);
    timer = null;
    const r = running;
    running = null;
    r?.stop();
  } else if (list.length) schedule(3000);
}

async function run(): Promise<void> {
  timer = null;
  if (holds > 0 || running) return;
  // se está navegando: después (2.1.1)
  if (keyIdleMs() < 2500) {
    schedule(1000);
    return;
  }
  const url = list.find(u => !known(u) && !missed.has(key(u)));
  if (!url) return;
  const mkv = /\.mkv(\?|$)/i.test(url);
  const job = mkv ? preloadMkv(url) : preloadIndex(url);
  const mine = { url, stop: job.stop };
  running = mine;
  let r = await job.done.catch(() => '');
  // un «.mp4» que en realidad es MKV: su cabecera como MKV
  if (r === 'mkv' && running === mine) {
    const j2 = preloadMkv(url);
    mine.stop = j2.stop;
    r = await j2.done.catch(() => '');
  }
  if (running !== mine) return;
  running = null;
  if (r !== 'ok' && r !== 'busy') missed.add(key(url));
  schedule(1500);
}
