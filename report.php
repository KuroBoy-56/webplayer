<?php
/**
 * Errores del navegador (reproductor) -> panel «Errores de las apps».
 * POST JSON {kind, message, detail, screen}. Solo con sesión iniciada; 30 cada 10 minutos por IP.
 */
require_once __DIR__ . '/includes/core.php';
wp_security_headers();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    http_response_code(405);
    exit('{"ok":false}');
}
wp_session_start();
$logged = !empty($_SESSION['username']);
session_write_close();
if (!$logged) {
    http_response_code(401);
    exit('{"ok":false}');
}
if (wp_rate_limited('report', 30, 600)) {
    http_response_code(429);
    exit('{"ok":false}');
}
$in = json_decode((string)file_get_contents('php://input', false, null, 0, 20000), true);
if (!is_array($in) || !is_string($in['message'] ?? null)) {
    http_response_code(400);
    exit('{"ok":false}');
}
$kind = in_array($in['kind'] ?? '', ['playback', 'error', 'network'], true) ? $in['kind'] : 'error';
$ok = wp_panel_report($kind, $in['message'], is_string($in['detail'] ?? null) ? $in['detail'] : '', is_string($in['screen'] ?? null) ? $in['screen'] : '');
echo json_encode(['ok' => $ok]);
