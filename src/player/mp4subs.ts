// Subtítulos de texto dentro de un MP4 (2.1.0): tx3g / mov_text (los que deja ffmpeg al convertir), el texto de
// QuickTime y WebVTT en MP4 (wvtt). El lector de MP4 los saca de lo que ya baja (vienen intercalados con el video y el
// audio) y los muestra la app, sin el servidor (antes los preparaba el panel en la VPS). Los de imagen no.
import { str } from './mkvparse';
import type { Cue } from '../lib/vtt';

// manejadores de pista de subtítulos y descripciones que se leen
export const SUB_HANDLERS = new Set(['sbtl', 'text', 'subt']);
export const SUB_ENTRIES = new Set(['tx3g', 'text', 'wvtt']);

const u16 = (b: Uint8Array, o: number) => (b[o] << 8) + b[o + 1];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];
const typ = (b: Uint8Array, o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

function utf16be(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i] << 8) | b[i + 1]);
  return s;
}

// sin etiquetas de estilo (<i>, <font …>, {\an8} de ASS) ni espacios de más
export function cleanText(s: string): string {
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(x => x.trim())
    .filter(Boolean)
    .join('\n');
}

// texto de una muestra; '' = sin texto (borra lo que había)
export function sampleText(entry: string, d: Uint8Array): string {
  if (entry === 'wvtt') {
    const out: string[] = [];
    for (let o = 0; o + 8 <= d.length; ) {
      const n = u32(d, o);
      if (n < 8 || o + n > d.length) break;
      if (typ(d, o + 4) === 'vttc') {
        for (let p = o + 8; p + 8 <= o + n; ) {
          const m = u32(d, p);
          if (m < 8 || p + m > o + n) break;
          if (typ(d, p + 4) === 'payl') out.push(str(d.subarray(p + 8, p + m)));
          p += m;
        }
      }
      o += n;
    }
    return cleanText(out.join('\n'));
  }
  // tx3g / text: largo (2 bytes) y el texto (UTF-8, o UTF-16 con su marca)
  if (d.length < 2) return '';
  const len = Math.min(u16(d, 0), d.length - 2);
  const b = d.subarray(2, 2 + len);
  const text = b.length >= 2 && b[0] === 0xfe && b[1] === 0xff ? utf16be(b.subarray(2)) : str(b);
  return cleanText(text);
}

// agrega un texto en orden (cueAt busca por mitades)
export function addCue(list: Cue[], c: Cue): void {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].s <= c.s) lo = mid + 1;
    else hi = mid;
  }
  list.splice(lo, 0, c);
}
