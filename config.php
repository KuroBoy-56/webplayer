<?php
require_once __DIR__ . '/includes/core.php';

// Todo se administra desde el panel (DNS, usuarios, guía y deportes).
// Con número de distribuidor: el nombre de su marca (Omitir: el de siempre)
$sitename = wp_brand_name('WebPlayer');

$protocol = wp_is_https() ? 'https://' : 'http://';
$basedir = $protocol . ($_SERVER['HTTP_HOST'] ?? 'localhost') . substr($_SERVER['REQUEST_URI'] ?? '/', 0, strrpos($_SERVER['REQUEST_URI'] ?? '/', '/'));
$default_color = 'black';
$get_dir = $basedir;
