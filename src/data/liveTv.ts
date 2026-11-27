// «En vivo ahora» de Inicio y recordatorios de partidos en la nube, solo con perfiles (uno elegido, no el infantil) y
// Deportes encendido para el distribuidor:
// - api/sports_live.php?next=1: los partidos que se juegan y los próximos de 24 h (hasta 20); con equipos
//   favoritos (los que se eligen en el celular o la computadora, guardados en la nube) además todos los de hoy de esos
//   equipos. Solo salen los que tienen un canal en la lista del cliente (las mismas reglas que Deportes).
// - api/alerts.php: el recordatorio de un partido se guarda en la nube por línea y perfil; el celular de la misma
//   línea y perfil avisa en su barra de notificaciones (30 min, 10 min y al empezar).
import { cloud, lineKey } from '../api/panel';
import { read, write } from '../lib/storage';
import { json } from '../lib/http';
import { brandName, features } from '../lib/tenant';
import { fold, int, nowSec, str } from '../lib/util';
import { t } from '../lib/i18n';
import { getState, profilesNeeded } from '../state';
import { Item } from './catalog';
import { evClock, evDay, matchSports, panelToday } from './sports';
import { fetchSports, localSports } from './sportsPanel';

export const LIVE_MAX = 20;

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

// ---------- recordatorios en la nube ----------

// equipo favorito (n = nombre, l = en el idioma, b = escudo, lg = liga, sp = deporte), como el celular
export type FavTeam = { n: string; l: string; b: string; lg: string; sp: string };
type Cloud = { teams: string[]; teamList: FavTeam[]; events: Record<string, { t: string; s: number; h?: string; a?: string }>; brand: string; at: number };
let alertsMem: Cloud | null = null;

function parseCloud(j: any): Cloud {
  const teamList: FavTeam[] = (Array.isArray(j.teams) ? j.teams : [])
    .filter((x: any) => str(x?.n))
    .map((x: any) => ({ n: str(x.n), l: str(x.l), b: str(x.b), lg: str(x.lg), sp: str(x.sp) }));
  return { teams: teamList.map(x => x.n), teamList, events: j.events && typeof j.events === 'object' ? j.events : {}, brand: str(j.brand), at: nowSec() };
}

/** equipos favoritos y partidos marcados de este perfil (5 min en memoria); null sin perfiles o sin panel */
export async function cloudAlerts(force = false): Promise<Cloud | null> {
  if (!liveTvOn()) return null;
  if (!force && alertsMem && nowSec() - alertsMem.at < 300) return alertsMem;
  const j = json<any>(await cloud('alerts.php', 'GET', pid() ? { profile: pid() } : {}));
  if (!j || j.success !== true || j.enabled !== true) return alertsMem;
  alertsMem = parseCloud(j);
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
const FIN = /^(FT|AET|AOT|PEN|Match Finished|Finished|After Over Time|Final)$/i;

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

export async function bellMessages(): Promise<BellMsg[]> {
  if (!liveTvOn()) return [];
  const fav = await cloudAlerts(true);
  const ag = await agenda();
  const lj = json<any>(await cloud('sports_live.php', 'GET', { soon: '1', next: '1' }));
  return bellFrom(fav, ag, lj?.enabled === true && Array.isArray(lj.events) ? lj.events : []);
}

export const isReminded = (id: string) => !!alertsMem?.events?.[id];

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
const liveKey = () => lineKey() + '|' + (getState().profile?.id || '');

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
  const j = json<any>(await cloud('sports_live.php', 'GET', { soon: '1', next: '1' }));
  if (!j || j.enabled !== true) return null;
  // un próximo que «empezaba» hace más de 5 min y el livescore no trae: fuera
  const n0 = nowSec();
  const events: any[] = (Array.isArray(j.events) ? j.events : []).filter((e: any) => !(e?.soon === true && int(e.s) > 0 && int(e.s) < n0 - 300));
  const fav = await cloudAlerts();
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
  const m = matchSports({ events, sports: j.sports || {}, match: j.match } as any).map;
  const cards: LiveCard[] = [];
  for (const e of events) {
    // solo un canal exacto: uno habitual (sin agenda ni equipos) no cuenta
    const mm = m[str(e.id)];
    const best = mm && !mm.guess ? mm.best : null;
    if (!best) continue;
    const solo = !str(e.h) || !str(e.a);
    cards.push({
      id: str(e.id), sp: str(e.sp), lg: str(e.lg), h: str(e.h) || str(e.ev), a: str(e.a), hb: str(e.hb), ab: str(e.ab),
      hs: str(e.hs), as: str(e.as), st: str(e.st), pr: str(e.pr), s: int(e.s), th: str(e.th), soon: e.soon === true, best,
      solo, spl: t((str(j.sports?.[str(e.sp)]?.label) || str(e.sp)) as any), ev: str(e.ev) || str(e.h) || str(e.a),
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
