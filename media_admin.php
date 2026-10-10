<?php
/**
 * Órdenes del panel para el motor multimedia de esta web player (Guía EPG del panel):
 * POST JSON {"action": "status|stop|enable|disable", "t": unix, "sig": hmac}
 * sig = HMAC-SHA256(action + "|" + t) con la llave derivada de la llave maestra del panel.
 */
require_once __DIR__ . '/includes/core.php';
require_once __DIR__ . '/includes/media_admin.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function wp_media_admin_out($code, array $data)
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') wp_media_admin_out(405, ['ok' => false, 'error' => 'Solo POST']);
$key = wp_media_admin_key();
if ($key === null) wp_media_admin_out(503, ['ok' => false, 'error' => 'La web player no tiene la llave del panel (includes/panel_secret.php)']);
$in = json_decode((string)file_get_contents('php://input'), true);
$action = is_array($in) ? (string)($in['action'] ?? '') : '';
$t = is_array($in) ? (int)($in['t'] ?? 0) : 0;
$sig = is_array($in) ? (string)($in['sig'] ?? '') : '';
if (!in_array($action, ['status', 'stop', 'enable', 'disable'], true) || abs(time() - $t) > 300
    || !hash_equals(hash_hmac('sha256', $action . '|' . $t, $key), $sig)) {
    wp_media_admin_out(403, ['ok' => false, 'error' => 'Orden no válida']);
}

$stopped = 0;
if ($action === 'stop') $stopped = wp_media_stop_all();
if ($action === 'enable') wp_media_set_enabled(true);
if ($action === 'disable') {
    wp_media_set_enabled(false);
    $stopped = wp_media_stop_all();
}
wp_media_admin_out(200, [
    'ok' => true,
    'enabled' => wp_media_enabled(),
    'ffmpeg' => wp_bin('ffmpeg') !== null,
    'exec' => wp_exec_mode() !== null,
    'active' => wp_media_active(),
    'stopped' => $stopped,
]);
