// Panel LatMpx: servidores (dns.php), equipo (auth.php) y nube con token
// (progress.php, epg.php, sports.php). Mismo contrato que la web, Android, Windows y Roku.
import { decodePanelUrl, dnsDecode, mopeDecrypt, mopeEncrypt } from '../lib/crypto';
import { hasMasterKey, panelDecrypt, panelEncrypt } from '../lib/aes';
import { formBody, http, HttpResult, json } from '../lib/http';
import { read, remove, write } from '../lib/storage';
import { cacheSeen, takeCacheOrder } from '../lib/cacheclear';
import { APP_ID, Brand, parseConfig, reportTenantProblem, scoped, TENANT_ERRORS, TENANT_FATAL, tenantCode, tenantFields } from '../lib/tenant';
import { lang, t } from '../lib/i18n';
import { normalizeBase, str } from '../lib/util';

export type Session = {
  dns: string;
  base: string;
  user: string;
  pass: string;
  exp: number;
  created: number;
  active: string;
  max: string;
};

export type Server = { name: string; base: string };

// línea del panel; demo: el panel dice que es una DEMO ("demo": true en check_mac)
// demoExpires / demoDuration: fin (segundos Unix) y duración (segundos) de la demo según el panel
export type Line = Server & { user: string; pass: string; demo?: boolean; demoExpires?: number; demoDuration?: number };

const PANEL_HEX =
  '4979456d507a6876665741734e4341715053773850796f374e794d34657a3475507a67694e32553250534a6b4f444d38507a41675944733050436f6e656a4d2f496e6f6949796f734e7a30554e43496d5a53553650773d3d';

let apiBase = '';
export function panelApiBase(): string {
  if (apiBase) return apiBase;
  let u = decodePanelUrl(PANEL_HEX).trim();
  if (!u) return '';
  if (/\.php$/i.test(u)) u = u.slice(0, u.lastIndexOf('/') + 1);
  else if (!u.endsWith('/')) u += '/';
  apiBase = u;
  return u;
}

// Llama al panel por https y, si el certificado del hosting falla, por http (igual que la web).
// El modo que funciona se recuerda. Siempre lleva ?lang= (idioma de la app): el panel traduce sus
// mensajes (progress, epg, sports, tmdb, alerta, media…); los códigos de error no cambian.
let panelMode = '';
// esquema con el que respondió el panel ('' si aún no se sabe)
export function panelScheme(): string {
  return panelMode;
}
export async function panel(file: string, method = 'GET', body = '', type = '', query = ''): Promise<HttpResult> {
  const base = panelApiBase();
  if (!base) return { code: 0, body: '', ok: false };
  const url = base + file + query + (query.includes('?') ? '&' : '?') + 'lang=' + lang();
  const modes = panelMode ? [panelMode, 'https', 'http'] : ['https', 'http'];
  const tried = new Set<string>();
  for (const md of modes) {
    if (tried.has(md)) continue;
    tried.add(md);
    const u = md === 'http' ? url.replace(/^https:/i, 'http:') : url;
    const r = await http(u, { method, body: body || undefined, type: type || undefined, timeout: 15000 });
    if (r.code > 0) {
      panelMode = md;
      return r;
    }
  }
  return { code: 0, body: '', ok: false };
}

// "http://host:port/get.php?username=u&password=p&type=..." -> línea
export function lineFromUrl(name: string, url: string, user = '', pass = ''): (Server & { user: string; pass: string }) | null {
  if (!url) return null;
  const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const params: Record<string, string> = {};
  for (const part of q.split('&')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        params[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1).replace(/\+/g, ' '));
      } catch {
        params[part.slice(0, i)] = part.slice(i + 1);
      }
    }
  }
  if (!user && params.username) user = params.username;
  if (!pass && params.password) pass = params.password;
  let base = url;
  if (url.includes('/get.php')) base = url.slice(0, url.indexOf('/get.php'));
  else if (url.includes('?')) base = url.slice(0, url.indexOf('?'));
  base = normalizeBase(base);
  if (!user || !pass || !base) return null;
  return { name, base, user, pass };
}

