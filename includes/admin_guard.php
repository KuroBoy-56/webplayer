<?php
/** Protección del panel de administración (antes bastaba con crear la cookie admin=true). */
require_once __DIR__ . '/core.php';
wp_security_headers();
wp_session_start();
$wp_is_admin = !empty($_SESSION['is_admin']);
session_write_close();
if (!$wp_is_admin) {
    header('Location: ../../login');
    exit;
}
