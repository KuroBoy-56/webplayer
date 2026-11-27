// Abrir fichas, cuadrículas y el reproductor (igual que Play.brs de Roku).
import { goto } from './lib/goto';
import type { Episode } from './api/xtream';
import { catalog, Item, Special } from './data/catalog';
import { t } from './lib/i18n';
import { serverDurationSec } from './lib/util';
import type { ExploreInit, Nav } from './nav';
import { progressMovie, resumePosition } from './state';

export function openItem(nav: Nav, it: Item, channels?: Item[]) {
  if (it.kind === 'live') {
    const list = channels && channels.length ? channels : [it];
    const index = Math.max(0, list.findIndex(c => c.id === it.id));
    nav.push({ name: 'player', params: { kind: 'live', channel: it, channels: list, index } });
    return;
  }
  nav.push({ name: 'detail', item: it });
}

// «Ver todo», plataformas y géneros: Explorar con el filtro de esa fila, como browse.php del web player (Top 10 =
// Mejor valorados, recientes = Agregados recientemente, una carpeta = esa carpeta). Continuar viendo y Mi lista tienen
// su propia cuadrícula; «Series / Películas para ti», su sección (como seriesondemand.php / moviesondemand.php).
export function openSpecial(nav: Nav, sp: Special) {
  const explore = (init: ExploreInit) => nav.push({ name: 'explore', init });
  const kindOf = (x: string) => (x === 'vod' || x === 'series' ? x : undefined);
  // un partido de «En vivo ahora»: su canal
  if (sp.kind === 'live') {
    if (sp.extra === 'sports') goto('sports');
    else if (sp.live) openItem(nav, sp.live.best);
  } else if (sp.kind === 'platform') {
    explore({ platform: sp.key });
  } else if (sp.kind === 'genre') {
    explore({ genre: sp.key, type: kindOf(sp.extra || '') });
  } else {
    const extra = sp.extra || '';
    if (extra === 'platform') explore({ platform: sp.key });
    else if (extra === 'genre') explore({ genre: sp.key });
    else if (extra === 'continue') nav.push({ name: 'grid', title: t('Continuar viendo'), mode: 'continue', key: 'continue' });
    else if (extra === 'mylist') nav.push({ name: 'grid', title: t('Mi lista'), mode: 'mylist', key: 'mylist' });
    else if (extra.startsWith('top:')) explore({ type: kindOf(extra.slice(4)) || 'all', sort: 'rating' });
    else if (extra.startsWith('for:')) goto(extra === 'for:series' ? 'series' : 'movies');
    else if (extra.startsWith('cat:')) {
      const kind = extra.slice(4) === 'series' ? 'series' : 'vod';
      const name = catalog.k[kind]?.cats.find(c => c.id === sp.key)?.name || t('Categoría');
      explore({ cat: { id: sp.key, name, kind } });
    } else explore({ type: extra === 'series' ? 'series' : 'vod', sort: 'recent' });
  }
}

export function playMovie(nav: Nav, item: Item, ext: string, fromStart = false, duration = '') {
  const p = progressMovie(item.id);
  const resume = fromStart ? 0 : resumePosition(p);
  nav.push({
    name: 'player',
    params: {
      kind: 'movie',
      // sin la duración del servidor (botón del inicio): la guardada con el avance, para la barra del reproductor
      queue: [{ id: item.id, title: item.name, ext: ext || item.ext, poster: item.poster, dur: serverDurationSec(duration) || Math.floor(p?.duration || 0) }],
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
    return { id: e.id, title: t, ext: e.ext, poster: e.image || series.poster, season: e.season, num: e.num, dur: serverDurationSec(e.duration) };
  });
  nav.push({
    name: 'player',
    params: { kind: 'episode', queue, index, saveTitle: series.name, savePoster: series.poster, cat: series.cat, seriesId: series.id, resume },
  });
}
