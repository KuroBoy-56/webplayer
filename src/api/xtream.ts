// API de Xtream Codes del proveedor.
import { b64Decode } from '../lib/crypto';
import { http, json } from '../lib/http';
import { enc, int, nowSec, parseIso, str } from '../lib/util';
import { cloud, Server, Session } from './panel';

export function api(s: { base: string; user: string; pass: string }, action = '', extra = ''): string {
  let u = s.base + '/player_api.php?username=' + enc(s.user) + '&password=' + enc(s.pass);
  if (action) u += '&action=' + action;
  return u + extra;
}

function sessionFrom(sv: Server, user: string, pass: string, ui: any): Session {
  return {
    dns: sv.name,
    base: sv.base,
    user,
    pass,
    exp: int(ui.exp_date),
    created: int(ui.created_at),
    active: str(ui.active_cons),
    max: str(ui.max_connections),
  };
}

// Prueba el usuario en todos los servidores a la vez y se queda con el primero que lo acepte
export async function loginAll(servers: Server[], user: string, pass: string): Promise<{ session?: Session; error?: string }> {
  if (!servers.length) return { error: 'El panel no devolvió servidores. Inténtalo de nuevo.' };
  const ctrl = new AbortController();
  let lastErr = 'No se pudo conectar con ningún servidor';
  return new Promise(resolve => {
    let pending = servers.length;
    let done = false;
    const finish = () => {
      pending--;
      if (pending === 0 && !done) {
        done = true;
        resolve({ error: lastErr });
      }
    };
    for (const sv of servers) {
      http(api({ base: sv.base, user, pass }), { timeout: 15000, signal: ctrl.signal }).then(r => {
        if (done) return;
        const j = json(r);
        const ui = j && typeof j === 'object' ? j.user_info : null;
        if (ui && int(ui.auth) === 1) {
          const st = str(ui.status);
          if (!st || st.toLowerCase() === 'active') {
            done = true;
            ctrl.abort();
            resolve({ session: sessionFrom(sv, user, pass, ui) });
            return;
          }
          lastErr = 'Tu cuenta está ' + st;
        } else if (r.code > 0 && lastErr === 'No se pudo conectar con ningún servidor') {
          lastErr = 'Usuario o contraseña incorrectos';
        }
        finish();
      });
    }
  });
}

export type Kind = 'vod' | 'series' | 'live';

export async function loadKind(s: Session, kind: Kind): Promise<{ cats: any[]; items: any[] }> {
  const actions: Record<Kind, [string, string]> = {
    vod: ['get_vod_categories', 'get_vod_streams'],
    series: ['get_series_categories', 'get_series'],
    live: ['get_live_categories', 'get_live_streams'],
  };
  const [catAction, listAction] = actions[kind];
  const [cr, items] = await Promise.all([
    http(api(s, catAction), { timeout: 30000 }),
    (async () => {
      for (let attempt = 1; attempt <= 2; attempt++) {
        const r = json(await http(api(s, listAction), { timeout: 90000 }));
        if (Array.isArray(r)) return r;
      }
      return [];
    })(),
  ]);
  const cats = json(cr);
  return { cats: Array.isArray(cats) ? cats : [], items };
}

export function movieUrl(s: Session, id: string, ext: string): string {
  return s.base + '/movie/' + enc(s.user) + '/' + enc(s.pass) + '/' + id + '.' + (ext || 'mp4');
}

export function episodeUrl(s: Session, id: string, ext: string): string {
  return s.base + '/series/' + enc(s.user) + '/' + enc(s.pass) + '/' + id + '.' + (ext || 'mp4');
}

export function liveUrl(s: Session, id: string, fmt: string): string {
  return s.base + '/live/' + enc(s.user) + '/' + enc(s.pass) + '/' + id + '.' + fmt;
}

export type VodInfo = {
  plot: string;
  cast: string;
  director: string;
  genre: string;
  duration: string;
  backdrop: string;
  poster: string;
  ext: string;
  year: string;
  rating: string;
};

const obj = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});

