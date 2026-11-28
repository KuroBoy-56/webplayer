// Estado global: sesión, carga del catálogo, progreso ("Continuar viendo") y Mi lista,
// sincronizados con api/progress.php del panel igual que la web, Android y Roku.
import { loadWeekTop } from './data/top10';
import { useSyncExternalStore } from 'react';
import { bindProfile, bindSession, cloud, forgetCloud, lineKey, onPanelDemo, panelTenantConfig, Session } from './api/panel';
import { fetchProfiles, Profile, ProfilesData } from './api/profiles';
import type { Route } from './nav';
import { loadKidsRules, rememberKidsRules } from './lib/kids';
import { bindKidsRate, onVerdicts } from './data/kidsrate';
import { Kind, loadKind, setStreamFlip } from './api/xtream';
import { catalog } from './data/catalog';
import { json } from './lib/http';
import { read, readJson, remove, write, writeJson } from './lib/storage';
import { deviceId, deviceRegistered } from './lib/deviceid';
import { APP_ID, brand, clearTenant, expiredMessage, locallyExpired, OFFLINE_GRACE, saveBrand, scoped, TENANT_FATAL, tenantCode } from './lib/tenant';
import { digits, nowSec, parseIso, str } from './lib/util';
import { setImgCache } from './lib/images';
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
  // perfiles (api/profiles.ts): lo último que dijo el panel (null = no se sabe o la línea no tiene) y el elegido
  profiles: ProfilesData | null;
  profile: Profile | null;
  // sube cuando el panel dice que el perfil ya no existe (App vuelve a «¿Quién está viendo?»)
  profileGone: number;
  // el menú de arriba se esconde mientras se recorren las filas de Inicio, Series y Películas (como Android)
  menuHidden: boolean;
  // el aviso del panel (AlertDialog) está abierto: la campanita espera a que se cierre para bajar su cartel
  alertOpen: boolean;
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
  profiles: null,
  profile: null,
  profileGone: 0,
  menuHidden: false,
  alertOpen: false,
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

export const setAlertOpen = (on: boolean) => {
  if (state.alertOpen !== on) set({ alertOpen: on });
};

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
bindProfile(() => state.profile?.id || '', () => {
  catalog.setKids(false);
  set({ profile: null, progress: [], favorites: [], profileGone: state.profileGone + 1, catalogRev: state.catalogRev + 1 });
  // la lista otra vez del panel (sin el perfil que ya no está)
  const ses = state.session;
  fetchProfiles(Number(ses?.max) || 0).then(d => d && state.session === ses && setProfiles(d)).catch(() => {});
});
// clasificación de TMDB del perfil infantil (api/kids_rate.php), guardada por distribuidor
bindKidsRate(items => cloud('kids_rate.php', 'POST', { items }).then(r => json(r)), () => scoped('kids_rate'));
// veredictos nuevos de TMDB para el perfil infantil: se rehacen las filas
onVerdicts(() => {
  if (!catalog.kidsOn) return;
  catalog.refreshKids();
  refreshCatalog();
});

// ---------- perfiles ----------

// lo que dijo el panel (las listas del perfil infantil se guardan para la próxima vez)
export function setProfiles(data: ProfilesData | null) {
  if (data?.kidsRules) rememberKidsRules(data.kidsRules);
  const cur = state.profile && data?.enabled ? data.profiles.find(p => p.id === state.profile!.id) || null : state.profile;
  set({ profiles: data, profile: cur });
}

// ¿la línea elige perfil? (perfiles encendidos y más de una conexión)
export function profilesNeeded(): boolean {
  const d = state.profiles;
  return !!d && d.enabled && d.max > 1 && d.profiles.length > 0 && !state.demo;
}

// último perfil elegido en este equipo para esta línea (el foco de la pantalla de perfiles empieza ahí)
export function lastProfileId(): string {
  return read('pf_last|' + lineKey());
}

// el perfil elegido: Continuar viendo y Mi lista se leen otra vez (son de cada perfil) y el infantil filtra el catálogo
export function chooseProfile(p: Profile) {
  write('pf_last|' + lineKey(), p.id);
  if (p.kids) loadKidsRules();
  catalog.setKids(p.kids);
  set({ profile: p, progress: [], favorites: [], catalogRev: state.catalogRev + 1 });
  loadCloud();
}

