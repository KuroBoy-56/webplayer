<?php
/**
 * Catálogo rápido (web player 2.8.0).
 *
 * El catálogo de películas y series de una línea es grande (40.000 títulos ≈ 10 MB en la caché). Cada fila de Inicio,
 * cada página de Explorar y cada ficha lo leía entero, lo filtraba y lo ordenaba: 150-350 ms y unos 100 MB de memoria
 * por pedido, unas 20 veces por cada Inicio. Aquí:
 *  - wp_sort_items(): el mismo orden que usort (estable), con array_multisort (8 veces más rápido);
 *  - wp_cat_derive(): lo que se calcula del catálogo (una fila, los títulos de una categoría, los géneros que hay…)
 *    se guarda aparte, chiquito, y vale mientras el catálogo y sus categorías no cambien (su fecha en la caché). Así
 *    una fila lee unos KB en lugar de 10 MB. Con el catálogo vencido (más de 30 min) se calcula como siempre, y eso
 *    lo renueva. Un perfil infantil filtra con TMDB a medida que llegan los datos: ahí se calcula siempre.
 */
if (defined('WP_CATALOG_FAST_LOADED')) {
    return;
}
define('WP_CATALOG_FAST_LOADED', true);
define('WP_CAT_TTL', 1800); // lo mismo que dura el catálogo en la caché (wp_catalog_raw)

/**
 * Ordena como usort con «$b[$f] <=> $a[$f]» (desc) o strnatcasecmp (name, asc), y deja los empates en el orden en que
 * estaban (igual que usort, que en PHP 8 es estable).
 */
function wp_sort_items(array &$list, $field, $desc = true)
{
    $n = count($list);
    if ($n < 2) return;
    $list = array_values($list);
    $col = [];
    foreach ($list as $it) $col[] = $it[$field] ?? ($field === 'name' ? '' : 0);
    $idx = range(0, $n - 1);
    if ($field === 'name') {
        array_multisort($col, SORT_ASC, SORT_NATURAL | SORT_FLAG_CASE, $idx, SORT_ASC, SORT_NUMERIC, $list);
    } else {
        array_multisort($col, $desc ? SORT_DESC : SORT_ASC, SORT_NUMERIC, $idx, SORT_ASC, SORT_NUMERIC, $list);
    }
}

/** Archivo de la caché de una clave (el mismo nombre que usa wp_cache_get). */
function wp_cache_file_of($key)
{
    return wp_cache_dir('data') . '/' . md5($key) . '.json';
}

/**
 * Versión del catálogo de estos tipos: la fecha del catálogo y de sus categorías en la caché. 'fresh' = todo existe y
 * tiene menos de 30 min (si no, hay que pasar por wp_catalog para que se renueve).
 */
function wp_cat_state(array $types)
{
    $v = [];
    $fresh = true;
    $now = time();
    foreach ($types as $t) {
        $t = $t === 'series' ? 'series' : 'movie';
        $files = [
            wp_cache_file_of('slim2|' . $t . '|' . xt_cache_key('', [])),
            wp_cache_file_of(xt_cache_key($t === 'series' ? 'get_series_categories' : 'get_vod_categories', [])),
        ];
        foreach ($files as $f) {
            $m = (int)@filemtime($f);
            if ($m <= 0 || $now - $m > WP_CAT_TTL) $fresh = false;
            $v[] = $m;
        }
    }
    return [implode('.', $v), $fresh];
}

/**
 * Lo que $fn calcula del catálogo de $types, guardado aparte mientras el catálogo no cambie. $name distingue cada
 * cálculo (la línea y el distribuidor ya van en la clave).
 */
function wp_cat_derive($name, array $types, callable $fn)
{
    if (function_exists('wp_kids_on') && wp_kids_on()) return $fn();
    $key = 'cd|' . $name . '|' . xt_cache_key('', []);
    list($v, $fresh) = wp_cat_state($types);
    $hit = wp_cache_get($key, 7 * 86400);
    // lo guardado vale mientras el catálogo sea el mismo; si el catálogo venció, se pide renovarlo sin esperar
    // (después de contestar o por el navegador) y mientras tanto se usa esto
    if (is_array($hit) && ($hit['v'] ?? '') === $v && array_key_exists('d', $hit) && ($fresh || wp_cat_touch($types))) return $hit['d'];
    $d = $fn();
    // la versión de después: si $fn renovó el catálogo, lo guardado va con la fecha nueva
    list($v2) = wp_cat_state($types);
    // sin catálogo todavía (modo navegador, página por partes): no se guarda un cálculo vacío
    if (in_array('0', explode('.', $v2), true)) return $d;
    wp_cache_set($key, ['v' => $v2, 'd' => $d]);
    return $d;
}

