// Qué contesta el servidor IPTV a un video que el reproductor no abrió (igual que streamCheck de Roku): el código HTTP
// (una lectura de 2 bytes, la conexión se corta al momento), el estado de la cuenta (línea activa, conexiones en uso)
// y, si es una película, si sigue en el servidor y con qué extensión (get_vod_info: el catálogo guardado pudo quedar
// viejo: la película se borró o ahora es otro tipo de archivo).
import { api } from '../api/xtream';
import { Session } from '../api/panel';
import { http, json, UA } from '../lib/http';
import { str } from '../lib/util';

export type StreamCheck = { code: number; status?: string; active?: number; max?: number; exists?: boolean; ext?: string };

async function statusOf(url: string): Promise<number> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-1', Connection: 'close' }, signal: ctrl.signal });
    ctrl.abort(); // solo el código: nada del video
    return r.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

export async function streamCheck(url: string, s: Session, movieId: string): Promise<StreamCheck> {
  const out: StreamCheck = { code: await statusOf(url) };
  if (out.code < 400) return out;
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
