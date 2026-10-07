// Estado global: sesión, carga del catálogo, progreso ("Continuar viendo") y Mi lista,
// sincronizados con api/progress.php del panel igual que la web, Android y Roku.
import { useSyncExternalStore } from 'react';
import { bindSession, cloud, forgetCloud, Session } from './api/panel';
import { Kind, loadKind } from './api/xtream';
import { catalog } from './data/catalog';
import { json } from './lib/http';
import { read, readJson, remove, write, writeJson } from './lib/storage';
import { digits, nowSec, parseIso, str } from './lib/util';

export type Progress = {
  title: string;
  position: number;
  duration: number;
  url: string;
  poster: string;
  type: 'movie' | 'episode' | 'live';
  id: string;
  seriesId: string;
  categoryId: string;
  order?: number;
};

export type Fav = { id: string; type: 'movie' | 'series' | 'live'; title: string; poster: string; categoryId: string };

type State = {
  session: Session | null;
  loaded: Record<Kind, boolean>;
  loading: string;
  error: string;
  progress: Progress[];
  favorites: Fav[];
  catalogRev: number;
  rev: number;
};

let state: State = {
  session: null,
  loaded: { vod: false, series: false, live: false },
  loading: '',
  error: '',
  progress: [],
  favorites: [],
  catalogRev: 0,
  rev: 0,
};

const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch, rev: state.rev + 1 };
  listeners.forEach(l => l());
}

export function getState(): State {
  return state;
}