/**
 * Pide renovar el catálogo vencido de estos tipos sin hacer esperar a nadie: por el hosting después de contestar, o en
 * el modo navegador por el navegador (en segundo plano). false = este servidor no puede contestar antes de terminar:
 * se calcula como siempre.
 */
function wp_cat_touch(array $types)
{
    $client = function_exists('wp_xt_client') && wp_xt_client();
    $now = time();
    foreach ($types as $t) {
        $t = $t === 'series' ? 'series' : 'movie';
        foreach ([$t === 'series' ? 'get_series' : 'get_vod_streams', $t === 'series' ? 'get_series_categories' : 'get_vod_categories'] as $act) {
            $file = $act === 'get_series' || $act === 'get_vod_streams'
                ? wp_cache_file_of('slim2|' . $t . '|' . xt_cache_key('', []))
                : wp_cache_file_of(xt_cache_key($act, []));
            if ($now - (int)@filemtime($file) <= WP_CAT_TTL) continue;
            if ($client) {
                wp_xt_need($act, [], false);
            } elseif (!wp_xt_refresh_later($act, [], 40)) {
                return false;
            }
        }
    }
    return true;
}

/**
 * wp_filter() sin búsqueda, guardado: ['n' => cuántos hay, 'l' => los primeros $max]. Para las filas de Inicio, las
 * páginas de Explorar y el destacado.
 */
function wp_filter_cached($type, $platform = '', $genre = '', $cat = '', $sort = 'recent', $max = 60)
{
    $types = $type === 'all' ? ['movie', 'series'] : [$type === 'series' ? 'series' : 'movie'];
    $max = max(1, (int)$max);
    $name = 'flt|' . $type . '|' . $platform . '|' . $genre . '|' . $cat . '|' . $sort . '|' . $max;
    return wp_cat_derive($name, $types, function () use ($type, $platform, $genre, $cat, $sort, $max) {
        $list = wp_filter($type, $platform, $genre, $cat, '', $sort);
        return ['n' => count($list), 'l' => array_slice($list, 0, $max)];
    });
}

/** Los ids del catálogo ([id => 1]): para saber si un título de Mi lista o Continuar viendo sigue en el servidor. */
function wp_catalog_ids($type)
{
    $type = $type === 'series' ? 'series' : 'movie';
    return wp_cat_derive('ids|' . $type, [$type], function () use ($type) {
        $ids = [];
        foreach (wp_catalog($type) as $it) $ids[(string)$it['id']] = 1;
        return $ids;
    });
}

/** [categoría principal, 'categorías,separadas'] de un título del catálogo, o null si no está. */
function wp_catalog_item_cats($type, $id)
{
    $type = $type === 'series' ? 'series' : 'movie';
    $map = wp_cat_derive('idcats|' . $type, [$type], function () use ($type) {
        $m = [];
        foreach (wp_catalog($type) as $it) $m[(string)$it['id']] = [(string)$it['cat'], implode(',', $it['cats'])];
        return $m;
    });
    $c = is_array($map) ? ($map[(string)$id] ?? null) : null;
    return is_array($c) && count($c) === 2 ? [(string)$c[0], (string)$c[1]] : null;
}

/**
 * «Similares» de una ficha: los más nuevos (hasta 80) que comparten alguna categoría con el título $id. [] si el título
 * no está en el catálogo.
 */
function wp_catalog_similar($type, $id)
{
    $type = $type === 'series' ? 'series' : 'movie';
    $id = (string)$id;
    $c = wp_catalog_item_cats($type, $id);
    if ($c === null || $c[1] === '') return [];
    $mine = $c[1];
    $list = wp_cat_derive('sim|' . $type . '|' . md5($mine), [$type], function () use ($type, $mine) {
        $want = array_flip(explode(',', $mine));
        $out = [];
        foreach (wp_catalog($type) as $it) {
            foreach ($it['cats'] as $c) {
                if (isset($want[$c])) { $out[] = $it; break; }
            }
        }
        wp_sort_items($out, 'added');
        return array_slice($out, 0, 81);
    });
    $res = [];
    foreach ((array)$list as $it) {
        if ((string)$it['id'] !== $id) $res[] = $it;
    }
    return array_slice($res, 0, 80);
}

/* ------------------------------------------------------------------ */
/* Catálogos vencidos: se renuevan después de contestar                 */
/* ------------------------------------------------------------------ */

