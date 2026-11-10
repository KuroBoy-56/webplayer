// Índice de las últimas películas y capítulos abiertos, guardado en el equipo (2.0.14).
//
// El índice de un MP4 (moov) pesa 5-8 MB y en los servidores IPTV va al final del archivo: bajarlo cada vez tardaba
// 15-25 s con los servidores que contestan lento (avisos «tardó en empezar»: indice=5.6MB en 24.3s). Con el índice ya
// guardado, Continuar viendo (y volver a abrir el mismo título) pide de una vez el video del segundo guardado: una sola
// espera del servidor en lugar de tres.
//
// Se guarda «adelgazado» (mp4mse.ts: el video y el audio que suena completos; de los demás idiomas solo la descripción),
// en base64, en el almacenamiento de la app con otro prefijo: storage.ts carga al iniciar todo lo de «latmpx:» y esto
// no debe cargarse ahí (son varios MB). Los 8 más recientes, 24 MB como mucho.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readJson, writeJson } from '../lib/storage';

const PREFIX = 'latmpxidx:';
const LIST = 'idx_list_1';
const MAX_ITEMS = 8;
const MAX_BYTES = 32 * 1048576; // de texto guardado (base64: ~24 MB de índices)
const MAX_ONE = 8 * 1048576;
const LOAD_MS = 2500;
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
// motivo de los lectores cuando lo guardado ya no es de este archivo (playback lo abre otra vez leyendo del servidor)
export const STALE_INDEX = 'índice guardado viejo';

// kind: 'm' = índice de MP4 (base64), 'k' = cabecera e índice de MKV (JSON); n = largo de lo guardado
type Entry = { k: string; t: number; n: number; size: number; kind?: string };

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DEC = new Uint8Array(128);
for (let i = 0; i < 64; i++) DEC[B64.charCodeAt(i)] = i;
const ENC = new Uint8Array(64);
for (let i = 0; i < 64; i++) ENC[i] = B64.charCodeAt(i);

// 4096 letras por llamada a String.fromCharCode.apply: el tope seguro en todos los motores de JavaScript (el mismo que
// usa la biblioteca «buffer»); con más, algunos fallan por demasiados argumentos
const STEP = 3 * 1024;
const block = new Uint8Array((STEP / 3) * 4);
// base64 de d[p, end) (hasta STEP bytes)
function encodeBlock(d: Uint8Array, p: number, end: number): string {
  const out = block;
  let o = 0;
  let i = p;
  for (; i + 2 < end; i += 3) {
    const n = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    out[o++] = ENC[n >> 18];
    out[o++] = ENC[(n >> 12) & 63];
    out[o++] = ENC[(n >> 6) & 63];
    out[o++] = ENC[n & 63];
  }
  if (i < end) {
    const n = (d[i] << 16) | (i + 1 < end ? d[i + 1] << 8 : 0);
    out[o++] = ENC[n >> 18];
    out[o++] = ENC[(n >> 12) & 63];
    out[o++] = i + 1 < end ? ENC[(n >> 6) & 63] : 61;
    out[o++] = 61;
  }
  return String.fromCharCode.apply(null, out.subarray(0, o) as unknown as number[]);
}

// base64 de a pedazos, cediendo el turno entre uno y otro (son varios MB: de una vez trababa la imagen)
export async function toBase64(d: Uint8Array): Promise<string> {
  const parts: string[] = [];
  for (let p = 0; p < d.length; p += STEP) {
    parts.push(encodeBlock(d, p, Math.min(d.length, p + STEP)));
    if (parts.length % 128 === 0) await sleep(0);
  }
  return parts.join('');
}

// lo mismo de una vez (datos chicos: la descripción de una pista)
export function b64(d: Uint8Array): string {
  let s = '';
  for (let p = 0; p < d.length; p += STEP) s += encodeBlock(d, p, Math.min(d.length, p + STEP));
  return s;
}

export function fromBase64(s: string): Uint8Array {
  let len = s.length;
  while (len > 0 && s.charCodeAt(len - 1) === 61) len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const n = (DEC[s.charCodeAt(i) & 127] << 18) | (DEC[s.charCodeAt(i + 1) & 127] << 12) | (DEC[s.charCodeAt(i + 2) & 127] << 6) | DEC[s.charCodeAt(i + 3) & 127];
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 255;
    out[o++] = n & 255;
  }
  if (len - i === 3) {
    const n = (DEC[s.charCodeAt(i) & 127] << 18) | (DEC[s.charCodeAt(i + 1) & 127] << 12) | (DEC[s.charCodeAt(i + 2) & 127] << 6);
    out[o++] = n >> 16;
    out[o++] = (n >> 8) & 255;
  } else if (len - i === 2) {
    const n = (DEC[s.charCodeAt(i) & 127] << 18) | (DEC[s.charCodeAt(i + 1) & 127] << 12);
    out[o++] = n >> 16;
  }
  return out;
}

