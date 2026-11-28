// TMDB: reparto de una ficha y filmografía de un actor (person/{id} con combined_credits).
// Clave: la que entrega el panel (tmdbKey) y, si falta o no sirve, la incorporada (igual que la web).
import { catalog, Item } from '../data/catalog';
import { http, json } from '../lib/http';
import { panel } from './panel';
import { tmdbLang } from '../lib/i18n';
import { read } from '../lib/storage';
import { APP_ID, scoped, tenantCode } from '../lib/tenant';
import { buildTitleIndex, catalogYear, lookupTitle, TitleIndex, titleKeys, yearsOk } from '../lib/titles';
import { tmdbFirstPart, tmdbTitle } from '../lib/tmdbTitle';
import { str } from '../lib/util';

const BUILTIN_KEY = '0c23c3f0458f0f9e4d0a35048d3a199a';
const API = 'https://api.themoviedb.org/3/';
const IMG = 'https://image.tmdb.org/t/p/';

function keys(): string[] {
  const panel = read(scoped('tmdb_key'));
  const out = /^[0-9a-f]{32}$/i.test(panel) ? [panel] : [];
  if (!out.includes(BUILTIN_KEY)) out.push(BUILTIN_KEY);
  return out;
}

// TMDB por el panel (api/tmdb.php: la clave del distribuidor o del dueño y su caché de 24 h); solo si el
// panel no responde se pregunta a TMDB directo con la clave del panel o la incorporada
async function get(path: string, query = ''): Promise<any> {
  const code = tenantCode();
  const tq = code ? '&t=' + encodeURIComponent(code) + '&app=' + APP_ID : '';
  const p = json<any>(await panel('tmdb.php', 'GET', '', '', '?path=' + path + (query ? '&' + query : '') + tq));
  // {"error": "tmdb_key_not_set"} del panel o {"success": false} de TMDB
  if (p && !p.error && p.success !== false) return p;
  for (const k of keys()) {
    const r = await http(API + path + '?api_key=' + k + (query ? '&' + query : ''), { timeout: 12000 });
    if (r.code === 0) return null; // sin red: otra clave no ayuda
    if (r.code === 401) continue; // clave no válida: la siguiente
    return json(r);
  }
  return null;
}

export type CastMember = { id: number; name: string; character: string; photo: string };

const castCache = new Map<string, CastMember[]>();
const idCache = new Map<string, string>();
const overviewCache = new Map<string, string>();

// borrado de caché pedido por el panel
export function clearTmdbCache(): void {
  castCache.clear();
  idCache.clear();
  overviewCache.clear();
}

// id de TMDB de una película o serie: el tmdb_id del servidor o buscando el título (+ año) en es-MX
// (los títulos del catálogo están en español). '' si no hay coincidencia segura.
async function tmdbIdFor(item: Item, tmdbId: string, year: string): Promise<string> {
  if (/^\d+$/.test(tmdbId)) return tmdbId;
  const kind = item.kind === 'series' ? 'tv' : 'movie';
  const ck = kind + ':' + item.id;
  const hit = idCache.get(ck);
  if (hit !== undefined) return hit;
  const y = catalogYear(item.name, year || item.year);
  // el título como lo entiende TMDB («NETFLIX - Stranger Things S01» -> «Stranger Things»), la misma regla que el panel,
  // Roku y Android; sin el subtítulo («Título - …») si TMDB no lo conoce entero
  const { q, y: y0 } = tmdbTitle(item.name);
  const yy = y || (y0 ? Number(y0) : null);
  let id = '';
  let answered = false;
  for (const one of [q, tmdbFirstPart(q)].filter((v, i, a) => v && a.indexOf(v) === i)) {
    const k = titleKeys(one);
    const j = await get('search/' + kind, 'language=es-MX&include_adult=false&query=' + encodeURIComponent(k.base ? one : item.name));
    if (j) answered = true;
    for (const r of (j && Array.isArray(j.results) ? j.results : []).slice(0, 8)) {
      const names = [str(r.title), str(r.name), str(r.original_title), str(r.original_name)].filter(Boolean).map(n => titleKeys(n).exact);
      const ry = Number(str(r.release_date || r.first_air_date).slice(0, 4)) || null;
      if ((names.includes(k.exact) || names.includes(k.base)) && yearsOk(yy, ry)) {
        id = str(r.id);
        break;
      }
    }
    // la primera parte solo con el año conocido (si no, «Avengers: Endgame» daría «The Avengers»)
    if (id || !yy) break;
  }
  if (answered) idCache.set(ck, id);
  return id;
}

