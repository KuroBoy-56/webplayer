<?php
/*
 * Páginas por token (includes/route_token.php): .htaccess manda aquí cada "w-<token>" por dentro; el navegador nunca
 * ve este archivo ni el nombre de la página. Un token alterado, vencido o de otra sesión lleva al inicio.
 */
require_once __DIR__ . '/includes/core.php';
$tok = (string)($_GET['_w'] ?? '');
$r = preg_match('/^[A-Za-z0-9_-]{30,2000}$/', $tok) ? wp_route_open('w-' . $tok) : null;
if ($r && $r[2] !== '') {
    // token de esta línea: se compara con la sesión (sin dejarla abierta)
    $s = wp_session_read_close();
    $_SESSION = $s;
    if (wp_route_owner() !== $r[2]) $r = null;
}
if (!$r) {
    header('Cache-Control: no-store');
    header('Location: ./', true, 302);
    exit;
}
list($page, $query) = $r;
// parámetros: los del token más los que traiga la dirección (descarga, ?t=…), que mandan; con _r=1 (filtros que la
// página reescribe con history.replaceState) solo los de la dirección
unset($_GET['_w']);
$extra = $_GET;
$_GET = [];
if (empty($extra['_r'])) parse_str($query, $_GET);
unset($extra['_r']);
$_GET = array_merge($_GET, $extra);
$_REQUEST = array_merge($_GET, $_POST);
$_SERVER['QUERY_STRING'] = http_build_query($_GET);
$dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/route.php')), '/');
$_SERVER['SCRIPT_NAME'] = $dir . '/' . $page;
$_SERVER['PHP_SELF'] = $_SERVER['SCRIPT_NAME'];
$_SERVER['SCRIPT_FILENAME'] = __DIR__ . '/' . $page;
define('WP_ROUTED', true);
chdir(__DIR__);
require __DIR__ . '/' . $page;
