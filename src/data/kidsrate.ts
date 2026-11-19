// Clasificación de edad de TMDB para el perfil infantil (api/kids_rate.php del panel, docs/PERFILES.md sección 5):
// lo «dudoso» se ve solo si el panel dice 'ok'. Se pide en segundo plano (nunca se espera para mostrar una pantalla) y
// se guarda por distribuidor; cuando llegan veredictos nuevos se vuelve a armar el catálogo infantil.
import { readJson, writeJson } from '../lib/storage';
import { str } from '../lib/util';

export type RateNeed = { t: 'm' | 's'; id?: string; n?: string; y?: string };
type Map = Record<string, [string, number]>;

const TTL: Record<string, number> = { ok: 30 * 86400, no: 30 * 86400, '?': 7 * 86400, wait: 120 };
const EVERY = 15000;
const MAX_KEEP = 20000;

// el pedido al panel y la clave por distribuidor los pone state.ts (así el catálogo no depende del panel)
let post: (items: unknown[]) => Promise<any> = async () => null;
let key: () => string = () => 'kids_rate';
export function bindKidsRate(request: (items: unknown[]) => Promise<any>, storeKey: () => string): void {
  post = request;
  key = storeKey;
}

let map: Map | null = null;
let mapKey = '';

function load(): Map {
  if (map && mapKey === key()) return map;
  mapKey = key();
  map = readJson<Map>(mapKey) || {};
  return map;
}

// 'ok' | 'no' | '?' | '' (no se sabe todavía o ya venció)
export function verdict(q: string): string {
  const e = load()[q];
  if (!e) return '';
  const [v, at] = e;
  if (Date.now() / 1000 - at > (TTL[v] ?? 0)) return '';
  return v === 'wait' ? '' : v;
}

let pending: Record<string, RateNeed> = {};
let running = false;
let lastRun = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let onChange: () => void = () => {};

export function onVerdicts(fn: () => void): void {
  onChange = fn;
}

// títulos sin veredicto: se piden al panel como mucho cada 15 s, hasta 400 por pedido y 3 pedidos por vez
export function askVerdicts(need: Record<string, RateNeed>): void {
  for (const q of Object.keys(need)) if (!verdict(q)) pending[q] = need[q];
  schedule(0);
}

function schedule(ms: number): void {
  if (timer || running || !Object.keys(pending).length) return;
  const wait = Math.max(ms, lastRun + EVERY - Date.now());
  timer = setTimeout(() => {
    timer = null;
    run().catch(() => {});
  }, Math.max(0, wait));
}

async function run(): Promise<void> {
  running = true;
  lastRun = Date.now();
  let changed = false;
  let waiting = false;
  try {
    const asked = pending;
    const all = Object.entries(asked);
    pending = {};
    for (let i = 0; i < all.length && i < 1200; i += 400) {
      const items = all.slice(i, i + 400).map(([q, x]) => ({ q, ...x }));
      const j = await post(items);
      if (!j || !j.success || !j.r || typeof j.r !== 'object') {
        // sin respuesta: se vuelve a probar en la próxima vuelta
        for (const [q, x] of all.slice(i)) pending[q] = x;
        break;
      }
      const m = load();
      const now = Math.floor(Date.now() / 1000);
      for (const q of Object.keys(j.r)) {
        const v = str(j.r[q]);
        if (!(v in TTL)) continue;
        // el panel todavía le está preguntando a TMDB: se vuelve a pedir en la próxima vuelta
        if (v === 'wait') {
          waiting = true;
          if (asked[q]) pending[q] = asked[q];
        } else if (!m[q] || m[q][0] !== v) changed = true;
        m[q] = [v, now];
      }
    }
    const m = load();
    const ks = Object.keys(m);
    if (ks.length > MAX_KEEP) for (const q of ks.slice(0, ks.length - MAX_KEEP)) delete m[q];
    writeJson(mapKey, m);
  } finally {
    running = false;
  }
  if (changed) onChange();
  if (waiting || Object.keys(pending).length) schedule(EVERY);
}
