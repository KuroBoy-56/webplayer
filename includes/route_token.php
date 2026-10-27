<?php
/**
 * Direcciones con tokens (como el panel): después del login ninguna página muestra su nombre de archivo. Cada enlace es
 * "w-<token>" y cada token es distinto y aleatorio (AES-256-GCM con un IV al azar y la llave propia del hosting): lleva
 * la página, sus parámetros, la hora y a quién pertenece (la línea de la sesión). Un token de otra sesión o de más de
 * 7 días lleva al inicio. Si alguien abre una página por su nombre (un enlace viejo, un favorito) se le redirige a un
 * token nuevo. Los llamados internos (api.php, img.php, report.php…) no aparecen en la barra y siguen igual.
 *
 *   .htaccess: w-<token> → route.php (por dentro; el navegador nunca ve route.php)
 */
if (defined('WP_ROUTE_LOADED')) {
    return;
}
define('WP_ROUTE_LOADED', true);

const WP_ROUTE_TTL = 7 * 86400;
// páginas que se navegan (el orden no se cambia: el número va dentro de los tokens; las nuevas, al final)
const WP_ROUTE_PAGES = ['homex.php', 'home.php', 'browse.php', 'movies.php', 'series.php', 'moviesondemand.php', 'seriesondemand.php',
    'Movie_description.php', 'seriesvideo.php', 'video_player.php', 'tvguide.php', 'sportsschedule.php', 'actor.php', 'myaccount.php',
    'settings.php', 'diag.php', 'estado.php', 'logout.php', 'playlist.php', 'play.php', 'oops.php', 'renew.php'];

function wp_route_key()
{
    static $k = null;
    return $k ?? ($k = hash('sha256', 'wp-route-v1|' . wp_secret(), true));
}

/** a quién pertenece el token: la línea de la sesión (8 caracteres) */
function wp_route_owner()
{
    $u = wp_user();
    return $u['username'] === '' ? '' : substr(hash_hmac('sha256', $u['username'] . '|' . $u['server'], wp_route_key()), 0, 8);
}

/** Token nuevo (aleatorio) para $page con $query; $bind = solo vale para esta sesión. '' si no se puede. */
function wp_route_token($page, $query = '', $bind = true)
{
    $i = array_search($page, WP_ROUTE_PAGES, true);
    if ($i === false || !function_exists('openssl_encrypt')) return '';
    $owner = $bind ? wp_route_owner() : '';
    $plain = $i . '|' . base_convert((string)time(), 10, 36) . '|' . $owner . '|' . $query;
    $iv = random_bytes(12);
    $tag = '';
    $ct = openssl_encrypt($plain, 'aes-256-gcm', wp_route_key(), OPENSSL_RAW_DATA, $iv, $tag);
    return $ct === false ? '' : 'w-' . wp_b64u_enc($iv . $tag . $ct);
}

/** [página, parámetros, dueño] del token o null (alterado, vencido o de otra web) */
function wp_route_open($tok)
{
    $raw = wp_b64u_dec(preg_replace('/^w-/', '', (string)$tok));
    if (!is_string($raw) || strlen($raw) < 30 || !function_exists('openssl_decrypt')) return null;
    $plain = openssl_decrypt(substr($raw, 28), 'aes-256-gcm', wp_route_key(), OPENSSL_RAW_DATA, substr($raw, 0, 12), substr($raw, 12, 16));
    if (!is_string($plain)) return null;
    $p = explode('|', $plain, 4);
    if (count($p) !== 4 || !isset(WP_ROUTE_PAGES[(int)$p[0]])) return null;
    $age = time() - (int)base_convert($p[1], 36, 10);
    if ($age < -300 || $age > WP_ROUTE_TTL) return null;
    return [WP_ROUTE_PAGES[(int)$p[0]], $p[3], $p[2]];
}

/**
 * Enlace relativo a una página de la lista ("Movie_description.php?id=5", "homex", "./tvguide?id=1#x") → "w-<token>".
 * Lo demás (api.php, imágenes, enlaces externos, tokens ya hechos) queda igual.
 */
