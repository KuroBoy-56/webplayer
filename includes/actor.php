<?php
/**
 * Página de actor: filmografía de TMDB (person/{id}?append_to_response=combined_credits)
 * filtrada a los títulos que el servidor IPTV tiene de verdad.
 * Empareja por título normalizado (+ año ±1) con el catálogo cargado, igual que la app de Windows
 * (libs/shared/interfaces/src/lib/title-normalization.util.ts).
 */
if (defined('WP_ACTOR_LOADED')) {
    return;
}
define('WP_ACTOR_LOADED', true);
require_once __DIR__ . '/core.php';

const WP_TITLE_QUALITY_TAGS = ['4k', 'uhd', 'fhd', 'hd', 'sd', 'hdr', 'hevc', 'h264', 'h265', 'x264', 'x265', '480p', '720p', '1080p', '2160p',
    'multi', 'multisub', 'vostfr', 'vf', 'dubbed',
    // etiquetas de idioma habituales en los catálogos en español
    'lat', 'latino', 'castellano', 'subtitulado', 'subt', 'vose', 'dual'];

/** Sin acentos y en minúsculas (con o sin la extensión intl). */
function wp_title_fold($s)
{
    $s = (string)$s;
    if (class_exists('Normalizer')) {
        $n = Normalizer::normalize($s, Normalizer::FORM_D);
        if (is_string($n)) $s = preg_replace('/\p{Mn}+/u', '', $n);
    }
    $s = mb_strtolower($s, 'UTF-8');
    return strtr($s, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n', 'à' => 'a', 'è' => 'e',
        'ì' => 'i', 'ò' => 'o', 'ù' => 'u', 'ç' => 'c', 'â' => 'a', 'ê' => 'e', 'î' => 'i', 'ô' => 'o', 'û' => 'u', 'ä' => 'a', 'ë' => 'e',
        'ï' => 'i', 'ö' => 'o', 'ã' => 'a', 'õ' => 'o']);
}

/**
 * Título en dos niveles: exact (con el año final) y base (sin el año final), más ese año.
 * "ES - The Matrix 1999 [4K]" → exact "the matrix 1999", base "the matrix", year 1999.
 */
function wp_title_keys($raw)
{
    $raw = (string)$raw;
    if (trim($raw) === '') return ['exact' => '', 'base' => '', 'year' => null];
    $s = preg_replace('/\[[^\][]*\]|\([^()]*\)|\{[^{}]*\}/u', ' ', $raw);
    $s = preg_replace('/^[A-Z]{2,3}\s*[-|:]\s+/u', '', $s);
    $s = wp_title_fold($s);
    $s = preg_replace('/[^\p{L}\p{N}]+/u', ' ', $s);
    $tags = array_flip(WP_TITLE_QUALITY_TAGS);
    $parts = array_filter(explode(' ', $s), function ($t) use ($tags) { return $t !== '' && !isset($tags[$t]); });
    $clean = trim(implode(' ', $parts));
    $season = '/(?:^|\s)(?:s\d{1,2}|season\s*\d{1,2}|сезон\s*\d{1,2}|staffel\s*\d{1,2}|temporada\s*\d{1,2})$/iu';
    $strip = function ($v) use ($season) {
        $o = trim(preg_replace($season, '', $v));
        return $o !== '' ? $o : $v;
    };
    $exact = $strip($clean);
    if (preg_match('/(?:^|\s)(19\d{2}|20\d{2})$/u', $clean, $m)) {
        $without = trim(preg_replace('/\s+/u', ' ', preg_replace('/(?:^|\s)(19\d{2}|20\d{2})$/u', '', $clean)));
        if ($without !== '') return ['exact' => $exact, 'base' => $strip($without), 'year' => (int)$m[1]];
    }
    return ['exact' => $exact, 'base' => $exact, 'year' => null];
}

/** Años compatibles (±1); un año desconocido nunca impide el emparejamiento. */
function wp_years_ok($a, $b)
{
    return !$a || !$b || abs((int)$a - (int)$b) <= 1;
}

/**
 * Año de un elemento del catálogo: campo year, o "(2019)" / "[2019]" en el nombre.
 * Un año final sin paréntesis puede ser parte del título ("Blade Runner 2049"): ese va en el nivel base.
 */
function wp_catalog_year(array $it)
{
    if (preg_match('/(19\d{2}|20\d{2})/', (string)($it['year'] ?? ''), $m)) return (int)$m[1];
    if (preg_match('/[\(\[](19\d{2}|20\d{2})[\)\]]/', (string)($it['name'] ?? ''), $m)) return (int)$m[1];
    return null;
}

/** Índice del catálogo: exact => [elementos], base => [elementos con año final quitado]. */
function wp_title_index(array $items)
{
    $idx = ['exact' => [], 'base' => []];
    foreach ($items as $it) {
        $k = wp_title_keys($it['name'] ?? '');
        if ($k['exact'] === '' || ($it['id'] ?? '') === '') continue;
        $y = wp_catalog_year($it);
        $idx['exact'][$k['exact']][] = ['it' => $it, 'year' => $y];
        if ($k['base'] !== $k['exact']) $idx['base'][$k['base']][] = ['it' => $it, 'year' => $k['year'] ?: $y];
    }
    return $idx;
}

