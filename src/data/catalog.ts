// Catálogo en memoria: filas del inicio, plataformas, géneros, búsqueda y TV en vivo
// (misma lógica que la app de Roku y Android).
import { Kind } from '../api/xtream';
import { fold, float, isAdult, str } from '../lib/util';
import { pref, readJson } from '../lib/storage';

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
};

export type Special = { kind: 'platform' | 'genre' | 'more'; key: string; label: string; image?: number; color: string; extra?: string };
export type Row = { title: string; type: 'poster' | 'top10' | 'platform' | 'genre'; items: (Item | Special)[] };

export type Platform = { key: string; label: string; image?: number; color: string; kw: string[] };

export const PLATFORMS: Platform[] = [
  { key: 'netflix', label: 'Netflix', image: require('../../assets/image/plat_netflix.png'), color: '#E50914', kw: ['netflix'] },
  { key: 'disney', label: 'Disney+', image: require('../../assets/image/plat_disney.png'), color: '#113CCF', kw: ['disney', 'pixar', 'star+', 'star plus'] },
  { key: 'max', label: 'HBO Max', image: require('../../assets/image/plat_max.png'), color: '#5822B4', kw: ['hbo', '\\bmax\\b'] },
  { key: 'prime', label: 'Prime Video', image: require('../../assets/image/plat_prime.png'), color: '#00A8E1', kw: ['amazon', 'prime'] },
  { key: 'marvel', label: 'Marvel', image: require('../../assets/image/plat_marvel.png'), color: '#EC1D24', kw: ['marvel', '\\bmcu\\b'] },
  { key: 'apple', label: 'Apple TV+', color: '#555555', kw: ['apple'] },
  { key: 'paramount', label: 'Paramount+', color: '#0064FF', kw: ['paramount'] },
  { key: 'dc', label: 'DC', color: '#0476F2', kw: ['\\bdc\\b', 'dc comics'] },
  { key: 'xmas', label: 'Navidad', image: require('../../assets/image/plat_xmas.png'), color: '#1F7A3A', kw: ['navidad', 'navide', 'christmas', 'xmas'] },
  { key: 'halloween', label: 'Halloween', image: require('../../assets/image/plat_halloween.png'), color: '#FF6A00', kw: ['halloween', 'terror', 'horror'] },
];

export const GENRES: Platform[] = [
  { key: 'accion', label: 'Acción', color: '#B71C1C', kw: ['accion', 'action', 'artes marciales'] },
  { key: 'suspenso', label: 'Suspenso', color: '#37474F', kw: ['suspenso', 'suspense', 'thriller', 'misterio', 'mystery', 'intriga'] },
  { key: 'aventura', label: 'Aventura', color: '#2E7D32', kw: ['aventura', 'adventure'] },
  { key: 'anime', label: 'Anime', color: '#D81B60', kw: ['anime', 'crunchyroll', 'otaku'] },
  { key: 'drama', label: 'Drama', color: '#6A1B9A', kw: ['drama'] },
  { key: 'comedia', label: 'Comedia', color: '#F9A825', kw: ['comedia', 'comedy', 'humor'] },
  { key: 'terror', label: 'Terror', color: '#212121', kw: ['terror', 'horror', 'miedo'] },
  { key: 'scifi', label: 'Ciencia ficción', color: '#1565C0', kw: ['ciencia ficcion', 'sci-fi', 'scifi', 'science fiction'] },
  { key: 'fantasia', label: 'Fantasía', color: '#4527A0', kw: ['fantasia', 'fantasy'] },
  { key: 'romance', label: 'Romance', color: '#C2185B', kw: ['romance', 'romantic', 'romantica', 'amor'] },
  { key: 'crimen', label: 'Crimen', color: '#424242', kw: ['crimen', 'crime', 'policia', 'mafia'] },
  { key: 'animacion', label: 'Animación', color: '#00897B', kw: ['animacion', 'animation', 'animada', 'infantil', 'kids', 'cartoon'] },
  { key: 'documental', label: 'Documental', color: '#5D4037', kw: ['documental', 'documentary', 'docu'] },
  { key: '4k', label: '4K', color: '#000000', kw: ['4k', 'uhd', '2160'] },
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
  const bd = Array.isArray(it.backdrop_path) && it.backdrop_path.length ? str(it.backdrop_path[0]) : '';
  return {
    kind,
    id: kind === 'series' ? str(it.series_id) : str(it.stream_id),
    name: str(it.name),
    poster: kind === 'series' ? str(it.cover) : str(it.stream_icon),
    backdrop: bd,
    plot: str(it.plot),
    cat: str(it.category_id),
    ext: str(it.container_extension),
    rating,
    year: str(it.year) || str(it.releaseDate).slice(0, 4) || str(it.release_date).slice(0, 4),
    epg: str(it.epg_channel_id),
    num: str(it.num),
  };
}

