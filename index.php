<?php
require_once __DIR__ . '/includes/core.php';
$s = wp_session_read_close();
$_SESSION = $s;
header('Cache-Control: no-store');
// el dominio con ?d=NNNNNN: el enlace de un distribuidor (login.php › wp_tenant_link_get)
if (isset($_GET['d']) && preg_match('/^\d{6}$/', (string)$_GET['d'])) {
    header('Location: login?d=' . $_GET['d']);
    exit;
}
header('Location: ' . (!empty($s['username']) ? wp_route_url('homex') : 'login'));
exit;
