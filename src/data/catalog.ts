// Catálogo en memoria: filas del inicio, plataformas, géneros, búsqueda y TV en vivo
// (misma lógica que la app de Roku y Android).
import { imgPath, Kind } from '../api/xtream';
import { fold, float, isAdult, shuffle, str } from '../lib/util';
import { pref, readJson } from '../lib/storage';
import { Key, t } from '../lib/i18n';
import { buildTitleIndex, lookupTitle, TitleIndex } from '../lib/titles';
import { TopEntry, weekShuffle, weekTop } from './top10';
import { blockedName, CatClass, catClass, itemLevel, rateKey, ratePass } from '../lib/kids';
import { askVerdicts, RateNeed, verdict } from './kidsrate';

// nombre en el idioma de la app (las marcas como Netflix no están en los diccionarios y quedan igual);
// las palabras clave (kw) siguen en español: buscan en los nombres de categoría del servidor
export const label = (p: { label: string }) => t(p.label as Key);

export type Item = {
  kind: Kind;
  id: string;
  name: string;
  poster: string;
  backdrop: string;
  plot: string;
  cat: string;
  ext: string;
  rating: number;
  year: string;
  epg: string;
  num: string;
  // id de TMDB que manda el servidor IPTV (tmdb / tmdb_id): la carátula del panel es una por título
  tm?: string;
};

// live: un partido de «En vivo ahora» (data/liveTv.ts, solo con perfiles)
export type Special = { kind: 'platform' | 'genre' | 'more' | 'live'; key: string; label: string; image?: number; color: string; extra?: string; live?: import('./liveTv').LiveCard; art?: number; feat?: Item };
export type Row = { title: string; type: 'poster' | 'top10' | 'platform' | 'genre' | 'live'; items: (Item | Special)[] };

// art = dibujo de líneas de los géneros (assets/image/genre_*.png, fuentes SVG en tools/genre-art de Roku)
export type Platform = { key: string; label: string; image?: number; color: string; kw: string[]; art?: number };

export const PLATFORMS: Platform[] = [
  { key: 'netflix', label: 'Netflix', image: require('../../assets/image/plat_netflix.png'), color: '#E50914', kw: ['netflix'] },
  { key: 'disney', label: 'Disney+', image: require('../../assets/image/plat_disney.png'), color: '#113CCF', kw: ['disney', 'pixar', 'star+', 'star plus'] },
  { key: 'max', label: 'HBO Max', image: require('../../assets/image/plat_max.png'), color: '#5822B4', kw: ['hbo', '\\bmax\\b'] },
  { key: 'prime', label: 'Prime Video', image: require('../../assets/image/plat_prime.png'), color: '#00A8E1', kw: ['amazon', 'prime'] },
  { key: 'marvel', label: 'Marvel', image: require('../../assets/image/plat_marvel.png'), color: '#EC1D24', kw: ['marvel', '\\bmcu\\b'] },
  { key: 'apple', label: 'Apple TV+', image: require('../../assets/image/plat_apple.png'), color: '#555555', kw: ['apple'] },
  { key: 'paramount', label: 'Paramount+', image: require('../../assets/image/plat_paramount.png'), color: '#0064FF', kw: ['paramount'] },
  { key: 'dc', label: 'DC', image: require('../../assets/image/plat_dc.png'), color: '#0476F2', kw: ['\\bdc\\b', 'dc comics'] },
  { key: 'xmas', label: 'Navidad', image: require('../../assets/image/plat_xmas.png'), color: '#1F7A3A', kw: ['navidad', 'navide', 'christmas', 'xmas'] },
  { key: 'halloween', label: 'Halloween', image: require('../../assets/image/plat_halloween.png'), color: '#FF6A00', kw: ['halloween', 'terror', 'horror'] },
];