// reparto de una película o serie en el idioma de la app (caché por idioma)
export async function castFor(item: Item, tmdbId: string, year: string): Promise<CastMember[]> {
  const kind = item.kind === 'series' ? 'tv' : 'movie';
  const ck = kind + ':' + item.id + ':' + tmdbLang();
  const hit = castCache.get(ck);
  if (hit) return hit;
  const id = await tmdbIdFor(item, tmdbId, year);
  if (!id) return [];
  const j = await get(kind + '/' + id + '/' + (kind === 'tv' ? 'aggregate_credits' : 'credits'), 'language=' + tmdbLang());
  const list: CastMember[] = [];
  for (const a of (j && Array.isArray(j.cast) ? j.cast : []).slice(0, 20)) {
    if (!a || !a.id) continue;
    list.push({
      id: Number(a.id),
      name: str(a.name),
      character: str(a.character) || str(a.roles?.[0]?.character),
      photo: a.profile_path ? IMG + 'w185' + a.profile_path : '',
    });
  }
  if (j) castCache.set(ck, list);
  return list;
}

// sinopsis de TMDB en el idioma de la app; '' en español (queda la del servidor), sin coincidencia o
// si TMDB no la tiene en ese idioma (caché por idioma)
export async function overviewFor(item: Item, tmdbId: string, year: string): Promise<string> {
  const language = tmdbLang();
  if (language === 'es-MX') return '';
  const kind = item.kind === 'series' ? 'tv' : 'movie';
  const ck = kind + ':' + item.id + ':' + language;
  const hit = overviewCache.get(ck);
  if (hit !== undefined) return hit;
  const id = await tmdbIdFor(item, tmdbId, year);
  if (!id) return '';
  const j = await get(kind + '/' + id, 'language=' + language);
  const text = str(j?.overview).trim();
  if (j) overviewCache.set(ck, text);
  return text;
}

// fondo horizontal y sinopsis de un título buscándolo en TMDB (título + año, la misma regla que el reparto); para la
// portada de Inicio / Series / Películas cuando el servidor no tiene fondo
export async function searchArt(item: Item, year: string): Promise<{ backdrop: string; plot: string; rating: string } | null> {
  const kind = item.kind === 'series' ? 'tv' : 'movie';
  const { q, y: y0 } = tmdbTitle(item.name);
  const k = titleKeys(q);
  const y = catalogYear(item.name, year || item.year) || (y0 ? Number(y0) : null);
  const j = await get('search/' + kind, 'language=es-MX&include_adult=false&query=' + encodeURIComponent(k.base ? q : item.name));
  if (!j) return null;
  for (const r of (Array.isArray(j.results) ? j.results : []).slice(0, 8)) {
    const names = [str(r.title), str(r.name), str(r.original_title), str(r.original_name)].filter(Boolean).map(n => titleKeys(n).exact);
    const ry = Number(str(r.release_date || r.first_air_date).slice(0, 4)) || null;
    if ((names.includes(k.exact) || names.includes(k.base)) && yearsOk(y, ry) && r.backdrop_path) {
      return { backdrop: IMG + 'w1280' + str(r.backdrop_path), plot: str(r.overview), rating: str(r.vote_average) };
    }
  }
  return { backdrop: '', plot: '', rating: '' };
}

export type Person = { id: number; name: string; bio: string; birthday: string; place: string; photo: string; items: Item[] };

const indexCache = new WeakMap<object, TitleIndex>();

function indexFor(kind: 'vod' | 'series'): TitleIndex | null {
  const d = catalog.k[kind];
  if (!d) return null;
  // por vista del catálogo (la del perfil infantil comparte la lista de items con la completa)
  let idx = indexCache.get(d);
  if (!idx) {
    const rows: { id: string; name: string; year: string }[] = [];
    d.index.forEach((i, id) => {
      const it = d.items[i];
      rows.push({ id, name: str(it?.name), year: str(it?.year) || str(it?.releaseDate).slice(0, 4) || str(it?.release_date).slice(0, 4) });
    });
    idx = buildTitleIndex(rows);
    indexCache.set(d, idx);
  }
  return idx;
}

