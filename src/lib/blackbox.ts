// «Caja negra» del reproductor (2.6.4). Si la app se cierra sola mientras se ve una película o serie (memoria, el
// reproductor de Amazon: nada que JavaScript pueda atrapar), en la apertura siguiente queda al panel («Errores de las
// apps») lo último que hacía: qué se abrió, los pasos con su segundo y la memoria de JavaScript en cada uno. Se guarda
// en el equipo cada pocos segundos (lo de los últimos ~2 s puede perderse con el cierre).
import { read, remove, write } from './storage';

const KEY = 'bb_play';
const MAX_STEPS = 30;
let cur: { t: number; what: string; steps: string[] } | null = null;
let lastWrite = 0;

// memoria de JavaScript (Hermes): ' heap=123MB'; '' si el motor no la da
function heap(): string {
  try {
    const s = (globalThis as any).HermesInternal?.getInstrumentedStats?.();
    const h = s && (s.js_heapSize || s.js_allocatedBytes);
    if (h) return ' heap=' + Math.round(h / 1048576) + 'MB';
  } catch {
    // sin datos
  }
  return '';
}

function flush(): void {
  if (!cur) return;
  lastWrite = Date.now();
  try {
    write(KEY, JSON.stringify(cur));
  } catch {
    // sin almacenamiento
  }
}

// se abre una película o episodio
export function bbOpen(what: string): void {
  cur = { t: Date.now(), what: what.slice(0, 300), steps: [] };
  bbStep('abrir', true);
}

// un paso (now: guardarlo ya, si no a lo sumo cada 2 s)
export function bbStep(step: string, now = false): void {
  if (!cur) return;
  cur.steps.push(((Date.now() - cur.t) / 1000).toFixed(1) + 's ' + step.slice(0, 300) + heap());
  if (cur.steps.length > MAX_STEPS) cur.steps.splice(0, cur.steps.length - MAX_STEPS);
  if (now || Date.now() - lastWrite > 2000) flush();
}

// se cerró el reproductor sin problemas (o la app pasó a segundo plano: el sistema puede cerrarla ahí sin que sea un
// error)
export function bbClose(): void {
  cur = null;
  try {
    remove(KEY);
  } catch {
    // sin almacenamiento
  }
}

// volvió del segundo plano con el reproductor abierto
export function bbResume(): void {
  if (cur) flush();
}

export function bbPause(): void {
  if (!cur) return;
  try {
    remove(KEY);
  } catch {
    // sin almacenamiento
  }
}

// al abrir la app: lo que quedó de una reproducción que terminó con la app cerrada sola ('' si no hubo)
export function bbPending(): string {
  const raw = read(KEY);
  if (!raw) return '';
  try {
    remove(KEY);
  } catch {
    // sin almacenamiento
  }
  try {
    const j = JSON.parse(raw);
    return String(j.what || '') + '\nabierto: ' + new Date(Number(j.t) || 0).toISOString() + '\n' + (Array.isArray(j.steps) ? j.steps.join('\n') : '');
  } catch {
    return raw.slice(0, 4000);
  }
}