export const GENRES: Platform[] = [
  { key: 'accion', label: 'Acción', color: '#B71C1C', kw: ['accion', 'action', 'artes marciales'], art: require('../../assets/image/genre_accion.png') },
  { key: 'suspenso', label: 'Suspenso', color: '#37474F', kw: ['suspenso', 'suspense', 'thriller', 'misterio', 'mystery', 'intriga'], art: require('../../assets/image/genre_suspenso.png') },
  { key: 'aventura', label: 'Aventura', color: '#2E7D32', kw: ['aventura', 'adventure'], art: require('../../assets/image/genre_aventura.png') },
  { key: 'anime', label: 'Anime', color: '#D81B60', kw: ['anime', 'crunchyroll', 'otaku'], art: require('../../assets/image/genre_anime.png') },
  { key: 'drama', label: 'Drama', color: '#6A1B9A', kw: ['drama'], art: require('../../assets/image/genre_drama.png') },
  { key: 'comedia', label: 'Comedia', color: '#F9A825', kw: ['comedia', 'comedy', 'humor'], art: require('../../assets/image/genre_comedia.png') },
  { key: 'terror', label: 'Terror', color: '#212121', kw: ['terror', 'horror', 'miedo'], art: require('../../assets/image/genre_terror.png') },
  { key: 'scifi', label: 'Ciencia ficción', color: '#1565C0', kw: ['ciencia ficcion', 'sci-fi', 'scifi', 'science fiction'], art: require('../../assets/image/genre_scifi.png') },
  { key: 'fantasia', label: 'Fantasía', color: '#4527A0', kw: ['fantasia', 'fantasy'], art: require('../../assets/image/genre_fantasia.png') },
  { key: 'romance', label: 'Romance', color: '#C2185B', kw: ['romance', 'romantic', 'romantica', 'amor'], art: require('../../assets/image/genre_romance.png') },
  { key: 'crimen', label: 'Crimen', color: '#424242', kw: ['crimen', 'crime', 'policia', 'mafia'], art: require('../../assets/image/genre_crimen.png') },
  { key: 'animacion', label: 'Animación', color: '#00897B', kw: ['animacion', 'animation', 'animada', 'infantil', 'kids', 'cartoon'], art: require('../../assets/image/genre_animacion.png') },
  { key: 'documental', label: 'Documental', color: '#5D4037', kw: ['documental', 'documentary', 'docu'], art: require('../../assets/image/genre_documental.png') },
  { key: '4k', label: '4K', color: '#000000', kw: ['4k', 'uhd', '2160'], art: require('../../assets/image/genre_4k.png') },
];

const reCache = new Map<string, RegExp>();
// ¿el nombre (de categoría) coincide con alguna palabra clave? (\b es límite de palabra)
export function matchesKw(name: string, kw: string[]): boolean {
  const n = fold(name);
  for (const k of kw) {
    if (k.includes('\\b')) {
      let re = reCache.get(k);
      if (!re) {
        re = new RegExp(k);
        reCache.set(k, re);
      }
      if (re.test(n)) return true;
    } else if (n.includes(k)) return true;
  }
  return false;
}

export function isItem(x: Item | Special): x is Item {
  return x.kind === 'vod' || x.kind === 'series' || x.kind === 'live';
}

type KindData = { cats: { id: string; name: string }[]; items: any[]; byCat: Map<string, number[]>; index: Map<string, number> };

export function toItem(kind: Kind, it: any): Item {
  let rating = float(it.rating);
  if (rating > 10) rating = rating / 10;
  const bd = imgPath(it.backdrop_path, 'w1280');
  return {
    kind,
    id: kind === 'series' ? str(it.series_id) : str(it.stream_id),
    name: str(it.name),
    poster: imgPath(kind === 'series' ? it.cover : it.stream_icon, 'w500'),
    backdrop: bd,
    plot: str(it.plot),
    cat: str(it.category_id),
    ext: str(it.container_extension),
    rating,
    year: str(it.year) || str(it.releaseDate).slice(0, 4) || str(it.release_date).slice(0, 4),
    epg: str(it.epg_channel_id),
    num: str(it.num),
    tm: tmdbId(it),
  };
}

function tmdbId(it: any): string {
  const v = str(it.tmdb) || str(it.tmdb_id);
  return /^[1-9]\d{0,8}$/.test(v) ? v : '';
}

class Catalog {
  k: Partial<Record<Kind, KindData>> = {};
  unlocked = false;
  // perfil infantil: k tiene solo lo permitido; raw es siempre el catálogo completo del servidor (el principal nunca ve
  // el catálogo recortado)
  kidsOn = false;
  private raw: Partial<Record<Kind, KindData>> = {};

  clear() {
    this.k = {};
    this.raw = {};
    this.tIdx = {};
    this.folded = {};
    this.exCache.clear();
  }

  setKids(on: boolean) {
    this.kidsOn = on;
    this.refreshKids();
  }

