// «En vivo ahora» de Inicio y recordatorios de partidos en la nube, solo con perfiles (uno elegido, no el infantil) y
// Deportes encendido para el distribuidor:
// - api/sports_live.php?next=1: los partidos que se juegan y los próximos de 24 h (hasta 20); con equipos
//   favoritos (los que se eligen en el celular o la computadora, guardados en la nube) además todos los de hoy de esos
//   equipos. Solo salen los que tienen un canal en la lista del cliente (las mismas reglas que Deportes).
// - api/alerts.php: el recordatorio de un partido se guarda en la nube por línea y perfil; el celular de la misma
//   línea y perfil avisa en su barra de notificaciones (30 min, 10 min y al empezar).
import { cloud, lineKey } from '../api/panel';
import { read, readJson, write, writeJson } from '../lib/storage';
import { json } from '../lib/http';
import { brandName, features } from '../lib/tenant';
import { fold, int, nowSec, str } from '../lib/util';
import { t } from '../lib/i18n';
import { getState, profilesNeeded } from '../state';
import { Item } from './catalog';
import { evClock, evDay, matchSports, panelToday } from './sports';
import { fetchSports, loadFixtures, localSports } from './sportsPanel';

export const LIVE_MAX = 20;

/** disciplinas sin equipos ni marcador (peleas, boxeo, WWE, carreras, golf…): la tarjeta va con el evento y su póster */
const SOLO_SPORTS = new Set(['fighting', 'boxing', 'wrestling', 'mma', 'motorsport', 'golf', 'cycling', 'athletics']);

/** activar el recordatorio solo vale si faltan más de 5 minutos para que empiece (el panel responde 409 too_late) */
export const tooLate = (e: any) => int(e.s) <= nowSec() + 300;

export type LiveCard = {
  id: string;
  sp: string;
  lg: string;
  h: string;
  a: string;
  hb: string;
  ab: string;
  hs: string;
  as: string;
  st: string;
  pr: string;
  s: number;
  th: string;
  soon: boolean;
  best: Item;
  /** sin dos equipos (peleas, boxeo, WWE, carreras): la tarjeta muestra la disciplina (spl), el evento (ev) y su póster */
  solo: boolean;
  spl: string;
  ev: string;
  /** todo lo encontrado para el partido (agenda, guía, equipos): el menú de canales de la tarjeta, como en Deportes */
  m?: import('./sports').SportMatch;
  folder?: Item | null;
  iptv?: boolean;
};

/** ¿existe todo esto? (perfiles activos con un perfil elegido que no es el infantil, y Deportes encendido) */
export function liveTvOn(): boolean {
  const p = getState().profile;
  return profilesNeeded() && !!p && !p.kids && features().sports !== false;
}

const pid = () => {
  const p = getState().profile;
  return p && p.id !== 'main' ? p.id : '';
};

/** Cuenta › Habilitar tarjetas de plataformas: con «En vivo ahora» las plataformas vuelven debajo (por línea y perfil) */
const platKey = () => 'plat_cards|' + lineKey() + '|' + (getState().profile?.id || '');
export const platformCards = () => features().platforms !== false && read(platKey()) === '1';
export const setPlatformCards = (on: boolean) => write(platKey(), on ? '1' : '0');

/**
 * con perfiles y partidos en vivo del panel las plataformas no van en Inicio (salvo «Habilitar tarjetas de
 * plataformas»). Hasta que el panel contesta vale lo de la última vez para esta línea: así no aparecen y se van.
 */
const availKey = () => 'live_avail|' + lineKey();
export const hidesPlatforms = () => liveTvOn() && !platformCards() && read(availKey()) !== '0';

/** Cuenta › Deporte favorito: '' = todos; si no, «En vivo ahora» solo con esa disciplina (por línea y perfil) */
const sportKey = () => 'live_sport|' + lineKey() + '|' + (getState().profile?.id || '');
export const liveSport = () => read(sportKey()) || '';
export const liveSportName = () => read(sportKey() + '|n') || '';
export const setLiveSport = (sp: string, name: string) => {
  write(sportKey(), sp);
  write(sportKey() + '|n', name);
  // las ligas favoritas de otra disciplina ya no tienen sentido
  if (sp) setLiveLeagues(liveLeagues().filter(x => x.sp.toLowerCase() === sp.toLowerCase()));
};

