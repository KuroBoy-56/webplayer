<?php
/**
 * Proxy de video seguro.
 * - Sólo acepta URLs firmadas por el propio servidor (no es un proxy abierto)
 * - Requiere sesión iniciada
 * - Soporta saltos en el video (Range) y listas HLS (.m3u8) reescribiendo segmentos,
 *   para reproducir servidores http dentro de un sitio https sin errores de contenido mixto.
 */
require_once __DIR__ . '/includes/core.php';

// registro del último error de PHP (lo muestra diag.php): ayuda a ver por qué se corta el video
register_shutdown_function(function () {
    $e = error_get_last();
    if ($e && in_array($e['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR, E_USER_ERROR, E_RECOVERABLE_ERROR], true)) {
        @file_put_contents(wp_cache_dir('data') . '/proxy_error.txt', date('d/m H:i:s') . ' ' . $e['message'] . ' (' . basename($e['file']) . ':' . $e['line'] . ")\n", FILE_APPEND);
    }
});

$url = null;
// Los enlaces firmados con caducidad no necesitan cookie (el iPhone a veces no la envía al pedir el video)
if (!wp_verify_signed($url) || !isset($_GET['e'])) {
    $sess = wp_session_read_close();
    if (empty($sess['username'])) {
        http_response_code(403);
        exit;
    }
}
if ($url === null) {
    // compatibilidad con enlaces antiguos ?url=base64, sólo hacia las DNS configuradas
    $legacy = isset($_GET['url']) ? base64_decode((string)$_GET['url'], true) : false;
    $ok = false;
    if ($legacy && preg_match('~^https?://~i', $legacy)) {
        $h = strtolower((string)parse_url($legacy, PHP_URL_HOST));
        foreach (wp_dns_list() as $srv) {
            if ($h !== '' && $h === strtolower((string)parse_url($srv['url'], PHP_URL_HOST))) { $ok = true; break; }
        }
    }
    if (!$ok) {
        http_response_code(403);
        exit;
    }
    $url = $legacy;
}

@set_time_limit(0);
@ignore_user_abort(false);
@ini_set('zlib.output_compression', '0');
if (function_exists('apache_setenv')) @apache_setenv('no-gzip', '1');
while (ob_get_level() > 0) @ob_end_clean();

function wp_resolve_url($base, $rel)
{
    $rel = trim($rel);
    if (preg_match('~^[a-z][a-z0-9+.-]*://~i', $rel)) return $rel;
    $p = parse_url($base);
    $scheme = $p['scheme'] ?? 'http';
    $auth = $scheme . '://' . ($p['host'] ?? '') . (isset($p['port']) ? ':' . $p['port'] : '');
    if (strpos($rel, '//') === 0) return $scheme . ':' . $rel;
    if ($rel !== '' && $rel[0] === '/') return $auth . $rel;
    $path = $p['path'] ?? '/';
    $dir = substr($path, 0, strrpos($path, '/') + 1);
    $full = $dir . $rel;
    // normaliza ./ y ../
    $parts = [];
    foreach (explode('/', $full) as $seg) {
        if ($seg === '..') { array_pop($parts); } elseif ($seg !== '.') { $parts[] = $seg; }
    }
    return $auth . implode('/', $parts);
}

function wp_rewrite_m3u8($body, $base)
{
    $out = [];
    foreach (preg_split('/\r\n|\n|\r/', $body) as $line) {
        $t = trim($line);
        if ($t === '') { $out[] = $line; continue; }
        if ($t[0] === '#') {
            $out[] = preg_replace_callback('/URI="([^"]+)"/', function ($m) use ($base) {
                return 'URI="' . wp_proxy_url(wp_resolve_url($base, $m[1])) . '"';
            }, $line);
            continue;
        }
        $out[] = wp_proxy_url(wp_resolve_url($base, $t));
    }
    return implode("\n", $out);
}

$path = (string)parse_url($url, PHP_URL_PATH);
$isPlaylist = (bool)preg_match('/\.m3u8?$/i', $path);
$state = ['code' => 200, 'headers' => [], 'mode' => null, 'buf' => '', 'sent' => false, 'left' => -1];
// Range pedido por el navegador (iPhone/Safari siempre pide "bytes=0-1" antes de reproducir un MP4)
$wantRange = null;
if (!empty($_SERVER['HTTP_RANGE']) && preg_match('/^bytes=(\d+)-(\d*)$/', trim($_SERVER['HTTP_RANGE']), $rm)) {
    $wantRange = [(int)$rm[1], $rm[2] === '' ? null : (int)$rm[2]];
}

$isHead = ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD';
$mimeByExt = ['mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'mov' => 'video/quicktime', 'mkv' => 'video/x-matroska',
    'webm' => 'video/webm', 'ts' => 'video/mp2t', 'avi' => 'video/x-msvideo', 'mp3' => 'audio/mpeg', 'aac' => 'audio/aac',
    'm4s' => 'video/iso.segment', 'vtt' => 'text/vtt', 'srt' => 'text/plain'];
$extMime = $mimeByExt[strtolower(pathinfo($path, PATHINFO_EXTENSION))] ?? '';

$fwd = [];
if (!empty($_SERVER['HTTP_RANGE'])) $fwd[] = 'Range: ' . $_SERVER['HTTP_RANGE'];
if (!empty($_SERVER['HTTP_IF_RANGE'])) $fwd[] = 'If-Range: ' . $_SERVER['HTTP_IF_RANGE'];

$ch = curl_init($url);
wp_doh_apply($ch, $url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => false,
    CURLOPT_HEADER => false,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS => 8,
    CURLOPT_CONNECTTIMEOUT => 12,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_SSL_VERIFYHOST => 0,
    CURLOPT_USERAGENT => WP_UA,
    CURLOPT_HTTPHEADER => $fwd,
    CURLOPT_BUFFERSIZE => 256 * 1024,
    CURLOPT_NOBODY => $isHead && !$isPlaylist,
    CURLOPT_LOW_SPEED_LIMIT => 1,
    CURLOPT_LOW_SPEED_TIME => 60,
    CURLOPT_HEADERFUNCTION => function ($c, $h) use (&$state) {
        $len = strlen($h);
        $h = trim($h);
        if ($h === '') return $len;
        if (preg_match('~^HTTP/\S+\s+(\d{3})~', $h, $m)) {
            $state['code'] = (int)$m[1];
            $state['headers'] = [];
            return $len;
        }
        $pos = strpos($h, ':');
        if ($pos !== false) $state['headers'][strtolower(trim(substr($h, 0, $pos)))] = trim(substr($h, $pos + 1));
        return $len;
    },
    CURLOPT_WRITEFUNCTION => function ($c, $chunk) use (&$state, $isPlaylist, $extMime, $wantRange) {
        if ($state['mode'] === null) {
            $ct = strtolower($state['headers']['content-type'] ?? '');
            $state['mode'] = ($isPlaylist || strpos($ct, 'mpegurl') !== false || strncmp(ltrim($chunk), '#EXTM3U', 7) === 0) ? 'playlist' : 'stream';
            if ($state['mode'] === 'stream') {
                wp_proxy_fake_range($state, $wantRange);
                wp_proxy_send_headers($state, $extMime);
                $state['sent'] = true;
            }
        }
        if ($state['left'] >= 0 && $state['mode'] === 'stream') {
            // el servidor IPTV ignoró el Range: se entrega solo el tramo pedido y se corta
            if ($state['left'] === 0) return -1;
            if (strlen($chunk) > $state['left']) $chunk = substr($chunk, 0, $state['left']);
            $state['left'] -= strlen($chunk);
            echo $chunk;
            @flush();
            return $state['left'] === 0 ? -1 : strlen($chunk);
        }
        if ($state['mode'] === 'playlist') {
            $state['buf'] .= $chunk;
            return strlen($chunk);
        }
        echo $chunk;
        @flush();
        if (connection_aborted()) return -1;
        return strlen($chunk);
    },
]);

/**
 * Si el navegador pidió un tramo desde el byte 0 y el servidor IPTV respondió el archivo completo (200),
 * se responde 206 con ese tramo. Sin esto Safari en iPhone no abre el MP4 ni permite adelantar.
 */
function wp_proxy_fake_range(&$state, $wantRange)
{
    if (!$wantRange || $wantRange[0] !== 0 || $state['code'] !== 200) return;
    $len = isset($state['headers']['content-length']) ? (int)$state['headers']['content-length'] : 0;
    if ($len <= 0) return;
    $end = $wantRange[1] === null ? $len - 1 : min($len - 1, $wantRange[1]);
    $state['code'] = 206;
    $state['headers']['content-range'] = 'bytes 0-' . $end . '/' . $len;
    $state['headers']['content-length'] = (string)($end + 1);
    $state['headers']['accept-ranges'] = 'bytes';
    if ($end < $len - 1) $state['left'] = $end + 1;
}

function wp_proxy_send_headers($state, $extMime)
{
    http_response_code($state['code']);
    // Tipo correcto: Safari/iPhone no reproduce si el servidor responde application/octet-stream
    $ct = strtolower($state['headers']['content-type'] ?? '');
    if ($extMime && $state['code'] < 300 && strpos($ct, 'video/') !== 0 && strpos($ct, 'audio/') !== 0 && strpos($ct, 'mpegurl') === false) {
        $state['headers']['content-type'] = $extMime;
    }
    foreach (['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag'] as $k) {
        if (isset($state['headers'][$k])) header(ucwords($k, '-') . ': ' . $state['headers'][$k]);
    }
    if (!isset($state['headers']['accept-ranges']) && ($state['code'] === 206 || isset($state['headers']['content-length']))) header('Accept-Ranges: bytes');
    header('Cache-Control: no-store');
    header('X-Accel-Buffering: no');
}

curl_exec($ch);
$err = curl_errno($ch);
$final = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL) ?: $url;
curl_close($ch);

if ($state['mode'] === 'playlist') {
    // el servidor respondió una página (no una lista HLS): se avisa al reproductor para que pruebe otro formato
    if (strncmp(ltrim($state['buf']), '#EXTM3U', 7) !== 0) {
        http_response_code(415);
        exit;
    }
    header('Content-Type: application/vnd.apple.mpegurl');
    header('Cache-Control: no-store');
    echo wp_rewrite_m3u8($state['buf'], $final);
    exit;
}
if (!$state['sent']) {
    if ($isHead && !$err && $state['code'] < 400) {
        wp_proxy_fake_range($state, $wantRange);
        wp_proxy_send_headers($state, $extMime); // HEAD: sólo cabeceras
    } else {
        http_response_code($err ? 502 : ($state['code'] ?: 502));
    }
}