// Servidores (DNS) que el panel tiene configurados. Con distribuidor solo los suyos
// (login.php fetch_dns); dns.php es siempre la lista del dueño.
export async function panelDnsList(): Promise<Server[]> {
  const out: Server[] = [];
  const seen = new Set<string>();
  const r = tenantCode() ? { code: 0, body: '', ok: false } : await panel('dns.php');
  if (r.ok) {
    try {
      const j = JSON.parse(dnsDecode(r.body));
      for (const p of j?.portalsdns || []) {
        const u = str(p?.url);
        if (!u) continue;
        const b = normalizeBase(u);
        if (seen.has(b)) continue;
        seen.add(b);
        out.push({ name: str(p?.name), base: b });
      }
    } catch {
      // respuesta no válida: lista vacía
    }
  }
  for (const u of await panelFetchDns()) {
    const b = normalizeBase(u);
    if (!seen.has(b)) {
      seen.add(b);
      out.push({ name: '', base: b });
    }
  }
  out.forEach((s, i) => {
    if (!s.name) s.name = 'Servidor ' + (i + 1);
  });
  // la lista se guarda por si el panel no responde la próxima vez
  if (out.length) write(scoped('servers'), JSON.stringify(out));
  else {
    try {
      return JSON.parse(read(scoped('servers'), '[]'));
    } catch {
      return [];
    }
  }
  return out;
}

// auth.php: listas que el panel tiene asignadas a este equipo (sin llave). Solo responde con
// datos del dueño: con distribuidor se usa check_mac (login.php).
export async function panelPlaylists(deviceId: string): Promise<{ lines: Line[]; error: string }> {
  if (tenantCode()) return { lines: [], error: '' };
  const r = await panel('auth.php', 'POST', JSON.stringify({ data: mopeEncrypt(JSON.stringify({ mac_address: deviceId })) }), 'application/json');
  if (r.code === 0) return { lines: [], error: t('No se pudo conectar con el panel. Revisa tu conexión a internet.') };
  const outer = json(r);
  if (!outer) return { lines: [], error: t('Respuesta no válida del panel') };
  let resp: any = null;
  if (str(outer.data)) {
    try {
      resp = JSON.parse(mopeDecrypt(outer.data));
    } catch {
      resp = null;
    }
  }
  if (!resp) resp = outer.plain;
  if (!resp) return { lines: [], error: '' };
  const tmdb = str(resp.tmdbKey);
  if (tmdb && tmdb !== 'missing_tmdb_key') write(scoped('tmdb_key'), tmdb);
  if (/^\d{4}$/.test(str(resp.parent_control))) write(scoped('panel_pin'), str(resp.parent_control));
  const lines: Line[] = [];
  const seen = new Set<string>();
  for (const o of resp.urls || []) {
    const ln = lineFromUrl(str(o?.name) || t('Servidor'), str(o?.url));
    if (ln && !seen.has(ln.base + '|' + ln.user)) {
      seen.add(ln.base + '|' + ln.user);
      lines.push(ln);
    }
  }
  return { lines, error: '' };
}

// ---------- token del panel (progress.php / epg.php / sports.php) ----------

let sessionRef: () => Session | null = () => null;
export function bindSession(fn: () => Session | null): void {
  sessionRef = fn;
}

// progress.php responde "demo": true (auth y GET ?v=2) cuando la línea es una DEMO
let demoHook: () => void = () => {};
export function onPanelDemo(fn: () => void): void {
  demoHook = fn;
}

// línea en uso (distribuidor + usuario@servidor): lo que se guarda por línea (estado del motor)
export function lineKey(): string {
  const s = sessionRef();
  return s ? tenantCode() + '|' + s.user + '@' + s.base : '';
}

