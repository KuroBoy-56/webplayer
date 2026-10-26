// Listas HLS (.m3u8): dirección absoluta de cada línea y lectura de la lista (calidades, segmentos con su número,
// duración objetivo, fin, fMP4). Sin nada del reproductor, para usarlo en el lector en vivo y en las pruebas.
export type Seg = { seq: number; url: string; dur: number };

// dirección absoluta de una línea de la lista (relativa a la lista, a la raíz del servidor o completa)
export function resolveUrl(base: string, ref: string): string {
  if (/^https?:\/\//i.test(ref)) return ref;
  const m = base.match(/^(https?:\/\/[^/?#]+)([^?#]*)/i);
  if (!m) return ref;
  if (ref.startsWith('//')) return base.split(':')[0] + ':' + ref;
  if (ref.startsWith('/')) return m[1] + ref;
  return m[1] + m[2].slice(0, m[2].lastIndexOf('/') + 1) + ref;
}

// lista de un canal: segmentos con su número; master = lista de calidades (se usa la de más ancho de banda)
export function parseList(body: string, base: string): { master: string; segs: Seg[]; target: number; ended: boolean; fmp4: boolean } {
  const lines = body.split(/\r?\n/).map(l => l.trim());
  let best = '';
  let bw = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const b = Number((lines[i].match(/BANDWIDTH=(\d+)/i) || [])[1]) || 0;
    const next = lines.slice(i + 1).find(l => l && !l.startsWith('#'));
    if (next && b > bw) {
      bw = b;
      best = resolveUrl(base, next);
    }
  }
  const segs: Seg[] = [];
  let seq = 0;
  let dur = 0;
  let target = 6;
  let ended = false;
  let fmp4 = false;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = parseInt(line.slice(22), 10) || 0;
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) target = parseFloat(line.slice(22)) || 6;
    else if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8)) || 0;
    else if (line.startsWith('#EXT-X-MAP')) fmp4 = true;
    else if (line === '#EXT-X-ENDLIST') ended = true;
    else if (line && !line.startsWith('#')) segs.push({ seq: seq++, url: resolveUrl(base, line), dur });
  }
  return { master: best, segs, target, ended, fmp4 };
}
