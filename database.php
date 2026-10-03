<?php
$db_file = __DIR__ . '/includes/userdata.sqlite';
$db = new SQLite3($db_file);

$db->exec("CREATE TABLE IF NOT EXISTS user_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    stream_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    poster_url TEXT,
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(username, stream_id)
)");

$db->exec("CREATE TABLE IF NOT EXISTS user_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    stream_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    poster_url TEXT,
    current_time INTEGER NOT NULL,
    total_time INTEGER NOT NULL,
    last_watched DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(username, stream_id)
)");

@$db->exec("ALTER TABLE user_progress ADD COLUMN series_id INTEGER DEFAULT 0");
?>