/** Elemento del catálogo para un título de TMDB (y su título original), o null. */
function wp_title_lookup(array $idx, array $titles, $year)
{
    foreach ($titles as $t) {
        $want = wp_title_keys($t)['exact'];
        if ($want === '') continue;
        foreach ($idx['exact'][$want] ?? [] as $c) {
            if (wp_years_ok($year, $c['year'])) return $c['it'];
        }
        foreach ($idx['base'][$want] ?? [] as $c) {
            if (wp_years_ok($year, $c['year'])) return $c['it'];
        }
    }
    return null;
}

/** Clave TMDB: la del panel (llega con Continuar viendo) o la de includes/panel_secret.php. */
function wp_tmdb_keys()
{
    $keys = [];
    $panel = wp_cache_get(wp_panel_ck('panel|tmdbkey'), 30 * 86400, $stale);
    $panel = is_string($panel) ? $panel : (is_string($stale) ? $stale : '');
    if (preg_match('/^[0-9a-f]{32}$/i', $panel)) $keys[] = $panel;
    $own = wp_tmdb_key();
    if ($own && !in_array($own, $keys, true)) $keys[] = $own;
    return $keys;
}

/** GET a TMDB probando la clave del panel y luego la incorporada. Devuelve el JSON o null. */
function wp_tmdb_get($path, $query = '', $timeout = 8)
{
    foreach (wp_tmdb_keys() as $key) {
        $body = wp_http_get('https://api.themoviedb.org/3/' . $path . '?api_key=' . rawurlencode($key) . ($query ? '&' . $query : ''), $timeout, $code);
        if ($body === null) return null; // sin red: otra clave no ayuda
        if ($code === 401) continue;     // clave no válida: se prueba la siguiente
        $j = json_decode($body, true);
        return is_array($j) ? $j : null;
    }
    return null;
}

/** Persona de TMDB por id, o buscando por nombre. Caché 7 días. */
function wp_tmdb_person($id, $name = '')
{
    $id = preg_replace('/\D/', '', (string)$id);
    if ($id === '' && trim($name) !== '') {
        $s = wp_tmdb_get('search/person', 'language=es-MX&include_adult=false&query=' . urlencode(trim($name)));
        $id = (string)($s['results'][0]['id'] ?? '');
    }
    if ($id === '') return null;
    $ck = 'tmdbp1|' . $id;
    $hit = wp_cache_get($ck, 604800);
    if (is_array($hit)) return $hit;
    $j = wp_tmdb_get('person/' . $id, 'language=es-MX&append_to_response=combined_credits');
    if (!is_array($j) || empty($j['id'])) return null;
    if (trim((string)($j['biography'] ?? '')) === '') {
        $en = wp_tmdb_get('person/' . $id, 'language=en-US', 5);
        if (!empty($en['biography'])) $j['biography'] = $en['biography'];
    }
    $p = [
        'id' => (int)$j['id'],
        'name' => (string)($j['name'] ?? ''),
        'bio' => trim((string)($j['biography'] ?? '')),
        'birthday' => (string)($j['birthday'] ?? ''),
        'place' => (string)($j['place_of_birth'] ?? ''),
        'photo' => !empty($j['profile_path']) ? 'https://image.tmdb.org/t/p/w300' . $j['profile_path'] : '',
        'credits' => [],
    ];
    $seen = [];
    foreach ((array)($j['combined_credits']['cast'] ?? []) as $c) {
        $mt = $c['media_type'] ?? '';
        if (!in_array($mt, ['movie', 'tv'], true) || empty($c['id']) || isset($seen[$mt . $c['id']])) continue;
        $seen[$mt . $c['id']] = 1;
        $date = (string)($c['release_date'] ?? ($c['first_air_date'] ?? ''));
        $p['credits'][] = [
            'type' => $mt === 'tv' ? 'series' : 'movie',
            'title' => trim((string)($c['title'] ?? ($c['name'] ?? ''))),
            'original' => trim((string)($c['original_title'] ?? ($c['original_name'] ?? ''))),
            'year' => preg_match('/^(\d{4})/', $date, $m) ? (int)$m[1] : null,
            'poster' => !empty($c['poster_path']) ? 'https://image.tmdb.org/t/p/w342' . $c['poster_path'] : '',
            'character' => trim((string)($c['character'] ?? '')),
            'pop' => (float)($c['popularity'] ?? 0),
        ];
    }
    wp_cache_set($ck, $p);
    return $p;
}

/**
 * Filmografía que existe en el servidor: [['it' => catálogo, 'type', 'credit'], ...],
 * más recientes primero, sin repetir el mismo contenido.
 */
function wp_actor_available(array $person)
{
    $idx = ['movie' => wp_title_index(wp_catalog('movie')), 'series' => wp_title_index(wp_catalog('series'))];
    $out = [];
    $seen = [];
    foreach ($person['credits'] as $c) {
        $titles = array_values(array_unique(array_filter([$c['title'], $c['original']])));
        $it = wp_title_lookup($idx[$c['type']], $titles, $c['year']);
        if (!$it || isset($seen[$c['type'] . $it['id']])) continue;
        $seen[$c['type'] . $it['id']] = 1;
        $out[] = ['it' => $it, 'type' => $c['type'], 'credit' => $c];
    }
    usort($out, function ($a, $b) {
        return ($b['credit']['year'] ?? 0) <=> ($a['credit']['year'] ?? 0) ?: $b['credit']['pop'] <=> $a['credit']['pop'];
    });
    return $out;
}

/** Enlace a la página del actor (id de TMDB, o el nombre si no hay id). */
function wp_actor_url(array $a)
{
    return !empty($a['id']) ? 'actor.php?id=' . rawurlencode((string)$a['id']) : 'actor.php?name=' . rawurlencode((string)($a['n'] ?? ''));
}
