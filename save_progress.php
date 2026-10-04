<?php
/* Guarda "Continuar viendo" en el panel (api/progress.php). Nada se guarda en el hosting. */
include "session.php";
include "config.php";

header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo '{"ok":false}';
    exit;
}

$stream_id = preg_replace('/[^0-9]/', '', (string)($_POST['id'] ?? ''));
$slug = ($_POST['slug'] ?? 'movie') === 'series' ? 'series' : 'movie';
$series_id = preg_replace('/[^0-9]/', '', (string)($_POST['series_id'] ?? '0')) ?: '0';
$current_time = max(0, (int)($_POST['current_time'] ?? 0));
$total_time = max(0, (int)($_POST['total_time'] ?? 0));

if (!$stream_id || !$username || ($slug === 'series' && $series_id === '0')) {
    echo '{"ok":false}';
    exit;
}

// Título, póster, categoría y extensión (desde la caché de la API Xtream)
$title = '';
$poster = '';
$category = '';
$ext = 'mp4';
if ($slug === 'series') {
    $apiData = xt_get('get_series_info', ['series_id' => $series_id], 21600);
    $title = (string)($apiData['info']['name'] ?? '');
    $poster = (string)($apiData['info']['cover'] ?? '');
    $category = (string)($apiData['info']['category_id'] ?? '');
    foreach ((array)($apiData['episodes'] ?? []) as $eps) {
        foreach ((array)$eps as $ep) {
            if (is_array($ep) && (string)($ep['id'] ?? '') === $stream_id) {
                $ext = (string)($ep['container_extension'] ?? 'mp4');
                break 2;
            }
        }
    }
} else {
    $apiData = xt_get('get_vod_info', ['vod_id' => $stream_id], 21600);
    $title = (string)($apiData['info']['name'] ?? ($apiData['movie_data']['name'] ?? ''));
    $poster = (string)($apiData['info']['movie_image'] ?? ($apiData['info']['cover_big'] ?? ''));
    $category = (string)($apiData['movie_data']['category_id'] ?? '');
    $ext = (string)($apiData['movie_data']['container_extension'] ?? 'mp4');
}
$title = trim($title);
if ($title === '') {
    // Sin nombre no hay clave en el panel (el panel guarda una entrada por título)
    echo '{"ok":false}';
    exit;
}

// Visto al 95 % o más: se quita de "Continuar viendo"
if ($total_time > 0 && $current_time / $total_time >= 0.95) {
    $ok = wp_panel_post('delete', ['title' => $title]);
    echo json_encode(['ok' => $ok]);
    exit;
}

// Series: una sola entrada por serie (clave = nombre de la serie) con el último episodio visto
$ok = wp_panel_post('save', [
    'title' => $title,
    'position' => $current_time,
    'duration' => $total_time,
    'url' => wp_stream_url($slug === 'series' ? 'series' : 'movie', $stream_id, $ext),
    'poster' => wp_panel_url($poster),
    'type' => $slug === 'series' ? 'episode' : 'movie',
    'id' => $stream_id,
    'seriesId' => $slug === 'series' ? $series_id : '',
    'categoryId' => $category,
]);
echo json_encode(['ok' => $ok]);