  // las listas o los veredictos de TMDB cambiaron: se vuelve a armar lo que ve el perfil infantil
  refreshKids() {
    for (const kind of Object.keys(this.raw) as Kind[]) this.k[kind] = this.kidsOn ? this.kidsView(kind, this.raw[kind]!) : this.raw[kind];
    this.tIdx = {};
    this.exCache.clear();
  }

  // ¿este título se puede abrir? (en el perfil infantil, solo lo que pasa el filtro)
  allowed(kind: Kind, id: string): boolean {
    return !this.kidsOn || !!this.k[kind]?.index.has(id);
  }

  // el mismo catálogo (las mismas posiciones) con solo lo permitido para niños (lib/kids.ts)
  private kidsView(kind: Kind, d: KindData): KindData {
    const live = kind === 'live';
    const cls = new Map<string, CatClass>();
    for (const c of d.cats) cls.set(c.id, catClass(c.name, live));
    const out: KindData = { cats: [], items: d.items, byCat: new Map(), index: new Map() };
    const need: Record<string, RateNeed> = {};
    const idKey = kind === 'series' ? 'series_id' : 'stream_id';
    for (const c of d.cats) {
      const list: number[] = [];
      for (const i of d.byCat.get(c.id) || []) {
        const it = d.items[i];
        const name = str(it?.name);
        if (live) {
          if (cls.get(c.id) !== 'kids' || blockedName(name)) continue;
        } else {
          const ids: string[] = Array.isArray(it?.category_ids) && it.category_ids.length ? it.category_ids.map(String) : [c.id];
          const level = itemLevel(name, str(it?.genre), ids.map(id => cls.get(id) || ''));
          if (!level) continue;
          const year = str(it?.year) || str(it?.releaseDate).slice(0, 4);
          const tm = tmdbId(it);
          const q = rateKey(kind, name, year, tm);
          const v = verdict(q);
          if (!v && !need[q]) need[q] = { t: kind === 'series' ? 's' : 'm', ...(tm ? { id: tm } : { n: name, y: year }) };
          if (!ratePass(level, v)) continue;
        }
        list.push(i);
        out.index.set(str(it?.[idKey]), i);
      }
      if (list.length) {
        out.cats.push(c);
        out.byCat.set(c.id, list);
      }
    }
    if (Object.keys(need).length) askVerdicts(need);
    return out;
  }

  // ---------- Top 10 de la semana ----------
  // títulos del catálogo visible por tipo (para cruzar la lista de la semana del panel); id = posición en items
  private tIdx: Partial<Record<Kind, { rev: string; idx: TitleIndex }>> = {};
  private titleIdx(kind: Kind, vis: number[]): TitleIndex {
    const d = this.k[kind]!;
    const rev = vis.length + ':' + d.items.length + ':' + this.unlocked;
    const c = this.tIdx[kind];
    if (c && c.rev === rev) return c.idx;
    const idx = buildTitleIndex(vis.map(i => ({ id: String(i), name: str(d.items[i]?.name), year: str(d.items[i]?.year) || str(d.items[i]?.releaseDate).slice(0, 4) })));
    this.tIdx[kind] = { rev, idx };
    return idx;
  }

  // posiciones del catálogo de la lista de la semana, en su orden (sin repetir)
  private weekMatches(kind: Kind, list: TopEntry[], vis: number[], n: number): number[] {
    if (!list.length || !vis.length) return [];
    const ti = this.titleIdx(kind, vis);
    const out: number[] = [];
    for (const e of list) {
      const id = lookupTitle(ti, [e.t, e.o].filter(Boolean), e.y || null);
      if (id && !out.includes(Number(id))) out.push(Number(id));
      if (out.length >= n) break;
    }
    return out;
  }

  // relleno: de las 40 mejor calificadas, unas distintas cada semana (ordenadas por calificación)
  private weekFill(kind: Kind, vis: number[], skip: number[], n: number, salt: number): number[] {
    if (n <= 0) return [];
    const pool = this.top(kind, vis, 'rating', 40).filter(i => !skip.includes(i));
    const pick = new Set(weekShuffle(pool, salt).slice(0, n));
    return pool.filter(i => pick.has(i));
  }

  // Top 10 de un tipo (Películas o Series)
  weekTop10(kind: Kind, vis: number[]): number[] {
    const w = weekTop();
    const got = this.weekMatches(kind, (kind === 'series' ? w?.series : w?.movies) || [], vis, 10);
    return [...got, ...this.weekFill(kind, vis, got, 10 - got.length, kind === 'series' ? 2 : 1)];
  }

