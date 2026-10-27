<?php
// La página de inicio ahora es homex (más rápida). Se conserva esta URL.
require_once __DIR__ . '/includes/core.php';
$_SESSION = wp_session_read_close();
header('Location: ' . wp_route_url('homex' . (!empty($_SERVER['QUERY_STRING']) ? '?' . $_SERVER['QUERY_STRING'] : '')));
exit;
