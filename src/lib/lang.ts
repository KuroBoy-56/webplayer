// Nombres de idiomas y códecs de las pistas de audio y subtítulos (igual que PlayerTracks.brs de Roku).
import { Key, t } from './i18n';

const THREE: Record<string, string> = { spa: 'es', eng: 'en', por: 'pt', fre: 'fr', fra: 'fr', ger: 'de', deu: 'de', ita: 'it', jpn: 'ja', kor: 'ko' };

// código de 2 letras (spa, es, es-419 -> es); '' si no se sabe
export function langKey(code: string): string {
  const c = (code || '').toLowerCase().trim();
  if (!c || c === 'und') return '';
  if (THREE[c]) return THREE[c];
  return c.slice(0, 2);
}

export function sameLang(a: string, b: string): boolean {
  const ka = langKey(a);
  return ka !== '' && ka === langKey(b);
}

// se traducen al mostrarlos (t)
const NAMES: Record<string, Key> = {
  es: 'Español',
  en: 'Inglés',
  pt: 'Portugués',
  fr: 'Francés',
  de: 'Alemán',
  it: 'Italiano',
  ja: 'Japonés',
  ko: 'Coreano',
};

// Solo el idioma: "Español latino", "Inglés"… (nada de códecs ni números técnicos). Idioma desconocido:
// su nombre si es una palabra corta, si no el código (FR, HIN); '' si no hay nada que mostrar.
export function langName(code: string, name: string): string {
  const n = (name || '').toLowerCase().trim();
  const k = langKey(code) || langKey(guessLang(name));
  if (NAMES[k]) {
    if (k === 'es' && n.includes('lat')) return t('Español latino');
    if (k === 'es' && (n.includes('cast') || n.includes('spain') || n.includes('españa'))) return t('Español de España');
    return t(NAMES[k]);
  }
  const nm = (name || '').trim();
  // sin \p{L}: los navegadores de televisores viejos no lo entienden
  if (nm && nm.length <= 16 && !/[0-9.,:;()[\]/\\#_+=|-]/.test(nm)) return nm;
  const c = (code || '').trim();
  if (/^[a-z]{2,3}$/i.test(c) && c.toLowerCase() !== 'und') return c.toUpperCase();
  return '';
}

// dos pistas con el mismo nombre: "Inglés", "Inglés 2"
export function numbered<T extends { label: string }>(items: T[]): T[] {
  const seen: Record<string, number> = {};
  return items.map(it => {
    const c = (seen[it.label] = (seen[it.label] || 0) + 1);
    return c > 1 ? { ...it, label: it.label + ' ' + c } : it;
  });
}

// pistas sin código de idioma pero con nombre ("Latino", "English")
function guessLang(name: string): string {
  const n = (name || '').toLowerCase().trim();
  if (/\b(latino|español|espanol|castellano|spanish)\b/.test(n)) return 'es';
  if (/\b(english|inglés|ingles)\b/.test(n)) return 'en';
  if (/\b(portugu[eê]s|portuguese)\b/.test(n)) return 'pt';
  return '';
}

// idioma de una pista: el código o, si no trae, lo que diga su nombre
export function trackLang(code: string, name: string): string {
  return langKey(code) || guessLang(name);
}

// códec normalizado: aac, ac3, eac3, dts, truehd, mp3, opus, flac, pcm, vorbis o el original
export function codecKey(codec: string): string {
  const l = (codec || '').toLowerCase();
  if (!l) return '';
  if (l.includes('truehd') || l === 'mlpa') return 'truehd';
  if (l.startsWith('a_eac3') || l === 'ec-3' || l === 'ec3' || l === 'eac3') return 'eac3';
  if (l.startsWith('a_ac3') || l === 'ac-3' || l === 'ac3') return 'ac3';
  if (l.startsWith('a_dts') || l.startsWith('dts')) return 'dts';
  if (l.startsWith('a_aac') || l === 'mp4a' || l.includes('aac')) return 'aac';
  if (l.startsWith('a_mpeg') || l.includes('mp3') || l === '.mp3') return 'mp3';
  if (l.includes('opus')) return 'opus';
  if (l.includes('flac')) return 'flac';
  if (l.startsWith('a_pcm') || l === 'lpcm' || l === 'ipcm' || l === 'sowt' || l === 'twos') return 'pcm';
  if (l.includes('vorbis')) return 'vorbis';
  return l;
}

export function codecName(codec: string): string {
  const k = codecKey(codec);
  const names: Record<string, string> = {
    aac: 'AAC',
    ac3: 'Dolby AC3',
    eac3: 'Dolby E-AC3',
    dts: 'DTS',
    truehd: 'Dolby TrueHD',
    mp3: 'MP3',
    opus: 'Opus',
    flac: 'FLAC',
    pcm: 'PCM',
    vorbis: 'Vorbis',
  };
  return names[k] || (codec || '').toUpperCase();
}

// subtítulos de imagen (no se pueden convertir a texto)
export function imageSub(codec: string): boolean {
  const c = (codec || '').toUpperCase();
  return c.includes('PGS') || c.includes('VOBSUB') || c.includes('DVB') || c.includes('HDMV');
}