export async function vodInfo(s: Session, id: string): Promise<VodInfo | null> {
  const j = json(await http(api(s, 'get_vod_info', '&vod_id=' + enc(id))));
  if (!j || typeof j !== 'object') return null;
  const info = obj(j.info);
  const md = obj(j.movie_data);
  const bd = Array.isArray(info.backdrop_path) && info.backdrop_path.length ? str(info.backdrop_path[0]) : '';
  return {
    plot: str(info.plot) || str(info.description),
    cast: str(info.cast) || str(info.actors),
    director: str(info.director),
    genre: str(info.genre),
    duration: str(info.duration),
    backdrop: bd,
    poster: str(info.movie_image),
    ext: str(md.container_extension),
    year: (str(info.releasedate) || str(info.release_date)).slice(0, 4),
    rating: str(info.rating),
  };
}

export type Episode = { id: string; num: number; season: number; title: string; ext: string; image: string; plot: string; duration: string };
export type SeriesInfo = { plot: string; cast: string; director: string; genre: string; backdrop: string; poster: string; year: string; rating: string; seasons: { season: number; episodes: Episode[] }[] };

function episodeOf(e: any, season: number): Episode {
  const ei = obj(e?.info);
  return {
    id: str(e?.id),
    num: int(e?.episode_num),
    season: int(e?.season) > 0 ? int(e?.season) : season,
    title: str(e?.title),
    ext: str(e?.container_extension),
    image: str(ei.movie_image),
    plot: str(ei.plot),
    duration: str(ei.duration),
  };
}

export async function seriesInfo(s: Session, id: string): Promise<SeriesInfo | null> {
  const j = json(await http(api(s, 'get_series_info', '&series_id=' + enc(id)), { timeout: 25000 }));
  if (!j || typeof j !== 'object') return null;
  const info = obj(j.info);
  const seasons: SeriesInfo['seasons'] = [];
  const eps = j.episodes;
  if (Array.isArray(eps)) {
    // algunos servidores mandan una lista de temporadas
    eps.forEach((arr: any, i: number) => {
      const list = Array.isArray(arr) ? arr.map(e => episodeOf(e, i + 1)) : [];
      if (list.length) seasons.push({ season: i + 1, episodes: list });
    });
  } else if (eps && typeof eps === 'object') {
    const keys = Object.keys(eps).sort((a, b) => int(a) - int(b));
    for (const k of keys) {
      const arr = eps[k];
      const list = Array.isArray(arr) ? arr.map(e => episodeOf(e, int(k))) : [];
      list.sort((a, b) => a.num - b.num);
      if (list.length) seasons.push({ season: int(k), episodes: list });
    }
  }
  const bd = Array.isArray(info.backdrop_path) && info.backdrop_path.length ? str(info.backdrop_path[0]) : '';
  return {
    plot: str(info.plot),
    cast: str(info.cast),
    director: str(info.director),
    genre: str(info.genre),
    backdrop: bd,
    poster: str(info.cover),
    year: str(info.releaseDate).slice(0, 4),
    rating: str(info.rating),
    seasons,
  };
}

export type EpgEntry = { t: string; d: string; s: number; e: number };

// guía: primero get_short_epg del proveedor y, si no trae nada, epg.php del panel
export async function channelEpg(s: Session, ch: { id: string; epg: string; name: string }): Promise<EpgEntry[]> {
  const now = nowSec();
  let out: EpgEntry[] = [];
  const j = json(await http(api(s, 'get_short_epg', '&stream_id=' + enc(ch.id) + '&limit=8'), { timeout: 10000 }));
  if (j && Array.isArray(j.epg_listings)) {
    for (const e of j.epg_listings) {
      const st = int(e.start_timestamp) || parseIso(str(e.start));
      const en = int(e.stop_timestamp) || parseIso(str(e.end));
      if (en > now) out.push({ t: b64Decode(str(e.title)), d: b64Decode(str(e.description)), s: st, e: en });
    }
  }
  if (!out.length) {
    const pj = json(await cloud('epg.php', 'POST', { channels: [{ id: ch.id, epg: ch.epg, name: ch.name }] }));
    const lst = pj && pj.epg && Array.isArray(pj.epg[ch.id]) ? pj.epg[ch.id] : [];
    out = lst.filter((e: any) => int(e.e) > now).map((e: any) => ({ t: str(e.t), d: str(e.d), s: int(e.s), e: int(e.e) }));
  }
  return out.sort((a, b) => a.s - b.s).slice(0, 6);
}