  set(kind: Kind, cats: any[], items: any[]) {
    const d: KindData = { cats: [], items, byCat: new Map(), index: new Map() };
    for (const c of cats) {
      const id = str(c?.category_id);
      d.cats.push({ id, name: str(c?.category_name) });
      d.byCat.set(id, []);
    }
    const idKey = kind === 'series' ? 'series_id' : 'stream_id';
    items.forEach((it, i) => {
      const id = str(it?.[idKey]);
      if (!id || d.index.has(id)) return;
      d.index.set(id, i);
      const cid = str(it.category_id);
      if (!d.byCat.has(cid)) {
        d.byCat.set(cid, []);
        d.cats.push({ id: cid, name: t('Otros') });
      }
      d.byCat.get(cid)!.push(i);
    });
    this.raw[kind] = d;
    this.k[kind] = this.kidsOn ? this.kidsView(kind, d) : d;
    this.exCache.clear();
  }

  has(kind: Kind) {
    return !!this.k[kind];
  }

  blocked(): Set<string> {
    return new Set((readJson<string[]>('blocked_cats') || []).map(String));
  }

  // categorías visibles (oculta adultos y bloqueadas salvo que se haya desbloqueado con el PIN)
  visibleCats(kind: Kind) {
    const d = this.k[kind];
    if (!d) return [];
    if (this.unlocked) return d.cats;
    const hideAdult = pref('hide_adult', '1') === '1';
    const blocked = this.blocked();
    return d.cats.filter(c => !(blocked.has(kind + ':' + c.id) || (hideAdult && isAdult(c.name))));
  }

  isCatLocked(kind: Kind, name: string, id: string) {
    const hideAdult = pref('hide_adult', '1') === '1';
    return this.blocked().has(kind + ':' + id) || (hideAdult && isAdult(name));
  }

  allIdx(kind: Kind): number[] {
    const d = this.k[kind];
    if (!d) return [];
    const out: number[] = [];
    for (const c of this.visibleCats(kind)) out.push(...(d.byCat.get(c.id) || []));
    return out;
  }

  idxForKw(kind: Kind, kw: string[]): number[] {
    const d = this.k[kind];
    if (!d) return [];
    // un título en dos categorías de la misma plataforma sale una sola vez
    const out = new Set<number>();
    for (const c of this.visibleCats(kind)) if (matchesKw(c.name, kw)) for (const i of d.byCat.get(c.id) || []) out.add(i);
    return [...out];
  }

  sortKey(kind: Kind, it: any, by: 'added' | 'rating'): number {
    if (by === 'rating') {
      const v = float(it.rating);
      return v > 10 ? v / 10 : v;
    }
    return float(kind === 'series' ? it.last_modified : it.added);
  }

