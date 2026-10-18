<?php
/* Cuenta las pistas de audio de un contenido (solo lee la cabecera del archivo, sin ffmpeg) y guarda el resultado.
 * Lo pide el reproductor en segundo plano cuando todavía no se sabe. Solo acepta enlaces firmados. */
require_once __DIR__ . '/includes/core.php';
$url = null;
if (!wp_verify_signed($url) || !isset($_GET['e'])) {
    http_response_code(403);
    exit;
}
header('Content-Type: application/json');
header('Cache-Control: private, max-age=3600');
@set_time_limit(90);
// en segundo plano se puede esperar a ffprobe si la lectura rápida no alcanzó (solo con permiso del motor)
require_once __DIR__ . '/includes/media_admin.php';
echo json_encode(['n' => wp_audio_track_count($url, false, wp_media_off_text() === '')]);
