// Títulos normalizados para emparejar la filmografía de TMDB con el catálogo del servidor
// (misma lógica que la app de Windows: title-normalization.util.ts, y que la web: includes/actor.php).
import { fold } from './util';

const QUALITY_TAGS = new Set([
  '4k', 'uhd', 'fhd', 'hd', 'sd', 'hdr', 'hevc', 'h264', 'h265', 'x264', 'x265', '480p', '720p', '1080p', '2160p',
  'multi', 'multisub', 'vostfr', 'vf', 'dubbed',
  // etiquetas de idioma habituales en catálogos en español
  'lat', 'latino', 'castellano', 'subtitulado', 'subt', 'vose', 'dual',
]);

// "EN - ", "ES| ", "LAT: " (solo mayúsculas: "It: Chapter Two" no se toca)
const LANGUAGE_PREFIX = /^[A-Z]{2,3}\s*[-|:]\s+/;
const TRAILING_YEAR = /(?:^|\s)(19\d{2}|20\d{2})$/;
const SEASON_SUFFIX = /(?:^|\s)(?:s\d{1,2}|season\s*\d{1,2}|сезон\s*\d{1,2}|staffel\s*\d{1,2}|temporada\s*\d{1,2})$/i;
// letras latinas (con acentos ya quitados), latín extendido y cirílico; lo demás separa palabras
const NON_WORD = /[^a-z0-9À-ɏЀ-ӿ]+/g;

export type TitleKeys = { exact: string; base: string; year: number | null };

// exact: con el año final ("blade runner 2049"); base: sin el año final ("blade runner")
export function titleKeys(raw: string): TitleKeys {
  if (!raw || !raw.trim()) return { exact: '', base: '', year: null };
  const cleaned = fold(raw.replace(/\[[^\][]*\]|\([^()]*\)|\{[^{}]*\}/g, ' ').replace(LANGUAGE_PREFIX, ''))
    .replace(NON_WORD, ' ')
    .split(' ')
    .filter(t => t !== '' && !QUALITY_TAGS.has(t))
    .join(' ')
    .trim();
  const stripSeason = (v: string) => v.replace(SEASON_SUFFIX, '').trim() || v;
  const exact = stripSeason(cleaned);
  const m = cleaned.match(TRAILING_YEAR);
  const without = cleaned.replace(TRAILING_YEAR, '').replace(/\s+/g, ' ').trim();
  if (!m || !without) return { exact, base: exact, year: null };
  return { exact, base: stripSeason(without), year: Number(m[1]) };
}

// años compatibles (±1); un año desconocido nunca impide el emparejamiento
export function yearsOk(a: number | null | undefined, b: number | null | undefined): boolean {
  return !a || !b || Math.abs(a - b) <= 1;
}

// año del elemento del catálogo: campo year o "(2019)" en el nombre (un año final sin
// paréntesis puede ser parte del título, "Blade Runner 2049": ese va en el nivel base)
export function catalogYear(name: string, year: string): number | null {
  const y = (year || '').match(/(19\d{2}|20\d{2})/) || (name || '').match(/[([](19\d{2}|20\d{2})[)\]]/);
  return y ? Number(y[1]) : null;
}

type Entry = { id: string; year: number | null };
export type TitleIndex = { exact: Map<string, Entry[]>; base: Map<string, Entry[]> };

export function buildTitleIndex(rows: { id: string; name: string; year: string }[]): TitleIndex {
  const idx: TitleIndex = { exact: new Map(), base: new Map() };
  const add = (m: Map<string, Entry[]>, k: string, e: Entry) => {
    const l = m.get(k);
    if (l) l.push(e);
    else m.set(k, [e]);
  };
  for (const r of rows) {
    const k = titleKeys(r.name);
    if (!k.exact || !r.id) continue;
    const y = catalogYear(r.name, r.year);
    add(idx.exact, k.exact, { id: r.id, year: y });
    if (k.base !== k.exact) add(idx.base, k.base, { id: r.id, year: k.year || y });
  }
  return idx;
}

// id del catálogo para un título de TMDB (y su título original), o ''
export function lookupTitle(idx: TitleIndex, titles: string[], year: number | null): string {
  for (const t of titles) {
    const want = titleKeys(t).exact;
    if (!want) continue;
    for (const c of idx.exact.get(want) || []) if (yearsOk(year, c.year)) return c.id;
    for (const c of idx.base.get(want) || []) if (yearsOk(year, c.year)) return c.id;
  }
  return '';
}
