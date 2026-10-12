<?php
/* Mi lista y canales favoritos: se guardan en el panel (api/progress.php). */
include "session.php";
include "config.php";

header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo '{"ok":false}';
    exit;
}

$stream_id = preg_replace('/[^0-9]/', '', (string)($_POST['id'] ?? ''));
$type = in_array($_POST['type'] ?? 'movie', ['movie', 'series', 'live'], true) ? $_POST['type'] : 'movie';
$action = in_array($_POST['action'] ?? '', ['add', 'remove'], true) ? $_POST['action'] : '';

if (!$stream_id || !$username || !$action) {
    echo '{"ok":false}';
    exit;
}

// DEMO: Mi lista no está disponible (no se llama al panel)
if (wp_is_demo()) {
    echo json_encode(['ok' => false, 'demo' => true, 'message' => 'No disponible en la DEMO'], JSON_UNESCAPED_UNICODE);
    exit;
}

if ($action === 'remove') {
    echo json_encode(['ok' => wp_panel_post('fav_remove', ['id' => $stream_id, 'type' => $type])]);
    exit;
}

$title = trim((string)($_POST['title'] ?? ''));
$poster = wp_panel_url($_POST['poster_url'] ?? '');
$category = '';
if ($type !== 'live') {
    $apiData = $type === 'series'
        ? xt_get('get_series_info', ['series_id' => $stream_id], 21600)
        : xt_get('get_vod_info', ['vod_id' => $stream_id], 21600);
    $info = is_array($apiData['info'] ?? null) ? $apiData['info'] : [];
    if ($title === '') $title = (string)($info['name'] ?? '');
    if ($poster === '') $poster = wp_panel_url($info['cover'] ?? ($info['movie_image'] ?? ''));
    $category = (string)($type === 'series' ? ($info['category_id'] ?? '') : ($apiData['movie_data']['category_id'] ?? ''));
}

echo json_encode(['ok' => wp_panel_post('fav_add', ['item' => [
    'id' => $stream_id,
    'type' => $type,
    'title' => $title !== '' ? $title : 'Desconocido',
    'poster' => $poster,
    'categoryId' => $category,
]])]);
