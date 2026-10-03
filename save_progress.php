<?php
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

if (!$stream_id || !$username) {
    echo '{"ok":false}';
    exit;
}

$file_progress = __DIR__ . '/progress.json';
$file_history = __DIR__ . '/api/history.json';
$key = $slug . '_' . $stream_id;

// Título y póster (sólo la primera vez, con caché)
$existing = wp_user_progress($username);
$title = $existing[$key]['title'] ?? '';
$poster = $existing[$key]['poster_url'] ?? '';
if ($title === '' || $title === 'Desconocido') {
    if ($slug == 'series' && $series_id) {
        $apiData = xt_get('get_series_info', ['series_id' => $series_id], 21600);
        $title = $apiData['info']['name'] ?? 'Desconocido';
        $poster = $apiData['info']['cover'] ?? '';
    } else {
        $apiData = xt_get('get_vod_info', ['vod_id' => $stream_id], 21600);
        $title = $apiData['info']['name'] ?? 'Desconocido';
        $poster = $apiData['info']['movie_image'] ?? '';
    }
}

$completed = false;
wp_json_update($file_progress, function ($data_prog) use ($username, $key, $slug, $series_id, $stream_id, $current_time, $total_time, $title, $poster, &$completed) {
    if (!isset($data_prog[$username]) || !is_array($data_prog[$username])) $data_prog[$username] = [];

    // Para series sólo se guarda el último episodio visto
    if ($slug == 'series' && $series_id) {
        foreach ($data_prog[$username] as $k => $v) {
            if (isset($v['type']) && $v['type'] == 'series' && isset($v['series_id']) && $v['series_id'] == $series_id && $k != $key) {
                unset($data_prog[$username][$k]);
            }
        }
    }

    $final_total = $total_time;
    if ($total_time == 0 && !empty($data_prog[$username][$key]['total_time'])) {
        $final_total = $data_prog[$username][$key]['total_time'];
    }
    $percentage = $final_total > 0 ? ($current_time / $final_total) * 100 : 0;

    if ($percentage >= 95) {
        unset($data_prog[$username][$key]);
        $completed = true;
    } else {
        $data_prog[$username][$key] = [
            'stream_id' => $stream_id,
            'series_id' => $series_id,
            'type' => $slug,
            'title' => $title,
            'poster_url' => $poster,
            'current_time' => $current_time,
            'total_time' => $final_total,
            'last_watched' => time(),
        ];
    }
    return $data_prog;
});

if ($completed) {
    wp_json_update($file_history, function ($data_hist) use ($username, $key, $title, $slug) {
        if (!isset($data_hist[$username]) || !is_array($data_hist[$username])) $data_hist[$username] = [];
        $data_hist[$username][$key] = ['title' => $title, 'type' => $slug, 'completed_at' => time()];
        return $data_hist;
    });
}
echo '{"ok":true}';
