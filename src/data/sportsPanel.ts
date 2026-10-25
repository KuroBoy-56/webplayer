// Deportes con el panel (igual que Roku): agenda guardada por usuario (sale al instante y se renueva), hora de cada
// partido leída una vez, canal por la guía (api/sports_epg.php), tablas (api/sports_tables.php), partidos de
// Equipos / Selecciones (api/sports_fixtures.php), ficha del equipo (api/sports_team.php) y buscador de canales
// del servidor IPTV por nombre de canal, equipo o evento. Todo sale de los JSON que prepara el panel: la app nunca
// consulta TheSportsDB.
import { cloud, lineKey } from '../api/panel';
import { json } from '../lib/http';
import { lang } from '../lib/i18n';
import { readJson, remove, writeJson } from '../lib/storage';
import { tenantCode } from '../lib/tenant';
import { fold, hm, int, localDay, norm, nowSec, pad2, parseIso, str } from '../lib/util';
import { catalog, Item, toItem } from './catalog';
import { EpgChan, SportsData } from './sports';

// ---------- hora de cada partido (una vez, no en cada dibujo) ----------

export type Ev = Record<string, any> & { s: number; dy: number; ck: string; dt: string; kh?: string; ka?: string };

/** s = inicio (el panel nuevo ya lo manda), dy = día en la zona del panel, ck = "HH:MM", dt = "26/10"; con alias,
 *  kh / ka = local y visitante comparables (sin acentos, también en español) para el buscador */
export function prepEvents(list: any[], alias?: Record<string, string>): Ev[] {
  for (const e of list) {
    let st = int(e.s);
    if (st <= 0) st = parseIso(str(e.ts));
    e.s = st;
    if (st > 0) {
      let d: Date;
      if (typeof e.o === 'number') {
        d = new Date((st + e.o) * 1000);
        e.dy = Math.floor((st + e.o) / 86400);
        e.ck = hm(d.getUTCHours(), d.getUTCMinutes());
        e.dt = lang() === 'en' ? pad2(d.getUTCMonth() + 1) + '/' + pad2(d.getUTCDate()) : pad2(d.getUTCDate()) + '/' + pad2(d.getUTCMonth() + 1);
      } else {
        d = new Date(st * 1000);
        e.dy = localDay(st);
        e.ck = hm(d.getHours(), d.getMinutes());
        e.dt = lang() === 'en' ? pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) : pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1);
      }
    }
    if (alias) {
      e.kh = teamText(str(e.h), alias) + ' ' + norm(str(e.hn));
      e.ka = teamText(str(e.a), alias) + ' ' + norm(str(e.an));
      // sin equipos (carreras, peleas…): el nombre del evento
      if (!str(e.h) && !str(e.a)) e.kh = norm(str(e.ev));
    }
  }
  return list as Ev[];
}

/** alias del panel ya comparables: {"spain": "espana", "germany": "alemania"…} */
export function aliasMap(match: any): Record<string, string> {
  const out: Record<string, string> = {};
  const al = match && typeof match === 'object' ? match.alias : null;
  if (al && typeof al === 'object') for (const k of Object.keys(al)) out[norm(k)] = norm(str(al[k]));
  return out;
}

export function teamText(name: string, alias: Record<string, string>): string {
  const n = norm(name);
  if (!n) return '';
  const a = alias[n];
  return a && a !== n ? n + ' ' + a : n;
}

// ---------- agenda guardada (por usuario, distribuidor e idioma) ----------

const agendaKey = () => 'sp_agenda|' + tenantCode() + '|' + lineKey() + '|' + lang();

/** la agenda guardada (menos de 3 h) para dibujar Deportes al instante */
export function localSports(): SportsData | null {
  const j = readJson<any>(agendaKey());
  if (!j || !Array.isArray(j.events) || nowSec() - int(j.saved) > 3 * 3600) return null;
  return toData(j);
}

function toData(j: any): SportsData {
  return { ...j, events: prepEvents(j.events), sports: j.sports && typeof j.sports === 'object' ? j.sports : {}, tzo: typeof j.tzo === 'number' ? j.tzo : undefined };
}

/** agenda del panel (api/sports.php); se guarda para la próxima vez */
export async function fetchSports(): Promise<SportsData | null> {
  const j = json(await cloud('sports.php', 'GET', null));
  if (!j || !Array.isArray(j.events)) return null;
  writeJson(agendaKey(), { ...j, saved: nowSec() });
  return toData(j);
}

// ---------- canal por la guía del panel ----------

