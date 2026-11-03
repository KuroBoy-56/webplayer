// Qué contesta el servidor IPTV a un video que el reproductor no abrió (igual que streamCheck de Roku): el código HTTP
// (una lectura de 2 bytes, la conexión se corta al momento), el estado de la cuenta (línea activa, conexiones en uso)
// y, si es una película, si sigue en el servidor y con qué extensión (get_vod_info: el catálogo guardado pudo quedar
// viejo: la película se borró o ahora es otro tipo de archivo).
import { api } from '../api/xtream';
import { Session } from '../api/panel';
import { http, json, UA } from '../lib/http';
import { str } from '../lib/util';
import { xuiError } from '../lib/xui';

// xui: el código que da XUI.one en «Debug Mode» (contesta 200 con una página HTML en lugar del video: INVALID_STREAM_ID,
// STREAM_OFFLINE, BLOCKED_USER_AGENT…) y su texto; html: el servidor devolvió una página en lugar del video
export type StreamCheck = { code: number; type?: string; html?: boolean; page?: string; xui?: string; xuiText?: string; status?: string; active?: number; max?: number; exists?: boolean; ext?: string; moved?: string; size?: number; ranges?: string };

export { xuiError };

// moved: otro servidor al que redirige; size: tamaño total (Content-Range); ranges: Accept-Ranges (para el reporte)
async function statusOf(url: string): Promise<{ code: number; type: string; body: string; moved?: string; size?: number; ranges?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-1', Connection: 'close' }, signal: ctrl.signal });
    const type = r.headers.get('content-type') || '';
    const extra = {
      moved: r.redirected && r.url ? r.url.replace(/^(https?:\/\/[^/]+).*$/i, '$1') : undefined,
      size: Number((r.headers.get('content-range') || '').split('/')[1]) || undefined,
      ranges: r.headers.get('accept-ranges') || undefined,
    };
    // una página en lugar del video: se lee (es corta) para saber el motivo
    if (/text\/html/i.test(type)) return { code: r.status, type, body: (await r.text()).slice(0, 20000), ...extra };
    ctrl.abort(); // solo el código: nada del video
    return { code: r.status, type, body: '', ...extra };
  } catch {
    return { code: 0, type: '', body: '' };
  } finally {
    clearTimeout(timer);
  }
}

// account: la cuenta también cuando el servidor sí entregó (canales: para el reporte)
export async function streamCheck(url: string, s: Session, movieId: string, account = false): Promise<StreamCheck> {
  const st = await statusOf(url);
  const out: StreamCheck = { code: st.code, type: st.type, moved: st.moved, size: st.size, ranges: st.ranges };
  if (st.body) {
    out.html = true;
    // el texto de la página (sin etiquetas), para el reporte
    out.page = st.body.replace(/<(style|script)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
    const x = xuiError(st.body);
    if (x) {
      out.xui = x.code;
      out.xuiText = x.text;
    }
  }
  if (out.code < 400 && !out.html && !account) return out;
  const acc = json(await http(api(s), { timeout: 10000 }));
  if (acc && typeof acc === 'object' && acc.user_info && typeof acc.user_info === 'object') {
    out.status = str(acc.user_info.status).toLowerCase();
    out.active = Number(acc.user_info.active_cons) || 0;
    out.max = Number(acc.user_info.max_connections) || 0;
  }
  if (movieId) {
    const vi = json(await http(api(s, 'get_vod_info', '&vod_id=' + encodeURIComponent(movieId)), { timeout: 10000 }));
    if (vi && typeof vi === 'object') {
      const md = vi.movie_data && typeof vi.movie_data === 'object' && !Array.isArray(vi.movie_data) ? vi.movie_data : null;
      out.exists = !!md && str(md.stream_id) !== '';
      if (md) out.ext = str(md.container_extension).toLowerCase();
    }
  }
  return out;
}
