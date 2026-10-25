// Canal de cada partido con las reglas "match" de api/sports.php
// (misma puntuación que la web, Android, Windows y Roku).
import { cloud } from '../api/panel';
import { json } from '../lib/http';
import { clock, fold, hm, int, localDay, norm, str } from '../lib/util';
import { catalog, Item, toItem } from './catalog';

type Rules = {
  stop: Set<string>;
  alias: Record<string, string>;
  eventRe: RegExp;
  fullName: number;
  token: number;
  teamWeight: number;
  bothTeamsBonus: number;
  leagueBonus: number;
  eventCategoryBonus: number;
  singleTokenWeight: number;
};

function rules(m: any): Rules {
  let stop = ['fc', 'cf', 'sc', 'ac', 'cd', 'ca', 'club', 'de', 'del', 'la', 'el', 'los', 'las', 'the', 'and', 'vs', 'v', 'city', 'united', 'real', 'sporting', 'atletico', 'deportivo', 'union', 'women', 'femenil', 'w', 'u20', 'u21', 'u23', 'sub'];
  let evCat = 'event|ppv|pay per view|deportes? en vivo|live sport|partidos? (de )?hoy';
  const r: Rules = { stop: new Set(), alias: {}, eventRe: /x/, fullName: 2, token: 1, teamWeight: 10, bothTeamsBonus: 15, leagueBonus: 3, eventCategoryBonus: 6, singleTokenWeight: 8 };
  if (m && typeof m === 'object') {
    if (Array.isArray(m.stop) && m.stop.length) stop = m.stop.map(str);
    if (str(m.eventCategory)) evCat = str(m.eventCategory);
    if (m.alias && typeof m.alias === 'object') for (const k of Object.keys(m.alias)) r.alias[norm(k)] = norm(str(m.alias[k]));
    const sc = m.scoring;
    if (sc && typeof sc === 'object') {
      for (const k of ['fullName', 'token', 'teamWeight', 'bothTeamsBonus', 'leagueBonus', 'eventCategoryBonus', 'singleTokenWeight'] as const) {
        if (sc[k] !== undefined) r[k] = int(sc[k]);
      }
    }
  }
  r.stop = new Set(stop);
  try {
    r.eventRe = new RegExp(evCat, 'i');
  } catch {
    r.eventRe = /event|ppv/i;
  }
  return r;
}

const hasWord = (chan: string, w: string) => !!w && (' ' + chan + ' ').includes(' ' + w + ' ');

function tokens(s: string, r: Rules): string[] {
  return norm(s).split(' ').filter(t => t.length >= 3 && !r.stop.has(t));
}

function teamScore(chan: string, team: string, r: Rules): number {
  if (!team.trim()) return 0;
  const n = norm(team);
  const names = [n];
  if (r.alias[n]) names.push(r.alias[n]);
  let best = 0;
  for (const nm of names) {
    if (nm.length >= 3 && hasWord(chan, nm)) return r.fullName;
    for (const t of tokens(nm, r)) if (t.length >= 4 && hasWord(chan, t)) best = r.token;
  }
  return best;
}

type Chan = { norm: string; isEvent: boolean; idx: number; key: string[] };

function findChannel(ev: any, chans: Chan[], r: Rules): number {
  const h = str(ev.h).trim();
  const a = str(ev.a).trim();
  const leagueToks = tokens(str(ev.lg), r);
  const single = !h && !a ? tokens(str(ev.ev), r) : [];
  let best = -1;
  let bestScore = -999999;
  for (const c of chans) {
    const chan = c.norm;
    let score = 0;
    if (h || a) {
      const hs = teamScore(chan, h, r);
      const aw = teamScore(chan, a, r);
      if (hs === 0 && aw === 0) continue;
      const both = hs > 0 && aw > 0;
      if (!c.isEvent && !both) continue;
      if (!both && / (vs|v|x) /.test(' ' + chan + ' ')) continue;
      score = hs * r.teamWeight + aw * r.teamWeight + (both ? r.bothTeamsBonus : 0);
    } else {
      const hit = single.filter(t => hasWord(chan, t)).length;
      if (hit === 0 || (!c.isEvent && hit < 2)) continue;
      score = hit * r.singleTokenWeight;
    }
    if (leagueToks.some(t => hasWord(chan, t))) score += r.leagueBonus;
    if (c.isEvent) score += r.eventCategoryBonus;
    if (best < 0 || score > bestScore) {
      best = c.idx;
      bestScore = score;
    }
  }
  return best;
}