const WP_XT_BG_ACTIONS = ['get_vod_streams', 'get_series', 'get_live_streams', 'get_vod_categories', 'get_series_categories', 'get_live_categories'];

/**
 * Por el hosting (no en el modo navegador): un catálogo grande vencido se renueva cuando la página ya salió
 * (fastcgi_finish_request / litespeed_finish_request), una sola vez a la vez por línea y catálogo. false = no se puede
 * (otra acción, o un servidor sin terminar la respuesta antes): se hace como siempre, esperando.
 */
function wp_xt_refresh_later($action, array $params, $timeout)
{
    static $pending = null;
    if (!in_array($action, WP_XT_BG_ACTIONS, true)) return false;
    if (!function_exists('fastcgi_finish_request') && !function_exists('litespeed_finish_request')) return false;
    if (function_exists('wp_xt_client') && wp_xt_client()) return false;
    $key = xt_cache_key($action, $params);
    if ($pending === null) {
        $pending = [];
        $u = wp_user();
        register_shutdown_function(function () use (&$pending, $u) {
            if (!$pending) return;
            if (function_exists('fastcgi_finish_request')) {
                @fastcgi_finish_request();
            } elseif (function_exists('litespeed_finish_request')) {
                litespeed_finish_request();
            }
            ignore_user_abort(true);
            @set_time_limit(180);
            // la línea de la página (después de contestar las variables globales pueden no estar)
            $GLOBALS['get_dns'] = $u['server'];
            $GLOBALS['username'] = $u['username'];
            $GLOBALS['password'] = $u['password'];
            foreach ($pending as $p) wp_xt_refresh_now($p[0], $p[1], $p[2]);
        });
    }
    // ya se está renovando (otro pedido de hace menos de 3 min): se usa lo guardado
    if (wp_cache_get('xtrf|' . $key, 180) === null) {
        wp_cache_set('xtrf|' . $key, time());
        $pending[$key] = [$action, $params, max(20, (int)$timeout)];
    }
    return true;
}

/** Renueva un catálogo desde el hosting (y el catálogo ligero de películas o series, ya listo para la próxima página). */
function wp_xt_refresh_now($action, array $params, $timeout)
{
    $key = xt_cache_key($action, $params);
    $body = wp_http_get(xt_url($action, $params), $timeout, $code);
    $json = $body !== null ? json_decode($body, true) : null;
    unset($body);
    if (!is_array($json) || !$json) {
        // no contestó: se vuelve a intentar en el próximo pedido pasados 3 min (lo vencido sigue sirviendo)
        return false;
    }
    wp_cache_set($key, $json);
    if (($action === 'get_vod_streams' || $action === 'get_series') && !$params) {
        $type = $action === 'get_series' ? 'series' : 'movie';
        $slim = wp_catalog_slim($type, $json);
        if ($slim) wp_cache_set('slim2|' . $type . '|' . xt_cache_key('', []), $slim);
    }
    return true;
}

/* ------------------------------------------------------------------ */
/* Páginas que el navegador puede guardar un momento                   */
/* ------------------------------------------------------------------ */

const WP_CACHE_PAGES = ['homex.php', 'home.php', 'browse.php', 'movies.php', 'series.php', 'moviesondemand.php', 'seriesondemand.php',
    'Movie_description.php', 'seriesvideo.php', 'actor.php'];

function wp_page_cache_headers()
{
    if (headers_sent() || ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' || isset($_GET['ajax'])) return;
    if (!in_array(basename((string)($_SERVER['SCRIPT_NAME'] ?? '')), WP_CACHE_PAGES, true)) return;
    header_remove('Pragma');
    header_remove('Expires');
    header('Cache-Control: private, max-age=60');
}

/**
 * Llave de lo que este navegador guarda de la web (assets/nf/app.js): cambia con la sesión, el perfil, el idioma, el
 * distribuidor y la versión, así nunca se mezcla lo de otra cuenta o de otro perfil.
 */
function wp_client_cache_key()
{
    $sid = session_id();
    if (!is_string($sid) || $sid === '') return '';
    $prof = function_exists('wp_prof_id') ? wp_prof_id() : '';
    $kids = function_exists('wp_kids_on') && wp_kids_on() ? 'k' : '';
    $tc = function_exists('wp_panel_tenant') ? wp_panel_tenant() : '';
    return substr(hash('sha256', 'nfck|' . $sid . '|' . $prof . '|' . $kids . '|' . wp_lang() . '|' . $tc . '|' . WP_VERSION . '|' . wp_secret()), 0, 16);
}
