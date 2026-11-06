// Cuándo empieza a sonar una película o un capítulo leídos por la app (MP4 y MKV): con 5 s bajados, con el archivo
// entero (si dura menos) o, si el servidor va lento, a los 6 s de abrir con al menos 1,5 s. Antes empezaba con 1,5 s y
// se detenía enseguida («cargando») si el tramo siguiente tardaba. Lo demás se sigue bajando por delante (40 s) sin
// cortar lo que suena. Al cambiar de idioma alcanzan 2 s (se nota menos la pausa).
export const START_SEC = 5;
export const SWITCH_SEC = 2;
const MIN_SEC = 1.5;
const MAX_WAIT = 6000;

export class StartGate {
  private waiting = true;
  private since = Date.now();

  // paused: abrir en pausa (se cambió de idioma con el video en pausa)
  constructor(private need = START_SEC, private paused = false) {}

  get started(): boolean {
    return !this.waiting;
  }

  // ahead: segundos bajados por delante de la imagen; done: ya está todo. true = darle play ahora
  check(ahead: number, done: boolean, now = Date.now()): boolean {
    if (!this.waiting) return false;
    if (!done && ahead < this.need && !(ahead >= MIN_SEC && now - this.since > MAX_WAIT)) return false;
    this.waiting = false;
    return !this.paused;
  }
}
