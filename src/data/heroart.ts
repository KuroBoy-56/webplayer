// Portada de Inicio / Series / Películas: fondo horizontal del título enfocado (como Roku, source/HeroArt.brs). Primero
// el servidor IPTV (get_vod_info / get_series_info) y, si no tiene fondo, TMDB por el panel. Cada título se pregunta
// una sola vez: lo encontrado se guarda en el equipo por línea (7 días, los 400 más recientes) y la próxima vez sale
// al instante. Solo se atiende el último pedido (recorrer una fila no deja una cola de consultas al servidor).
import { lineKey } from '../api/panel';
import { searchArt } from '../api/tmdb';
import { seriesInfo, vodInfo } from '../api/xtream';
import { readJson, writeJson } from '../lib/storage';
import { getState } from '../state';
import { Item } from './catalog';

export type Art = { backdrop: string; plot: string; year: string; rating: string; genre: string };
type Saved = Art & { t: number };

const KEY = 'hero_art';
const DAY = 86400000;
let saved: Record<string, Saved> | null = null;
let busy = false;
let wanted: { item: Item; done: (a: Art | null) => void } | null = null;

const keyOf = (it: Item) => lineKey() + '|' + it.kind + '|' + it.id;

function store(): Record<string, Saved> {
  if (!saved) saved = readJson<Record<string, Saved>>(KEY) || {};
  return saved;
}

// lo ya sabido de este título (sin red); null si nunca se preguntó o pasó una semana
export function savedArt(it: Item): Art | null {
  const e = store()[keyOf(it)];
  return e && Date.now() - e.t < 7 * DAY ? e : null;
}

function remember(it: Item, a: Art): void {
  const all = store();
  all[keyOf(it)] = { ...a, t: Date.now() };
  const ks = Object.keys(all);
  if (ks.length > 400) {
    ks.sort((x, y) => all[x].t - all[y].t);
    for (const k of ks.slice(0, ks.length - 400)) delete all[k];
  }
  writeJson(KEY, all);
}

async function ask(it: Item): Promise<Art | null> {
  const s = getState().session;
  if (!s) return null;
  const info = it.kind === 'series' ? await seriesInfo(s, it.id) : await vodInfo(s, it.id);
  const a: Art = { backdrop: info?.backdrop || '', plot: info?.plot || '', year: info?.year || '', rating: info?.rating || '', genre: info?.genre || '' };
  let answered = !!info;
  if (!a.backdrop) {
    const t = await searchArt(it, a.year).catch(() => null);
    if (t) {
      answered = true;
      a.backdrop = t.backdrop;
      if (!a.plot) a.plot = t.plot;
      if (!a.rating) a.rating = t.rating;
    }
  }
  // sin respuesta (sin red) no se guarda: se vuelve a preguntar la próxima vez
  if (answered) remember(it, a);
  return answered ? a : null;
}

// fondo del título enfocado; done se llama solo para el último pedido
export function heroArt(it: Item, done: (a: Art | null) => void): void {
  const hit = savedArt(it);
  if (hit) return done(hit);
  wanted = { item: it, done };
  if (busy) return;
  busy = true;
  (async () => {
    while (wanted) {
      const w = wanted;
      wanted = null;
      const a = await ask(w.item).catch(() => null);
      if (!wanted) w.done(a);
    }
    busy = false;
  })();
}