export type SportsData = { events: any[]; sports: Record<string, { label?: string; minutes?: number; icon?: string }>; match: any; tzo?: number };

// Hora y día en la zona horaria del panel (la del distribuidor o del dueño), no la del equipo:
// api/sports.php manda "o" por evento (segundos a sumar a la hora UTC) y "tzo" (lo mismo ahora).
// Un panel viejo sin ellos: la del equipo.
export function evDay(e: any, start: number): number {
  return typeof e?.o === 'number' ? Math.floor((start + e.o) / 86400) : localDay(start);
}

export function panelToday(data: SportsData | null, now: number): number {
  return typeof data?.tzo === 'number' ? Math.floor((now + data.tzo) / 86400) : localDay(now);
}

export function evClock(e: any, start: number): string {
  if (typeof e?.o !== 'number') return clock(start);
  const d = new Date((start + e.o) * 1000);
  return hm(d.getUTCHours(), d.getUTCMinutes());
}

export async function loadSports(): Promise<SportsData | null> {
  const j = json(await cloud('sports.php', 'GET', null));
  if (!j || !Array.isArray(j.events)) return null;
  return { events: j.events, sports: j.sports && typeof j.sports === 'object' ? j.sports : {}, match: j.match, tzo: typeof j.tzo === 'number' ? j.tzo : undefined };
}

// ---------- canal que transmite ("ESPN 2" -> los canales ESPN 2 del cliente) ----------

// lo que no distingue un canal de otro: calidad y país/región
const NOISE = new Set(['hd', 'fhd', 'uhd', 'sd', '4k', '8k', 'hq', 'hevc', 'h264', 'h265', '1080', '1080p', '720', '720p', '50fps', '60fps', 'fps',
  'backup', 'bk', 'alt', 'vip', 'op1', 'op2', 'tv', 'channel', 'canal',
  'mx', 'mex', 'mexico', 'us', 'usa', 'eeuu', 'ar', 'arg', 'argentina', 'co', 'col', 'colombia', 'cl', 'chile', 'pe', 'peru', 'ec', 'ecuador',
  've', 'venezuela', 'uy', 'uruguay', 'py', 'paraguay', 'bo', 'bolivia', 'cr', 'pa', 'panama', 'gt', 'hn', 'sv', 'ni', 'do', 'pr',
  'latam', 'latin', 'latino', 'latina', 'lat', 'america', 'es', 'esp', 'spain', 'espana', 'uk', 'gb', 'int', 'intl', 'international',
  'br', 'bra', 'brasil', 'brazil', 'pt', 'portugal', 'ca', 'can', 'canada', 'fr', 'france', 'it', 'italy', 'de', 'germany',
  'nl', 'netherlands', 'au', 'australia', 'nz', 'zealand', 'new', 'ie', 'ireland', 'en', 'network', 'net']);

// palabras que identifican el canal; un número va pegado a la palabra anterior ("espn 2" -> "espn2")
export function channelKey(name: string): string[] {
  const out: string[] = [];
  for (let t of norm(name).split(' ')) {
    // "M+ LaLiga" (Movistar Plus) llega como "m laliga"
    if (t === 'm') t = 'movistar';
    if (!t || NOISE.has(t)) continue;
    if (/^\d+$/.test(t) && out.length && !/^\d+$/.test(out[out.length - 1])) out[out.length - 1] += t;
    else out.push(t);
  }
  return out;
}

type Index = { chans: Chan[]; words: Map<string, number[]>; keys: Map<string, number[]> };

function addTo(m: Map<string, number[]>, k: string, i: number) {
  const l = m.get(k);
  if (!l) m.set(k, [i]);
  else if (l[l.length - 1] !== i) l.push(i);
}