  top(kind: Kind, idx: number[], by: 'added' | 'rating', n: number): number[] {
    const d = this.k[kind];
    if (!d) return [];
    return idx
      .map(i => ({ i, v: this.sortKey(kind, d.items[i], by) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, n)
      .map(p => p.i);
  }

  items(kind: Kind, idx: number[], max = 100000): Item[] {
    const d = this.k[kind];
    if (!d) return [];
    return idx.slice(0, max).map(i => toItem(kind, d.items[i]));
  }

  find(kind: Kind, id: string): Item | null {
    const d = this.k[kind];
    const i = d?.index.get(id);
    return d && i !== undefined ? toItem(kind, d.items[i]) : null;
  }

  // ---------- inicio (mismo orden que Roku) ----------
  // Plataformas, Top 10 de hoy (películas y series juntas), Películas agregadas recientemente, Series nuevas,
  // «Lo mejor de…» de 5 plataformas, Series para ti, los géneros y Películas para ti; «Ver todo» al final de cada fila.
  // platforms: false = el distribuidor no separa su contenido por plataformas (sin fila ni filas por plataforma)
  home(platforms = true): { rows: Row[]; hero: Item | null; heroes: Item[] } {
    const rows: Row[] = [];
    let hero: Item | null = null;
    const vodIdx = this.allIdx('vod');
    const serIdx = this.allIdx('series');

    const plats: Row = { title: '', type: 'platform', items: [] };
    const platRows: { p: Platform; mv: number[]; sv: number[] }[] = [];
    for (const p of platforms ? PLATFORMS : []) {
      const mv = this.idxForKw('vod', p.kw);
      const sv = this.idxForKw('series', p.kw);
      if (mv.length + sv.length > 0) {
        plats.items.push({ kind: 'platform', key: p.key, label: label(p), image: p.image, color: p.color });
        platRows.push({ p, mv, sv });
      }
    }
    if (plats.items.length) rows.push(plats);

    // Top 10 de la semana: lo más popular de la semana (panel, TMDB) que está en el catálogo, películas y series en su
    // orden; lo que falte, de las mejor calificadas, distintas cada semana
    const w = weekTop();
    const picks: { kind: Kind; i: number }[] = [];
    if (w?.all.length) {
      const mv = this.k.vod ? this.weekMatches('vod', w.all.filter(e => e.k !== 's'), vodIdx, 10) : [];
      const sv = this.k.series ? this.weekMatches('series', w.all.filter(e => e.k === 's'), serIdx, 10) : [];
      // en el orden de la lista de la semana (alternada): la n-ésima película coincide con la n-ésima de la lista
      for (let a = 0, b = 0; picks.length < 10 && (a < mv.length || b < sv.length); ) {
        if (a < mv.length) picks.push({ kind: 'vod', i: mv[a++] });
        if (picks.length < 10 && b < sv.length) picks.push({ kind: 'series', i: sv[b++] });
      }
    }
    if (picks.length < 10) {
      const need = 10 - picks.length;
      const fill = [
        ...(this.k.vod ? this.weekFill('vod', vodIdx, picks.filter(p => p.kind === 'vod').map(p => p.i), need, 3).map(i => ({ kind: 'vod' as Kind, i })) : []),
        ...(this.k.series ? this.weekFill('series', serIdx, picks.filter(p => p.kind === 'series').map(p => p.i), need, 4).map(i => ({ kind: 'series' as Kind, i })) : []),
      ];
      picks.push(...weekShuffle(fill, 5).slice(0, need));
    }
    // «Ver todo» del Top 10: Explorar con Mejor valorados (como el web player)
    if (picks.length >= 5) rows.push({ title: t('Top 10 de la semana'), type: 'top10', items: [...picks.map(x => this.items(x.kind, [x.i])[0]), { kind: 'more', key: 'top', label: t('Ver todo'), color: '', extra: 'top:all' }] });

    const recentMovies = this.top('vod', vodIdx, 'added', 30);
    if (recentMovies.length) {
      hero = this.items('vod', [recentMovies[Math.floor(Math.random() * Math.min(10, recentMovies.length))]])[0];
      rows.push({
        title: t('Películas agregadas recientemente'),
        type: 'poster',
        items: [...this.items('vod', recentMovies), { kind: 'more', key: 'recent', label: t('Ver todo'), color: '', extra: 'vod' }],
      });
    }
    const recentSeries = this.top('series', serIdx, 'added', 30);
    if (recentSeries.length) {
      rows.push({
        title: t('Series nuevas'),
        type: 'poster',
        items: [...this.items('series', recentSeries), { kind: 'more', key: 'recent', label: t('Ver todo'), color: '', extra: 'series' }],
      });
      if (!hero) hero = this.items('series', [recentSeries[0]])[0];
    }

    // «Lo mejor de…»: películas y series intercaladas, lo más nuevo primero
    const mixed = (mv: number[], sv: number[]): Item[] => {
      const a = this.items('vod', this.top('vod', mv, 'added', 15));
      const b = this.items('series', this.top('series', sv, 'added', 15));
      const out: Item[] = [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i]) out.push(a[i]);
        if (b[i]) out.push(b[i]);
      }
      return out;
    };
    for (const pr of platRows.filter(x => x.p.key !== 'xmas' && x.p.key !== 'halloween').slice(0, 5)) {
      const items = mixed(pr.mv, pr.sv);
      if (items.length) rows.push({ title: t('Lo mejor de {x}', { x: label(pr.p) }), type: 'poster', items: [...items, { kind: 'more', key: pr.p.key, label: t('Ver todo'), color: pr.p.color, extra: 'platform' }] });
    }

    const pick = (kind: Kind, idx: number[], n: number) => this.items(kind, shuffle(idx.slice()).slice(0, n));
    const seriesForYou = pick('series', serIdx, 24);
    if (seriesForYou.length) rows.push({ title: t('Series para ti'), type: 'poster', items: [...seriesForYou, { kind: 'more', key: 'recent', label: t('Ver todo'), color: '', extra: 'for:series' }] });

    for (const key of ['accion', 'comedia', 'terror', 'anime', 'drama', 'suspenso', 'aventura', 'animacion', 'scifi', 'romance', 'documental']) {
      const g = GENRES.find(x => x.key === key);
      if (!g) continue;
      const items = mixed(this.idxForKw('vod', g.kw), this.idxForKw('series', g.kw));
      if (items.length) rows.push({ title: label(g), type: 'poster', items: [...items, { kind: 'more', key: g.key, label: t('Ver todo'), color: g.color, extra: 'genre' }] });
    }

    const moviesForYou = pick('vod', vodIdx, 24);
    if (moviesForYou.length) rows.push({ title: t('Películas para ti'), type: 'poster', items: [...moviesForYou, { kind: 'more', key: 'recent', label: t('Ver todo'), color: '', extra: 'for:vod' }] });
    return { rows, hero, heroes: this.heroCandidates(['vod', 'series'], 4) };
  }

