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
import { int, nowSec, str } from '../lib/util';
import { getState, profilesNeeded } from '../state';
import { Item } from './catalog';
import { matchSports } from './sports';
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

type Cloud = { teams: string[]; events: Record<string, { t: string; s: number }>; brand: string; at: number };
let alertsMem: Cloud | null = null;

/** equipos favoritos y partidos marcados de este perfil (5 min en memoria); null sin perfiles o sin panel */
export async function cloudAlerts(force = false): Promise<Cloud | null> {
  if (!liveTvOn()) return null;
  if (!force && alertsMem && nowSec() - alertsMem.at < 300) return alertsMem;
  const j = json<any>(await cloud('alerts.php', 'GET', pid() ? { profile: pid() } : {}));
  if (!j || j.success !== true || j.enabled !== true) return alertsMem;
  alertsMem = {
    teams: (Array.isArray(j.teams) ? j.teams : []).map((x: any) => str(x?.n)).filter(Boolean),
    events: j.events && typeof j.events === 'object' ? j.events : {},
    brand: str(j.brand),
    at: nowSec(),
  };
  return alertsMem;
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
  alertsMem = { teams: (Array.isArray(j.teams) ? j.teams : []).map((x: any) => str(x?.n)).filter(Boolean), events: j.events || {}, brand: str(j.brand), at: nowSec() };
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
    const best = m[str(e.id)]?.best;
    if (!best) continue;
    cards.push({
      id: str(e.id), sp: str(e.sp), lg: str(e.lg), h: str(e.h) || str(e.ev), a: str(e.a), hb: str(e.hb), ab: str(e.ab),
      hs: str(e.hs), as: str(e.as), st: str(e.st), pr: str(e.pr), s: int(e.s), th: str(e.th), soon: e.soon === true, best,
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
