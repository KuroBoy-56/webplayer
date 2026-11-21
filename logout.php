<?php
require_once __DIR__ . '/includes/core.php';
wp_session_start();
$was = !empty($_SESSION["username"]);
// la web del distribuidor de esta sesión (o el último de este navegador): «Cerrar sesión» vuelve a su enlace
$dist = $was ? (string)($_SESSION['dist'] ?? '') : wp_dist_remembered();
$_SESSION = [];
if (ini_get('session.use_cookies')) {
    $p = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
}
session_destroy();
// lo que el navegador guardó de las páginas (60 s) y las filas de Inicio (assets/nf/app.js) no quedan para el próximo
header('Clear-Site-Data: "cache"');
header('Cache-Control: no-store');
wp_panel_set_tenant(preg_match('/^\d{6}$/', $dist) ? $dist : '');
header('Location: ' . wp_login_url($was ? 'logout=true' : ''));
exit;