  // destacados que van pasando en la portada (como Roku): de lo más nuevo (150) con carátula, al azar, n por tipo; la
  // portada se queda con los que tienen fondo horizontal (servidor o TMDB)
  heroCandidates(kinds: Kind[], n: number): Item[] {
    const out: Item[] = [];
    for (const kind of kinds) {
      const d = this.k[kind];
      if (!d) continue;
      const withPic = this.top(kind, this.allIdx(kind), 'added', 150).filter(i => {
        const it = d.items[i];
        return str(kind === 'series' ? it?.cover : it?.stream_icon) !== '';
      });
      out.push(...this.items(kind, shuffle(withPic).slice(0, n)));
    }
    return shuffle(out);
  }

  // ---------- películas / series ----------
  browse(kind: 'vod' | 'series'): { rows: Row[]; hero: Item | null; heroes: Item[] } {
    const rows: Row[] = [];
    const d = this.k[kind];
    if (!d) return { rows, hero: null, heroes: [] };
    const all = this.allIdx(kind);
    const recent = this.top(kind, all, 'added', 30);
    const hero = recent.length ? this.items(kind, [recent[Math.floor(Math.random() * Math.min(10, recent.length))]])[0] : null;
    if (recent.length) {
      rows.push({
        title: t('Agregadas recientemente'),
        type: 'poster',
        items: [...this.items(kind, recent), { kind: 'more', key: 'recent', label: t('Ver todo'), color: '', extra: kind }],
      });
    }
    // cada género con su dibujo y el póster de su título más destacado: el de la lista de la semana de TMDB
    // (api/top10.php) que está en esas carpetas; si no hay, el mejor calificado (como las tarjetas de deportes)
    const gen: Row = { title: t('Géneros'), type: 'genre', items: [] };
    const wl = (kind === 'series' ? weekTop()?.series : weekTop()?.movies) || [];
    for (const g of GENRES) {
      const gi = this.idxForKw(kind, g.kw);
      if (!gi.length) continue;
      const f = this.weekMatches(kind, wl, gi, 1)[0] ?? this.top(kind, gi, 'rating', 1)[0];
      gen.items.push({ kind: 'genre', key: g.key, label: label(g), color: g.color, extra: kind, art: g.art, feat: f !== undefined ? this.items(kind, [f])[0] : undefined });
    }
    if (gen.items.length) rows.push(gen);
    const top = this.weekTop10(kind, all);
    if (top.length >= 5) rows.push({ title: t('Top 10 de la semana'), type: 'top10', items: [...this.items(kind, top), { kind: 'more', key: 'top', label: t('Ver todo'), color: '', extra: 'top:' + kind }] });
    for (const c of this.visibleCats(kind)) {
      const idx = d.byCat.get(c.id) || [];
      if (!idx.length) continue;
      const items: (Item | Special)[] = this.items(kind, idx, 25);
      if (idx.length > 25) items.push({ kind: 'more', key: c.id, label: t('Ver todo'), color: '', extra: 'cat:' + kind });
      rows.push({ title: c.name, type: 'poster', items });
    }
    return { rows, hero, heroes: this.heroCandidates([kind], 8) };
  }

