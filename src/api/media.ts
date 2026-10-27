// Motor del panel para Vega (api/media_vega.php): cuando el reproductor del equipo no puede cambiar
// el audio de un archivo o no sabe decodificarlo (DTS, TrueHD…), el panel lo prepara con ffmpeg
// (video sin cambios + ese audio en AAC, HLS desde el segundo pedido); los subtítulos del archivo
// que el equipo no muestra llegan como WebVTT. Mismo contrato que media.php de Roku.
import { b64Encode } from '../lib/crypto';
import { http, json } from '../lib/http';
import { str } from '../lib/util';
import { cloud, cloudToken, lineKey, panel, panelApiBase, panelScheme } from './panel';
import { Probe, probeTracks } from '../lib/probe';
import { features } from '../lib/tenant';
import { lang, t } from '../lib/i18n';

const FILE = 'media_vega.php';

export type Engine = { base: string; token: string };

// estado del motor de esta línea: se pregunta una vez por sesión; sin permiso no se le vuelve a pedir nada
let state: { line: string; engine: Engine | null; error: string } | null = null;

// texto del panel si ya se sabe que el motor no está para esta línea ('' = disponible o aún no se sabe)
export function engineDenied(): string {
  if (!features().ffmpeg) return t('Sin permisos');
  return state && state.line === lineKey() && !state.engine ? state.error : '';
}

// el motor contestó 503/501 (sin permiso o sin ffmpeg): no se le pide nada más en esta línea
export function markDenied(error: string): void {
  state = { line: lineKey(), engine: null, error };
}

// dirección del panel con el esquema que funciona, token de la línea y si el panel tiene ffmpeg
export async function mediaEngine(): Promise<{ ok: true; engine: Engine } | { ok: false; error: string }> {
  const line = lineKey();
  const denied = engineDenied();
  if (denied) return { ok: false, error: denied };
  if (state?.engine && state.line === line) return { ok: true, engine: state.engine };
  let base = panelApiBase();
  if (!base) return { ok: false, error: t('No se encontró el panel') };
  const token = await cloudToken();
  if (!token) return { ok: false, error: t('No se pudo validar tu línea con el panel.') };
  // con el token el panel dice también si el distribuidor de la línea tiene ffmpeg activado
  const st = await panel(FILE, 'GET', '', '', '?do=status&token=' + encodeURIComponent(token));
  const j = json(st);
  // sin conexión: no se guarda (se vuelve a preguntar la próxima vez)
  if (st.code === 0) return { ok: false, error: t('No se pudo conectar con el panel.') };
  // sin el servicio, apagado por el dueño o sin permiso: solo el texto del panel ("Sin permisos" / "No compatible…")
  if (st.code === 404 || !j || j.ffmpeg !== true) {
    const error = (j && str(j.error)) || t('No compatible con el dispositivo');
    if (lineKey() === line) state = { line, engine: null, error };
    return { ok: false, error };
  }
  if (panelScheme() === 'http') base = base.replace(/^https:/i, 'http:');
  const engine = { base, token };
  if (lineKey() === line) state = { line, engine, error: '' };
  return { ok: true, engine };
}

// el token cambió (401): se pide otro la próxima vez
export function forgetEngine(): void {
  if (state?.engine) state = null;
}

// borrado de caché pedido por el panel: se vuelve a preguntar al motor
export function resetEngine(): void {
  state = null;
}

