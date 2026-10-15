// Motor del panel para webOS (api/media_webos.php): cuando el reproductor del equipo no puede cambiar
// el audio de un archivo o no sabe decodificarlo (DTS, TrueHD…), el panel lo prepara con ffmpeg
// (video sin cambios + ese audio en AAC, HLS desde el segundo pedido); los subtítulos del archivo
// que el equipo no muestra llegan como WebVTT. Mismo contrato que media.php de Roku.
import { b64Encode } from '../lib/crypto';
import { http, json } from '../lib/http';
import { str } from '../lib/util';
import { cloudToken, panel, panelApiBase, panelScheme } from './panel';
import { lang, t } from '../lib/i18n';

const FILE = 'media_webos.php';

export type Engine = { base: string; token: string };

let cached: Engine | null = null;

// dirección del panel con el esquema que funciona, token de la línea y si el panel tiene ffmpeg
export async function mediaEngine(): Promise<{ ok: true; engine: Engine } | { ok: false; error: string }> {
  if (cached) return { ok: true, engine: cached };
  let base = panelApiBase();
  if (!base) return { ok: false, error: t('No se encontró el panel') };
  const token = await cloudToken();
  if (!token) return { ok: false, error: t('No se pudo validar tu línea con el panel.') };
  // con el token el panel dice también si el distribuidor de la línea tiene ffmpeg activado
  const st = await panel(FILE, 'GET', '', '', '?do=status&token=' + encodeURIComponent(token));
  const j = json(st);
  if (st.code === 0) return { ok: false, error: t('No se pudo conectar con el panel.') };
  if (st.code === 404 || !j) return { ok: false, error: t('El panel todavía no tiene el motor de audio y subtítulos (actualízalo).') };
  if (j.ffmpeg !== true) return { ok: false, error: t('El cambio de idioma desde el panel no está disponible.') };
  if (panelScheme() === 'http') base = base.replace(/^https:/i, 'http:');
  cached = { base, token };
  return { ok: true, engine: cached };
}

// el token cambió (401): se pide otro la próxima vez
export function forgetEngine(): void {
  cached = null;
}

function b64u(s: string): string {
  return b64Encode(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// HLS con el audio a (orden en el archivo) desde el segundo t
export function hlsLink(e: Engine, url: string, a: number, t: number): string {
  return e.base + FILE + '?do=hls&token=' + encodeURIComponent(e.token) + '&u=' + b64u(url) + '&a=' + a + '&t=' + Math.max(0, Math.floor(t)) + '&lang=' + lang();
}

// subtítulo s del archivo en WebVTT (o = segundos que se adelanta)
export function subLink(e: Engine, url: string, s: number, o = 0): string {
  return e.base + FILE + '?do=sub&token=' + encodeURIComponent(e.token) + '&u=' + b64u(url) + '&s=' + s + '&o=' + Math.max(0, Math.floor(o)) + '&lang=' + lang();
}

// ¿ya está listo el subtítulo? (la primera vez el panel lee el archivo entero: puede tardar)
export async function subCheck(e: Engine, url: string, s: number): Promise<{ ready: boolean; failed: boolean; code: number }> {
  const r = await http(subLink(e, url, s) + '&check=1', { timeout: 15000 });
  const j = json(r);
  const out = { ready: false, failed: r.code === 404 || r.code === 403 || r.code === 501, code: r.code };
  if (j && typeof j === 'object') {
    out.ready = j.ready === true;
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
