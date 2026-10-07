// Panel LatMpx: servidores (dns.php), equipo (auth.php) y nube con token
// (progress.php, epg.php, sports.php). Mismo contrato que la web, Android, Windows y Roku.
import { decodePanelUrl, dnsDecode, mopeDecrypt, mopeEncrypt } from '../lib/crypto';
import { http, HttpResult, json } from '../lib/http';
import { read, remove, write } from '../lib/storage';
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
// El modo que funciona se recuerda.
let panelMode = '';
export async function panel(file: string, method = 'GET', body = '', type = '', query = ''): Promise<HttpResult> {
  const base = panelApiBase();
  if (!base) return { code: 0, body: '', ok: false };
  const url = base + file + query;
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

// Servidores (DNS) que el panel tiene configurados
export async function panelDnsList(): Promise<Server[]> {
  const out: Server[] = [];
  const seen = new Set<string>();
  const r = await panel('dns.php');
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
  out.forEach((s, i) => {
    if (!s.name) s.name = 'Servidor ' + (i + 1);
  });
  // la lista se guarda por si el panel no responde la próxima vez
  if (out.length) write('servers', JSON.stringify(out));
  else {
    try {
      return JSON.parse(read('servers', '[]'));
    } catch {
      return [];
    }
  }
  return out;
}

// auth.php: listas que el panel tiene asignadas a este equipo (sin llave)
export async function panelPlaylists(deviceId: string): Promise<{ lines: (Server & { user: string; pass: string })[]; error: string }> {
  const r = await panel('auth.php', 'POST', JSON.stringify({ data: mopeEncrypt(JSON.stringify({ mac_address: deviceId })) }), 'application/json');
  if (r.code === 0) return { lines: [], error: 'No se pudo conectar con el panel. Revisa tu conexión a internet.' };
  const outer = json(r);
  if (!outer) return { lines: [], error: 'Respuesta no válida del panel' };
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
  if (tmdb && tmdb !== 'missing_tmdb_key') write('tmdb_key', tmdb);
  if (str(resp.parent_control)) write('panel_pin', str(resp.parent_control));
  const lines: (Server & { user: string; pass: string })[] = [];
  const seen = new Set<string>();
  for (const o of resp.urls || []) {
    const ln = lineFromUrl(str(o?.name) || 'Servidor', str(o?.url));
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

async function cloudToken(forceNew = false): Promise<string> {
  if (!forceNew) {
    const t = read('cloud_token');
    if (t) return t;
  }
  const s = sessionRef();
  if (!s) return '';
  const r = await panel('progress.php', 'POST', JSON.stringify({ action: 'auth', user: s.user, pass: s.pass }), 'application/json');
  const j = json(r);
  if (!j || !str(j.token)) return '';
  const tmdb = str(j.tmdbKey);
  if (tmdb && tmdb !== 'missing_tmdb_key') write('tmdb_key', tmdb);
  write('cloud_token', j.token);
  return j.token;
}

// petición con token; si venció (401) pide otro una vez
export async function cloud(file: string, method: 'GET' | 'POST', payload: Record<string, any> | null): Promise<HttpResult> {
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
    remove('cloud_token');
    tok = await cloudToken(true);
    if (!tok) break;
  }
  const j = json(r);
  if (j && typeof j === 'object' && str(j.token)) write('cloud_token', j.token);
  return r;
}

export function forgetCloud(): void {
  remove('cloud_token');
}