/** partido -> ids de los canales que lo tienen en su programación a esa hora */
export async function sportsEpg(chans: EpgChan[]): Promise<Record<string, string[]>> {
  if (!chans.length) return {};
  const j = json(await cloud('sports_epg.php', 'POST', { channels: chans.map(c => ({ id: c.id, epg: c.epg, name: c.name })) }));
  const m = j && typeof j === 'object' && j.map && typeof j.map === 'object' ? j.map : {};
  const out: Record<string, string[]> = {};
  for (const k of Object.keys(m)) if (Array.isArray(m[k])) out[k] = m[k].map(str);
  return out;
}

/** canal en vivo del cliente por su id */
export function liveById(id: string): Item | null {
  const d = catalog.k.live;
  if (!d) return null;
  const i = d.index.get(id);
  return i !== undefined ? toItem('live', d.items[i]) : null;
}

// ---------- buscador de canales del servidor IPTV ----------

const NOISE = new Set(['club', 'united', 'city', 'real', 'deportivo', 'atletico', 'sporting', 'vs']);
const SPORT_CAT = /sport|deport|event|ppv|futbol/;

/** Canales de la lista del cliente por nombre (canal, equipo o evento), sin acentos: primero los que tienen todas
 *  las palabras; si ninguno, los que tienen alguna palabra importante (4 letras o más: «Tigres UANL» encuentra
 *  «LIGA MX: Tigres vs Monterrey»). Dentro de cada grupo, las categorías de deportes / eventos primero. Hasta 12. */
export function searchChannels(q: string): Item[] {
  const d = catalog.k.live;
  if (!d) return [];
  const words = norm(q).split(' ').filter(w => w.length >= 2);
  if (!words.length) return [];
  const vis = new Set(catalog.visibleCats('live').map(c => c.id));
  const catName = new Map(d.cats.map(c => [c.id, fold(c.name)]));
  const groups: Item[][] = [[], [], [], []];
  for (const i of d.index.values()) {
    const it = d.items[i];
    const cid = str(it.category_id);
    if (!vis.has(cid)) continue;
    const n = fold(str(it.name));
    let all = true;
    let some = false;
    for (const w of words) {
      if (n.includes(w)) {
        if (w.length >= 4 && !NOISE.has(w)) some = true;
      } else all = false;
    }
    if (!all && !some) continue;
    const sport = SPORT_CAT.test(catName.get(cid) || '');
    const g = all ? (sport ? 0 : 1) : sport ? 2 : 3;
    if (groups[g].length < 12) groups[g].push(toItem('live', it));
  }
  // con alguna coincidencia completa no se muestran las parciales
  const last = groups[0].length + groups[1].length > 0 ? 1 : 3;
  return groups.slice(0, last + 1).flat().slice(0, 12);
}

// ---------- tablas de posiciones ----------

export type League = { id: string; n: string; c: string; b: string; sp: string; sl: string; d: number; rg: string; s: string; w?: number; g: { n: string; r: any[] }[] };
export type TablesResult = { on: boolean; ok: boolean; leagues: League[]; partial?: boolean; fresh?: boolean };

const tablesKey = () => 'sp_tables|' + tenantCode() + '|' + lineKey();

/** primero lo guardado (hasta 7 días); fresh = es la versión que anuncia el panel (tables.t) */
export function localTables(rev: number): TablesResult | null {
  const j = readJson<any>(tablesKey());
  if (!j || !Array.isArray(j.leagues) || !j.leagues.length) return null;
  const age = nowSec() - int(j.saved);
  if (age < 0 || age > 7 * 86400) return null;
  return { on: true, ok: true, leagues: j.leagues, fresh: age < 86400 && rev > 0 && int(j.mt) === rev };
}

/** del panel (comprimido; responde siempre al momento: p = 1 si todavía está armando el resto) */
export async function fetchTables(): Promise<TablesResult> {
  const j = json(await cloud('sports_tables.php', 'GET', null));
  if (!j || typeof j !== 'object') {
    const old = localTables(0);
    return old || { on: true, ok: false, leagues: [] };
  }
  if (j.on === false) {
    remove(tablesKey());
    return { on: false, ok: true, leagues: [] };
  }
  const partial = int(j.p) === 1;
  if (Array.isArray(j.leagues) && j.leagues.length) {
    // a medio armar sirve de respaldo, pero la próxima vez se vuelve a pedir
    writeJson(tablesKey(), { leagues: j.leagues, mt: partial ? 0 : int(j.mt), saved: nowSec() });
    return { on: true, ok: true, leagues: j.leagues, partial };
  }
  const old = localTables(0);
  if (old) return { ...old, partial };
  return { on: true, ok: partial, leagues: [], partial };
}