function wp_route_url($href, $bind = true)
{
    $href = (string)$href;
    if (!preg_match('~^(?:\./)?([A-Za-z_]+)(?:\.php)?(\?[^#\'"<>\s]*)?(#[^\'"<>\s]*)?$~', $href, $m)) return $href;
    $page = $m[1] . '.php';
    if (!in_array($page, WP_ROUTE_PAGES, true)) return $href;
    $q = isset($m[2]) ? (string)substr($m[2], 1) : '';
    $t = wp_route_token($page, html_entity_decode($q, ENT_QUOTES | ENT_HTML5, 'UTF-8'), $bind);
    return $t === '' ? $href : $t . ($m[3] ?? '');
}

/** ¿Es una navegación del navegador (no una carga en segundo plano)? */
function wp_route_is_navigation()
{
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET' || isset($_GET['ajax'])) return false;
    $mode = strtolower((string)($_SERVER['HTTP_SEC_FETCH_MODE'] ?? ''));
    if ($mode !== '') return $mode === 'navigate';
    if (strtolower((string)($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '')) === 'xmlhttprequest') return false;
    return stripos((string)($_SERVER['HTTP_ACCEPT'] ?? ''), 'text/html') !== false;
}

/**
 * Páginas con sesión: si se abrió por su nombre se pasa a un token nuevo, y los enlaces de la página (href, action y
 * las direcciones completas entre comillas de la configuración del reproductor) salen como tokens. Las redirecciones
 * (Location) también.
 */
function wp_route_begin()
{
    static $done = false;
    if ($done || PHP_SAPI === 'cli') return;
    $done = true;
    $self = basename((string)($_SERVER['SCRIPT_NAME'] ?? ''));
    if (!defined('WP_ROUTED') && in_array($self, WP_ROUTE_PAGES, true) && wp_route_is_navigation()) {
        $t = wp_route_token($self, (string)($_SERVER['QUERY_STRING'] ?? ''));
        if ($t !== '' && !headers_sent()) {
            header('Cache-Control: no-store');
            header('Location: ' . $t, true, 302);
            exit;
        }
    }
    if (function_exists('header_register_callback')) {
        header_register_callback(function () {
            foreach (headers_list() as $h) {
                if (stripos($h, 'Location:') === 0) {
                    $to = trim(substr($h, 9));
                    $new = wp_route_url($to);
                    if ($new !== $to) header('Location: ' . $new, true);
                }
            }
        });
    }
    ob_start('wp_route_rewrite');
}

/** Reescribe los enlaces de una página HTML (las respuestas JSON y los archivos no se tocan). */
function wp_route_rewrite($html)
{
    foreach (headers_list() as $h) {
        if (stripos($h, 'Content-Type:') === 0 && stripos($h, 'text/html') === false) return $html;
    }
    if (stripos($html, '<') === false) return $html;
    $pages = implode('|', array_map(function ($p) { return preg_quote(substr($p, 0, -4), '~'); }, WP_ROUTE_PAGES));
    // atributos href / action / formaction
    $html = preg_replace_callback('~\b(href|action|formaction)=(["\'])((?:\./)?(?:' . $pages . ')(?:\.php)?(?:\?[^"\'<>\s]*)?(?:#[^"\'<>\s]*)?)\2~',
        function ($m) { return $m[1] . '=' . $m[2] . wp_route_url($m[3]) . $m[2]; }, $html);
    // direcciones completas entre comillas dobles (configuración del reproductor en JSON): nunca un pedazo que se
    // concatena en JavaScript ("…?id=" + id)
    // (con & escrito como \u0026 por JSON_HEX_AMP)
    $html = preg_replace_callback('~(?<=[:,\[(]|[:,\[(] )"((?:\./)?(?:' . $pages . ')(?:\.php)?(?:\?(?:[^"\'<>\s\\\\]|\\\\u0026)*)?)"(?!\s*\+)~',
        function ($m) { return '"' . wp_route_url(str_replace('\\u0026', '&', $m[1])) . '"'; }, $html);
    return $html;
}