class Catalog {
  k: Partial<Record<Kind, KindData>> = {};
  unlocked = false;

  clear() {
    this.k = {};
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
        d.cats.push({ id: cid, name: 'Otros' });
      }
      d.byCat.get(cid)!.push(i);
    });
    this.k[kind] = d;
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
    const out: number[] = [];
    for (const c of this.visibleCats(kind)) if (matchesKw(c.name, kw)) out.push(...(d.byCat.get(c.id) || []));
    return out;
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

  // ---------- inicio ----------
  home(): { rows: Row[]; hero: Item | null } {
    const rows: Row[] = [];
    let hero: Item | null = null;
    const vodIdx = this.allIdx('vod');
    const serIdx = this.allIdx('series');

    const plats: Row = { title: 'Plataformas', type: 'platform', items: [] };
    const platRows: { p: Platform; mv: number[]; sv: number[] }[] = [];
    for (const p of PLATFORMS) {
      const mv = this.idxForKw('vod', p.kw);
      const sv = this.idxForKw('series', p.kw);
      if (mv.length + sv.length > 0) {
        plats.items.push({ kind: 'platform', key: p.key, label: p.label, image: p.image, color: p.color });
        platRows.push({ p, mv, sv });
      }
    }
    if (plats.items.length) rows.push(plats);

    const recentMovies = this.top('vod', vodIdx, 'added', 30);
    if (recentMovies.length) {
      hero = this.items('vod', [recentMovies[Math.floor(Math.random() * Math.min(10, recentMovies.length))]])[0];
      rows.push({
        title: 'Películas agregadas recientemente',
        type: 'poster',
        items: [...this.items('vod', recentMovies), { kind: 'more', key: 'recent', label: 'Ver todo', color: '', extra: 'vod' }],
      });
    }
    const top10 = this.top('vod', vodIdx, 'rating', 10);
    if (top10.length >= 5) rows.push({ title: 'Top 10 películas', type: 'top10', items: this.items('vod', top10) });

    const recentSeries = this.top('series', serIdx, 'added', 30);
    if (recentSeries.length) {
      rows.push({
        title: 'Series con episodios nuevos',
        type: 'poster',
        items: [...this.items('series', recentSeries), { kind: 'more', key: 'recent', label: 'Ver todo', color: '', extra: 'series' }],
      });
      if (!hero) hero = this.items('series', [recentSeries[0]])[0];
    }
    const topSeries = this.top('series', serIdx, 'rating', 10);
    if (topSeries.length >= 5) rows.push({ title: 'Top 10 series', type: 'top10', items: this.items('series', topSeries) });

    for (const pr of platRows) {
      rows.push({
        title: pr.p.label,
        type: 'poster',
        items: [
          ...this.items('vod', this.top('vod', pr.mv, 'added', 15)),
          ...this.items('series', this.top('series', pr.sv, 'added', 15)),
          { kind: 'more', key: pr.p.key, label: 'Ver todo', color: pr.p.color, extra: 'platform' },
        ],
      });
    }

    const gen: Row = { title: 'Géneros', type: 'genre', items: [] };
    const genRows: { g: Platform; mv: number[]; sv: number[] }[] = [];
    for (const g of GENRES) {
      const mv = this.idxForKw('vod', g.kw);
      const sv = this.idxForKw('series', g.kw);
      if (mv.length + sv.length > 0) {
        gen.items.push({ kind: 'genre', key: g.key, label: g.label, color: g.color });
        genRows.push({ g, mv, sv });
      }
    }
    if (gen.items.length) rows.push(gen);
    for (const gr of genRows.slice(0, 8)) {
      rows.push({
        title: gr.g.label,
        type: 'poster',
        items: [
          ...this.items('vod', this.top('vod', gr.mv, 'added', 15)),
          ...this.items('series', this.top('series', gr.sv, 'added', 15)),
          { kind: 'more', key: gr.g.key, label: 'Ver todo', color: gr.g.color, extra: 'genre' },
        ],
      });
    }
    return { rows, hero };
  }

  // ---------- películas / series ----------
  browse(kind: 'vod' | 'series'): { rows: Row[]; hero: Item | null } {
    const rows: Row[] = [];
    const d = this.k[kind];
    if (!d) return { rows, hero: null };
    const all = this.allIdx(kind);
    const recent = this.top(kind, all, 'added', 30);
    const hero = recent.length ? this.items(kind, [recent[Math.floor(Math.random() * Math.min(10, recent.length))]])[0] : null;
    if (recent.length) {
      rows.push({
        title: 'Agregadas recientemente',
        type: 'poster',
        items: [...this.items(kind, recent), { kind: 'more', key: 'recent', label: 'Ver todo', color: '', extra: kind }],
      });
    }
    const gen: Row = { title: 'Géneros', type: 'genre', items: [] };
    for (const g of GENRES) if (this.idxForKw(kind, g.kw).length) gen.items.push({ kind: 'genre', key: g.key, label: g.label, color: g.color, extra: kind });
    if (gen.items.length) rows.push(gen);
    const top = this.top(kind, all, 'rating', 10);
    if (top.length >= 5) rows.push({ title: 'Top 10', type: 'top10', items: this.items(kind, top) });
    for (const c of this.visibleCats(kind)) {
      const idx = d.byCat.get(c.id) || [];
      if (!idx.length) continue;
      const items: (Item | Special)[] = this.items(kind, idx, 25);
      if (idx.length > 25) items.push({ kind: 'more', key: c.id, label: 'Ver todo', color: '', extra: 'cat:' + kind });
      rows.push({ title: c.name, type: 'poster', items });
    }
    return { rows, hero };
  }

  // ---------- cuadrícula "Ver todo" ----------
  grid(mode: 'cat' | 'platform' | 'genre' | 'recent', key: string, kind?: Kind): Item[] {
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
      out.push(...this.items(k, idx, 3000));
    }
    return out;
  }

  // ---------- búsqueda ----------
  search(q: string): Item[] {
    const words = fold(q).split(' ').filter(Boolean);
    if (!words.length) return [];
    const out: Item[] = [];
    for (const kind of ['vod', 'series', 'live'] as Kind[]) {
      const d = this.k[kind];
      if (!d) continue;
      const vis = new Set(this.visibleCats(kind).map(c => c.id));
      let found = 0;
      for (const it of d.items) {
        if (!vis.has(str(it.category_id))) continue;
        const n = fold(str(it.name));
        if (words.every(w => n.includes(w))) {
          out.push(toItem(kind, it));
          if (++found >= 80) break;
        }
      }
    }
    return out;
  }

  // ---------- TV en vivo ----------
  liveCats(): { id: string; name: string; count: number; locked: boolean }[] {
    const d = this.k.live;
    const out = [{ id: 'fav', name: 'Favoritos', count: 0, locked: false }];
    if (!d) return out;
    out.push({ id: 'all', name: 'Todos los canales', count: d.index.size, locked: false });
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
