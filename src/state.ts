// Estado global: sesión, carga del catálogo, progreso ("Continuar viendo") y Mi lista,
// sincronizados con api/progress.php del panel igual que la web, Android y Roku.
import { useSyncExternalStore } from 'react';
import { bindSession, cloud, forgetCloud, onPanelDemo, panelTenantConfig, Session } from './api/panel';
import { Kind, loadKind, setStreamFlip } from './api/xtream';
import { catalog } from './data/catalog';
import { json } from './lib/http';
import { read, readJson, remove, write, writeJson } from './lib/storage';
import { tvMac } from './lib/platform';
import { APP_ID, brand, clearTenant, expiredMessage, locallyExpired, OFFLINE_GRACE, saveBrand, scoped, TENANT_FATAL, tenantCode } from './lib/tenant';
import { digits, nowSec, parseIso, str } from './lib/util';
import { Key, t } from './lib/i18n';

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
  // línea DEMO: no se muestran usuario ni contraseña y no se guardan progreso ni Mi lista
  demo: boolean;
  // fin (segundos Unix) y duración (segundos) de la demo según el panel; 0 = no se sabe
  demoExpires: number;
  demoDuration: number;
  // aviso corto encima de todo (p. ej. "No disponible en la DEMO")
  notice: string;
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
  demo: false,
  demoExpires: 0,
  demoDuration: 0,
  notice: '',
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
onPanelDemo(markDemo);

// La sesión vive solo en memoria: el usuario y la contraseña nunca se guardan en el equipo. Cada vez
// que se abre la app el inicio de sesión le pide la línea al panel y la comprueba en el servidor IPTV.
export function restoreSession(): boolean {
  remove('session'); // versiones anteriores la guardaban
  remove('parental_pin'); // el PIN es el del panel
  return false;
}

// demo: la sesión salió del botón Autodemo o el panel la marcó como DEMO (check_mac); un inicio
// de sesión normal la deja en false
export function setSession(s: Session, demo = false, demoExpires = 0, demoDuration = 0) {
  forgetCloud();
  setStreamFlip(false);
  set({ session: s, progress: [], favorites: [], demo, demoExpires: demo ? demoExpires : 0, demoDuration: demo ? demoDuration : 0 });
}

// el panel dijo "demo": true (progress.php): desde ahora la sesión es una DEMO
export function markDemo() {
  if (state.session && !state.demo) set({ demo: true, progress: [], favorites: [] });
}

export function isDemo(): boolean {
  return state.demo;
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;
export function showNotice(msg: string) {
  if (noticeTimer) clearTimeout(noticeTimer);
  set({ notice: msg });
  noticeTimer = setTimeout(() => {
    noticeTimer = null;
    set({ notice: '' });
  }, 3500);
}

export function logout() {
  remove('session');
  forgetCloud();
  catalog.clear();
  catalog.unlocked = false;
  set({ session: null, loaded: { vod: false, series: false, live: false }, loading: '', error: '', progress: [], favorites: [], demo: false, demoExpires: 0, demoDuration: 0 });
}

// ---------- catálogo ----------

const LABEL: Record<Kind, Key> = { vod: 'No se pudieron cargar las películas', series: 'No se pudieron cargar las series', live: 'No se pudieron cargar los canales' };

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
      // los canales no cambian Inicio, Películas ni Series: no se rehacen sus filas (TV en vivo sigue loaded.live)
      const rev = kind === 'live' ? state.catalogRev : state.catalogRev + 1;
      set({ loaded, loading: left, catalogRev: rev, error: items.length ? state.error : t(LABEL[kind]) });
    }),
  );
}

// el filtro de adultos o el PIN cambiaron: se rehacen las filas sin volver a descargar
export function refreshCatalog() {
  set({ catalogRev: state.catalogRev + 1 });
}

// ---------- nube ----------

// segundos de la última vez que se guardó (ts del panel con microsegundos, o updatedAt ISO)
function progressSeconds(e: any): number {
  const v = typeof e.ts === 'number' ? e.ts : parseFloat(str(e.ts));
  if (Number.isFinite(v) && v > 0) {
    // con decimales: dos guardados del mismo segundo mantienen su orden
    if (v > 1e14) return v / 1e6;
    if (v > 1e11) return v / 1e3;
    return v;
  }
  return parseIso(str(e.updatedAt));
}

