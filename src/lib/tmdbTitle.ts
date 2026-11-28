// Título de una película o serie del servidor IPTV tal como lo entiende TMDB (fondos, sinopsis y reparto). La misma
// regla que el panel (includes/title_clean.php, api/img.php), Roku (nfTmdbParse) y Android (Tmdb.clean); casos en
// tools/title_clean_vectors.json:
//   "ES - Avatar (2009) [4K] | LAT" -> {q: "Avatar", y: "2009"}; "NETFLIX - Stranger Things S01" -> "Stranger Things";
//   "The.Matrix.1999.1080p" -> "The Matrix"; «Mission: Impossible - Dead Reckoning» se queda; «1917 (2019)» -> «1917».
// Sin lookbehind ni \p{…}: los televisores viejos (webOS 3/4, Tizen 2017) no los entienden.

// letras (latinas con acentos, griego, cirílico, hebreo, árabe, japonés, chino, coreano) y números
const W = 'A-Za-z0-9À-ɏͰ-ϿЀ-ӿ֐-׿؀-ۿ぀-ヿ一-鿿가-힯';
const TAG = new RegExp('^(4k|8k|uhd|fhd|hd|sd|hq|lat|latino|latam|sub|subs|subt|subtitulad[oa]|esp|es|en|eng|spa|mx|us|ar|co|cl|pe|br|pt|fr|de|it|uk|ve|ec|uy|py|bo|cr|pa|gt|hn|sv|do|pr|dual|multi|multi ?audio|dub|dublad[oa]|legendad[oa]|castellano|espa[nñ]ol|ingl[eé]s|vose|vos|vo|cam|ts|hdr|hdr10|dv|hevc|[xh]26[45]|web|web-?dl|webrip|bluray|brrip|dvdrip|hdtv|remux|imax|vip|new|nuevo|nueva|estreno|premiere|netflix|amazon|prime|prime video|disney|disney\\+|hbo|hbo max|max|apple|apple tv\\+?|paramount\\+?|star\\+|\\d{3,4}p|(19|20)\\d\\d|[st]\\d{1,2})$', 'i');
const JUNK = new RegExp('(^|[^' + W + '])(4k|8k|uhd|fhd|hd|sd|hdr10|hdr|1080p|720p|2160p|480p|hevc|[xh]26[45]|10bit|web-?dl|webrip|bluray|brrip|dvdrip|hdtv|hdcam|remux|lat|latino|castellano|subtitulad[oa]|sub|esp|dual|multi|dublad[oa]|legendad[oa]|vose)(?=$|[^' + W + '])', 'gi');
const SEASON_EP = new RegExp('(^|[^' + W + '])s\\d{1,2}\\s*e\\d{1,3}(?=$|[^' + W + '])', 'gi');
const SEASON_END = /\s+(s\d{1,2}|t\d{1,2}|(temporada|season|saison)\s*\d{1,2})\s*$/i;
const BRACKETS = /\([^)]*\)|\[[^\]]*\]|\{[^}]*\}/g;
const DECOR = new RegExp("[^" + W + "\\s'’&:!?¿¡.,+#\\-–—|/]", 'g');
const WORD = new RegExp('[' + W + ']');

export function tmdbTitle(raw: string): { q: string; y: string } {
  let s = (raw || '').trim();
  // año: el de entre paréntesis o corchetes; si no, uno suelto (el último)
  let y = '';
  const box = s.match(/[([]\s*((?:19|20)\d\d)\s*[)\]]/);
  if (box) y = box[1];
  else {
    const re = new RegExp('(^|[^' + W + '])((?:19|20)\\d\\d)(?=$|[^' + W + '])', 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) y = m[2];
  }
  // "The.Matrix.1999.1080p" (sin espacios): los puntos y guiones bajos separan palabras
  if (s.indexOf(' ') < 0 && /[._]/.test(s)) s = s.replace(/[._]+/g, ' ');
  let t = s.replace(BRACKETS, ' ').replace(DECOR, ' ');
  // "|LAT| Avatar", "4K| Avatar", "ES: Avatar"
  t = t.replace(/^\s*\|?\s*[A-Z0-9+À-Þ]{2,5}\s*\|\s*/, '').replace(/^\s*[A-ZÀ-Þ]{2,4}\s*:\s+/, '');
  // "ES - Titanic", "Avatar | LAT", "NETFLIX - Stranger Things": fuera las partes que son solo etiquetas
  for (const sep of ['|', ' - ', ' – ', ' — ']) {
    if (t.indexOf(sep) < 0) continue;
    const keep = t.split(sep).map(p => p.trim()).filter(p => p !== '' && !TAG.test(p));
    if (keep.length) t = keep.join(sep === '|' ? ' ' : ' - ');
  }
  t = t.split('|').join(' ').replace(SEASON_EP, '$1 ').replace(SEASON_END, ' ').replace(JUNK, '$1 ');
  // el año sale del título salvo que sea todo el título («1917», «2012»)
  if (y) {
    const no = t.replace(new RegExp('(^|[^' + W + '])' + y + '(?=$|[^' + W + '])', 'g'), '$1 ').trim();
    if (WORD.test(no)) t = no;
  }
  t = t.replace(/\s+/g, ' ').replace(/^[\s\-–—:·,./]+|[\s\-–—:·,/]+$/g, '');
  if (!t) t = (raw || '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  return { q: t, y };
}

/** la primera parte de «Título - Subtítulo» (o '') */
export function tmdbFirstPart(q: string): string {
  const p = q.split(' - ');
  return p.length > 1 && p[0].trim().length >= 3 ? p[0].trim() : '';
}
