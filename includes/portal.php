<?php
// Antes devolvía las DNS a cualquiera. Ahora sólo para el administrador.
require_once __DIR__ . '/admin_guard.php';
$json = wp_dns_config();
$server = (string)($_GET["server"] ?? '');
if (preg_match('/^[1-6]$/', $server)) {
    echo $json['server' . $server] ?? '';
}
