<?php
/**
 * El hosting de la web ya no convierte nada (ni ffmpeg ni ffprobe): la conversión de audio, subtítulos y video la hace
 * el motor del panel en la VPS / VDS de la línea (api/media_web.php del panel: la VDS propia del distribuidor si la
 * eligió, si no la del dueño). Este archivo queda solo para que un reproductor viejo guardado en el navegador reciba
 * la misma respuesta que "motor no disponible" y siga con el video directo.
 */
http_response_code(503);
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
echo json_encode(['ffmpeg' => false, 'error' => 'No compatible con el dispositivo'], JSON_UNESCAPED_UNICODE);
