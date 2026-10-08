// TMDB: reparto de una ficha y filmografía de un actor (person/{id} con combined_credits).
// Clave: la que entrega el panel (tmdbKey) y, si falta o no sirve, la incorporada (igual que la web).
import { catalog, Item } from '../data/catalog';
import { http, json } from '../lib/http';
import { read } from '../lib/storage';
import { buildTitleIndex, catalogYear, lookupTitle, TitleIndex, titleKeys, yearsOk } from '../lib/titles';
import { str } from '../lib/util';

const BUILTIN_KEY = '0c23c3f0458f0f9e4d0a35048d3a199a';
const API = 'https://api.themoviedb.org/3/';
const IMG = 'https://image.tmdb.org/t/p/';

function keys(): string[] {
  const panel = read('tmdb_key');
  const out = /^[0-9a-f]{32}$/i.test(panel) ? [panel] : [];
  if (!out.includes(BUILTIN_KEY)) out.push(BUILTIN_KEY);
  return out;
}

async function get(path: string, query = ''): Promise<any> {
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

// reparto de una película o serie: por tmdb_id del servidor o buscando el título (+ año)
export async function castFor(item: Item, tmdbId: string, year: string): Promise<CastMember[]> {
  const kind = item.kind === 'series' ? 'tv' : 'movie';
  const ck = kind + ':' + item.id;
  const hit = castCache.get(ck);
  if (hit) return hit;
  let id = /^\d+$/.test(tmdbId) ? tmdbId : '';
  if (!id) {
    const k = titleKeys(item.name);
    const y = catalogYear(item.name, year || item.year);
    const q = encodeURIComponent(k.base || item.name);
    const j = await get('search/' + kind, 'language=es-MX&include_adult=false&query=' + q);
    for (const r of (j && Array.isArray(j.results) ? j.results : []).slice(0, 8)) {
      const names = [str(r.title), str(r.name), str(r.original_title), str(r.original_name)].filter(Boolean).map(n => titleKeys(n).exact);
      const ry = Number(str(r.release_date || r.first_air_date).slice(0, 4)) || null;
      if ((names.includes(k.exact) || names.includes(k.base)) && yearsOk(y, ry)) {
        id = str(r.id);
        break;
      }
    }
  }
  if (!id) return [];
  const j = await get(kind + '/' + id + '/' + (kind === 'tv' ? 'aggregate_credits' : 'credits'), 'language=es-MX');
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

export type Person = { id: number; name: string; bio: string; birthday: string; place: string; photo: string; items: Item[] };

const indexCache = new WeakMap<object, TitleIndex>();

function indexFor(kind: 'vod' | 'series'): TitleIndex | null {
  const d = catalog.k[kind];
  if (!d) return null;
  let idx = indexCache.get(d.items);
  if (!idx) {
    const rows: { id: string; name: string; year: string }[] = [];
    d.index.forEach((i, id) => {
      const it = d.items[i];
      rows.push({ id, name: str(it?.name), year: str(it?.year) || str(it?.releaseDate).slice(0, 4) || str(it?.release_date).slice(0, 4) });
    });
    idx = buildTitleIndex(rows);
    indexCache.set(d.items, idx);
  }
  return idx;
}

// actor con su filmografía, solo lo que el servidor tiene (más reciente primero)
export async function personWithCatalog(personId: number): Promise<Person | null> {
  const j = await get('person/' + personId, 'language=es-MX&append_to_response=combined_credits');
  if (!j || !j.id) return null;
  let bio = str(j.biography).trim();
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
    name: str(j.name),
    bio,
    birthday: str(j.birthday),
    place: str(j.place_of_birth),
    photo: j.profile_path ? IMG + 'w300' + j.profile_path : '',
    items,
  };
}
