// Canal de cada partido con las reglas "match" de api/sports.php
// (misma puntuación que la web, Android, Windows y Roku).
import { cloud } from '../api/panel';
import { json } from '../lib/http';
import { fold, int, norm, str } from '../lib/util';
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

type Chan = { norm: string; isEvent: boolean; idx: number };

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

export type SportsData = { events: any[]; sports: Record<string, { label?: string; minutes?: number; icon?: string }>; match: any };

export async function loadSports(): Promise<SportsData | null> {
  const j = json(await cloud('sports.php', 'GET', null));
  if (!j || !Array.isArray(j.events)) return null;
  return { events: j.events, sports: j.sports && typeof j.sports === 'object' ? j.sports : {}, match: j.match };
}

// evento -> canal en vivo
export function matchSports(data: SportsData): Record<string, Item> {
  const out: Record<string, Item> = {};
  const d = catalog.k.live;
  if (!d) return out;
  const r = rules(data.match);
  const eventCats = new Set(d.cats.filter(c => r.eventRe.test(fold(c.name))).map(c => c.id));
  const vis = new Set(catalog.visibleCats('live').map(c => c.id));
  const chans: Chan[] = [];
  d.index.forEach(i => {
    const it = d.items[i];
    const cid = str(it.category_id);
    if (vis.has(cid)) chans.push({ norm: norm(str(it.name)), isEvent: eventCats.has(cid), idx: i });
  });
  for (const ev of data.events) {
    const best = findChannel(ev, chans, r);
    if (best >= 0) out[str(ev.id)] = toItem('live', d.items[best]);
  }
  return out;
}
