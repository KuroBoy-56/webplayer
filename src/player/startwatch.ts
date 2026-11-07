// Vega no avisa ningún error cuando no puede decodificar un video (Amazon, notas de Vega OS 2.0: «playback appears to
// load forever»): la película quedaba «cargando» 45 s. Con al menos 3 s bajados por delante y la imagen sin avanzar
// nunca en 8 s (sin contar los saltos que hace la app), el lector la da por no decodificable y se sigue con otro camino.
export class StartWatch {
  private from = -1;
  private since = 0;
  started = false;

  // la app movió la imagen a propósito (salto a un tramo): se cuenta desde ahí
  moved(to: number): void {
    if (!this.started) {
      this.from = to;
      this.since = 0;
    }
  }

  // true = con video por delante y sin imagen (una sola vez)
  stuck(t: number, ahead: number, paused: boolean, now = Date.now()): boolean {
    if (this.started) return false;
    if (this.from < 0) this.from = t;
    if (t - this.from > 0.5) {
      this.started = true;
      return false;
    }
    if (paused || ahead < 3) {
      this.since = 0;
      return false;
    }
    if (!this.since) this.since = now;
    if (now - this.since < 8000) return false;
    this.started = true;
    return true;
  }
}
