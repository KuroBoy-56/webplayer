// Utilidades compartidas (mismo comportamiento que la web, Android y Roku).
import { lang, t } from './i18n';

export function str(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return '';
}

export function int(v: unknown): number {
  const n = parseInt(str(v), 10);
  return Number.isFinite(n) ? n : 0;
}

export function float(v: unknown): number {
  const n = parseFloat(str(v));
  return Number.isFinite(n) ? n : 0;
}

export function digits(s: string): string {
  return s.replace(/[^0-9]/g, '');
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

const ACCENTS: Record<string, string> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a',
  é: 'e', è: 'e', ë: 'e', ê: 'e',
  í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
  ú: 'u', ù: 'u', ü: 'u', û: 'u',
  ñ: 'n', ç: 'c',
};

// minúsculas y sin acentos (fold() de la web)
export function fold(s: string): string {
  return s.toLowerCase().replace(/[áàäâãéèëêíìïîóòöôõúùüûñç]/g, c => ACCENTS[c] || c);
}

// minúsculas, sin acentos y todo lo que no sea [a-z0-9] -> un espacio (norm() de la web)
export function norm(s: string): string {
  return fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n);
}

// hora en el idioma de la app: "18:45" (inglés: "6:45 PM")
function hm(h: number, m: number): string {
  if (lang() === 'en') return (h % 12 || 12) + ':' + pad2(m) + (h < 12 ? ' AM' : ' PM');
  return pad2(h) + ':' + pad2(m);
}

// fecha en el idioma de la app: "13/10/2026" (inglés: "10/13/2026")
export function ymd(y: number, m: number, d: number): string {
  return lang() === 'en' ? pad2(m) + '/' + pad2(d) + '/' + y : pad2(d) + '/' + pad2(m) + '/' + y;
}

export function clock(epoch: number): string {
  const d = new Date(epoch * 1000);
  return hm(d.getHours(), d.getMinutes());
}

export function dateText(epoch: number): string {
  if (epoch <= 0) return t('Ilimitado');
  const d = new Date(epoch * 1000);
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// fecha y hora exactas del equipo: "13/10/2026 18:45"
export function dateTimeText(epoch: number): string {
  const d = new Date(epoch * 1000);
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate()) + ' ' + hm(d.getHours(), d.getMinutes());
}

// "1 hora", "2 horas", "30 minutos", "1 día"… según la duración de la demo del panel ('' si no la mandó)
export function demoLength(sec: number): string {
  if (!(sec > 0)) return '';
  if (sec % 86400 === 0) return sec === 86400 ? t('1 día') : t('{n} días', { n: sec / 86400 });
  if (sec % 3600 === 0) return sec === 3600 ? t('1 hora') : t('{n} horas', { n: sec / 3600 });
  const m = Math.round(sec / 60);
  return m === 1 ? t('1 minuto') : t('{n} minutos', { n: m });
}

// número de día local (para separar Hoy / Mañana)
export function localDay(epoch: number): number {
  const d = new Date(epoch * 1000);
  return Math.floor((epoch - d.getTimezoneOffset() * 60) / 86400);
}

// "2026-10-03T15:00:00Z" / "+00:00" / "2026-10-03 15:00:00" (UTC) -> epoch en segundos
export function parseIso(raw: string): number {
  let t = raw.trim();
  if (!t) return 0;
  if (/^\d{10}$/.test(t)) return parseInt(t, 10);
  t = t.replace(' ', 'T');
  if (!/[zZ]$|[+-]\d\d:?\d\d$/.test(t)) t += 'Z';
  const ms = Date.parse(t);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export function hms(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? h + ':' + pad2(m) + ':' + pad2(r) : m + ':' + pad2(r);
}

export function normalizeBase(u: string): string {
  let x = u.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(x)) x = 'http://' + x;
  return x;
}

export function enc(s: string): string {
  return encodeURIComponent(s);
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// categorías para adultos (se ocultan con el control parental)
const ADULT = /adult|xxx|\+18|18\+|porn|erot|playboy|hot ?club|venus/i;
export function isAdult(name: string): boolean {
  return ADULT.test(name);
}

// duración del servidor IPTV ("01:52:13", "112 min", "6720") en segundos; 0 si no se entiende. El progreso la usa
// cuando el reproductor no sabe la duración (HLS del motor del panel, que convierte por partes)
export function serverDurationSec(raw: string): number {
  const s = String(raw || '').trim().toLowerCase();
  if (/^\d+(:\d+)+$/.test(s)) return s.split(':').reduce((a, x) => a * 60 + parseInt(x, 10), 0);
  const n = parseInt(s, 10);
  if (!(n > 0)) return 0;
  return /min/.test(s) ? n * 60 : n;
}
