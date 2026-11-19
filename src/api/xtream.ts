// API de Xtream Codes del proveedor.
import { b64Decode } from '../lib/crypto';
import { http, json } from '../lib/http';
import { t } from '../lib/i18n';
import { digits, enc, int, nowSec, parseIso, str } from '../lib/util';
import { cloud, Server, Session } from './panel';
import { read, write } from '../lib/storage';

export function api(s: { base: string; user: string; pass: string }, action = '', extra = ''): string {
  let u = s.base + '/player_api.php?username=' + enc(s.user) + '&password=' + enc(s.pass);
  if (action) u += '&action=' + action;
  return u + extra;
}

export function sessionFrom(sv: Server, user: string, pass: string, ui: any): Session {
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

// http://… <-> https://…
// servidores mixtos: true = el video sale por el otro protocolo que el de la sesión (p. ej. la sesión en
// https y el video solo en http). Lo pone el reproductor cuando un video arranca; vale para la sesión.
let flip = false;
export function streamFlip(): boolean {
  return flip;
}
export function setStreamFlip(on: boolean): void {
  flip = on;
}

export function otherScheme(base: string): string {
  // el puerto por defecto del otro protocolo se quita (http://host:443 da «400 plain HTTP request»)
  return /^https:\/\//i.test(base)
    ? 'http://' + base.slice(8).replace(/^([^/]+):443(?=\/|$)/, '$1')
    : 'https://' + base.replace(/^[a-z]+:\/\//i, '').replace(/^([^/]+):80(?=\/|$)/, '$1');
}

// XUI.one en «Debug Mode» no responde {"user_info":{"auth":0}} sino una página HTML (200) con el motivo:
// «XUI.ONE INVALID_CREDENTIALS Username or password is invalid.». Devuelve el código (o '').
export function xuiError(body: string): string {
  const text = (body || '').replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const m = /XUI\.(?:ONE|one)\s+([A-Z][A-Z_]{2,})/.exec(text);
  return m ? m[1] : '';
}

export function xuiMessage(code: string): string {
  if (code === 'INVALID_CREDENTIALS') return t('El servidor no reconoce el usuario o la contraseña');
  if (code === 'EXPIRED') return t('Tu cuenta está vencida');
  if (code === 'BANNED' || code === 'DISABLED') return t('Tu cuenta está desactivada en el servidor');
  return t('El servidor rechazó la cuenta ({code})', { code });
}

// Prueba el usuario en todos los servidores a la vez y se queda con el primero que lo acepte. El panel
// (https) manda los servidores IPTV con https:// y muchos solo responden en http (p. ej. puerto 8080):
// cada servidor se prueba también con el otro protocolo, así la app nunca se queda sin entrar por eso.
// offline = ningún servidor contestó (ni aceptó ni rechazó la cuenta)
// Inicio de sesión en las DNS del panel con la regla de docs/LOGIN-SERVIDORES.md del panel (que XUI no bloquee la IP):
// primero la DNS con la que este usuario entró la última vez en el equipo, después de a una en el orden del panel y
// parando en la primera que acepta; una sola vez por servidor (host y puerto); https solo si en http no contestó nadie;
// un servidor que no contesta no cuenta como intento, y pasados 20 s lo que falta va a la vez. Si ninguno contesta, se
// avisa al panel (Errores de las apps) con cada DNS.
type Try = { session?: Session; error?: string; answered: boolean; note: string };

// aviso al panel cuando ninguna DNS contestó (lo conecta App con api/report.ts: este archivo no depende del reporte)
let unreachable: (detail: string) => void = () => {};
export function onLoginUnreachable(fn: (detail: string) => void): void {
  unreachable = fn;
}

export async function loginAll(input: Server[], user: string, pass: string): Promise<{ session?: Session; error?: string; offline?: boolean }> {
  if (!input.length) return { error: t('El panel no devolvió servidores. Inténtalo de nuevo.') };
  const lastKey = 'login_dns|' + user.trim().toLowerCase();
  const last = read(lastKey);
  const seen = new Set<string>();
  let list: { name: string; plain: string; secure: string }[] = [];
  for (const sv of input) {
    const isHttps = /^https:\/\//i.test(sv.base);
    const plain = isHttps ? otherScheme(sv.base) : sv.base;
    const k = plain.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    list.push({ name: sv.name, plain, secure: otherScheme(plain) });
  }
  const lk = last.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
  list = [...list.filter(x => x.plain.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').toLowerCase() === lk), ...list.filter(x => x.plain.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '').toLowerCase() !== lk)];
  const none = t('No se pudo conectar con ningún servidor');
  let lastErr = none;
  const notes: string[] = [];
  const ctrl = new AbortController();

  const one = async (name: string, base: string): Promise<Try> => {
    const r = await http(api({ base, user, pass }), { timeout: 15000, signal: ctrl.signal });
    const j = json(r);
    const ui = j && typeof j === 'object' ? j.user_info : null;
    console.log('[LatMpx] login ' + base.replace(/^[a-z]+:\/\//i, '') + ' -> http ' + r.code + (ui ? ' auth=' + str(ui.auth) + ' status=' + str(ui.status) : ' sin JSON'));
    if (r.code === 0) return { answered: false, note: base + ': no contestó' };
    if (ui && int(ui.auth) === 1) {
      const st = str(ui.status);
      if (!st || st.toLowerCase() === 'active') return { answered: true, session: sessionFrom({ name, base }, user, pass, ui), note: '' };
      return { answered: true, error: t('Tu cuenta está {st}', { st }), note: base + ': ' + st };
    }
    if (ui) return { answered: true, error: t('Usuario o contraseña incorrectos'), note: base + ': usuario o contraseña incorrectos' };
    if (xuiError(r.body)) return { answered: true, error: xuiMessage(xuiError(r.body)), note: base + ': XUI ' + xuiError(r.body) };
    // el servidor respondió pero no con la cuenta (línea bloqueada, vencida o servidor caído)
    return { answered: true, error: t('El servidor no aceptó la conexión (código {code})', { code: r.code }), note: base + ': http ' + r.code };
  };
  // http primero; https solo si http no contestó (nunca los dos a la vez: serían dos intentos para XUI)
  const server = async (sv: { name: string; plain: string; secure: string }): Promise<Try> => {
    const a = await one(sv.name, sv.plain);
    if (a.answered || ctrl.signal.aborted) return a;
    notes.push(a.note);
    return one(sv.name, sv.secure);
  };
  const keep = (r: Try) => {
    if (r.note) notes.push(r.note);
    // «usuario o contraseña incorrectos» no tapa un mensaje más claro de otro servidor (cuenta vencida, XUI…)
    if (r.error && (lastErr === none || lastErr === t('Usuario o contraseña incorrectos'))) lastErr = r.error;
  };
  const done = (sv: { plain: string }, r: Try) => {
    ctrl.abort();
    write(lastKey, sv.plain);
    return { session: r.session! };
  };

  const started = Date.now();
  for (let i = 0; i < list.length; i++) {
    // pasados 20 s lo que falta va a la vez, para no hacer esperar de más
    if (Date.now() - started > 20000 && list.length - i > 1) {
      const rest = list.slice(i);
      const won = await new Promise<{ sv: typeof rest[0]; r: Try } | null>(resolve => {
        let left = rest.length;
        for (const sv of rest) {
          server(sv).then(r => {
            if (r.session) return resolve({ sv, r });
            keep(r);
            if (--left === 0) resolve(null);
          });
        }
      });
      if (won) return done(won.sv, won.r);
      break;
    }
    const r = await server(list[i]);
    if (r.session) return done(list[i], r);
    keep(r);
  }
  // ningún servidor contestó: al panel (Errores de las apps), con lo que dijo cada DNS
  if (lastErr === none) unreachable(list.length + ' DNS\n' + notes.join('\n'));
  return { error: lastErr, offline: lastErr === none };
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
  // 'direct': la dirección corta sin /live/ ni extensión (algunos servidores solo entregan así)
  if (fmt === 'direct') return s.base + '/' + enc(s.user) + '/' + enc(s.pass) + '/' + id;
  return s.base + '/live/' + enc(s.user) + '/' + enc(s.pass) + '/' + id + '.' + fmt;
}

// imagen del servidor: backdrop_path llega como lista o como texto, y a veces como ruta de TMDB
// ("/abc.jpg") sin el dominio
export function imgPath(u: any, size: string): string {
  const v = Array.isArray(u) ? str(u[0]) : str(u);
  return v.startsWith('/') ? 'https://image.tmdb.org/t/p/' + size + v : v;
}

// formatos de TV en vivo en orden: si uno falla se prueba el siguiente. LG (webOS) reproduce HLS
// directo en <video>; Vega y Tizen entran mejor por MPEG-TS
// primero .m3u8: en Vega el modo directo no abre MPEG-TS (lo lee la app por MSE, src/player/livehls.ts) y en LG lo abre
// su propio <video>; después .ts y la dirección corta por si algún equipo sí los abre. En Vega (sin navegador:
// no hay document) solo .m3u8: el .ts y la dirección corta siempre daban «error 4» y los intentos de más hacen que el
// servidor bloquee el equipo un rato
export const LIVE_FORMATS = typeof (globalThis as any).document === 'undefined' ? ['m3u8'] : ['m3u8', 'ts', 'direct'];

// formato con el que se vio el último canal (esta sesión): los siguientes canales empiezan por él (en la tele LG, si el
// .m3u8 no abre y el .ts sí, cada canal ya no espera al .m3u8)
let liveFmt = 0;
export function liveFormatStart(): number {
  return liveFmt < LIVE_FORMATS.length ? liveFmt : 0;
}
export function setLiveFormat(i: number): void {
  liveFmt = i >= 0 && i < LIVE_FORMATS.length ? i : 0;
}

export type VodInfo = {
  tmdb: string;
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
  const bd = imgPath(info.backdrop_path, 'w1280');
  return {
    tmdb: digits(str(info.tmdb_id) || str(info.tmdb)),
    plot: str(info.plot) || str(info.description),
    cast: str(info.cast) || str(info.actors),
    director: str(info.director),
    genre: str(info.genre),
    duration: str(info.duration),
    backdrop: bd,
    poster: imgPath(info.movie_image, 'w500'),
    ext: str(md.container_extension),
    year: (str(info.releasedate) || str(info.release_date)).slice(0, 4),
    rating: str(info.rating),
  };
}

export type Episode = { id: string; num: number; season: number; title: string; ext: string; image: string; plot: string; duration: string };
export type SeriesInfo = { tmdb: string; plot: string; cast: string; director: string; genre: string; backdrop: string; poster: string; year: string; rating: string; seasons: { season: number; episodes: Episode[] }[] };

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
  const bd = imgPath(info.backdrop_path, 'w1280');
  return {
    tmdb: digits(str(info.tmdb_id) || str(info.tmdb)),
    plot: str(info.plot),
    cast: str(info.cast),
    director: str(info.director),
    genre: str(info.genre),
    backdrop: bd,
    poster: imgPath(info.cover, 'w500'),
    year: str(info.releaseDate).slice(0, 4),
    rating: str(info.rating),
    seasons,
  };
}

export type EpgEntry = { t: string; d: string; s: number; e: number };

// La guía de la vista previa y la del reproductor comparten una petición.
// Solo memoria, separada por sesión y limitada a 64 canales / 60 segundos.
const epgCache = new Map<string, { until: number; entries: EpgEntry[] }>();
const epgPending = new Map<string, Promise<EpgEntry[]>>();

// guía: primero get_short_epg del proveedor y, si no trae nada, epg.php del panel
export function channelEpg(s: Session, ch: { id: string; epg: string; name: string }): Promise<EpgEntry[]> {
  const key = JSON.stringify([s.base, s.user, s.pass, ch.id, ch.epg, ch.name]);
  const cached = epgCache.get(key);
  if (cached && cached.until > Date.now()) return Promise.resolve(cached.entries.filter(e => e.e > nowSec()));
  const pending = epgPending.get(key);
  if (pending) return pending;
  const request = fetchChannelEpg(s, ch).then(entries => {
    epgCache.delete(key);
    epgCache.set(key, { entries, until: Date.now() + (entries.length ? 60000 : 5000) });
    while (epgCache.size > 64) epgCache.delete(epgCache.keys().next().value!);
    return entries;
  }).finally(() => epgPending.delete(key));
  epgPending.set(key, request);
  return request;
}

async function fetchChannelEpg(s: Session, ch: { id: string; epg: string; name: string }): Promise<EpgEntry[]> {
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