export function useAppState(): State {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

bindSession(() => state.session);

export function restoreSession(): boolean {
  const s = readJson<Session>('session');
  if (s && s.base && s.user) {
    state = { ...state, session: s };
    return true;
  }
  return false;
}

export function setSession(s: Session) {
  writeJson('session', s);
  forgetCloud();
  set({ session: s, progress: [], favorites: [] });
}

export function logout() {
  remove('session');
  forgetCloud();
  catalog.clear();
  catalog.unlocked = false;
  set({ session: null, loaded: { vod: false, series: false, live: false }, loading: '', error: '', progress: [], favorites: [] });
}

// ---------- catálogo ----------

const LABEL: Record<Kind, string> = { vod: 'las películas', series: 'las series', live: 'los canales' };

export async function loadCatalog(force = false) {
  const s = state.session;
  if (!s) return;
  if (force) {
    catalog.clear();
    set({ loaded: { vod: false, series: false, live: false }, error: '' });
  }
  // las tres listas a la vez; cada una se muestra en cuanto llega
  const kinds = (['vod', 'series', 'live'] as Kind[]).filter(k => !state.loaded[k]);
  set({ loading: kinds[0] || '' });
  await Promise.all(
    kinds.map(async kind => {
      const { cats, items } = await loadKind(s, kind);
      if (state.session !== s) return;
      catalog.set(kind, cats, items);
      const loaded = { ...state.loaded, [kind]: true };
      const left = (['vod', 'series', 'live'] as Kind[]).find(k => !loaded[k]) || '';
      set({ loaded, loading: left, catalogRev: state.catalogRev + 1, error: items.length ? state.error : 'No se pudo cargar ' + LABEL[kind] });
    }),
  );
}

// el filtro de adultos o el PIN cambiaron: se rehacen las filas sin volver a descargar
export function refreshCatalog() {
  set({ catalogRev: state.catalogRev + 1 });
}

// ---------- nube ----------

// segundos de la última vez que se guardó (ts en microsegundos o updatedAt ISO)
function progressSeconds(e: any): number {
  const v = typeof e.ts === 'number' ? e.ts : parseFloat(str(e.ts));
  if (Number.isFinite(v) && v > 0) {
    if (v > 1e14) return Math.floor(v / 1e6);
    if (v > 1e11) return Math.floor(v / 1e3);
    return Math.floor(v);
  }
  return parseIso(str(e.updatedAt));
}

export async function loadCloud() {
  const j = json(await cloud('progress.php', 'GET', { v: '2' }));
  if (!j || typeof j !== 'object') return;
  const prog = j.progress && typeof j.progress === 'object' && !Array.isArray(j.progress) ? j.progress : {};
  const list: Progress[] = [];
  for (const title of Object.keys(prog)) {
    const e = prog[title];
    if (!e || typeof e !== 'object') continue;
    list.push({
      title,
      position: Number(e.position) || 0,
      duration: Number(e.duration) || 0,
      url: str(e.url),
      poster: str(e.poster),
      type: (str(e.type) || 'movie') as Progress['type'],
      id: str(e.id),
      seriesId: str(e.seriesId),
      categoryId: str(e.categoryId),
      order: progressSeconds(e),
    });
  }
  list.sort((a, b) => (b.order || 0) - (a.order || 0));
  const favs: Fav[] = Array.isArray(j.favorites)
    ? j.favorites.map((f: any) => ({ id: str(f.id), type: str(f.type) as Fav['type'], title: str(f.title), poster: str(f.poster), categoryId: str(f.categoryId) }))
    : [];
  set({ progress: list, favorites: favs });
}

function cloudPost(body: Record<string, any>) {
  cloud('progress.php', 'POST', body).catch(() => {});
}

export function favType(kind: string): Fav['type'] {
  if (kind === 'vod' || kind === 'movie') return 'movie';
  if (kind === 'series') return 'series';
  return 'live';
}

export function isFav(kind: string, id: string): boolean {
  const t = favType(kind);
  return state.favorites.some(f => f.type === t && digits(f.id) === id);
}

// agrega o quita; devuelve true si quedó en la lista
export function toggleFav(kind: string, id: string, title: string, poster: string, cat: string): boolean {
  const t = favType(kind);
  const found = isFav(kind, id);
  if (found) {
    set({ favorites: state.favorites.filter(f => !(f.type === t && digits(f.id) === id)) });
    cloudPost({ action: 'fav_remove', id, type: t });
  } else {
    const item: Fav = { id, type: t, title, poster, categoryId: cat };
    set({ favorites: [item, ...state.favorites] });
    cloudPost({ action: 'fav_add', item });
  }
  return !found;
}

export function progressMovie(id: string): Progress | undefined {
  return state.progress.find(p => p.type === 'movie' && digits(p.id) === id);
}

export function progressSeries(seriesId: string): Progress | undefined {
  return state.progress.find(p => (p.type === 'episode' || (p.type as string) === 'series') && digits(p.seriesId) === seriesId);
}

const lastSent: Record<string, number> = {};
// se envía como máximo cada 30 s por título (force en pausa o al salir); al 95 % se borra
export function saveProgress(p: Progress, force: boolean) {
  const done = p.duration > 0 && p.position >= p.duration * 0.95;
  const now = nowSec();
  const removed: string[] = [];
  const out: Progress[] = [];
  for (const e of state.progress) {
    const same = e.type === p.type && ((p.type === 'movie' && digits(e.id) === p.id) || (p.type === 'episode' && digits(e.seriesId) === p.seriesId));
    if (e.title === p.title) continue;
    if (same) removed.push(e.title);
    else out.push(e);
  }
  if (!done) out.unshift({ ...p, order: now });
  const send = done || force || now - (lastSent[p.title] || 0) >= 30;
  for (const t of removed) cloudPost({ action: 'delete', title: t });
  if (!send) {
    state = { ...state, progress: out };
    return;
  }
  lastSent[p.title] = now;
  set({ progress: out });
  if (done) {
    cloudPost({ action: 'delete', title: p.title });
    return;
  }
  const { order, ...body } = p;
  cloudPost({ action: 'save', ...body });
}

export function removeProgress(title: string) {
  set({ progress: state.progress.filter(e => e.title !== title) });
  cloudPost({ action: 'delete', title });
}

// ---------- equipo ----------

// identificador con formato MAC del panel: 8 pares hex en mayúsculas que nunca empiezan en "00"
export function deviceId(): string {
  const saved = read('device_id');
  if (saved) return saved;
  let hex = '';
  for (let i = 0; i < 16; i++) hex += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  if (hex.startsWith('00')) hex = '1' + hex.slice(1);
  const id = hex.match(/.{2}/g)!.join(':');
  write('device_id', id);
  return id;
}

// PIN de control parental: el elegido en el equipo o el del panel (0000 por defecto)
export function parentalPin(): string {
  return read('parental_pin') || read('panel_pin') || '0000';
}
