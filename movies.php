<?php
// Lista de películas por categoría (se conserva la URL movies.php?id=CATEGORIA&order=...)
$_GET['type'] = 'movie';
$_GET['cat'] = isset($_GET['id']) ? (string)$_GET['id'] : '';
$order = $_GET['order'] ?? 'default';
$_GET['sort'] = $order === 'az' ? 'az' : ($order === 'rating' ? 'rating' : 'recent');
include __DIR__ . '/browse.php';
