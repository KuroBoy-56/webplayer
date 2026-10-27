<?php
require_once __DIR__ . '/includes/core.php';
$s = wp_session_read_close();
$_SESSION = $s;
header('Cache-Control: no-store');
header('Location: ' . (!empty($s['username']) ? wp_route_url('homex') : 'login'));
exit;