// actor con su filmografía, solo lo que el servidor tiene (más reciente primero). La filmografía se
// empareja en es-MX (títulos del catálogo); nombre y biografía en el idioma de la app
export async function personWithCatalog(personId: number): Promise<Person | null> {
  const j = await get('person/' + personId, 'language=es-MX&append_to_response=combined_credits');
  if (!j || !j.id) return null;
  const local = tmdbLang() === 'es-MX' ? j : await get('person/' + personId, 'language=' + tmdbLang());
  let bio = str(local?.biography).trim();
  if (!bio) {
    const en = await get('person/' + personId, 'language=en-US');
    bio = str(en?.biography).trim();
  }
  type Credit = { kind: 'vod' | 'series'; titles: string[]; year: number | null; pop: number };
  const credits: Credit[] = (Array.isArray(j.combined_credits?.cast) ? j.combined_credits.cast : [])
    .filter((c: any) => c && (c.media_type === 'movie' || c.media_type === 'tv'))
    .map((c: any): Credit => ({
      kind: c.media_type === 'tv' ? 'series' : 'vod',
      titles: [str(c.title || c.name), str(c.original_title || c.original_name)].filter(Boolean),
      year: Number(str(c.release_date || c.first_air_date).slice(0, 4)) || null,
      pop: Number(c.popularity) || 0,
    }))
    .sort((a: Credit, b: Credit) => (b.year || 0) - (a.year || 0) || b.pop - a.pop);
  const items: Item[] = [];
  const seen = new Set<string>();
  // categorías ocultas (adultos o bloqueadas con PIN) tampoco aparecen aquí
  const visible = {
    vod: new Set(catalog.visibleCats('vod').map(x => x.id)),
    series: new Set(catalog.visibleCats('series').map(x => x.id)),
  };
  for (const c of credits) {
    const idx = indexFor(c.kind);
    const id = idx ? lookupTitle(idx, c.titles, c.year) : '';
    if (!id || seen.has(c.kind + id)) continue;
    seen.add(c.kind + id);
    const it = catalog.find(c.kind, id);
    if (it && visible[c.kind].has(it.cat)) items.push(it);
  }
  return {
    id: Number(j.id),
    name: str(local?.name) || str(j.name),
    bio,
    birthday: str(j.birthday),
    place: str(j.place_of_birth),
    photo: j.profile_path ? IMG + 'w300' + j.profile_path : '',
    items,
  };
}

export type Highlight = { title: string; rating: number; year: string; kind: 'movie' | 'tv'; backdrop: string };
let hlCache: { lang: string; at: number; list: Highlight[] } | null = null;

// Lo más destacado de la semana en TMDB (trending de películas y series): el fondo de «¿Quién está viendo?» va pasando
// por 15 a 20 títulos (BackdropSlides, 10 s cada uno). Página 1 y, si no llegan a 15 con fondo, la 2. 6 h en memoria.
export async function weekHighlights(): Promise<Highlight[]> {
  const lang = tmdbLang();
  if (hlCache && hlCache.lang === lang && Date.now() - hlCache.at < 6 * 3600000) return hlCache.list;
  const list: Highlight[] = [];
  const seen = new Set<string>();
  let ok = false;
  for (const page of [1, 2]) {
    if (list.length >= 15) break;
    const j = await get('trending/all/week', 'language=' + lang + '&page=' + page).catch(() => null);
    if (!j) break;
    ok = true;
    for (const r of Array.isArray(j.results) ? j.results : []) {
      if (list.length >= 20) break;
      if (!r || !str(r.backdrop_path) || (r.media_type !== 'movie' && r.media_type !== 'tv')) continue;
      const title = str(r.title) || str(r.name);
      const key = r.media_type + ':' + str(r.id);
      if (!title || seen.has(key)) continue;
      seen.add(key);
      const date = str(r.release_date) || str(r.first_air_date);
      list.push({ title, rating: Math.round((Number(r.vote_average) || 0) * 10) / 10, year: date.slice(0, 4), kind: r.media_type, backdrop: IMG + 'w1280' + str(r.backdrop_path) });
    }
  }
  if (ok) hlCache = { lang, at: Date.now(), list };
  return list;
}

// el primero (lo que usaba la pantalla antes de pasar por varios)
export async function weekHighlight(): Promise<Highlight | null> {
  return (await weekHighlights())[0] || null;
}
