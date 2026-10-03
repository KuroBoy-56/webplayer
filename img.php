<?php
/**
 * Imágenes a través del servidor (sólo en sitios HTTPS con pósters http).
 * URLs firmadas + caché en disco de 7 días para que todo cargue rápido.
 */
require_once __DIR__ . '/includes/core.php';

$url = null;
if (!wp_verify_signed($url)) {
    http_response_code(403);
    exit;
}

$dir = wp_cache_dir('img');
$key = md5($url);
$file = $dir . '/' . $key . '.bin';
$meta = $dir . '/' . $key . '.type';
$ttl = 7 * 86400;

function wp_img_out($file, $type)
{
    $etag = '"' . md5_file($file) . '"';
    header('Content-Type: ' . $type);
    header('Cache-Control: public, max-age=604800, immutable');
    header('ETag: ' . $etag);
    header('X-Content-Type-Options: nosniff');
    if (isset($_SERVER['HTTP_IF_NONE_MATCH']) && trim($_SERVER['HTTP_IF_NONE_MATCH']) === $etag) {
        http_response_code(304);
        exit;
    }
    header('Content-Length: ' . filesize($file));
    readfile($file);
    exit;
}

if (is_file($file) && is_file($meta) && (time() - filemtime($file) < $ttl)) {
    wp_img_out($file, trim((string)file_get_contents($meta)));
}

$ch = wp_curl($url, 12);
curl_setopt($ch, CURLOPT_ENCODING, '');
curl_setopt($ch, CURLOPT_NOPROGRESS, false);
curl_setopt($ch, CURLOPT_PROGRESSFUNCTION, function ($c, $dlTotal, $dl) {
    return $dl > 8 * 1024 * 1024 ? 1 : 0; // máx. 8 MB
});
$body = curl_exec($ch);
$code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
$type = strtolower((string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE));
curl_close($ch);

$type = trim(explode(';', $type)[0]);
if ($body === false || $code >= 400 || $body === '') {
    if (is_file($file) && is_file($meta)) wp_img_out($file, trim((string)file_get_contents($meta)));
    header('Location: ' . WP_NOIMG);
    exit;
}
if (strpos($type, 'image/') !== 0) {
    // detecta el tipo real si el servidor no lo envía
    $sig = substr($body, 0, 12);
    if (strncmp($sig, "\xFF\xD8", 2) === 0) $type = 'image/jpeg';
    elseif (strncmp($sig, "\x89PNG", 4) === 0) $type = 'image/png';
    elseif (strncmp($sig, 'GIF8', 4) === 0) $type = 'image/gif';
    elseif (substr($sig, 0, 4) === 'RIFF' && substr($sig, 8, 4) === 'WEBP') $type = 'image/webp';
    else {
        header('Location: ' . WP_NOIMG);
        exit;
    }
}
if ($type === 'image/svg+xml') {
    header('Location: ' . WP_NOIMG); // los SVG externos pueden contener scripts
    exit;
}
@file_put_contents($file, $body);
@file_put_contents($meta, $type);
if (mt_rand(1, 300) === 1) {
    // limpieza ocasional de imágenes viejas
    foreach ((array)glob($dir . '/*.bin') as $old) {
        if (filemtime($old) < time() - 20 * 86400) { @unlink($old); @unlink(substr($old, 0, -4) . '.type'); }
    }
}
wp_img_out($file, $type);