// adónde va la app con la sesión iniciada: «¿Quién está viendo?» si la línea elige perfil; si no, Inicio. Si el panel
// no contesta en 6 s se entra con el principal (nunca se queda esperando)
export async function enterRoute(): Promise<Route> {
  const ses = state.session;
  if (!ses) return { name: 'login' };
  if (state.demo) return { name: 'main' };
  // si la última vez el dueño tenía los perfiles apagados, Inicio enseguida como siempre (sin esperar al panel); lo que
  // conteste ahora queda guardado y, si los encendió, se ven desde el próximo inicio (nunca un salto en pleno uso)
  const onKey = 'pf_on|' + lineKey();
  const ask = fetchProfiles(Number(ses.max) || 0)
    .catch(() => null)
    .then(d => {
      if (d) write(onKey, d.enabled ? '1' : '0');
      return d;
    });
  if (read(onKey) === '0') {
    ask.then(d => d && !d.enabled && state.session === ses && setProfiles(d));
    return { name: 'main' };
  }
  const data = await Promise.race([ask, new Promise<null>(r => setTimeout(() => r(null), 6000))]);
  if (state.session !== ses) return { name: 'login' };
  setProfiles(data);
  return profilesNeeded() ? { name: 'profiles', from: 'start' } : { name: 'main' };
}

export function setMenuHidden(hidden: boolean) {
  if (state.menuHidden !== hidden) set({ menuHidden: hidden });
}

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
  // sesión iniciada con el identificador actual: el panel ya lo tiene registrado con la línea
  deviceRegistered();
  byHand = false;
  forgetCloud();
  setStreamFlip(false);
  catalog.setKids(false);
  set({ session: s, progress: [], favorites: [], demo, demoExpires: demo ? demoExpires : 0, demoDuration: demo ? demoDuration : 0, profiles: null, profile: null, menuHidden: false });
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

// se cerró sesión a mano (Cuenta, «¿Quién está viendo?», tema de prueba): el inicio de sesión no pregunta al panel ni
// entra solo hasta volver a abrir la app (solo en memoria; al abrirla otra vez entra sola como siempre)
let byHand = false;
export function signedOutByHand(): boolean {
  return byHand;
}
export function logoutByHand() {
  logout();
  byHand = true;
}

export function logout() {
  remove('session');
  forgetCloud();
  catalog.clear();
  catalog.unlocked = false;
  catalog.setKids(false);
  set({ session: null, loaded: { vod: false, series: false, live: false }, loading: '', error: '', progress: [], favorites: [], demo: false, demoExpires: 0, demoDuration: 0, profiles: null, profile: null, menuHidden: false });
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

// Cuenta › «Actualizar catálogo» (como Roku): películas, series y canales otra vez del servidor IPTV para traer lo nuevo,
// sin vaciar lo que se ve: cada lista se cambia al llegar y, si el servidor no contesta una, se conserva la anterior
let reloading = false;
export async function reloadCatalog(): Promise<void> {
  const s = state.session;
  if (!s || reloading) return;
  reloading = true;
  showNotice(t('Actualizando el catálogo…'));
  try {
    loadWeekTop().catch(() => {});
    const ok = await Promise.all(
      (['vod', 'series', 'live'] as Kind[]).map(async kind => {
        const { cats, items } = await loadKind(s, kind).catch(() => ({ cats: [] as any[], items: [] as any[] }));
        // sin lista, o sin categorías cuando ya había: se queda lo anterior
        if (state.session !== s || !items.length || (!cats.length && catalog.has(kind))) return false;
        catalog.set(kind, cats, items);
        set({ loaded: { ...state.loaded, [kind]: true }, catalogRev: state.catalogRev + 1 });
        return true;
      }),
    );
    if (state.session !== s) return;
    if (ok.every(Boolean)) set({ error: '' });
    showNotice(t(ok.every(Boolean) ? 'Catálogo actualizado' : 'No se pudo actualizar todo el catálogo; se conserva lo anterior'));
  } finally {
    reloading = false;
  }
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
  // la línea elige perfil y todavía no lo eligió: nada (serían los del principal)
  if (profilesNeeded() && !state.profile) return;
  const pid = state.profile?.id || '';
  const j = json(await cloud('progress.php', 'GET', { v: '2' }));
  // se cambió de perfil mientras tanto: esto era del anterior
  if ((state.profile?.id || '') !== pid) return;
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

// identificador del equipo para el panel: src/lib/deviceid.ts
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
  byHand = false;
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
