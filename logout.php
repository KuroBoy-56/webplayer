<?php
require_once __DIR__ . '/includes/core.php';
wp_session_start();
$was = !empty($_SESSION["username"]) || !empty($_SESSION['is_admin']);
$_SESSION = [];
if (ini_get('session.use_cookies')) {
    $p = session_get_cookie_params();
    setcookie(session_name(), '', time() - 42000, $p['path'], $p['domain'], $p['secure'], $p['httponly']);
}
session_destroy();
setcookie('admin', '', time() - 3600, '/');
header("Location: login" . ($was ? "?logout=true" : ""));
exit;
