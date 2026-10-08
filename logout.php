<?php
require_once __DIR__ . '/includes/core.php';
wp_session_start();
$was = !empty($_SESSION["username"]);
$_SESSION = [];
if (ini_get('session.use_cookies')) {
    $p = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
}
session_destroy();
// "Cambiar distribuidor": se borra el número guardado y se vuelve a la pantalla del distribuidor
if (isset($_GET['dist'])) {
    wp_dist_set('');
    header('Location: login?dist=1');
    exit;
}
header("Location: login" . ($was ? "?logout=true" : ""));
exit;