/** Cuenta › Eventos favoritos (ligas y copas): id de TheSportsDB, nombre, escudo y deporte; ninguna = todas (por línea y perfil) */
export type FavLeague = { id: string; n: string; b: string; sp: string };
const leagueKey = () => 'live_leagues|' + lineKey() + '|' + (getState().profile?.id || '');
export const liveLeagues = (): FavLeague[] => {
  const j = readJson<FavLeague[]>(leagueKey());
  return Array.isArray(j) ? j.filter(x => x && str(x.id)) : [];
};
export const setLiveLeagues = (list: FavLeague[]) => writeJson(leagueKey(), list);
/** ligas para elegir: las de la agenda (con cuántos partidos tienen hoy) y las de los próximos 21 días; con un
 *  deporte favorito, solo las de ese. Primero las que juegan hoy; las elegidas siempre están para poder quitarlas */
export async function leagueChoices(): Promise<(FavLeague & { today: number })[]> {
  const [ag, fx] = await Promise.all([fetchSports().catch(() => null), loadFixtures(0, null).catch(() => null)]);
  const now = nowSec();
  const today = panelToday(null, now);
  const map = new Map<string, FavLeague & { today: number }>();
  for (const e of (ag || localSports())?.events || []) {
    const id = str(e.li);
    if (!id || !str(e.lg)) continue;
    const x = map.get(id) || { id, n: str(e.lg), b: str(e.lb), sp: str(e.sp), today: 0 };
    if (int(e.s) > 0 && evDay(e, int(e.s)) === today) x.today++;
    map.set(id, x);
  }
  for (const [id, v] of Object.entries<any>(fx?.leagues || {})) {
    if (!map.has(id) && str(v?.n)) map.set(id, { id, n: str(v.n), b: str(v.b), sp: str(v.sp), today: 0 });
  }
  // copas internacionales y de selecciones (Champions, Libertadores, CONCACAF, Mundial FIFA…) aunque esta semana no jueguen
  for (const c of (ag || localSports())?.cups || []) if (str(c?.id) && !map.has(str(c.id))) map.set(str(c.id), { id: str(c.id), n: str(c.n), b: '', sp: str(c.sp), today: 0 });
  for (const x of liveLeagues()) if (!map.has(x.id)) map.set(x.id, { ...x, today: 0 });
  const sp = liveSport().toLowerCase();
  // sin deporte favorito no se eligen eventos (la pantalla pide elegirlo primero)
  if (!sp) return [];
  return [...map.values()]
    .filter(x => !sp || x.sp.toLowerCase() === sp)
    .sort((a, b) => Number(b.today > 0) - Number(a.today > 0) || a.sp.localeCompare(b.sp) || a.n.localeCompare(b.n));
}

/**
 * Cuenta › Deporte favorito y Eventos favoritos también ordenan Deportes: primero los de los eventos favoritos, después
 * los demás del deporte favorito y al final todo lo demás, cada grupo en su orden (no se quita nada). Solo con perfiles.
 */