export async function loadCloud() {
  // la DEMO no tiene Continuar viendo ni Mi lista
  if (state.demo) return;
  const j = json(await cloud('progress.php', 'GET', { v: '2' }));
  if (!j || typeof j !== 'object' || state.demo) return;
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
  // nada se guarda en el panel con una DEMO (save, delete, fav_add, fav_remove)
  if (state.demo) return;
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
  if (state.demo) {
    showNotice(t('No disponible en la DEMO'));
    return false;
  }
  const ft = favType(kind);
  const found = isFav(kind, id);
  if (found) {
    set({ favorites: state.favorites.filter(f => !(f.type === ft && digits(f.id) === id)) });
    cloudPost({ action: 'fav_remove', id, type: ft });
  } else {
    const item: Fav = { id, type: ft, title, poster, categoryId: cat };
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
  if (state.demo) return;
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
  if (!done) out.unshift({ ...p, order: Date.now() / 1000 });
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
  cloudPost({ action: 'save', ...body, platform: APP_ID, device: read('device_id') });
}

export function removeProgress(title: string) {
  if (state.demo) return;
  set({ progress: state.progress.filter(e => e.title !== title) });
  cloudPost({ action: 'delete', title });
}

// ---------- equipo ----------

// identificador con formato MAC del panel: 8 pares hex en mayúsculas que nunca empiezan en "00"
export function deviceId(): string {
  const saved = read('device_id');
  if (saved) return saved;
  // Tizen: MAC armada con el id del televisor (no cambia al reinstalar la app)
  const tv = tvMac();
  if (tv) {
    write('device_id', tv);
    return tv;
  }
  let hex = '';
  for (let i = 0; i < 16; i++) hex += '0123456789ABCDEF'[Math.floor(Math.random() * 16)];
  if (hex.startsWith('00')) hex = '1' + hex.slice(1);
  const id = hex.match(/.{2}/g)!.join(':');
  write('device_id', id);
  return id;
}

// PIN de control parental (siempre activo): el del panel (check_mac / auth.php), 0000 de fábrica.
// Se cambia en Cuenta y se guarda en el panel (set_pin).
export function parentalPin(): string {
  const p = read(scoped('panel_pin'));
  return /^\d{4}$/.test(p) ? p : '0000';
}

export function setPanelPin(pin: string) {
  if (/^\d{4}$/.test(pin)) write(scoped('panel_pin'), pin);
}

// ---------- distribuidor (guardián) ----------

// "Cambiar distribuidor" o número que dejó de valer: cierra sesión y borra número y marca
export function resetTenant() {
  logout();
  clearTenant();
}

export type Guard =
  | { kind: 'skip' } // Omitir o sin número: nada que revisar
  | { kind: 'ok'; changed: boolean } // vigente (changed: nueva marca)
  | { kind: 'offline' } // sin respuesta: sigue con lo guardado (< 72 h)
  | { kind: 'wiped'; message: string } // número borrado: pedir otro
  | { kind: 'retry'; message: string }; // sin respuesta hace más de 72 h

let guarding: Promise<Guard> | null = null;

// revisa el número con el panel (tenant_config); una sola revisión a la vez
export function checkTenant(): Promise<Guard> {
  if (!guarding) guarding = runCheck().finally(() => (guarding = null));
  return guarding;
}

// toca revisar: al abrir, al volver a la app o cada recheck_after segundos
export function tenantCheckDue(): boolean {
  const b = brand();
  return !!b && nowSec() - b.lastOk >= b.recheckAfter;
}

async function runCheck(): Promise<Guard> {
  const code = tenantCode();
  if (!code) return { kind: 'skip' };
  const old = brand();
  const now = nowSec();
  const r = await panelTenantConfig(code, deviceId(), now);
  if (tenantCode() !== code) return { kind: 'skip' }; // cambió mientras tanto
  if (r.ok) {
    saveBrand(r.brand);
    const changed = !old || old.rev !== r.brand.rev || old.logoRev !== r.brand.logoRev || old.logoUrl !== r.brand.logoUrl;
    return { kind: 'ok', changed };
  }
  if (TENANT_FATAL.includes(r.code)) {
    resetTenant();
    return { kind: 'wiped', message: r.message };
  }
  // sin respuesta válida (red, 5xx, 429…): vale lo guardado, salvo vencido por fecha o pasadas 72 h
  if (old && locallyExpired(old, now)) {
    resetTenant();
    return { kind: 'wiped', message: expiredMessage(old) };
  }
  if (old && now - old.lastOk < OFFLINE_GRACE) return { kind: 'offline' };
  return { kind: 'retry', message: r.network ? t('No se pudo comprobar tu distribuidor. Revisa tu conexión a internet.') : r.message };
}