  // ---------- cuadrícula "Ver todo" ----------
  grid(mode: 'cat' | 'platform' | 'genre' | 'recent', key: string, kind?: Kind, max = 3000): Item[] {
    const kinds: Kind[] = kind ? [kind] : ['vod', 'series'];
    const out: Item[] = [];
    for (const k of kinds) {
      const d = this.k[k];
      if (!d) continue;
      let idx: number[] = [];
      if (mode === 'cat') {
        if (this.visibleCats(k).some(c => c.id === key)) idx = d.byCat.get(key) || [];
      } else if (mode === 'platform') {
        const p = PLATFORMS.find(x => x.key === key);
        if (p) idx = this.top(k, this.idxForKw(k, p.kw), 'added', 3000);
      } else if (mode === 'genre') {
        const g = GENRES.find(x => x.key === key);
        if (g) idx = this.top(k, this.idxForKw(k, g.kw), 'added', 3000);
      } else {
        idx = this.top(k, this.allIdx(k), 'added', 300);
      }
      out.push(...this.items(k, idx, max));
    }
    return out;
  }

  // ---------- Explorar (la lupa de la barra, como browse.php del web player) ----------
  // Películas y/o series de las categorías visibles, por plataforma y/o género o una carpeta del servidor (cat, como
  // «Categorías» de Películas / Series del web player), filtradas por título y ordenadas; total = cuántas hay (se arman
  // como mucho «max» fichas). El orden de cada combinación queda en memoria hasta que cambie el catálogo: la lupa abre
  // al momento (se prepara al entrar al perfil, warmExplore) y cambiar de filtro no vuelve a ordenar todo.
  private exCache = new Map<string, { k: Kind; i: number }[]>();
  private exRes: { key: string; list: { k: Kind; i: number }[]; r: { items: Item[]; total: number } } | null = null;

  explore(type: 'all' | 'vod' | 'series', sort: 'recent' | 'az' | 'rating', platform: string, genre: string, q: string, max = 2000, cat = '', catKind = ''): { items: Item[]; total: number } {
    let kinds: Kind[] = type === 'all' ? ['vod', 'series'] : [type];
    if (cat) kinds = [catKind === 'vod' || catKind === 'series' ? catKind : kinds[0]];
    const p = cat ? undefined : PLATFORMS.find(x => x.key === platform);
    const g = cat ? undefined : GENRES.find(x => x.key === genre);
    const needle = fold(q.trim());
    const sig = kinds.map(k => k + (this.k[k]?.items.length || 0) + ':' + this.visibleCats(k).length).join(',');
    const key = [sig, sort, p?.key || '', g?.key || '', cat, this.kidsOn ? 1 : 0, this.unlocked ? 1 : 0].join('|');
    let list = this.exCache.get(key);
    if (!list) {
      const all: { k: Kind; i: number; v: number; n: string }[] = [];
      for (const k of kinds) {
        const d = this.k[k];
        if (!d) continue;
        let idx = cat ? (this.visibleCats(k).some(c => c.id === cat) ? d.byCat.get(cat) || [] : []) : p ? this.idxForKw(k, p.kw) : this.allIdx(k);
        if (g) {
          const inGenre = new Set(this.idxForKw(k, g.kw));
          idx = idx.filter(i => inGenre.has(i));
        }
        for (const i of idx) {
          const it = d.items[i];
          all.push({ k, i, n: sort === 'az' ? fold(str(it.name)) : '', v: sort === 'az' ? 0 : this.sortKey(k, it, sort === 'rating' ? 'rating' : 'added') });
        }
      }
      all.sort(sort === 'az' ? (a, b) => (a.n < b.n ? -1 : a.n > b.n ? 1 : 0) : (a, b) => b.v - a.v);
      list = all.map(x => ({ k: x.k, i: x.i }));
      if (this.exCache.size > 10) this.exCache.clear();
      this.exCache.set(key, list);
    }
    // el último resultado armado (las fichas ya convertidas): volver a abrir la lupa no rehace 2000 fichas
    const rk = key + '|' + needle + '|' + max;
    if (this.exRes?.key === rk && this.exRes.list === list) return this.exRes.r;
    const hits = needle ? list.filter(x => fold(str(this.k[x.k]!.items[x.i].name)).includes(needle)) : list;
    const r = { items: hits.slice(0, max).map(x => toItem(x.k, this.k[x.k]!.items[x.i])), total: hits.length };
    this.exRes = { key: rk, list, r };
    return r;
  }