// el token es de cada distribuidor (con Omitir, la clave de siempre)
export async function cloudToken(forceNew = false): Promise<string> {
  const s = sessionRef();
  if (!s) return '';
  const key = scoped('cloud_token2');
  // el token es de esta cuenta (usuario@servidor); si entra otra, no se reutiliza y se pide uno nuevo
  const scopeKey = scoped('cloud_token2_scope');
  const scope = s.user + '@' + s.base;
  if (read(scopeKey) !== scope) { remove(key); write(scopeKey, scope); }
  if (!forceNew) {
    const t = read(key);
    if (t) return t;
  }
  const r = await panel('progress.php', 'POST', JSON.stringify({ action: 'auth', user: s.user, pass: s.pass, dns: s.base, ...tenantFields(), platform: APP_ID, device: read('device_id') }), 'application/json');
  tenantProblem(r);
  const j = json(r);
  if (j && j.demo === true && sessionRef() === s) demoHook();
  if (!j || !str(j.token)) return '';
  // vacía: el distribuidor no tiene clave (el panel nunca le da la del dueño): se olvida la guardada
  if ('tmdbKey' in j) {
    const tmdb = str(j.tmdbKey);
    if (tmdb && tmdb !== 'missing_tmdb_key') write(scoped('tmdb_key'), tmdb);
    else remove(scoped('tmdb_key'));
  }
  write(key, j.token);
  return j.token;
}

// error del distribuidor (vencido, suspendido…) en progress/epg/sports: lo revisa el guardián
function tenantProblem(r: HttpResult): void {
  if (!tenantCode() || r.code < 400 || r.code >= 500) return;
  const code = str(json(r)?.code);
  if (TENANT_FATAL.includes(code)) reportTenantProblem(code);
}

// petición con token; si venció (401) pide otro una vez
export async function cloud(file: string, method: 'GET' | 'POST', payload: Record<string, any> | null): Promise<HttpResult> {
  const ses = sessionRef();
  let tok = await cloudToken();
  if (!tok) return { code: 0, body: '', ok: false };
  let r: HttpResult = { code: 0, body: '', ok: false };
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (method === 'GET') {
      let q = '?token=' + encodeURIComponent(tok);
      for (const k of Object.keys(payload || {})) q += '&' + k + '=' + encodeURIComponent(str(payload![k]));
      r = await panel(file, 'GET', '', '', q);
    } else {
      r = await panel(file, 'POST', JSON.stringify({ ...(payload || {}), token: tok }), 'application/json');
    }
    if (r.code !== 401 || attempt === 2) break;
    remove(scoped('cloud_token2'));
    tok = await cloudToken(true);
    if (!tok) break;
  }
  tenantProblem(r);
  const j = json(r);
  if (j && typeof j === 'object' && str(j.token)) write(scoped('cloud_token2'), j.token);
  if (file === 'progress.php' && j && typeof j === 'object' && j.demo === true && sessionRef() === ses) demoHook();
  return r;
}

export function forgetCloud(): void {
  remove(scoped('cloud_token2'));
  remove(scoped('cloud_token2_scope'));
}

// ---------- login.php (con la llave maestra) ----------

// POST a login.php con el JSON cifrado (con distribuidor lleva "tenant" y "app")
// diferencia entre la hora del panel y la del equipo (segundos), para el "ts" de cada pedido
let clockSkew = 0;

