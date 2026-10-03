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

$noimg = !empty($_GET['fb']) ? WP_LOGO : WP_NOIMG; // logos de canales: logo del webplayer
// espacios y acentos sin codificar en la URL del logo
$url = preg_replace_callback('/[^\x21-\x7e]/', function ($m) { return rawurlencode($m[0]); }, $url);
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

// imagen que falló hace poco: no se vuelve a esperar al servidor caído
$bad = $dir . '/' . $key . '.bad';
if (is_file($bad) && time() - filemtime($bad) < 86400 && !is_file($file)) {
    header('Cache-Control: public, max-age=3600');
    header('Location: ' . $noimg);
    exit;
}
function wp_img_fail($bad, $noimg)
{
    @touch($bad);
    header('Cache-Control: public, max-age=3600');
    header('Location: ' . $noimg);
    exit;
}

$ch = wp_curl($url, !empty($_GET['fb']) ? 7 : 12);
curl_setopt($ch, CURLOPT_ENCODING, '');
curl_setopt($ch, CURLOPT_REFERER, (string)parse_url($url, PHP_URL_SCHEME) . '://' . (string)parse_url($url, PHP_URL_HOST) . '/');
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
    wp_img_fail($bad, $noimg);
}
if (strpos($type, 'image/') !== 0) {
    // detecta el tipo real si el servidor no lo envía
    $sig = substr($body, 0, 12);
    if (strncmp($sig, "\xFF\xD8", 2) === 0) $type = 'image/jpeg';
    elseif (strncmp($sig, "\x89PNG", 4) === 0) $type = 'image/png';
    elseif (strncmp($sig, 'GIF8', 4) === 0) $type = 'image/gif';
    elseif (substr($sig, 0, 4) === 'RIFF' && substr($sig, 8, 4) === 'WEBP') $type = 'image/webp';
    else wp_img_fail($bad, $noimg);
}
if (strlen($body) < 120) {
    wp_img_fail($bad, $noimg); // imagen vacía o de 1 píxel
}
if ($type === 'image/svg+xml') {
    header('Location: ' . $noimg); // los SVG externos pueden contener scripts
    exit;
}
@file_put_contents($file, $body);
@file_put_contents($meta, $type);
@unlink($bad);
if (mt_rand(1, 300) === 1) {
    // limpieza ocasional de imágenes viejas
    foreach ((array)glob($dir . '/*.bin') as $old) {
        if (filemtime($old) < time() - 20 * 86400) { @unlink($old); @unlink(substr($old, 0, -4) . '.type'); }
    }
}
wp_img_out($file, $type);