  /** «Categorías» de Explorar: las carpetas visibles del servidor (con «Todo», las de películas y las de series) */
  exploreCats(type: 'all' | 'vod' | 'series'): { id: string; name: string; kind: 'vod' | 'series' }[] {
    const kinds: ('vod' | 'series')[] = type === 'all' ? ['vod', 'series'] : [type];
    const out: { id: string; name: string; kind: 'vod' | 'series' }[] = [];
    for (const k of kinds) for (const c of this.visibleCats(k)) if ((this.k[k]?.byCat.get(c.id) || []).length) out.push({ id: c.id, name: c.name, kind: k });
    return out;
  }

  // géneros y plataformas que tienen alguna categoría visible (géneros: del tipo elegido)
  exploreTags(type: 'all' | 'vod' | 'series', platforms: boolean): { genres: Platform[]; platforms: Platform[] } {
    const has = (kinds: Kind[], kw: string[]) => kinds.some(k => this.visibleCats(k).some(c => matchesKw(c.name, kw)));
    const kinds: Kind[] = type === 'all' ? ['vod', 'series'] : [type];
    return {
      genres: GENRES.filter(g => has(kinds, g.kw)),
      platforms: platforms ? PLATFORMS.filter(x => has(['vod', 'series'], x.kw)) : [],
    };
  }

  // ---------- búsqueda ----------
  // nombres normalizados una vez por catálogo (Buscar arma los resultados mientras se escribe: antes se normalizaban
  // todos los títulos en cada tecla y el Fire TV se trababa), como Android
  private folded: Partial<Record<Kind, { items: any[]; names: string[] }>> = {};
  private foldedNames(kind: Kind): string[] {
    const d = this.k[kind]!;
    const c = this.folded[kind];
    if (c && c.items === d.items) return c.names;
    const names = d.items.map(it => fold(str(it.name)));
    this.folded[kind] = { items: d.items, names };
    return names;
  }

  search(q: string): Item[] {
    const words = fold(q).split(' ').filter(Boolean);
    if (!words.length) return [];
    const first = words.join(' ');
    const out: Item[] = [];
    for (const kind of ['vod', 'series', 'live'] as Kind[]) {
      const d = this.k[kind];
      if (!d) continue;
      const vis = new Set(this.visibleCats(kind).map(c => c.id));
      const names = this.foldedNames(kind);
      // lo que empieza por lo buscado va primero (como Android), después el resto; hasta 80 por tipo
      const starts: number[] = [];
      const rest: number[] = [];
      const idKey = kind === 'series' ? 'series_id' : 'stream_id';
      for (let i = 0; i < d.items.length && starts.length < 80; i++) {
        const n = names[i];
        if (!words.every(w => n.includes(w)) || !vis.has(str(d.items[i].category_id))) continue;
        // perfil infantil: solo lo que pasó el filtro (la lista de items es la completa)
        if (this.kidsOn && d.index.get(str(d.items[i][idKey])) !== i) continue;
        if (n.startsWith(first)) starts.push(i);
        else if (rest.length < 80) rest.push(i);
      }
      for (const i of starts.concat(rest).slice(0, 80)) out.push(toItem(kind, d.items[i]));
    }
    return out;
  }

  // ---------- TV en vivo ----------
  liveCats(): { id: string; name: string; count: number; locked: boolean }[] {
    const d = this.k.live;
    const out = [{ id: 'fav', name: t('Favoritos'), count: 0, locked: false }];
    if (!d) return out;
    out.push({ id: 'all', name: t('Todos los canales'), count: d.index.size, locked: false });
    for (const c of d.cats) {
      const n = (d.byCat.get(c.id) || []).length;
      if (n) out.push({ id: c.id, name: c.name, count: n, locked: !this.unlocked && this.isCatLocked('live', c.name, c.id) });
    }
    return out;
  }

  liveChannels(cat: string, favIds: string[] = []): Item[] {
    const d = this.k.live;
    if (!d) return [];
    if (cat === 'fav') {
      return favIds.map(id => d.index.get(id)).filter((i): i is number => i !== undefined).map(i => toItem('live', d.items[i]));
    }
    if (cat === 'all') return this.items('live', this.allIdx('live'), 6000);
    return this.items('live', d.byCat.get(cat) || []);
  }

  allCategories(kind: Kind) {
    return (this.k[kind]?.cats || []).map(c => ({ ...c, adult: isAdult(c.name) }));
  }
}

export const catalog = new Catalog();