// índice de palabras de los canales: cada partido solo compara los canales que comparten alguna
// palabra con sus equipos o sus canales de TV (no todos contra todos)
function buildIndex(chans: Chan[]): Index {
  const words = new Map<string, number[]>();
  const keys = new Map<string, number[]>();
  chans.forEach((c, i) => {
    for (const w of c.norm.split(' ')) if (w.length >= 3) addTo(words, w, i);
    for (const w of c.key) if (w.length >= 2 && !/^\d+$/.test(w)) addTo(words, w, i);
    const compact = c.key.join('');
    if (compact) addTo(keys, compact, i);
  });
  return { chans, words, keys };
}

// canales candidatos para un partido: los que tienen alguna palabra de sus equipos (o del evento)
function teamCandidates(ev: any, ix: Index, r: Rules): Chan[] {
  const want = new Set<string>();
  const h = str(ev.h).trim();
  const a = str(ev.a).trim();
  for (const team of [h, a]) {
    if (!team) continue;
    const n = norm(team);
    for (const nm of r.alias[n] ? [n, r.alias[n]] : [n]) {
      const tk = tokens(nm, r);
      if (tk.length) tk.forEach(t => want.add(t));
      else nm.split(' ').filter(w => w.length >= 3).forEach(w => want.add(w));
    }
  }
  if (!h && !a) tokens(str(ev.ev), r).forEach(t => want.add(t));
  const pos = new Set<number>();
  want.forEach(w => ix.words.get(w)?.forEach(i => pos.add(i)));
  return [...pos].sort((x, y) => x - y).map(i => ix.chans[i]);
}

// el mejor canal del cliente para un canal que transmite: primero el que se llama igual (sin calidad
// ni país), después el que contiene todas sus palabras y, al final, el que las tiene pegadas ("La Liga
// Hypermotion" = "laligahypermotion"). "ESPN 2" nunca da "ESPN" ni "ESPN 3". Cada nombre se busca una vez.
function findByChannel(tvName: string, ix: Index, items: any[]): number {
  const memo = (ix as any).memo || ((ix as any).memo = new Map<string, number>());
  const hit = memo.get(tvName);
  if (hit !== undefined) return hit;
  const r = findByChannelOnce(tvName, ix, items);
  memo.set(tvName, r);
  return r;
}

function findByChannelOnce(tvName: string, ix: Index, items: any[]): number {
  const q = channelKey(tvName);
  const qs = q.join(' ');
  const qc = q.join('');
  if (!q.length || qc.length < 2) return -1;
  const len = (c: Chan) => str(items[c.idx].name).length;
  let best = -1;
  let bestScore = -999999;
  const exact = ix.keys.get(qc);
  if (exact) {
    for (const ci of exact) {
      const c = ix.chans[ci];
      const score = 1000 - c.key.length * 10 - len(c) + (c.key.join(' ') === qs ? 100 : 0);
      if (best < 0 || score > bestScore) {
        best = c.idx;
        bestScore = score;
      }
    }
    return best;
  }
  for (const ci of ix.words.get(q[0]) || []) {
    const c = ix.chans[ci];
    if (!q.every(t => c.key.includes(t))) continue;
    const score = 500 - 10 * (c.key.length - q.length) - len(c);
    if (best < 0 || score > bestScore) {
      best = c.idx;
      bestScore = score;
    }
  }
  return best >= 0 ? best : findLoose(q, ix, items);
}

// último intento: las palabras del canal pegadas contienen cada palabra buscada, sin que la siga un número
function findLoose(q: string[], ix: Index, items: any[]): number {
  const first = q[0];
  if (first.length < 3) return -1;
  const cand = new Set<number>();
  for (let L = first.length; L >= 2; L--) ix.words.get(first.slice(0, L))?.forEach(i => cand.add(i));
  let best = -1;
  let bestScore = -999999;
  const want = q.join('').length;
  cand.forEach(ci => {
    const c = ix.chans[ci];
    const compact = c.key.join('');
    if (!compact) return;
    for (const t of q) {
      const p = compact.indexOf(t);
      if (p < 0 || /\d/.test(compact.charAt(p + t.length))) return;
    }
    const score = 300 - (compact.length - want) - str(items[c.idx].name).length;
    if (best < 0 || score > bestScore) {
      best = c.idx;
      bestScore = score;
    }
  });
  return best;
}

