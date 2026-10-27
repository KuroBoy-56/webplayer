<?php
/**
 * Carátulas y fondos por la caché de imágenes del panel (igual que Roku, Vega, Android, Windows e iPhone): una sola
 * copia de cada imagen en el panel, compartida por todas las apps y la web. Orden de una carátula:
 *   1. api/imgc/<sha1>.jpg?v=2  copia pública (la sirve el servidor web del panel, sin PHP)
 *   2. api/img.php?w=500&v=2…    el panel la achica la primera vez y, con el título, busca el póster en TMDB si el
 *                                servidor IPTV no tiene
 *   3. la dirección original     (por img.php del hosting si la web es https y la imagen http)
 *   4. TMDB por el hosting        (NF.imgErr → api.php?action=posters, solo si todo lo anterior falló)
 * Fondos de TMDB en Full HD hechos por el panel (img.php?w=1920). Si el dueño apaga la caché ("img": false de
 * progress.php ?v=2) todo va directo, como antes. El navegador nunca recibe la llave del panel: solo el token de la
 * línea, el mismo que usan las apps.
 */
if (defined('WP_PANEL_IMG_LOADED')) {
    return;
}
define('WP_PANEL_IMG_LOADED', true);

/** El dueño tiene la caché de imágenes encendida (lo informa progress.php ?v=2; sin dato, encendida). */
function wp_panel_img_on()
{
    static $on = null;
    if ($on !== null) return $on;
    $hit = wp_cache_get('panel|img', 86400 * 30);
    return $on = !is_array($hit) || !empty($hit['on']);
}

/** Lo que dice progress.php ?v=2 ("img"): vale desde las próximas páginas. */
function wp_panel_img_remember($j)
{
    if (!is_array($j) || !array_key_exists('img', $j)) return;
    $on = !empty($j['img']);
    $hit = wp_cache_get('panel|img', 86400 * 30);
    if (!is_array($hit) || (bool)($hit['on'] ?? true) !== $on) wp_cache_set('panel|img', ['on' => $on]);
}

/**
 * "https://panel/api/" o '' (caché apagada, panel sin configurar o web https con el panel en http: el navegador
 * bloquearía la imagen).
 */
function wp_panel_img_base()
{
    static $b = null;
    if ($b !== null) return $b;
    $base = wp_panel_base();
    if ($base === '' || !wp_panel_img_on()) return $b = '';
    // el hosting llega al panel solo por http (SSL quitado o vencido): en una web https no se usa
    $mode = wp_cache_get('panel|mode', 3600);
    if (wp_is_https() && (stripos($base, 'https://') !== 0 || $mode === 2)) return $b = '';
    return $b = $base;
}

/**
 * Nombre de la copia en el panel (igual que img_key / img_idkey de api/img.php): con el id de TMDB
 * "500|tmdbid:<vod|series>:<id>"; si no, la dirección sin http(s):// y con el servidor en minúsculas.
 */
function wp_panel_img_key($poster, $kind, $tm)
{
    if ($tm !== '') return '500|tmdbid:' . $kind . ':' . $tm;
    if (preg_match('~image\.tmdb\.org/t/p/[^/]+/([A-Za-z0-9_\-]+\.(?:jpe?g|png|webp))~i', $poster, $m)) return '500|tmdb:' . $m[1];
    $u = preg_replace('~^https?://~i', '', $poster);
    $slash = strpos($u, '/');
    if ($slash === false) return '500|' . strtolower($u);
    return '500|' . strtolower(substr($u, 0, $slash)) . substr($u, $slash);
}

/**
 * Direcciones de la carátula de un título, en orden (la tarjeta pasa a la siguiente si una no carga).
 * $kind: movie|vod|series|live. Los logos de canales y los pósteres que ya son de TMDB van directo.
 */
function wp_poster_sources($kind, $poster, $name, $year = '', $tm = '')
{
    $poster = trim((string)$poster);
    $name = trim((string)$name);
    $tm = preg_match('/^[1-9]\d{0,8}$/', trim((string)$tm)) ? trim((string)$tm) : '';
    $year = preg_match('/^(19|20)\d\d$/', (string)$year) ? (string)$year : '';
    $http = (bool)preg_match('~^https?://~i', $poster);
    // carátula vacía o el marcador de "sin imagen" del servidor
    if ($poster === 'https://image.tmdb.org/t/p/w600_and_h900_bestv2') { $poster = ''; $http = false; }
    $out = [];
    $b = $kind === 'live' ? '' : wp_panel_img_base();
    $isTmdb = stripos($poster, 'image.tmdb.org/') !== false;
    if ($b !== '' && !$isTmdb && ($http || $name !== '' || $tm !== '')) {
        $k = $kind === 'series' ? 'series' : 'vod';
        $src = $http ? $poster : '';
        $key = $src !== '' || $tm !== '' ? wp_panel_img_key($src, $k, $tm) : '500|n|' . $k . '|' . $name . '|' . $year;
        // ?v=2: el panel vació la caché (los pósteres de TMDB de antes podían ser de otra película)
        $out[] = $b . 'imgc/' . sha1($key) . '.jpg?v=2';
        $tok = wp_panel_token();
        if ($tok !== '') {
            $u = $b . 'img.php?w=500&v=2&token=' . rawurlencode($tok);
            if ($src !== '') $u .= '&u=' . wp_b64u_enc($src);
            if ($name !== '' || $tm !== '') $u .= '&k=' . $k;
            if ($name !== '') $u .= '&n=' . wp_b64u_enc($name) . ($year !== '' ? '&y=' . $year : '');
            if ($tm !== '') $u .= '&t=' . $tm;
            $out[] = $u;
        }
    }
    if ($http) {
        $orig = wp_img($poster, '');
        if ($orig !== '' && !in_array($orig, $out, true)) $out[] = $orig;
    }
    return $out;
}

/** Fondo: el de TMDB en Full HD hecho por el panel y, si falla, el de siempre. */
function wp_backdrop_sources($url)
{
    $url = trim((string)$url);
    if ($url === '' || !preg_match('~^https?://~i', $url)) return [];
    $plain = wp_img($url, '');
    $b = wp_panel_img_base();
    $tok = wp_panel_token();
    if ($b === '' || $tok === '' || stripos($url, 'image.tmdb.org/') === false) return $plain !== '' ? [$plain] : [];
    $orig = preg_replace('~(image\.tmdb\.org/t/p/)[^/]+/~i', '$1original/', $url);
    return array_values(array_filter([$b . 'img.php?w=1920&token=' . rawurlencode($tok) . '&u=' . wp_b64u_enc($orig), $plain]));
}

/** Atributos src + data-fb (las demás direcciones, en JSON) para un <img>; con $fallback si no hay ninguna. */
function wp_img_attrs(array $sources, $fallback = WP_NOIMG)
{
    if (!$sources) return 'src="' . e($fallback) . '"';
    $first = array_shift($sources);
    return 'src="' . e($first) . '"' . ($sources ? ' data-fb="' . e(json_encode(array_values($sources), JSON_UNESCAPED_SLASHES)) . '"' : '');
}
