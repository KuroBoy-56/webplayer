<?php
/* Lista .m3u para abrir el contenido en VLC desde la computadora (VLC la abre al hacer clic en el archivo descargado). */
include "session.php";
include "config.php";

$id = preg_replace('/[^0-9]/', '', (string)($_GET['id'] ?? ''));
$slug = in_array($_GET['slug'] ?? '', ['movie', 'series', 'live'], true) ? $_GET['slug'] : 'movie';
$ext = strtolower(preg_replace('/[^a-z0-9]/i', '', (string)($_GET['ext'] ?? ''))) ?: ($slug === 'live' ? 'ts' : 'mp4');
$title = trim((string)($_GET['title'] ?? '')) ?: 'Reproducir';
if ($id === '') { http_response_code(400); exit; }

$url = wp_stream_url($slug, $id, $ext);
$name = preg_replace('/[^A-Za-z0-9_\- ]/', '', $title) ?: 'video';
header('Content-Type: audio/x-mpegurl; charset=utf-8');
header('Content-Disposition: attachment; filename="' . $name . '.m3u"');
header('Cache-Control: no-store');
echo "#EXTM3U\n#EXTINF:-1," . str_replace(["\r", "\n"], ' ', $title) . "\n#EXTVLCOPT:http-user-agent=VLC/3.0.21 LibVLC/3.0.21\n" . $url . "\n";
