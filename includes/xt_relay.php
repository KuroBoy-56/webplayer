<?php
/**
 * Puente para servidores IPTV sin SSL (web player 2.9.0, cloudflare/edge-worker.js).
 *
 * Con la web en https el navegador no deja pedir nada a un servidor http (ni a uno con certificado casero o vencido):
 * el modo navegador no podía usarlo y todo iba por el hosting, que muchos servidores bloquean. Si la web se abre por un
 * dominio con el Worker de Cloudflare (el nuevo, que manda X-MPX-Relay), el navegador pide a la misma web
 * xtr/<firma>.<vence>/http/<servidor:puerto>/player_api.php y el Worker se lo pide al servidor IPTV. Solo
 * player_api.php (inicio de sesión, catálogo, cuenta), firmado con el secreto del Worker y por unos días: nunca video
 * ni otro archivo, ni un servidor que la web no haya firmado. El servidor IPTV ve la IP de Cloudflare.
 * Sin el Worker (la web abierta por el hosting) no cambia nada.
 */
if (defined('WP_XT_RELAY_LOADED')) {
    return;
}
define('WP_XT_RELAY_LOADED', true);

/** ¿Esta visita llegó por un Worker con puente y la web está en https? */
function wp_xt_relay_on()
{
    return !empty($GLOBALS['wp_edge_key']) && !empty($GLOBALS['wp_edge_relay']) && function_exists('wp_is_https') && wp_is_https();
}

function wp_xt_relay_sig($scheme, $hostport, $exp)
{
    $mac = hash_hmac('sha256', 'xtr|' . strtolower($scheme) . '|' . strtolower($hostport) . '|' . (int)$exp, (string)$GLOBALS['wp_edge_key'], true);
    return substr(rtrim(strtr(base64_encode($mac), '+/', '-_'), '='), 0, 22);
}

/**
 * Base del puente para un servidor IPTV ('xtr/…/http/servidor:puerto', relativa a la web) o '' si no hay puente. Solo
 * servidores con nombre (Cloudflare no deja pedir a una IP) y sin carpeta (el Worker solo pasa /player_api.php).
 */
function wp_xt_relay_base($url, $week = false)
{
    if (!wp_xt_relay_on()) return '';
    $p = parse_url(rtrim((string)$url, '/'));
    $scheme = strtolower((string)($p['scheme'] ?? ''));
    $host = strtolower((string)($p['host'] ?? ''));
    if ($scheme !== 'http' && $scheme !== 'https') return '';
    if (!preg_match('/^[a-z0-9.-]{1,253}$/', $host) || filter_var($host, FILTER_VALIDATE_IP) || strpos($host, '.') === false) return '';
    if (trim((string)($p['path'] ?? ''), '/') !== '') return '';
    $port = (int)($p['port'] ?? ($scheme === 'https' ? 443 : 80));
    // vence en 2-3 días y es igual todo el día: la lista que ve el navegador y lo que manda al entrar coinciden. Las
    // imágenes ($week): igual toda la semana, así el navegador las guarda y no las vuelve a pedir cada día
    $exp = $week ? (intdiv(time(), 604800) + 2) * 604800 : (intdiv(time(), 86400) + 3) * 86400;
    $hp = $host . ':' . $port;
    return 'xtr/' . wp_xt_relay_sig($scheme, $hp, $exp) . '.' . $exp . '/' . $scheme . '/' . $hp;
}

/** La dirección real (http://servidor:puerto) de una base del puente válida y vigente, o ''. */
function wp_xt_relay_target($base)
{
    if (empty($GLOBALS['wp_edge_key'])) return '';
    if (!preg_match('~^/?xtr/([A-Za-z0-9_-]{22})\.(\d{9,11})/(https?)/([A-Za-z0-9.-]{1,253}):(\d{1,5})$~', rtrim((string)$base, '/'), $m)) return '';
    if ((int)$m[2] < time()) return '';
    $hp = strtolower($m[4]) . ':' . $m[5];
    if (!hash_equals(wp_xt_relay_sig($m[3], $hp, $m[2]), $m[1])) return '';
    return strtolower($m[3]) . '://' . $hp;
}

/** Una dirección de player_api.php para el navegador: por el puente si el servidor es http y la web https. */
function wp_xt_browser_url($url)
{
    if (!wp_xt_relay_on()) return $url;
    $p = parse_url((string)$url);
    if (strtolower((string)($p['scheme'] ?? '')) !== 'http' || ($p['path'] ?? '') !== '/player_api.php') return $url;
    $b = wp_xt_relay_base('http://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : ''));
    return $b === '' ? $url : $b . '/player_api.php' . (isset($p['query']) ? '?' . $p['query'] : '');
}

/**
 * La línea por el puente, desde el hosting: el hosting le pide a la dirección pública de la web (Cloudflare), el Worker
 * al servidor IPTV. user_info si la línea entra, o null.
 */
function wp_xt_relay_check($base, $user, $pass)
{
    if (wp_xt_relay_target($base) === '') return null;
    $host = preg_replace('/[^A-Za-z0-9.:\[\]-]/', '', (string)($_SERVER['HTTP_HOST'] ?? ''));
    if ($host === '') return null;
    $url = 'https://' . $host . '/' . ltrim((string)$base, '/') . '/player_api.php?username=' . urlencode((string)$user) . '&password=' . urlencode((string)$pass);
    $body = wp_http_get($url, 15);
    $j = is_string($body) ? json_decode($body, true) : null;
    return is_array($j) && is_array($j['user_info'] ?? null) ? $j['user_info'] : null;
}

/**
 * Una imagen del servidor IPTV (carátula, fondo) por el puente del Worker (web player 2.9.1, Worker con imágenes):
 * con la web en https el navegador no carga una imagen http, ni una https con certificado casero o vencido, y por el
 * hosting tampoco si el servidor bloquea su IP. Solo archivos de imagen (.jpg .png .webp .gif .bmp) de una dirección
 * http, o https del mismo servidor de la línea cuando la línea entra por http (su https no sirve). El Worker la guarda
 * una semana. '' sin puente o si no hace falta.
 */
function wp_xt_relay_img($url)
{
    if (!wp_xt_relay_on()) return '';
    $p = parse_url(trim((string)$url));
    if (!is_array($p)) return '';
    $scheme = strtolower((string)($p['scheme'] ?? ''));
    $host = strtolower((string)($p['host'] ?? ''));
    $path = (string)($p['path'] ?? '');
    if (($scheme !== 'http' && $scheme !== 'https') || $host === '' || strpos($path, '..') !== false) return '';
    if (!preg_match('~^/[A-Za-z0-9._\~%!$&\'()*+,;=:@/-]{1,400}\.(?:jpe?g|png|webp|gif|bmp)$~i', $path)) return '';
    $port = (int)($p['port'] ?? ($scheme === 'https' ? 443 : 80));
    if ($scheme === 'https') {
        $s = parse_url((string)(function_exists('wp_user') ? wp_user()['server'] : ''));
        if (strtolower((string)($s['scheme'] ?? '')) !== 'http' || strtolower((string)($s['host'] ?? '')) !== $host) return '';
        $scheme = 'http';
        $port = (int)($s['port'] ?? 80);
    }
    $b = wp_xt_relay_base($scheme . '://' . $host . ':' . $port, true);
    // desde la raíz: el Worker atiende /xtr/ en la raíz de su dominio (la web también está ahí)
    return $b === '' ? '' : '/' . $b . $path;
}