async function panelLogin(action: string, payload: Record<string, any>): Promise<HttpResult & { error?: string }> {
  // verificador antihack del panel: hora del pedido ("ts"); si el reloj del equipo está mal, el panel
  // responde 401 ts_expired con su hora y se reintenta una vez con el reloj corregido
  let r: HttpResult = { code: 0, body: '', ok: false };
  for (let attempt = 0; attempt < 2; attempt++) {
    const ts = Math.floor(Date.now() / 1000) + clockSkew;
    // platform: en qué equipo está esta MAC (Clientes MAC › Dispositivo) y la pantalla falsa de esta app
    const data = panelEncrypt(JSON.stringify({ ...payload, ...tenantFields(), platform: APP_ID, ts, lang: lang() }));
    if (!data) return { code: -1, body: '', ok: false, error: t('Esta versión no tiene la llave del panel.') };
    r = await panel('login.php', 'POST', formBody({ action, data }), 'application/x-www-form-urlencoded');
    const j = r.code === 401 ? json<any>(r) : null;
    if (attempt === 0 && j && /^ts_/.test(str(j.code)) && Number(j.server_time) > 0) {
      clockSkew = Number(j.server_time) - Math.floor(Date.now() / 1000);
      continue;
    }
    break;
  }
  return r.code === 0 ? { ...r, error: t('No se pudo conectar con el panel.') } : r;
}

