// Carátulas y fondos por el panel (igual que Roku): una sola copia de cada imagen, lista en el panel.
// Orden de una carátula: la copia pública del panel (api/imgc/<sha1>.jpg, la sirve el servidor web sin PHP),
// después api/img.php (la achica la primera vez; con el título busca el póster en TMDB si el servidor IPTV no tiene)
// y al final la dirección original. Fondos de TMDB en Full HD hechos por el panel (el original pesa hasta 10 veces
// más). Si el dueño apagó la caché (Tmdb Settings, "img": false de progress.php ?v=2) todo va directo al servidor
// IPTV y a TMDB, sin pasar por el panel y sin avisar nada.
import { sha1 } from '@noble/hashes/sha1';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { panelApiBase, panelScheme } from '../api/panel';
import { read, write } from './storage';
import { scoped } from './tenant';

export function imgCacheOn(): boolean {
  return read('img_cache') !== '0';
}

// lo que dice el panel (progress.php ?v=2): se guarda y vale desde las próximas carátulas
export function setImgCache(on: boolean): void {
  const v = on ? '1' : '0';
  if (read('img_cache') !== v) write('img_cache', v);
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// base64url sin "=" de los bytes UTF-8 (lo mismo que decodifica api/img.php)
function b64u(s: string): string {
  const b = utf8ToBytes(s);
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < b.length) out += B64[(n >> 6) & 63];
    if (i + 2 < b.length) out += B64[n & 63];
  }
  return out;
}

function hex1(s: string): string {
  return bytesToHex(sha1(utf8ToBytes(s)));
}

// "https://panel/api/" con el esquema que contestó; "" sin panel, sin token o con la caché apagada
function apiBase(): string {
  if (!imgCacheOn() || !read(scoped('cloud_token2'))) return '';
  let b = panelApiBase();
  if (b && panelScheme() === 'http') b = b.replace(/^https:/i, 'http:');
  return b;
}

const isTmdb = (u: string) => u.includes('image.tmdb.org/');
const isHttp = (u: string) => /^https?:\/\//i.test(u);
const year4 = (y: string) => (/^(19|20)\d\d$/.test(y) ? y : '');

/** direcciones de la carátula, en orden (la tarjeta pasa a la siguiente si una no carga) */
export function posterSources(kind: string, poster: string, name: string, year: string): string[] {
  const out: string[] = [];
  const b = apiBase();
  const media = kind === 'vod' || kind === 'series' || kind === 'movie';
  // logos de canales y carátulas de TMDB: directo (ya son livianos)
  if (b && media && !isTmdb(poster) && (isHttp(poster) || name)) {
    const y = year4(year);
    const key = poster ? '500|' + poster : '500|n|' + (kind === 'series' ? 'series' : 'vod') + '|' + name.trim() + '|' + y;
    // ?v=2: el panel vació la caché (los pósteres de TMDB de antes podían ser de otra película); con la misma
    // dirección el equipo seguiría mostrando la imagen vieja que guardó por 30 días
    out.push(b + 'imgc/' + hex1(key) + '.jpg?v=2');
    let u = b + 'img.php?w=500&v=2&token=' + encodeURIComponent(read(scoped('cloud_token2')));
    if (poster) u += '&u=' + b64u(poster);
    if (name) u += '&k=' + (kind === 'series' ? 'series' : 'vod') + '&n=' + b64u(name.trim()) + (y ? '&y=' + y : '');
    out.push(u);
  }
  if (poster && !out.includes(poster)) out.push(poster);
  return out;
}

/** fondo: el de TMDB en Full HD hecho por el panel y, si falla, el de siempre */
export function backdropSources(url: string): string[] {
  if (!url) return [];
  const b = apiBase();
  if (!b || !isTmdb(url)) return [url];
  const orig = url.replace(/(image\.tmdb\.org\/t\/p\/)[^/]+\//, '$1original/');
  return [b + 'img.php?w=1920&token=' + encodeURIComponent(read(scoped('cloud_token2'))) + '&u=' + b64u(orig), url];
}