// canales deportivos para buscar el partido en la guía del panel (api/sports_epg.php): por el nombre del canal o
// de su carpeta, sin las carpetas de eventos; primero los que tienen guía propia
const SPORT_RE = /sport|deport|espn|fox|tnt|tudn|dazn|bein|sky|movistar|futbol|soccer|nba|nfl|mlb|nhl|ufc|liga|win |directv|dsports|claro|vix|paramount|peacock|tyc|gol|telemundo|univision|azteca|canal 5|caracol|rcn|tsn|eurosport|teledeporte|cbs|nbc|usa network|f1|golf|tenis|tennis|box|universo|sportsnet|telefe|tv publica|teletica|tigo|max|apple tv/i;

function epgChannels(chans: Chan[], items: any[], cats: { id: string; name: string }[], maxN: number) {
  const sportCat = new Set(cats.filter(c => SPORT_RE.test(fold(c.name))).map(c => c.id));
  const withEpg: any[] = [];
  const noEpg: any[] = [];
  for (const c of chans) {
    if (c.isEvent) continue;
    const it = items[c.idx];
    if (!sportCat.has(str(it.category_id)) && !SPORT_RE.test(c.norm)) continue;
    const e = { id: str(it.stream_id), epg: str(it.epg_channel_id), name: str(it.name), idx: c.idx };
    (e.epg ? withEpg : noEpg).push(e);
    if (withEpg.length >= maxN) break;
  }
  return withEpg.concat(noEpg).slice(0, maxN);
}

export type SportMatch = { best: Item | null; teams: Item | null; tv: { n: string; c: string; ch: Item | null }[]; epg?: Item[] };

// evento -> canales: el primero de sus canales de TV que tiene el cliente, si no por equipos / nombre
// del evento. folder = primera carpeta de eventos (cuando no hay canal exacto).
export type EpgChan = { id: string; epg: string; name: string; idx: number };

let ixCache: { d: any; sig: string; chans: Chan[]; ix: Index } | null = null;

export function matchSports(data: SportsData): { map: Record<string, SportMatch>; folder: Item | null; epgChans: EpgChan[] } {
  const map: Record<string, SportMatch> = {};
  const d = catalog.k.live;
  if (!d) return { map, folder: null, epgChans: [] };
  const r = rules(data.match);
  // el índice de canales se arma una vez por catálogo, categorías visibles y reglas (no en cada búsqueda)
  const visList = catalog.visibleCats('live').map(c => c.id);
  const sig = visList.length + '|' + visList.join(',').length + '|' + r.eventRe.source;
  if (!ixCache || ixCache.d !== d || ixCache.sig !== sig) {
    const eventCats = new Set(d.cats.filter(c => r.eventRe.test(fold(c.name))).map(c => c.id));
    const vis = new Set(visList);
    const list: Chan[] = [];
    d.index.forEach(i => {
      const it = d.items[i];
      const cid = str(it.category_id);
      if (vis.has(cid)) {
        const n = norm(str(it.name));
        list.push({ norm: n, isEvent: eventCats.has(cid), idx: i, key: channelKey(str(it.name)) });
      }
    });
    ixCache = { d, sig, chans: list, ix: buildIndex(list) };
  }
  const chans = ixCache.chans;
  const ix = ixCache.ix;
  for (const ev of data.events) {
    const tv: SportMatch['tv'] = [];
    let best: Item | null = null;
    for (const t of Array.isArray(ev.tv) ? ev.tv : []) {
      const i = findByChannel(str(t.n), ix, d.items);
      const ch = i >= 0 ? toItem('live', d.items[i]) : null;
      tv.push({ n: str(t.n), c: str(t.c), ch });
      if (!best && ch) best = ch;
    }
    const ti = findChannel(ev, teamCandidates(ev, ix, r), r);
    const teams = ti >= 0 ? toItem('live', d.items[ti]) : null;
    map[str(ev.id)] = { best: best || teams, teams, tv };
  }
  const first = chans.find(c => c.isEvent);
  return { map, folder: first ? toItem('live', d.items[first.idx]) : null, epgChans: epgChannels(chans, d.items, d.cats, 600) };
}