// respuesta de login.php que se pidió con "enc": 1: el éxito (200) llega cifrado igual que
// fetch_dns (usuario y contraseña de la línea nunca en claro); un panel antiguo responde JSON
// normal y los errores siempre son JSON normal
function loginReply(r: HttpResult): any {
  const body = r.body.trim();
  if (!r.ok || !body || body.startsWith('{')) return json(r);
  const plain = panelDecrypt(body);
  if (!plain) return null;
  try {
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

function panelError(r: HttpResult & { error?: string }, fallback: string): string {
  if (r.error) return r.error;
  const j = json(r);
  const code = j && typeof j === 'object' ? str(j.code) : '';
  if (tenantCode() && TENANT_ERRORS[code]) {
    if (TENANT_FATAL.includes(code)) reportTenantProblem(code);
    return t(TENANT_ERRORS[code]);
  }
  const msg = j && typeof j === 'object' ? str(j.error) || str(j.message) : '';
  if (msg === 'Server not configured') return t('El panel no está configurado');
  if (msg === 'Decryption failed') return t('La llave de la app no coincide con la del panel');
  return msg || fallback;
}

// pantalla falsa del panel (Pantalla Falsa, solo el dueño) para equipos nuevos de esta app
export type FakeScreen = { type: 'calculator' | 'carrusel' | 'image' | 'video' | 'web'; url: string; images: string[]; interval: number; unlock: string };
let fakeScreen: FakeScreen | null = null;
export function lastFakeScreen(): FakeScreen | null {
  return fakeScreen;
}
function parseFake(j: any): FakeScreen | null {
  const f = j && typeof j === 'object' ? j.fake_screen : null;
  if (!f || f.show !== true) return null;
  const types = ['calculator', 'carrusel', 'image', 'video', 'web'];
  const http = (u: any) => /^https?:\/\//i.test(str(u));
  return {
    type: (types.includes(str(f.type)) ? str(f.type) : 'calculator') as FakeScreen['type'],
    url: http(f.url) ? str(f.url) : '',
    images: Array.isArray(f.images) ? f.images.filter(http).map(str) : [],
    interval: Math.min(120, Math.max(1, Number(f.interval) || 5)),
    unlock: str(f.unlock).replace(/\D/g, ''),
  };
}

// línea activada para este equipo en el panel
// poll: la app ya abierta vuelve a preguntar (cada 10 min): el panel no lo cuenta como otra apertura
export async function panelCheckMac(deviceId: string, poll = false): Promise<Line | null> {
  if (!hasMasterKey()) return null;
  // cc: última orden de borrar la caché que esta app ya aplicó
  const r = await panelLogin('check_mac', { mac_address: deviceId, enc: 1, cc: cacheSeen(), ...(poll ? { poll: 1 } : {}) });
  const j = loginReply(r);
  // el panel contestó (aunque sea "no hay línea"): sirve para cerrar la sesión al volver a la app
  lastCheckAnswered = r.code === 200 && !!j;
  // orden del panel de borrar la caché (viene con o sin línea; un panel viejo no la manda)
  if (lastCheckAnswered && takeCacheOrder(j.cache_clear, j.cache_clear_at, Math.floor(Date.now() / 1000) + clockSkew)) cacheHook();
  fakeScreen = parseFake(j);
  if (!j || j.exists !== true) return null;
  // PIN parental del panel: es el que usa la app
  if (/^\d{4}$/.test(str(j.pin))) write(scoped('panel_pin'), str(j.pin));
  const ln = lineFromUrl(t('Servidor'), str(j.url), str(j.username), str(j.password));
  return ln ? { ...ln, demo: j.demo === true, demoExpires: Number(j.demo_expires) || 0, demoDuration: Number(j.demo_duration) || 0 } : null;
}

let lastCheckAnswered = false;

// borrar la caché y reiniciar (lo hace App)
let cacheHook: () => void = () => {};
export function onCacheClear(fn: () => void): void {
  cacheHook = fn;
}

// funciones que el panel tiene para esta app (login.php features, respuesta sin cifrar). demo: hay
// una línea en «Configurar Demo» del distribuidor (o del dueño con Omitir). null = sin respuesta o
// panel viejo ("Invalid action")
// review: el panel ofrece el tema de prueba (Pantalla Falsa; solo con Omitir)
export async function panelFeatures(): Promise<{ demo: boolean; review: boolean } | null> {
  if (!hasMasterKey()) return null;
  const j = json<any>(await panelLogin('features', {}));
  const f = j && str(j.status) === 'ok' && j.features && typeof j.features === 'object' ? j.features : null;
  return f && typeof f.demo === 'boolean' ? { demo: f.demo, review: f.review === true && !tenantCode() } : null;
}

export type ReviewVideo = { name: string; url: string };
export type Review = { movies: ReviewVideo[]; series: ReviewVideo[] };

// Tema de prueba (login.php review_login): Auto-Demo (demo) o una cuenta del tema. No registra nada ni vence.
// code 401 = no es una cuenta del tema (sigue el inicio de sesión de siempre)
export async function panelReview(user: string, pass: string, demo: boolean): Promise<{ ok: true; review: Review } | { ok: false; error: string; code: number }> {
  const r = await panelLogin('review_login', demo ? { demo: 1 } : { username: user, password: pass });
  const j = json<any>(r);
  if (!r.ok || !j || str(j.status) !== 'ok') return { ok: false, error: panelError(r, t('No se pudo conectar con el panel.')), code: r.code };
  const list = (a: any): ReviewVideo[] =>
    (Array.isArray(a) ? a : []).map((v: any) => ({ name: str(v?.name), url: str(v?.url) })).filter((v: ReviewVideo) => !!v.url);
  return { ok: true, review: { movies: list(j.movies), series: list(j.series) } };
}
export function panelAnswered(): boolean {
  return lastCheckAnswered;
}

// cambia el PIN parental en el panel (pide el actual); si el panel no lo acepta, no cambia
export async function panelSetPin(deviceId: string, oldPin: string, pin: string): Promise<{ ok: boolean; error?: string }> {
  const r = await panelLogin('set_pin', { mac_address: deviceId, old_pin: oldPin, pin });
  const j = loginReply(r);
  if (r.ok && j && j.ok === true) {
    write(scoped('panel_pin'), pin);
    return { ok: true };
  }
  return { ok: false, error: panelError(r, t('El panel no guardó el PIN ({code})', { code: r.code })) };
}

// registra el equipo (código MAC) con la cuenta en el panel
// code: respuesta HTTP del panel (0 = sin conexión)
export async function panelSubmit(deviceId: string, user: string, pass: string, dns: string): Promise<{ ok: boolean; error?: string; code: number }> {
  const r = await panelLogin('submit_url', { mac_address: deviceId, username: user, password: pass, url: dns });
  const j = json(r);
  if (r.ok && j && str(j.status) === 'ok') return { ok: true, code: r.code };
  return { ok: false, error: panelError(r, t('No se pudo registrar el equipo')), code: r.code };
}

// código de demo de un revendedor: 6 letras y números con al menos una letra (solo números sería
// un número de distribuidor)
export function resellerCode(text: string): string {
  const t = text.trim();
  return /^(?=.*[A-Za-z])[A-Za-z0-9]{6}$/.test(t) ? t.toUpperCase() : '';
}

// demo automática (su duración la decide el panel: demo_duration), una por equipo. reseller: código del revendedor escrito en Contraseña (la demo
// queda a su nombre en el panel); cualquier otra cosa no se envía.
// url: el servidor de la demo (vacío en paneles viejos)
export async function panelDemo(
  deviceId: string,
  reseller = '',
): Promise<{ ok: boolean; user?: string; pass?: string; url?: string; expires?: number; duration?: number; error?: string; code: number }> {
  const code = resellerCode(reseller);
  const r = await panelLogin('auto_demo', code ? { mac_address: deviceId, reseller: code, enc: 1 } : { mac_address: deviceId, enc: 1 });
  const j = loginReply(r);
  if (r.ok && j && str(j.status) === 'ok' && str(j.username)) return {
      ok: true,
      user: str(j.username),
      pass: str(j.password),
      url: str(j.url),
      expires: Number(j.demo_expires) || 0,
      duration: Number(j.demo_duration) || 0,
      code: r.code,
    };
  let fb = t('No se pudo crear la demo');
  if (r.code === 403) fb = t('Demo ya utilizada en este dispositivo o dispositivo ya registrado.');
  if (r.code === 429) fb = t('Demasiadas demos desde esta conexión. Inténtalo mañana.');
  if (r.code === 503) fb = t('La demo no está disponible en este momento. Inténtalo más tarde.');
  if (r.code === 404 && code) fb = t('El código de revendedor no existe o no está activo.');
  return { ok: false, error: panelError(r, fb), code: r.code };
}

// DNS extra que solo da login.php
export async function panelFetchDns(): Promise<string[]> {
  if (!hasMasterKey()) return [];
  const r = await panelLogin('fetch_dns', {});
  if (!r.ok) return [];
  const plain = panelDecrypt(r.body);
  try {
    const arr = plain ? JSON.parse(plain) : [];
    return Array.isArray(arr) ? arr.map(str).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// ---------- distribuidor (login.php tenant_config) ----------

export type TenantResult =
  | { ok: true; brand: Brand }
  // network: sin conexión o error del servidor (5xx); code: error del panel (tenant_invalid…)
  | { ok: false; network: boolean; code: string; message: string };

export async function panelTenantConfig(code: string, device: string, now: number): Promise<TenantResult> {
  if (!hasMasterKey()) return { ok: false, network: false, code: 'no_key', message: t('Esta versión de la app no tiene la llave del panel') };
  const data = panelEncrypt(JSON.stringify({ code, app: APP_ID, device, lang: lang() }));
  const r = await panel('login.php', 'POST', formBody({ action: 'tenant_config', data }), 'application/x-www-form-urlencoded');
  if (r.code === 0 || r.code >= 500) return { ok: false, network: true, code: '', message: t('No se pudo conectar con el panel. Revisa tu conexión a internet.') };
  if (!r.ok) {
    const j = json(r);
    const c = j && typeof j === 'object' ? str(j.code) : '';
    if (TENANT_ERRORS[c]) return { ok: false, network: false, code: c, message: t(TENANT_ERRORS[c]) };
    const msg = j && typeof j === 'object' ? str(j.error) : '';
    if (msg === 'Decryption failed') return { ok: false, network: false, code: 'key', message: t('La llave de la app no coincide con la del panel') };
    return { ok: false, network: true, code: '', message: msg || t('Respuesta no válida del panel ({code})', { code: r.code }) };
  }
  const plain = panelDecrypt(r.body);
  let j: any = null;
  try {
    j = plain ? JSON.parse(plain) : null;
  } catch {
    j = null;
  }
  const brand = parseConfig(j, now);
  if (!brand || brand.code !== code) return { ok: false, network: true, code: '', message: t('Respuesta no válida del panel') };
  return { ok: true, brand };
}
