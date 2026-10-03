<?php
include "session.php";
include "config.php";
include "database.php";

header('Content-Type: application/json');
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($db)) {
    echo '{"ok":false}';
    exit;
}

$db->exec("CREATE TABLE IF NOT EXISTS user_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    stream_id INTEGER,
    type TEXT,
    title TEXT,
    poster_url TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(username, stream_id, type)
)");

$stream_id = preg_replace('/[^0-9]/', '', (string)($_POST['id'] ?? ''));
$type = in_array($_POST['type'] ?? 'movie', ['movie', 'series', 'live'], true) ? $_POST['type'] : 'movie';
$action = in_array($_POST['action'] ?? '', ['add', 'remove'], true) ? $_POST['action'] : '';

if (!$stream_id || !$username || !$action) {
    echo '{"ok":false}';
    exit;
}

$title = trim((string)($_POST['title'] ?? '')) ?: 'Desconocido';
$poster = trim((string)($_POST['poster_url'] ?? ''));
if ($poster !== '' && !preg_match('~^https?://~i', $poster)) $poster = '';

if ($type === 'live') {
    wp_json_update(__DIR__ . '/api/live_favorites.json', function ($fav_data) use ($username, $stream_id, $action, $title, $poster) {
        if (!isset($fav_data[$username]) || !is_array($fav_data[$username])) $fav_data[$username] = [];
        if ($action === 'add') {
            $fav_data[$username][$stream_id] = ['title' => $title, 'poster_url' => $poster, 'added_at' => time()];
        } else {
            unset($fav_data[$username][$stream_id]);
        }
        return $fav_data;
    });
} elseif ($action === 'add') {
    if ($title == 'Desconocido' || $poster === '') {
        $apiData = $type === 'series'
            ? xt_get('get_series_info', ['series_id' => $stream_id], 21600)
            : xt_get('get_vod_info', ['vod_id' => $stream_id], 21600);
        if (isset($apiData['info'])) {
            if ($title == 'Desconocido') $title = $apiData['info']['name'] ?? 'Desconocido';
            if ($poster === '') $poster = $apiData['info']['cover'] ?? ($apiData['info']['movie_image'] ?? '');
        }
    }
    $stmt = $db->prepare("INSERT OR IGNORE INTO user_favorites (username, stream_id, type, title, poster_url) VALUES (:u, :sid, :t, :title, :poster)");
    $stmt->bindValue(':u', $username, SQLITE3_TEXT);
    $stmt->bindValue(':sid', (int)$stream_id, SQLITE3_INTEGER);
    $stmt->bindValue(':t', $type, SQLITE3_TEXT);
    $stmt->bindValue(':title', $title, SQLITE3_TEXT);
    $stmt->bindValue(':poster', $poster, SQLITE3_TEXT);
    $stmt->execute();
} else {
    $stmt = $db->prepare("DELETE FROM user_favorites WHERE username = :u AND stream_id = :sid AND type = :t");
    $stmt->bindValue(':u', $username, SQLITE3_TEXT);
    $stmt->bindValue(':sid', (int)$stream_id, SQLITE3_INTEGER);
    $stmt->bindValue(':t', $type, SQLITE3_TEXT);
    $stmt->execute();
}
echo '{"ok":true}';
