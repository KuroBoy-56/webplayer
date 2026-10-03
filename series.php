<?php
// Lista de series por categoría (se conserva la URL series.php?id=CATEGORIA&order=...)
$_GET['type'] = 'series';
$id = isset($_GET['id']) ? (string)$_GET['id'] : '';
$_GET['cat'] = ($id === 'recently_added') ? '' : $id;
$order = $_GET['order'] ?? 'default';
$_GET['sort'] = $order === 'az' ? 'az' : ($order === 'rating' ? 'rating' : 'recent');
include __DIR__ . '/browse.php';
