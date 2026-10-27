// Listas HLS (.m3u8): dirección absoluta de cada línea y lectura de la lista (calidades, segmentos con su número,
// duración objetivo, fin, fMP4, cifrado). Sin nada del reproductor, para usarlo en el lector en vivo y en las pruebas.
// key: segmento cifrado con AES-128 (#EXT-X-KEY, lo usan muchos servidores XUI): dirección de la llave y su IV (sin IV,
// el número del segmento)
export type SegKey = { uri: string; iv: string };
export type Seg = { seq: number; url: string; dur: number; key?: SegKey };

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
export function parseList(body: string, base: string): { master: string; segs: Seg[]; target: number; ended: boolean; fmp4: boolean; sampleAes: boolean } {
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
  let sampleAes = false;
  let key: SegKey | undefined;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = parseInt(line.slice(22), 10) || 0;
    else if (line.startsWith('#EXT-X-TARGETDURATION:')) target = parseFloat(line.slice(22)) || 6;
    else if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8)) || 0;
    else if (line.startsWith('#EXT-X-MAP')) fmp4 = true;
    else if (line.startsWith('#EXT-X-KEY:')) {
      const method = ((line.match(/METHOD=([A-Z0-9-]+)/i) || [])[1] || '').toUpperCase();
      const uri = (line.match(/URI="([^"]*)"/i) || [])[1] || '';
      const iv = (line.match(/IV=0x([0-9a-f]+)/i) || [])[1] || '';
      if (method === 'AES-128' && uri) key = { uri: resolveUrl(base, uri), iv };
      else {
        key = undefined;
        if (method && method !== 'NONE') sampleAes = true;
      }
    }
    else if (line === '#EXT-X-ENDLIST') ended = true;
    else if (line && !line.startsWith('#')) segs.push({ seq: seq++, url: resolveUrl(base, line), dur, ...(key ? { key } : {}) });
  }
  return { master: best, segs, target, ended, fmp4, sampleAes };
}

// IV de un segmento cifrado: el de la lista o, si no trae, su número en 16 bytes (big-endian), como dice HLS
export function segIv(seg: Seg): Uint8Array {
  const out = new Uint8Array(16);
  const hex = (seg.key?.iv || '').padStart(32, '0').slice(-32);
  if (seg.key?.iv) {
    for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
    return out;
  }
  let n = seg.seq;
  for (let i = 15; i >= 12 && n > 0; i--) {
    out[i] = n & 255;
    n = Math.floor(n / 256);
  }
  return out;
}

// dónde empieza el MPEG-TS dentro del segmento (byte 0x47 cada 188): -1 si no es MPEG-TS
export function tsStart(d: Uint8Array): number {
  const max = Math.min(d.length - 1, 4096);
  for (let o = 0; o <= max; o++) {
    if (d[o] !== 0x47) continue;
    if (o + 188 >= d.length || d[o + 188] === 0x47) {
      if (o + 376 >= d.length || d[o + 376] === 0x47) return o;
    }
  }
  return -1;
}

// Primer PTS del segmento MPEG-TS en segundos (el menor entre el primer audio y el primer video), o null si no se
// encuentra. Con él el lector pone cada segmento a continuación del anterior en la línea de tiempo del reproductor
// (timestampOffset): segmentos seguidos de un mismo canal quedan pegados, sin huecos que saltar.
export function tsFirstPts(d: Uint8Array): number | null {
  const seen = new Set<number>();
  let min = Infinity;
  const last = Math.min(d.length - 188, 188 * 600);
  for (let i = 0; i <= last; i += 188) {
    if (d[i] !== 0x47 || !(d[i + 1] & 0x40)) continue;
    const pid = ((d[i + 1] & 0x1f) << 8) | d[i + 2];
    if (seen.has(pid)) continue;
    const afc = (d[i + 3] >> 4) & 3;
    if (afc === 0 || afc === 2) continue;
    const p = i + 4 + (afc === 3 ? 1 + d[i + 4] : 0);
    if (p + 14 > i + 188 || d[p] !== 0 || d[p + 1] !== 0 || d[p + 2] !== 1) continue;
    const sid = d[p + 3];
    // audio (0xC0-0xDF), video (0xE0-0xEF) o privado (AC-3 / E-AC-3)
    if (!((sid >= 0xc0 && sid <= 0xef) || sid === 0xbd) || !(d[p + 7] & 0x80)) continue;
    seen.add(pid);
    const b = p + 9;
    const pts = (d[b] & 0x0e) * 536870912 + d[b + 1] * 4194304 + (d[b + 2] & 0xfe) * 16384 + d[b + 3] * 128 + (d[b + 4] >> 1);
    if (pts < min) min = pts;
    if (seen.size >= 2) break;
  }
  return min === Infinity ? null : min / 90000;
}
