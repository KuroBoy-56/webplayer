// Estado global: sesión, carga del catálogo, progreso ("Continuar viendo") y Mi lista,
// sincronizados con api/progress.php del panel igual que la web, Android y Roku.
import { loadWeekTop } from './data/top10';
import { useSyncExternalStore } from 'react';
import { bindSession, cloud, forgetCloud, onPanelDemo, panelTenantConfig, Session } from './api/panel';
import { Kind, loadKind, setStreamFlip } from './api/xtream';
import { catalog } from './data/catalog';
import { json } from './lib/http';
import { deviceId } from './lib/deviceid';
import { read, readJson, remove, write, writeJson } from './lib/storage';
import { brand, clearTenant, expiredMessage, locallyExpired, OFFLINE_GRACE, saveBrand, scoped, TENANT_FATAL, tenantCode } from './lib/tenant';
import { digits, nowSec, parseIso, str } from './lib/util';
import { setImgCache } from './lib/images';
import { Key, t } from './lib/i18n';

export type PlayHint = { a?: string; ai?: number; [k: string]: unknown };
export type Progress = {
  title: string;
  position: number;
  duration: number;
  url: string;
  poster: string;
  type: 'movie' | 'episode' | 'series' | 'live';
  id: string;
  seriesId: string;
  categoryId: string;
  order?: number;
  // Datos de reproducción que viajan con el avance en el panel (api/progress.php «play», compartido entre equipos):
  // a = idioma de audio elegido para este título ('' = se volvió al predeterminado), ai = su número de pista en el
  // archivo (-1 = no se sabe). Roku guarda además cómo abrió el archivo (e, f, s, t, u); el panel junta lo de cada app.
  play?: PlayHint;
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
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
function set(patch: Partial<State>) {
  state = { ...state, ...patch, rev: state.rev + 1 };
  listeners.forEach(l => l());
}

export function getState(): State {
  return state;
}

export function useAppState(): State {
  return useSyncExternalStore(
    subscribe,
    () => state,
  );
}

// Seleccionar valores estables (primitivas o referencias del estado) evita
// redibujar listas por avisos, progreso u otros cambios que no utilizan.
export function useAppSelector<T>(select: (snapshot: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
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
  lastSent.clear();
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
  lastSent.clear();
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
  // Top 10 de la semana del panel: si llega una lista nueva, se rehacen las filas (sin volver a descargar)
  loadWeekTop().then(changed => changed && state.session === s && refreshCatalog()).catch(() => {});
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

let cloudRead = 0;
let progressRevision = 0;
const progressWrites = new WeakMap<Session, Promise<unknown>>();

export async function loadCloud() {
  const session = state.session;
  if (!session || state.demo) return;
  const request = ++cloudRead;
  const revision = progressRevision;
  await progressWrites.get(session);
  if (session !== state.session || request !== cloudRead || state.demo) return;
  // play=1: cada avance trae «play» (idioma elegido para el título en cualquier equipo; ver PlayHint)
  const response = await cloud('progress.php', 'GET', { v: '2', play: '1' });
  if (!response.ok) return;
  const j = json(response);
  if (session !== state.session || request !== cloudRead || state.demo) return;
  // caché de carátulas del panel (el dueño la puede apagar): apagada, imágenes directo a los servidores
  if (j && typeof j === 'object' && typeof j.img === 'boolean') setImgCache(j.img);
  if (!j || typeof j !== 'object' || state.demo) return;
  const prog = j.progress && typeof j.progress === 'object' && !Array.isArray(j.progress) ? j.progress : {};
  const list: Progress[] = [];
  for (const title of Object.keys(prog)) {
    const e = prog[title];
    if (!e || typeof e !== 'object') continue;
    list.push({
      title,
      position: progressSecondsValue(e.position),
      duration: progressSecondsValue(e.duration),
      url: str(e.url),
      poster: str(e.poster),
      type: (str(e.type) || 'movie') as Progress['type'],
      id: str(e.id),
      seriesId: str(e.seriesId),
      categoryId: str(e.categoryId),
      order: progressSeconds(e),
      play: e.play && typeof e.play === 'object' && !Array.isArray(e.play) ? e.play : undefined,
    });
  }
  list.sort((a, b) => (b.order || 0) - (a.order || 0));
  const favs: Fav[] = Array.isArray(j.favorites)
    ? j.favorites.map((f: any) => ({ id: str(f.id), type: str(f.type) as Fav['type'], title: str(f.title), poster: str(f.poster), categoryId: str(f.categoryId) }))
    : [];
  set({ progress: revision === progressRevision ? list : state.progress, favorites: favs });
}

function cloudPost(body: Record<string, any>) {
  // nada se guarda en el panel con una DEMO (save, delete, fav_add, fav_remove)
  if (state.demo) return;
  const session = state.session;
  if (!session) return;
  if (body.action !== 'save' && body.action !== 'delete') {
    void cloud('progress.php', 'POST', body).catch(() => {});
    return;
  }
  const previous = progressWrites.get(session) || Promise.resolve();
  const pending = previous.then(() => {
    if (state.session === session && !state.demo) return cloud('progress.php', 'POST', body);
  }).catch(() => {});
  progressWrites.set(session, pending);
  void pending.then(() => {
    if (progressWrites.get(session) === pending) progressWrites.delete(session);
  });
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

function progressSecondsValue(raw: unknown): number {
  const n = Number(str(raw));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function resumePosition(p: Progress | undefined): number {
  if (!p || !Number.isFinite(p.position) || p.position <= 5 || (p.duration > 0 && p.position >= p.duration * 0.95)) return 0;
  return Math.floor(p.position);
}

export function progressSeriesId(p: Progress): string {
  if (p.type === 'episode') return digits(p.seriesId);
  return p.type === 'series' ? digits(p.seriesId || p.id) : '';
}

export function progressEpisodeId(p: Progress | undefined): string {
  if (!p) return '';
  if (p.type === 'episode' && digits(p.id)) return digits(p.id);
  if (p.type !== 'episode' && p.type !== 'series') return '';
  // Algunas apps guardan el ID de la serie y dejan el episodio en la URL.
  const fromUrl = /\/series\/[^/]+\/[^/]+\/(\d+)(?:\.[a-z0-9]+)?(?:[?#]|$)/i.exec(p.url)?.[1];
  if (fromUrl) return fromUrl;
  const id = digits(p.id);
  return id !== progressSeriesId(p) ? id : '';
}

export function progressMovie(id: string): Progress | undefined {
  return state.progress.find(p => p.type === 'movie' && digits(p.id) === id);
}

// «play» guardado en el panel para el video que se va a abrir: el de la película, o el de la serie (el idioma con el
// que se viene viendo vale también para sus otros capítulos; el número de pista solo para el mismo capítulo)
export function playHintFor(kind: 'movie' | 'episode', id: string, seriesId: string): PlayHint | undefined {
  const p = kind === 'movie' ? progressMovie(digits(id)) : progressSeries(digits(seriesId));
  if (!p?.play) return undefined;
  return kind === 'movie' || progressEpisodeId(p) === digits(id) ? p.play : { a: p.play.a };
}

export function progressSeries(seriesId: string): Progress | undefined {
  return seriesId ? state.progress.find(p => progressSeriesId(p) === seriesId && !!progressEpisodeId(p)) : undefined;
}

const lastSent = new Map<string, number>();
// se envía como máximo cada 30 s por título (force en pausa o al salir); al 95 % se borra
export function saveProgress(p: Progress, force: boolean) {
  if (state.demo || !Number.isFinite(p.position) || p.position < 5) return;
  const done = p.duration > 0 && p.position >= p.duration * 0.95;
  const now = nowSec();
  const id = p.type + ':' + p.id;
  const removed: string[] = [];
  const out: Progress[] = [];
  for (const e of state.progress) {
    const sameMovie = p.type === 'movie' && e.type === 'movie' && digits(e.id) === digits(p.id);
    const sameSeries = p.type === 'episode' && !!p.seriesId && progressSeriesId(e) === digits(p.seriesId);
    const same = sameMovie || sameSeries;
    if (e.title === p.title) continue;
    if (same) removed.push(e.title);
    else out.push(e);
  }
  if (done && out.length === state.progress.length && !lastSent.has(id)) return;
  progressRevision++;
  if (!done) out.unshift({ ...p, order: Date.now() / 1000 });
  const send = done || force || now - (lastSent.get(id) || 0) >= 30;
  for (const t of removed) cloudPost({ action: 'delete', title: t });
  if (!send) {
    state = { ...state, progress: out };
    return;
  }
  set({ progress: out });
  if (done) {
    lastSent.delete(id);
    cloudPost({ action: 'delete', title: p.title });
    return;
  }
  lastSent.set(id, now);
  const { order, ...body } = p;
  cloudPost({ action: 'save', ...body, platform: 'vega', device: read('device_id') });
}

export function removeProgress(title: string) {
  if (state.demo) return;
  progressRevision++;
  set({ progress: state.progress.filter(e => e.title !== title) });
  cloudPost({ action: 'delete', title });
}

// ---------- equipo ----------

export { deviceId };

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
  let r = await panelTenantConfig(code, deviceId(), now);
  // el panel rechaza el número: antes de borrar el número y cerrar la sesión se le pregunta otra vez (una sola
  // respuesta equivocada del panel sacaba al cliente de la app)
  if (!r.ok && TENANT_FATAL.includes(r.code)) {
    await new Promise<void>(res => setTimeout(res, 3000));
    r = await panelTenantConfig(code, deviceId(), nowSec());
  }
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
