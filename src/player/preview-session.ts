// Una sola vista previa puede poseer el reproductor. La pantalla completa
// espera su cierre asíncrono para liberar la conexión y el decodificador.
import type { VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import type { Playback } from './playback';

type Stop = () => Promise<void>;
let current: Stop | null = null;
// la miniatura que está sonando puede entregar su reproductor a la pantalla grande (give: true = lo entregó)
let currentGive: (() => boolean) | null = null;

// Pantalla grande con el mismo reproductor de la miniatura (como Roku, que agranda el mismo video): sin cerrarlo ni
// volver a abrir el canal (antes tardaba y en algunos canales la imagen se congelaba al empezar de nuevo)
type Given = { url: string; v: VideoPlayer; c: Playback; at: number };
let given: Given | null = null;

export function offerPreview(g: Given): void {
  given = g;
}

// el reproductor de la miniatura para el canal url (si la miniatura lo entregó hace menos de 5 s)
export function takePreview(url: string): Given | null {
  const g = given;
  given = null;
  if (g && g.url === url && Date.now() - g.at < 5000) return g;
  // entregado pero no es para este canal (o ya venció): se cierra (antes quedaba abierto, con su conexión)
  if (g) closePlayer(g.v, g.c);
  return null;
}

function closePlayer(v: VideoPlayer, c: Playback): void {
  try {
    v.pause();
  } catch {
    // ya cerrado
  }
  let released: Promise<void> = Promise.resolve();
  try {
    released = c.destroy();
  } catch {
    // sin motor
  }
  playerClosing(released.then(() => v.deinitialize(), () => v.deinitialize()));
}

// Al revés (2.0.14): al salir de la pantalla grande con el canal sonando, ese mismo reproductor vuelve a la miniatura de
// TV en vivo (solo cambia de superficie, como Roku): sin cortar el canal ni abrirlo otra vez. La pantalla grande lo
// ofrece al cerrarse; la miniatura del mismo canal lo toma; si nadie lo toma en 4 s (se salió de TV en vivo, se eligió
// otro canal), se cierra como siempre.
type Returned = { id: string; v: VideoPlayer; c: Playback; at: number };
let returned: Returned | null = null;
let returnTimer: ReturnType<typeof setTimeout> | null = null;

export function offerReturn(id: string, v: VideoPlayer, c: Playback): void {
  dropReturn();
  returned = { id, v, c, at: Date.now() };
  returnTimer = setTimeout(dropReturn, 4000);
}

export function takeReturn(id: string): Returned | null {
  const r = returned;
  if (!r || r.id !== id) return null;
  returned = null;
  if (returnTimer) clearTimeout(returnTimer);
  returnTimer = null;
  return r;
}

// nadie lo tomó (o se va a abrir otro canal): se cierra
export function dropReturn(): void {
  const r = returned;
  returned = null;
  if (returnTimer) clearTimeout(returnTimer);
  returnTimer = null;
  if (r) closePlayer(r.v, r.c);
}

// la pantalla grande se abrió desde TV en vivo (la miniatura está debajo y puede recibir el reproductor de vuelta)
let liveOrigin = false;
export function markLiveOrigin(): void {
  liveOrigin = true;
}
export function takeLiveOrigin(): boolean {
  const x = liveOrigin;
  liveOrigin = false;
  return x;
}

// OK otra vez en el canal de la miniatura: la entrega a la pantalla grande si ya suena; si no, se cierra como siempre
export function handPreview(): boolean {
  const give = currentGive;
  if (give && give()) {
    current = null;
    currentGive = null;
    return true;
  }
  void stopLivePreview();
  return false;
}
let released: Promise<void> = Promise.resolve();

export function stopLivePreview(): Promise<void> {
  const stop = current;
  current = null;
  currentGive = null;
  if (stop) released = Promise.all([released, stop()]).then(() => {}, () => {});
  return released;
}

// Cierre del reproductor de pantalla grande (se libera en segundo plano). Amazon: el equipo tiene un solo decodificador y
// el reproductor anterior debe cerrarse antes de iniciar el siguiente (si no, el nuevo da error al darle el video). La
// miniatura y el reproductor siguiente esperan TODOS los cierres pendientes (cada uno como mucho 5 s). Antes se esperaba
// solo el último: al cambiar rápido con ▲▼, el canal de paso (que no llegó a iniciarse) se cerraba al instante y el
// siguiente arrancaba mientras el anterior todavía se cerraba: pantalla negra y el canal se volvía a cargar
let playerReleased: Promise<void> = Promise.resolve();
export function playerClosing(p: Promise<void>): void {
  const capped = Promise.race([p.then(() => {}, () => {}), new Promise<void>(r => setTimeout(r, 5000))]);
  playerReleased = Promise.all([playerReleased, capped]).then(() => {});
}

export function waitForLivePreview(): Promise<void> {
  return Promise.all([released, playerReleased]).then(() => {});
}

// el canal que sonaba al cerrar la pantalla grande (se pudo cambiar con ▲▼): TV en vivo pone ahí el foco y la miniatura
let lastLive = '';
export function setLastLive(id: string): void {
  lastLive = id;
}
export function takeLastLive(): string {
  const id = lastLive;
  lastLive = '';
  return id;
}

export function registerLivePreview(stop: Stop, give?: () => boolean): () => void {
  void stopLivePreview();
  current = stop;
  currentGive = give || null;
  return () => {
    if (current === stop) void stopLivePreview();
    else void stop(); // El cierre de cada sesión es idempotente.
  };
}
