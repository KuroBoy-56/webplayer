// Memoria del video (2.8.0). Vega cierra la app sin aviso si pasa de 420 MB en primer plano (Low Memory Kill, Amazon:
// «App Performance FAQ»; los Fire TV con Vega OS tienen 1 GB). La caja negra mostraba 48-68 MB de JavaScript al cerrarse:
// lo que llenaba la memoria no se veía ahí (el video entregado al reproductor, lo bajado por adelantado, los índices).
// - Por adelantado: se medía en segundos (40 s) y lo que pesa son bytes: 40 s de un 4K son ~130 MB en el reproductor,
//   más 30 s ya vistos. Ahora como mucho ~40 MB por delante (12-40 s según el archivo) y 6-12 s detrás.
// - Aviso del sistema de memoria baja (AppState «memoryWarning»): la mitad por delante durante 3 minutos.
// - Lo pesado que no hace falta para ver (guardar el índice en el equipo y subirlo a la VPS: textos de 7-34 MB) espera
//   a que se cierre el reproductor (whenNoVideo).
const MB = 1048576;
const BUDGET = 40 * MB;
const PRESSURE_MS = 3 * 60000;
let pressureAt = 0;

// segundos que se entregan al reproductor por delante de lo que se ve; bps: bytes por segundo del archivo (0 = no se sabe)
export function aheadSecs(bps: number): number {
  const s = bps > 0 ? Math.max(12, Math.min(40, BUDGET / bps)) : 40;
  return underPressure() ? Math.max(8, s / 2) : s;
}

// lo ya visto se borra cuando pasa de BEHIND_MAX segundos y quedan BEHIND_KEEP (◀ de unos segundos sin pedir nada)
export const BEHIND_MAX = 12;
export const BEHIND_KEEP = 6;

export function underPressure(): boolean {
  return pressureAt > 0 && Date.now() - pressureAt < PRESSURE_MS;
}

export function notePressure(): void {
  pressureAt = Date.now();
}

// reproductores abiertos (películas, series y canales)
let videos = 0;
let idle: (() => void)[] = [];
export function setVideoOpen(open: boolean): void {
  videos = Math.max(0, videos + (open ? 1 : -1));
  if (videos > 0) return;
  const w = idle;
  idle = [];
  // 3 s después de cerrar: el reproductor termina de soltar el video y la pantalla anterior se vuelve a dibujar
  setTimeout(() => {
    if (videos > 0) {
      idle.push(...w);
      return;
    }
    for (const f of w) f();
  }, 3000);
}

// termina cuando no hay ningún reproductor abierto
export function whenNoVideo(): Promise<void> {
  if (videos === 0) return Promise.resolve();
  return new Promise<void>(r => idle.push(r));
}

// memoria de JavaScript (Hermes) para la caja negra: ' heap=52MB ext=180MB' (ext: datos fuera del montón, como lo bajado
// del video); '' si el motor no la da
export function jsMemory(): string {
  try {
    const s = (globalThis as any).HermesInternal?.getInstrumentedStats?.();
    if (!s) return '';
    const h = s.js_heapSize || s.js_allocatedBytes;
    const e = s.js_mallocSizeEstimate;
    return (h ? ' heap=' + Math.round(h / MB) + 'MB' : '') + (e ? ' ext=' + Math.round(e / MB) + 'MB' : '');
  } catch {
    return '';
  }
}
