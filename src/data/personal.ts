// Continuar viendo y Mi lista (lo guardado en el panel) cruzados con el catálogo: título, carátula y ficha reales.
// Los usan las filas del inicio, Películas y Series y su «Ver todo».
import { digits } from '../lib/util';
import type { Fav, Progress } from '../state';
import { catalog, Item } from './catalog';

export function continueItems(progress: Progress[], only?: 'vod' | 'series', max = 30): Item[] {
  const items: Item[] = [];
  const seen = new Set<string>();
  for (const p of progress) {
    if (p.type === 'movie' && only !== 'series') {
      const it = catalog.find('vod', digits(p.id)) || null;
      if (it && !seen.has('v' + it.id)) {
        seen.add('v' + it.id);
        items.push(it);
      }
    } else if ((p.type === 'episode' || (p.type as string) === 'series') && only !== 'vod') {
      // 'series' lo guardan otras apps (Windows) con el id de la serie
      const it = catalog.find('series', digits(p.type === 'episode' ? p.seriesId : p.seriesId || p.id));
      if (it && !seen.has('s' + it.id)) {
        seen.add('s' + it.id);
        items.push(it);
      }
    }
    if (items.length >= max) break;
  }
  return items;
}

export function favItems(favorites: Fav[], max = 30): Item[] {
  const items: Item[] = [];
  for (const f of favorites) {
    if (f.type === 'live') continue;
    const it = catalog.find(f.type === 'movie' ? 'vod' : 'series', digits(f.id));
    if (it) items.push(it);
    if (items.length >= max) break;
  }
  return items;
}
