// Top 10 de la semana: el panel (api/top10.php) manda lo más popular de la semana en TMDB; catalog.ts lo cruza con el
// catálogo por título y año y completa con lo mejor calificado, distinto cada semana. Se guarda y se pide otra vez
// cada 12 h (al abrir la app con la lista vieja se ve al instante).
import { panel } from '../api/panel';
import { json } from '../lib/http';
import { readJson, writeJson } from '../lib/storage';
import { APP_ID, scoped, tenantCode } from '../lib/tenant';
import { str } from '../lib/util';

export type TopEntry = { k?: 'm' | 's'; t: string; o: string; y: number };
export type WeekTop = { week: string; movies: TopEntry[]; series: TopEntry[]; all: TopEntry[] };

const KEY = 'top10_week';
const AGE = 12 * 3600 * 1000;
let cur: { at: number; data: WeekTop } | null = null;
let asking: Promise<boolean> | null = null;

function saved(): { at: number; data: WeekTop } | null {
  if (!cur) cur = readJson<{ at: number; data: WeekTop }>(scoped(KEY));
  return cur;
}

// la lista de la semana ya sabida (o null)
export function weekTop(): WeekTop | null {
  return saved()?.data || null;
}

const entries = (v: any): TopEntry[] =>
  (Array.isArray(v) ? v : []).slice(0, 80).map((x: any): TopEntry => ({ k: x?.k === 's' ? 's' : x?.k === 'm' ? 'm' : undefined, t: str(x?.t), o: str(x?.o), y: Number(x?.y) || 0 })).filter(x => x.t || x.o);

// pide la lista si la guardada tiene más de 12 h; true = llegó una distinta (hay que rehacer las filas)
export function loadWeekTop(): Promise<boolean> {
  const s = saved();
  if (s && Date.now() - s.at < AGE) return Promise.resolve(false);
  if (asking) return asking;
  asking = (async () => {
    const q = tenantCode() ? '?t=' + encodeURIComponent(tenantCode()) + '&app=' + APP_ID : '';
    const r = await panel('top10.php', 'GET', '', '', q);
    const j = r.ok ? json<any>(r) : null;
    if (!j || typeof j !== 'object' || !('movies' in j)) return false;
    const data: WeekTop = { week: str(j.week), movies: entries(j.movies), series: entries(j.series), all: entries(j.all) };
    const before = JSON.stringify(s?.data || null);
    cur = { at: Date.now(), data };
    writeJson(scoped(KEY), cur);
    return JSON.stringify(data) !== before;
  })().finally(() => {
    asking = null;
  });
  return asking;
}

// número de la semana del año (ISO): el relleno del Top 10 cambia cada semana
export function isoWeek(d = new Date()): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() * 100 + Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7);
}

// orden al azar fijo por semana (mismo resultado toda la semana, otro la siguiente)
export function weekShuffle<T>(list: T[], salt: number): T[] {
  let s = (isoWeek() * 2654435761 + salt) >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
