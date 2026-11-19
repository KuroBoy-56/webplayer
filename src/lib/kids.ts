// Perfil infantil (docs/PERFILES.md del panel, sección 5): solo contenido para niños y de Disney. El mismo algoritmo que
// la web player (includes/kids.php): la clase de cada categoría por su nombre, el nivel de cada película o serie
// (seguro / dudoso / fuera) y, para lo dudoso, la clasificación de edad de TMDB (data/kidsrate.ts).
import { readJson, writeJson } from './storage';
import { fold, str } from './util';
import { KIDS_RULES_LOCAL } from './kidsrules';

export type KidsRules = { v: number; rate_age_max?: number } & Record<string, any>;
type Lists = 'kids' | 'family' | 'live' | 'disney' | 'block_cats' | 'kids_strong' | 'genre_kids' | 'genre_weak' | 'genre_anim' | 'genre_hard' | 'genre_block' | 'block_marks' | 'block_titles';
export type CatClass = 'block' | 'kids' | 'disney' | 'family' | '';
export type Level = 'strong' | 'weak' | '';

const KEY = 'kids_rules';

function valid(r: any): r is KidsRules {
  return !!r && typeof r === 'object' && Number(r.v) > 0 && Array.isArray(r.kids) && Array.isArray(r.block_cats);
}

let rules: KidsRules = KIDS_RULES_LOCAL;
let rx: Partial<Record<Lists, RegExp | null>> = {};

// las del panel (si son más nuevas que las guardadas o que la copia de fábrica, se quedan)
export function rememberKidsRules(r: unknown): void {
  if (!valid(r)) return;
  const saved = readJson<KidsRules>(KEY);
  const best = [KIDS_RULES_LOCAL, valid(saved) ? saved : null, r].filter(Boolean).sort((a, b) => Number(b!.v) - Number(a!.v))[0]!;
  if (best === r) writeJson(KEY, r);
  use(best);
}

export function loadKidsRules(): void {
  const saved = readJson<KidsRules>(KEY);
  use(valid(saved) && Number(saved.v) > KIDS_RULES_LOCAL.v ? saved : KIDS_RULES_LOCAL);
}

function use(r: KidsRules): void {
  if (r === rules) return;
  rules = r;
  rx = {};
}

export function kidsRulesVersion(): string {
  return String(rules.v);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// cada lista como una sola expresión (rápido con miles de títulos); «/…/» es una expresión, lo demás «contiene»
function listRx(list: Lists): RegExp | null {
  if (list in rx) return rx[list]!;
  const parts: string[] = [];
  for (const e of Array.isArray(rules[list]) ? rules[list] : []) {
    const v = str(e);
    if (!v) continue;
    const re = v.length > 2 && v[0] === '/' && v[v.length - 1] === '/';
    const part = re ? '(?:' + v.slice(1, -1) + ')' : escape(fold(v));
    try {
      new RegExp(part);
      parts.push(part);
    } catch {
      // una entrada que este equipo no entiende se salta (las demás siguen)
    }
  }
  return (rx[list] = parts.length ? new RegExp(parts.join('|')) : null);
}

// el texto ya en minúsculas y sin acentos
function m(text: string, list: Lists): boolean {
  const r = listRx(list);
  return !!r && !!text && r.test(text);
}

export function catClass(name: string, live = false): CatClass {
  const n = fold(str(name));
  if (!n) return '';
  if (!m(n, 'kids_strong') && m(n, 'block_cats')) return 'block';
  if (m(n, live ? 'live' : 'kids')) return 'kids';
  if (!live && m(n, 'disney')) return 'disney';
  if (!live && m(n, 'family')) return 'family';
  return '';
}

// un canal de una categoría de niños que igual no se muestra (+18, XXX…)
export function blockedName(name: string): boolean {
  return m(fold(str(name)), 'block_marks');
}

// 'strong' se ve salvo que TMDB diga 'no'; 'weak' solo si TMDB dice 'ok'; '' nunca
export function itemLevel(name: string, genre: string, classes: CatClass[]): Level {
  let kidsCat = false;
  let weakCat = false;
  for (const k of classes) {
    if (k === 'block') return '';
    if (k === 'kids') kidsCat = true;
    else if (k === 'disney' || k === 'family') weakCat = true;
  }
  const n = fold(str(name));
  if (m(n, 'block_marks') || m(n, 'block_titles')) return '';
  const g = fold(str(genre)).trim();
  const has = (l: Lists) => !!g && m(g, l);
  const gWeak = has('genre_weak');
  const kidsGenre = has('genre_kids') || (gWeak && has('genre_anim'));
  const gHard = has('genre_hard');
  const gBlock = has('genre_block');
  // crimen, terror, telenovela… sin nada de niños ni de familia: fuera
  if (gBlock && !kidsGenre && !gWeak) return '';
  if ((kidsCat || kidsGenre) && !gHard && !gBlock) return 'strong';
  return kidsCat || kidsGenre || weakCat || gWeak ? 'weak' : '';
}

export function ratePass(level: Level, verdict: string): boolean {
  if (!level || verdict === 'no') return false;
  return level === 'strong' || verdict === 'ok';
}

// clave del título para api/kids_rate.php: su id de TMDB o, sin él, el nombre y el año (vuelve igual del panel)
export function rateKey(kind: 'vod' | 'series', name: string, year: string, tmdb: string): string {
  const t = kind === 'series' ? 's' : 'm';
  if (/^[1-9]\d{0,8}$/.test(tmdb)) return t + ':' + tmdb;
  return t + 'n:' + hash16(fold(str(name)) + '|' + str(year));
}

// FNV-1a de 32 bits dos veces (con otra semilla): 16 caracteres, igual en todos los equipos
function hash16(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000193) >>> 0;
  }
  return ('0000000' + a.toString(16)).slice(-8) + ('0000000' + b.toString(16)).slice(-8);
}
