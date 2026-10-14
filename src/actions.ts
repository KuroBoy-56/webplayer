// Abrir fichas, cuadrículas y el reproductor (igual que Play.brs de Roku).
import type { Episode } from './api/xtream';
import { GENRES, Item, label, PLATFORMS, Special } from './data/catalog';
import { t } from './lib/i18n';
import type { Nav } from './nav';
import { progressMovie } from './state';

export function openItem(nav: Nav, it: Item, channels?: Item[]) {
  if (it.kind === 'live') {
    const list = channels && channels.length ? channels : [it];
    const index = Math.max(0, list.findIndex(c => c.id === it.id));
    nav.push({ name: 'player', params: { kind: 'live', channel: it, channels: list, index } });
    return;
  }
  nav.push({ name: 'detail', item: it });
}

export function openSpecial(nav: Nav, sp: Special) {
  if (sp.kind === 'platform') {
    nav.push({ name: 'grid', title: sp.label, mode: 'platform', key: sp.key });
  } else if (sp.kind === 'genre') {
    const kind = sp.extra === 'vod' || sp.extra === 'series' ? sp.extra : undefined;
    nav.push({ name: 'grid', title: sp.label, mode: 'genre', key: sp.key, kind });
  } else {
    const extra = sp.extra || '';
    if (extra === 'platform') {
      const p = PLATFORMS.find(x => x.key === sp.key);
      nav.push({ name: 'grid', title: p ? label(p) : t('Plataforma'), mode: 'platform', key: sp.key });
    } else if (extra === 'genre') {
      const g = GENRES.find(x => x.key === sp.key);
      nav.push({ name: 'grid', title: g ? label(g) : t('Género'), mode: 'genre', key: sp.key });
    } else if (extra.startsWith('cat:')) {
      nav.push({ name: 'grid', title: t('Categoría'), mode: 'cat', key: sp.key, kind: extra.slice(4) as 'vod' | 'series' });
    } else {
      const kind = extra === 'series' ? 'series' : 'vod';
      nav.push({ name: 'grid', title: kind === 'series' ? t('Series recientes') : t('Películas recientes'), mode: 'recent', key: 'recent', kind });
    }
  }
}

export function playMovie(nav: Nav, item: Item, ext: string, fromStart = false) {
  let resume = 0;
  const p = progressMovie(item.id);
  if (p && !fromStart && p.position > 5 && (p.duration <= 0 || p.position < p.duration * 0.95)) resume = Math.floor(p.position);
  nav.push({
    name: 'player',
    params: {
      kind: 'movie',
      queue: [{ id: item.id, title: item.name, ext: ext || item.ext, poster: item.poster }],
      index: 0,
      saveTitle: item.name,
      savePoster: item.poster,
      cat: item.cat,
      seriesId: '',
      resume,
    },
  });
}

// eps: episodios de la temporada; pasa solo al siguiente
export function playEpisodes(nav: Nav, series: Item, eps: Episode[], index: number, resume: number) {
  const queue = eps.map(e => {
    let t = series.name + ' · T' + e.season + ' E' + e.num;
    if (e.title && !e.title.includes(series.name)) t += ' · ' + e.title;
    return { id: e.id, title: t, ext: e.ext, poster: e.image || series.poster, season: e.season, num: e.num };
  });
  nav.push({
    name: 'player',
    params: { kind: 'episode', queue, index, saveTitle: series.name, savePoster: series.poster, cat: series.cat, seriesId: series.id, resume },
  });
}