function b64u(s: string): string {
  return b64Encode(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// HLS con el audio a (orden en el archivo) desde el segundo t. video: también el video convertido a H.264 (lo que el
// equipo no reproduce; solo en la VPS / VDS); plain: la VPS / VDS por http (el equipo rechazó su certificado)
export function hlsLink(e: Engine, url: string, a: number, t: number, opts: { video?: boolean; plain?: boolean } = {}): string {
  return e.base + FILE + '?do=hls&token=' + encodeURIComponent(e.token) + '&u=' + b64u(url) + '&a=' + a + '&t=' + Math.max(0, Math.floor(t)) + '&lang=' + lang()
    + (opts.video ? '&v=1' : '') + (opts.plain ? '&plain=1' : '');
}

// subtítulo s del archivo en WebVTT (o = segundos que se adelanta)
export function subLink(e: Engine, url: string, s: number, o = 0): string {
  return e.base + FILE + '?do=sub&token=' + encodeURIComponent(e.token) + '&u=' + b64u(url) + '&s=' + s + '&o=' + Math.max(0, Math.floor(o)) + '&lang=' + lang();
}

// ¿ya está listo el subtítulo? (la primera vez el panel lee el archivo entero: puede tardar)
// denied: el motor dijo que no (sin permiso / no compatible): no se vuelve a preguntar
export async function subCheck(e: Engine, url: string, s: number): Promise<{ ready: boolean; partial: boolean; failed: boolean; denied: string }> {
  const r = await http(subLink(e, url, s) + '&check=1', { timeout: 15000 });
  const j = json(r);
  const out = { ready: false, partial: false, failed: (r.code >= 400 && r.code < 500) || r.code === 501 || r.code === 503, denied: '' };
  if (r.code === 503 || r.code === 501) {
    out.denied = engineError(r.body, t('No compatible con el dispositivo'));
    markDenied(out.denied);
  }
  if (j && typeof j === 'object') {
    out.ready = j.ready === true;
    // a medio leer: el panel ya da lo leído hasta ahora
    out.partial = j.partial === true;
    out.failed = out.failed || j.failed === true;
  }
  if (r.code === 401) forgetEngine();
  return out;
}

export async function subText(e: Engine, url: string, s: number): Promise<string> {
  const r = await http(subLink(e, url, s), { timeout: 30000 });
  return r.ok ? r.body : '';
}

// mensaje de error del panel ({"error": "..."})
export function engineError(body: string, fallback: string): string {
  try {
    return str(JSON.parse(body)?.error) || fallback;
  } catch {
    return fallback;
  }
}

// ---------- idiomas del archivo recordados por el panel (api/tracks.php) ----------

// lo que ya leyó otro equipo (o este) de este video; null si el panel no lo tiene o tarda más de 2 s
async function savedTracks(url: string): Promise<Probe | null> {
  const r = await Promise.race([cloud('tracks.php', 'GET', { u: b64u(url) }), new Promise<null>(ok => setTimeout(() => ok(null), 2000))]);
  const p = r ? json(r)?.probe : null;
  if (!p || !Array.isArray(p.audio) || !Array.isArray(p.subs) || (p.container !== 'mkv' && p.container !== 'mp4')) return null;
  return { ok: true, container: p.container, audio: p.audio, subs: p.subs };
}

const known = new Map<string, Promise<Probe>>();

// lo ya leído o recibido mientras la app está abierta (sin el protocolo: el mismo archivo por http o https es el
// mismo). Como el tmp: de Roku: solo en memoria, se borra al cerrar la app; lo que dura es lo que guarda el panel
// (api/tracks.php, por distribuidor: de 1 mes a nunca según lo que elija el dueño, hasta 3 meses un distribuidor)
const done = new Map<string, Probe>();
const noScheme = (u: string) => u.replace(/^https?:\/\//i, '');
function remember(url: string, p: Probe): void {
  done.set(noScheme(url), p);
  if (done.size > 200) done.delete(done.keys().next().value as string);
}
function local(url: string): Probe | null {
  return done.get(noScheme(url)) || null;
}

// idiomas ya sabidos en este momento, sin esperar nada (lo leído en el equipo o lo que ya contestó el panel)
export function knownNow(url: string): Probe | null {
  return local(url);
}

// pedidos al panel en curso (la ficha los pide al entrar y el reproductor espera ese mismo pedido)
const asking = new Map<string, Promise<Probe>>();

// Idiomas que ya se saben SIN tocar el servidor IPTV: lo leído antes en este equipo o lo que recuerda el panel
// (tracks.php, como mucho 2 s). Es lo único que se pide antes de abrir el video: leer el archivo antes (varias
// peticiones seguidas) hacía que muchos servidores bloquearan la línea un rato y el video quedaba cargando sin fin.
export async function knownTracks(url: string): Promise<Probe> {
  const hit = local(url);
  if (hit) return hit;
  const k = noScheme(url);
  let p = asking.get(k);
  if (!p) {
    p = savedTracks(url).then(sv => {
      if (sv) remember(url, sv);
      return sv || { ok: false, container: '', audio: [], subs: [] };
    });
    asking.set(k, p);
    p.finally(() => asking.delete(k));
  }
  return p;
}

// la ficha de la película o serie pide los idiomas apenas se abre (como Roku): al pulsar Reproducir ya se saben y el
// video empieza con el idioma elegido
export function warmTracks(url: string): void {
  knownTracks(url).catch(() => {});
}

// idiomas de audio y subtítulos del archivo: primero lo ya sabido; si no, se leen de la cabecera del archivo (con el
// video ya abierto) y se le dejan al panel para los demás equipos. skipKnown: ya se preguntó al panel al abrir.
export function fileTracks(url: string, skipKnown = false): Promise<Probe> {
  const hit = known.get(url);
  if (hit) return hit;
  const p = (async () => {
    const have = skipKnown ? local(url) : await knownTracks(url).then(k => (k.ok ? k : null));
    if (have) return have;
    const read = await probeTracks(url);
    if (read.ok) remember(url, read);
    if (read.ok) cloud('tracks.php', 'POST', { u: b64u(url), probe: { container: read.container, audio: read.audio, subs: read.subs } }).catch(() => {});
    return read;
  })();
  known.set(url, p);
  p.then(res => { if (!res.ok) known.delete(url); });
  if (known.size > 40) known.delete(known.keys().next().value as string);
  return p;
}