/** ficha del equipo en el idioma de la app (el panel la guarda 30 días) */
export async function fetchTeam(id: string): Promise<any | null> {
  const j = json(await cloud('sports_team.php', 'GET', { id, lang: lang() }));
  return j && typeof j === 'object' && j.ok === true ? j : null;
}

// ---------- partidos de Equipos y Selecciones ----------

export type Fixtures = { on: boolean; ok: boolean; events: Ev[]; leagues: Record<string, any>; partial?: boolean };

const fixKey = () => 'sp_fix|' + tenantCode() + '|' + lineKey() + '|' + lang();

/** el JSON de los próximos 21 días: guardado (misma versión y menos de 12 h) o del panel */
export async function loadFixtures(rev: number, match: any): Promise<Fixtures> {
  const alias = aliasMap(match);
  const saved = readJson<any>(fixKey());
  if (saved && Array.isArray(saved.events) && rev > 0 && int(saved.mt) === rev && nowSec() - int(saved.saved) < 43200) {
    return { on: true, ok: true, events: prepEvents(saved.events, alias), leagues: saved.leagues || {} };
  }
  const j = json(await cloud('sports_fixtures.php', 'GET', null));
  if (j && typeof j === 'object') {
    if (j.on === false) {
      remove(fixKey());
      return { on: false, ok: true, events: [], leagues: {} };
    }
    const partial = int(j.p) === 1;
    if (Array.isArray(j.events) && j.events.length) {
      writeJson(fixKey(), { events: j.events, leagues: j.leagues || {}, mt: partial ? 0 : int(j.mt), saved: nowSec() });
      return { on: true, ok: true, events: prepEvents(j.events, alias), leagues: j.leagues || {}, partial };
    }
    if (partial && !saved) return { on: true, ok: true, events: [], leagues: {}, partial: true };
  }
  if (saved && Array.isArray(saved.events)) return { on: true, ok: true, events: prepEvents(saved.events, alias), leagues: saved.leagues || {} };
  return { on: true, ok: false, events: [], leagues: {} };
}

/** fin estimado (inicio + duración de la disciplina) */
export const evEnd = (e: Ev, minutes: (sp: string) => number) => e.s + minutes(str(e.sp)) * 60;

/** Por equipo (cada palabra en el local o en el visitante, también en español) o por país (el país completo: la
 *  selección y los partidos de las ligas de ese país). Solo los que no terminaron, hasta 80. */
export function searchTeam(fx: Fixtures, q: string, alias: Record<string, string>, minutes: (sp: string) => number): Ev[] {
  const qn = norm(q);
  const words = qn.split(' ').filter(Boolean);
  if (!words.length) return [];
  const countryLg = new Set<string>();
  for (const id of Object.keys(fx.leagues)) {
    const c = teamText(str(fx.leagues[id]?.c), alias);
    if (c && (' ' + c + ' ').includes(' ' + qn + ' ')) countryLg.add(id);
  }
  const now = nowSec();
  const out: Ev[] = [];
  for (const e of fx.events) {
    let ok = countryLg.has(str(e.l));
    if (!ok) ok = [str(e.kh), str(e.ka)].some(team => !!team && words.every(w => team.includes(w)));
    if (ok && e.s > 0 && evEnd(e, minutes) > now) {
      out.push(e);
      if (out.length >= 80) break;
    }
  }
  return out;
}

/** selecciones (ligas "nat") por empezar o en vivo, en vivo primero; chips = competiciones masculinas y al final
 *  «Selección femenina» (comp "w": todas las femeninas juntas) */
export function nations(fx: Fixtures, comp: string, minutes: (sp: string) => number): { list: Ev[]; chips: { id: string; n: string }[]; women: boolean } {
  const now = nowSec();
  const live: Ev[] = [];
  const next: Ev[] = [];
  const chips: { id: string; n: string }[] = [];
  const have = new Set<string>();
  let women = false;
  for (const e of fx.events) {
    const l = str(e.l);
    const info = fx.leagues[l];
    if (!info || str(info.rg) !== 'nat' || e.s <= 0 || now >= evEnd(e, minutes)) continue;
    const w = int(info.w) === 1;
    if (w) women = true;
    else if (!have.has(l)) {
      have.add(l);
      chips.push({ id: l, n: str(info.n) });
    }
    if (comp === '' || comp === l || (comp === 'w' && w)) {
      if (e.s <= now) live.push(e);
      else if (next.length < 150) next.push(e);
    }
  }
  return { list: live.concat(next), chips, women };
}