export function favoritesFirst<T>(list: T[], ev: (x: T) => Record<string, any>): T[] {
  if (!liveTvOn()) return list;
  const sp = liveSport().toLowerCase();
  const lg = new Set(liveLeagues().map(x => x.id));
  if (!sp && !lg.size) return list;
  const rank = (x: T) => {
    const e = ev(x);
    return str(e.li) && lg.has(str(e.li)) ? 0 : sp && str(e.sp).toLowerCase() === sp ? 1 : 2;
  };
  // con el índice: el orden de cada grupo queda igual también en los televisores viejos (sort no estable)
  return list
    .map((x, i) => ({ x, i, r: rank(x) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(o => o.x);
}

/** «Todos los eventos», el nombre del único o «3 eventos» */
export const liveLeaguesText = () => {
  const l = liveLeagues();
  return !l.length ? t('Todos los eventos') : l.length === 1 ? l[0].n : t('{n} eventos', { n: l.length });
};

// ---------- recordatorios en la nube ----------

// equipo favorito (n = nombre, l = en el idioma, b = escudo, lg = liga, sp = deporte), como el celular
export type FavTeam = { n: string; l: string; b: string; lg: string; sp: string };
type Cloud = { teams: string[]; teamList: FavTeam[]; events: Record<string, { t: string; s: number; h?: string; a?: string }>; brand: string; at: number; who: string };
let alertsMem: Cloud | null = null;
// de qué línea y perfil es lo guardado en memoria (otro perfil pide lo suyo enseguida)
const who = () => lineKey() + '|' + pid();

// ---------- Deporte favorito y Eventos favoritos en la nube («prefs» de api/alerts.php) ----------
// Lo que se elige aquí lo ven el celular, la computadora y las otras TV de la misma línea y perfil, y al revés. La nube
// manda; si nunca se guardó (at = 0) se sube lo que esta TV tenía guardado de antes.
let prefsTimer: ReturnType<typeof setTimeout> | null = null;
let prefsPending = false;
let uploadOld = false;

function applyCloudPrefs(p: any) {
  // un cambio de esta TV todavía sin subir gana (si no, la respuesta vieja lo borraría)
  if (!p || typeof p !== 'object' || prefsPending) return;
  if (int(p.at) <= 0) {
    uploadOld = !!liveSport() || liveLeagues().length > 0;
    return;
  }
  const sp = str(p.sp);
  const mine = new Map(liveLeagues().map(x => [x.id, x]));
  const lg: FavLeague[] = (Array.isArray(p.lg) ? p.lg : [])
    .filter((x: any) => str(x?.id))
    .map((x: any) => ({ id: str(x.id), n: str(x.n), b: mine.get(str(x.id))?.b || '', sp: str(x.sp) }));
  if (sp === liveSport() && lg.map(x => x.id).join(',') === liveLeagues().map(x => x.id).join(',')) return;
  write(sportKey(), sp);
  write(sportKey() + '|n', sp ? str(p.spn) : '');
  setLiveLeagues(lg);
}

/** sube el deporte y los eventos favoritos (después de elegirlos en Cuenta; varios cambios seguidos = un pedido) */
export function savePrefs() {
  if (!liveTvOn()) return;
  prefsPending = true;
  if (prefsTimer) clearTimeout(prefsTimer);
  prefsTimer = setTimeout(async () => {
    const body: Record<string, any> = {
      action: 'set_prefs',
      prefs: { sp: liveSport(), spn: liveSportName(), lg: liveLeagues().map(x => ({ id: x.id, n: x.n, sp: x.sp })) },
    };
    if (pid()) body.profile = pid();
    try {
      await cloud('alerts.php', 'POST', body);
    } catch {}
    prefsPending = false;
  }, 700);
}

function parseCloud(j: any): Cloud {
  const teamList: FavTeam[] = (Array.isArray(j.teams) ? j.teams : [])
    .filter((x: any) => str(x?.n))
    .map((x: any) => ({ n: str(x.n), l: str(x.l), b: str(x.b), lg: str(x.lg), sp: str(x.sp) }));
  applyCloudPrefs(j.prefs);
  return { teams: teamList.map(x => x.n), teamList, events: j.events && typeof j.events === 'object' ? j.events : {}, brand: str(j.brand), at: nowSec(), who: who() };
}

/** equipos favoritos y partidos marcados de este perfil (5 min en memoria); null sin perfiles o sin panel */
export async function cloudAlerts(force = false): Promise<Cloud | null> {
  if (!liveTvOn()) return null;
  if (!force && alertsMem && alertsMem.who === who() && nowSec() - alertsMem.at < 300) return alertsMem;
  const j = json<any>(await cloud('alerts.php', 'GET', pid() ? { profile: pid() } : {}));
  if (!j || j.success !== true || j.enabled !== true) return alertsMem && alertsMem.who === who() ? alertsMem : null;
  alertsMem = parseCloud(j);
  // la primera vez: lo que esta TV tenía guardado sube a la nube (las otras apps lo toman de ahí)
  if (uploadOld) {
    uploadOld = false;
    savePrefs();
  }
  return alertsMem;
}

/** guarda los equipos favoritos en la nube (avisa el celular de la misma línea y perfil); true si quedó guardado */
export async function setTeams(list: FavTeam[]): Promise<boolean> {
  const body: Record<string, any> = { action: 'set_teams', teams: list };
  if (pid()) body.profile = pid();
  const j = json<any>(await cloud('alerts.php', 'POST', body));
  if (!j || j.success !== true || j.enabled !== true) return false;
  alertsMem = parseCloud(j);
  return true;
}

// ---------- campanita: los partidos de HOY de los equipos favoritos y de los marcados ----------

export type BellMsg = { key: string; text: string; order: number; s: number };
const FIN = /^(FT|AET|AOT|AP|PEN|FT_PEN|FIN|Final|Final\/OT|Final OT|Ended|Finished|Match Finished|After Over Time|After Extra Time|After Penalties|AWD|WO|CANC|Cancelled|Canceled|ABD|Abandoned)$/i;

/** en vivo primero, después los que faltan (por hora) y al final los terminados; [] sin equipos ni marcados */
export function bellFrom(fav: Cloud | null, ag: any, liveEvents: any[], now: number = nowSec()): BellMsg[] {
  if (!fav || (!fav.teams.length && !Object.keys(fav.events).length)) return [];
  const names = new Set(fav.teams.map(n => fold(n)));
  const byId = new Map<string, any>();
  for (const e of ag?.events || []) byId.set(str(e.id), e);
  // el marcador en vivo es más nuevo que el de la agenda
  for (const e of liveEvents) {
    const a = byId.get(str(e.id));
    byId.set(str(e.id), a ? (e.soon ? a : { ...a, hs: e.hs, as: e.as, st: e.st }) : e);
  }
  const today = panelToday(ag, now);
  const out: BellMsg[] = [];
  for (const e of byId.values()) {
    const s = int(e.s);
    if (s <= 0 || evDay(e, s) !== today) continue;
    if (!(fav.events[str(e.id)] || names.has(fold(str(e.h))) || names.has(fold(str(e.a))))) continue;
    const who = str(e.h) && str(e.a) ? (str(e.hn) || str(e.h)) + ' vs ' + (str(e.an) || str(e.a)) : str(e.ev) || str(e.lg);
    const score = str(e.h) && str(e.a) && str(e.hs) !== '' && str(e.as) !== '' ? (str(e.hn) || str(e.h)) + ' ' + str(e.hs) + '-' + str(e.as) + ' ' + (str(e.an) || str(e.a)) : who;
    const dur = (int(ag?.sports?.[str(e.sp)]?.minutes) || 120) * 60;
    if (FIN.test(str(e.st).trim()) || now >= s + dur) out.push({ key: str(e.id), text: t('Final: {x}', { x: score }), order: 2, s });
    else if (now >= s) out.push({ key: str(e.id), text: t('¡En vivo! {x}', { x: score }), order: 0, s });
    else out.push({ key: str(e.id), text: t('Hoy {x}: {y}', { x: evClock(e, s), y: who }), order: 1, s });
  }
  return out.sort((x, y) => x.order - y.order || (x.order === 2 ? y.s - x.s : x.s - y.s));
}

// la campanita: lo que ya se vio (OK) en esta sesión, por perfil: el partido y su fase (0 en vivo, 1 hoy, 2 final), así
// el mismo partido vuelve a avisar cuando empieza y cuando termina
const bellSeenBy = new Map<string, Set<string>>();
const bellTag = (m: BellMsg) => m.key + ':' + m.order;
const bellSeenOf = (profile: string) => {
  let x = bellSeenBy.get(profile);
  if (!x) bellSeenBy.set(profile, (x = new Set()));
  return x;
};
/** los avisos que todavía no se vieron (los que hacen bajar el cartel de la campanita) */
export const bellUnseen = (profile: string, msgs: BellMsg[]) => msgs.filter(m => !bellSeenOf(profile).has(bellTag(m)));
export const bellMarkSeen = (profile: string, msgs: BellMsg[]) => msgs.forEach(m => bellSeenOf(profile).add(bellTag(m)));

export async function bellMessages(): Promise<BellMsg[]> {
  if (!liveTvOn()) return [];
  const fav = await cloudAlerts(true);
  const ag = await agenda();
  const lj = json<any>(await cloud('sports_live.php', 'GET', { soon: '1', next: '1' }));
  return bellFrom(fav, ag, lj?.enabled === true && Array.isArray(lj.events) ? lj.events : []);
}

export const isReminded = (id: string) => alertsMem?.who === who() && !!alertsMem?.events?.[id];

/** el nombre para el aviso: el del distribuidor (o el del dueño) que dice el panel */
export const alertsBrand = () => alertsMem?.brand || brandName();

/** marca o quita el recordatorio de un partido; true si quedó guardado en la nube */
export async function setReminder(e: any, on: boolean): Promise<boolean> {
  const id = str(e.id);
  const title = str(e.h) && str(e.a) ? (str(e.hn) || str(e.h)) + ' vs ' + (str(e.an) || str(e.a)) : str(e.ev) || str(e.lg);
  const body: Record<string, any> = { action: 'event', id, on, event: { t: title, s: int(e.s) * 1000, h: str(e.h), a: str(e.a) } };
  if (pid()) body.profile = pid();
  const j = json<any>(await cloud('alerts.php', 'POST', body));
  if (!j || j.success !== true || j.enabled !== true) return false;
  alertsMem = parseCloud(j);
  return true;
}

// ---------- «En vivo ahora» ----------

let agendaMem: { data: any; at: number } | null = null;

async function agenda(): Promise<any | null> {
  if (agendaMem && nowSec() - agendaMem.at < 600) return agendaMem.data;
  const d = (await fetchSports()) || localSports();
  if (d) agendaMem = { data: d, at: nowSec() };
  return d;
}

// lo último que se pidió (y el pedido en curso), por perfil: la carga al elegir el perfil lo deja listo y la fila de
// Inicio lo muestra al momento (antes la primera respuesta llegaba unos segundos después de entrar)
let lastLive: { key: string; at: number; r: { cards: LiveCard[]; ttl: number } | null } | null = null;
let liveInFlight: { key: string; p: Promise<{ cards: LiveCard[]; ttl: number } | null> } | null = null;
const liveKey = () => lineKey() + '|' + (getState().profile?.id || '') + '|' + liveSport() + '|' + liveLeagues().map(x => x.id).join(',');

/** «En vivo ahora» ya pedido (menos de 20 s) o uno nuevo; el mismo pedido si ya hay uno en curso */
export function loadLiveCardsCached(): Promise<{ cards: LiveCard[]; ttl: number } | null> {
  const k = liveKey();
  if (lastLive && lastLive.key === k && nowSec() - lastLive.at < 20 && lastLive.r?.cards.length) return Promise.resolve(lastLive.r);
  if (liveInFlight && liveInFlight.key === k) return liveInFlight.p;
  const p = loadLiveCards().then(
    r => {
      lastLive = { key: k, at: nowSec(), r };
      liveInFlight = null;
      return r;
    },
    e => {
      liveInFlight = null;
      throw e;
    },
  );
  liveInFlight = { key: k, p };
  return p;
}

/** los partidos de la fila (en vivo, por empezar y, con equipos favoritos, los de hoy de esos equipos) con su canal */
export async function loadLiveCards(): Promise<{ cards: LiveCard[]; ttl: number } | null> {
  if (!liveTvOn()) return null;
  // a la vez: los partidos y lo de la nube (el deporte y los eventos favoritos elegidos en otro equipo filtran ya)
  const [jr, fav] = await Promise.all([cloud('sports_live.php', 'GET', { soon: '1', next: '1' }), cloudAlerts().catch(() => null)]);
  const j = json<any>(jr);
  if (j) write(availKey(), j.enabled === true ? '1' : '0');
  if (!j || j.enabled !== true) return null;
  const only = liveSport().toLowerCase();
  const leagues = new Set(liveLeagues().map(x => x.id));
  // un próximo que «empezaba» hace más de 5 min y el livescore no trae: fuera
  const n0 = nowSec();
  const events: any[] = (Array.isArray(j.events) ? j.events : []).filter((e: any) => !(e?.soon === true && int(e.s) > 0 && int(e.s) < n0 - 300));
  if (fav?.teams.length) {
    const ag = await agenda();
    const now = nowSec();
    const names = new Set(fav.teams);
    const seen = new Set(events.map(e => str(e.id)));
    for (const e of ag?.events || []) {
      const s = int(e.s);
      const d0 = new Date(now * 1000).toDateString();
      // los de hoy de esos equipos que no terminaron (unas 3 h después de empezar)
      if (seen.has(str(e.id)) || !(names.has(str(e.h)) || names.has(str(e.a))) || s <= 0 || now > s + 3 * 3600) continue;
      if (new Date(s * 1000).toDateString() !== d0) continue;
      events.push({ ...e, hs: '', as: '', st: 'NS', pr: '', soon: true });
      seen.add(str(e.id));
    }
  }
  const mr = matchSports({ events, sports: j.sports || {}, match: j.match } as any);
  const m = mr.map;
  const cards: LiveCard[] = [];
  for (const e of events) {
    if (only && str(e.sp).toLowerCase() !== only) continue;
    if (leagues.size && !leagues.has(str(e.li))) continue;
    // solo un canal exacto: uno habitual (sin agenda ni equipos) no cuenta
    const mm = m[str(e.id)];
    const best = mm && !mm.guess ? mm.best : null;
    if (!best) continue;
    // también con dos nombres: TheSportsDB pone a veces a los dos boxeadores como local y visitante
    const solo = !str(e.h) || !str(e.a) || SOLO_SPORTS.has(str(e.sp).toLowerCase());
    cards.push({
      id: str(e.id), sp: str(e.sp), lg: str(e.lg), h: str(e.h) || str(e.ev), a: str(e.a), hb: str(e.hb), ab: str(e.ab),
      hs: str(e.hs), as: str(e.as), st: str(e.st), pr: str(e.pr), s: int(e.s), th: str(e.th), soon: e.soon === true, best,
      solo, spl: t((str(j.sports?.[str(e.sp)]?.label) || str(e.sp)) as any), ev: str(e.ev) || [str(e.h), str(e.a)].filter(Boolean).join(' vs ') || str(e.lg),
      m: mm, folder: mr.folder, iptv: str(j.chan) === 'iptv',
    });
  }
  // en vivo primero, después los que empiezan antes; como mucho 20 (al final va «Ir a Deportes»)
  cards.sort((x, y) => Number(x.soon) - Number(y.soon) || (x.s || 9e12) - (y.s || 9e12));
  return { cards: cards.slice(0, LIVE_MAX), ttl: Math.max(20, int(j.ttl) || 30) };
}

/** «67'», «Descanso», «Q3 5:21» o la hora de inicio (los que todavía no empiezan) */
export function liveClock(c: LiveCard, halfTime: string): string {
  if (c.soon) {
    const d = new Date(c.s * 1000);
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }
  if (c.st.toUpperCase() === 'HT' || c.pr.toUpperCase() === 'HT') return halfTime;
  if (/^\d+$/.test(c.pr)) return c.pr + "'";
  return c.pr || c.st;
}

/** color de la cancha de cada deporte (tarjetas y fondo de la portada) */
export function fieldColor(sp: string): string {
  const k = sp.toLowerCase();
  if (k.includes('basket')) return '#8a5a2b';
  if (k.includes('ice') || k.includes('hockey')) return '#2a4f7a';
  if (k.includes('tennis') || k.includes('volley')) return '#2f5d8f';
  if (k.includes('motor')) return '#3a3a3a';
  if (k.includes('fight') || k.includes('box')) return '#5a1f1f';
  return '#1f6b2c';
}