// clave corta del archivo (sin http/https: el mismo archivo por los dos protocolos)
function keyOf(url: string): string {
  const u = url.replace(/^https?:\/\//i, '');
  let a = 0x811c9dc5;
  let b = 0x1b873593;
  for (let i = 0; i < u.length; i++) {
    const c = u.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x85ebca6b) + i;
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36) + u.length.toString(36);
}

function list(): Entry[] {
  const l = readJson<Entry[]>(LIST);
  return Array.isArray(l) ? l : [];
}

// ¿hay un índice guardado para este archivo? (sin leerlo)
export function hasIndex(url: string): boolean {
  const k = keyOf(url);
  return list().some(e => e.k === k);
}

export function hasIndexKind(url: string, kind: string): boolean {
  const k = keyOf(url);
  return list().some(e => e.k === k && (e.kind || 'm') === kind);
}

// lo guardado de este archivo: tamaño del archivo cuando se guardó y el texto
export async function loadText(url: string, kind: string): Promise<{ size: number; text: string } | null> {
  const k = keyOf(url);
  const e = list().find(x => x.k === k);
  if (!e || (e.kind || 'm') !== kind) return null;
  try {
    // como mucho 2,5 s: si el almacenamiento del equipo tarda, el índice se lee del servidor como antes de la 2.0.14
    // (lo guardado es un atajo; nunca puede demorar el arranque más de lo que demoraba)
    const raw = await Promise.race([AsyncStorage.getItem(PREFIX + k), new Promise<null>(r => setTimeout(() => r(null), LOAD_MS))]);
    if (!raw || raw.length !== e.n) return null;
    return { size: e.size, text: raw };
  } catch {
    return null;
  }
}

let saving: Promise<void> = Promise.resolve();

// guarda en segundo plano (una escritura a la vez); lo más viejo se borra
export function saveText(url: string, kind: string, size: number, make: () => Promise<string> | string): void {
  if (size <= 0) return;
  const k = keyOf(url);
  saving = saving.then(async () => {
    try {
      const text = await make();
      if (!text || text.length > MAX_ONE * 1.4) return;
      await AsyncStorage.setItem(PREFIX + k, text);
      let l = list().filter(e => e.k !== k);
      l.unshift({ k, t: Date.now(), n: text.length, size, kind });
      let total = 0;
      const keep: Entry[] = [];
      const drop: Entry[] = [];
      for (const e of l) {
        total += e.n;
        if (keep.length < MAX_ITEMS && total <= MAX_BYTES) keep.push(e);
        else drop.push(e);
      }
      l = keep;
      writeJson(LIST, l);
      for (const e of drop) await AsyncStorage.removeItem(PREFIX + e.k).catch(() => {});
    } catch {
      // sin lugar o sin almacenamiento: se sigue sin guardar
    }
  });
}

// índice de un MP4 (mp4mse.ts)
export async function loadIndex(url: string): Promise<{ size: number; moov: Uint8Array } | null> {
  const got = await loadText(url, 'm');
  if (!got) return null;
  try {
    return { size: got.size, moov: fromBase64(got.text) };
  } catch {
    return null;
  }
}

export function saveIndex(url: string, size: number, moov: Uint8Array): void {
  if (!moov.length || moov.length > MAX_ONE) return;
  saveText(url, 'm', size, () => toBase64(moov));
}

// el archivo cambió en el servidor (otro tamaño) o el índice guardado no sirvió
export function dropIndex(url: string): void {
  const k = keyOf(url);
  const l = list();
  if (!l.some(e => e.k === k)) return;
  writeJson(LIST, l.filter(e => e.k !== k));
  AsyncStorage.removeItem(PREFIX + k).catch(() => {});
}

// borrado de caché pedido por el panel
export function clearIndexes(): void {
  const l = list();
  writeJson(LIST, []);
  for (const e of l) AsyncStorage.removeItem(PREFIX + e.k).catch(() => {});
}
