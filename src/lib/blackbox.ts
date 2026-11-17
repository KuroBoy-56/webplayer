// «Caja negra» del reproductor (2.6.4). Si la app se cierra sola mientras se ve una película o serie (memoria, el
// reproductor de Amazon: nada que JavaScript pueda atrapar), en la apertura siguiente queda al panel («Errores de las
// apps») lo último que hacía: qué se abrió, los pasos con su segundo y la memoria de JavaScript en cada uno. Se guarda
// en el equipo cada pocos segundos (lo de los últimos ~2 s puede perderse con el cierre).
// 2.6.11: en segundo plano (Inicio del control, otra app, el televisor apagado) no se guarda nada: ahí el sistema puede
// cerrar la app cuando quiera y eso no es un error. Antes el cierre del reproductor al pasar a segundo plano («se cierra
// el reproductor») volvía a guardar la caja y llegaba al panel como «La app se cerró sola». Al volver se guarda otra vez.
import { read, remove, write } from './storage';

const KEY = 'bb_play';
const MAX_STEPS = 30;
let cur: { t: number; what: string; steps: string[] } | null = null;
let lastWrite = 0;
// la app está en segundo plano: los pasos quedan en memoria, nada se guarda
let paused = false;

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
  if (!cur || paused) return;
  lastWrite = Date.now();
  try {
    write(KEY, JSON.stringify(cur));
  } catch {
    // sin almacenamiento
  }
}

// se abre una película o episodio (si ya había una caja abierta, por un reproductor nuevo o el episodio siguiente, se
// sigue en la misma: los pasos de antes son los que explican un cierre)
export function bbOpen(what: string): void {
  if (cur) {
    bbStep('abrir ' + what, true);
    return;
  }
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
  paused = false;
  try {
    remove(KEY);
  } catch {
    // sin almacenamiento
  }
}

// volvió del segundo plano con el reproductor abierto: se guarda otra vez (un cierre desde aquí sí es un error)
export function bbResume(): void {
  if (!paused) return;
  paused = false;
  if (cur) bbStep('vuelve del segundo plano', true);
}

// pasó a segundo plano: se borra lo guardado y no se guarda nada hasta volver
export function bbPause(): void {
  if (paused) return;
  if (cur) bbStep('segundo plano');
  paused = true;
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
