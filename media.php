<?php
/**
 * Motor multimedia opcional (requiere ffmpeg en el hosting o en la carpeta bin/).
 *  ?do=probe  → pistas de audio y subtítulos del contenido (JSON)
 *  ?do=tc     → video sin cambios + audio convertido a AAC estéreo (para audio Dolby AC3/E-AC3/DTS).
 *               t = segundo de inicio, a = pista de audio, v=1 convierte también el video (formatos antiguos)
 *  ?do=sub    → subtítulo interno convertido a WebVTT (i = pista)
 * Sólo acepta enlaces firmados por el propio servidor.
 */
require_once __DIR__ . '/includes/core.php';

$url = null;
if (!wp_verify_signed($url) || !isset($_GET['e'])) {
    http_response_code(403);
    exit;
}
$do = $_GET['do'] ?? 'probe';

if ($do === 'probe') {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: private, max-age=600');
    $p = wp_probe($url);
    if (!$p) { echo json_encode(['ok' => false]); exit; }
    $p = wp_probe_labels($p);
    $p['ok'] = true;
    echo json_encode($p, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** segundo exacto del fotograma clave donde arranca la conversión (el video copiado solo puede empezar ahí) */
function wp_media_kf($url, $t)
{
    if ($t <= 0) return 0.0;
    $ck = 'kf|' . md5($url) . '|' . $t;
    $hit = wp_cache_get($ck, 86400 * 7);
    if ($hit !== null) return (float)$hit;
    $fp = wp_bin('ffprobe');
    $out = $fp ? wp_run([$fp, '-v', 'error', '-user_agent', WP_UA, '-read_intervals', $t . '%+#1', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', $url], 20) : '';
    $k = is_string($out) && preg_match('/^\s*([0-9.]+)/', $out, $m) ? (float)$m[1] : (float)$t;
    if ($k > $t || $k < $t - 60) $k = (float)$t;
    wp_cache_set($ck, $k);
    return $k;
}

if ($do === 'kf') {
    header('Content-Type: application/json');
    header('Cache-Control: private, max-age=86400');
    $t = max(0, (int)($_GET['t'] ?? 0));
    echo json_encode(['k' => empty($_GET['v']) ? wp_media_kf($url, $t) : (float)$t]);
    exit;
}

$ff = wp_bin('ffmpeg');
if (!$ff) {
    http_response_code(501);
    exit;
}
@set_time_limit(0);
@ignore_user_abort(true);
@ini_set('zlib.output_compression', '0');
if (function_exists('apache_setenv')) @apache_setenv('no-gzip', '1');
while (ob_get_level() > 0) @ob_end_clean();

/* un solo proceso de conversión por usuario: al saltar en el video se detiene el anterior */
$sess = wp_session_read_close();
$who = md5((string)($sess['username'] ?? '') . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''));
$pidFile = wp_cache_dir() . '/ff_' . $who . '.pid';

if ($do === 'sub') {
    $i = max(0, (int)($_GET['i'] ?? 0));
    $ck = wp_cache_dir() . '/sub_' . md5($url . '|' . $i) . '.vtt';
    header('Content-Type: text/vtt; charset=utf-8');
    header('Cache-Control: private, max-age=86400');
    if (!is_file($ck) || filesize($ck) < 10) {
        // el subtítulo está repartido en todo el archivo: ffmpeg lo lee completo (puede tardar en archivos grandes)
        $out = wp_run([$ff, '-nostdin', '-v', 'error', '-user_agent', WP_UA, '-i', $url, '-map', '0:s:' . $i, '-f', 'webvtt', 'pipe:1'], 900);
        if (!$out || strpos($out, 'WEBVTT') === false) { http_response_code(404); exit; }
        @file_put_contents($ck, $out);
    }
    readfile($ck);
    exit;
}

if ($do !== 'tc') {
    http_response_code(400);
    exit;
}

$t = max(0, (int)($_GET['t'] ?? 0));
$a = max(0, (int)($_GET['a'] ?? 0));
$vtc = !empty($_GET['v']);
$probe = wp_probe($url);
$vcodec = $probe['video'] ?? '';

$cmd = [$ff, '-nostdin', '-v', 'error', '-user_agent', WP_UA, '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'];
// con video copiado ffmpeg arranca en el fotograma clave anterior a t; el reproductor pide ese segundo exacto (do=kf) para cuadrar el tiempo
if ($t > 0) array_push($cmd, '-ss', (string)$t);
array_push($cmd, '-i', $url, '-map', '0:v:0?', '-map', '0:a:' . $a . '?', '-sn', '-dn');
if ($vtc) {
    // formatos antiguos (XviD, MPEG-2, WMV...): se convierte el video a H.264 hasta 1080p
    array_push($cmd, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-vf', "scale='min(1920,iw)':-2", '-pix_fmt', 'yuv420p');
} else {
    array_push($cmd, '-c:v', 'copy');
    if (in_array($vcodec, ['hevc', 'h265'], true)) array_push($cmd, '-tag:v', 'hvc1');
}
array_push($cmd, '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000', 'pipe:1');

// detiene la conversión anterior de este usuario
if (is_file($pidFile)) {
    $old = (int)@file_get_contents($pidFile);
    if ($old > 1 && function_exists('posix_kill')) @posix_kill($old, 15);
    elseif ($old > 1 && wp_fn_ok('exec')) @exec('kill ' . $old);
    usleep(300000);
}

header('Content-Type: video/mp4');
header('Cache-Control: no-store');
header('X-Accel-Buffering: no');           // nginx
header('X-LiteSpeed-Cache-Control: no-cache'); // LiteSpeed (Hostinger)
header('Accept-Ranges: none');
@ini_set('output_buffering', '0');
@ini_set('implicit_flush', '1');

$sent = 0;
$errFile = wp_cache_dir() . '/ff_' . $who . '.err';
// hasta 3 intentos: si el servidor IPTV todavía cuenta la conexión anterior del navegador, rechaza la primera
for ($try = 0; $try < 3 && $sent === 0; $try++) {
    if ($try > 0) { sleep(2); if (connection_aborted()) break; }
    $pr = wp_spawn_stream($cmd, $errFile, $pidFile);
    if (!$pr) break;
    $myPid = (int)@file_get_contents($pidFile);
    $idle = 0;
    while (true) {
        $chunk = @fread($pr['h'], 65536);
        if ($chunk === false) break;
        if ($chunk === '') {
            if (feof($pr['h'])) break;
            if (!$pr['alive']()) { $chunk = (string)@stream_get_contents($pr['h']); if ($chunk === '') break; }
            else { usleep(20000); if (++$idle > 3000) break; continue; } // 60 s sin datos
        }
        $idle = 0;
        echo $chunk;
        @flush();
        $sent += strlen($chunk);
        if (connection_aborted()) break;
    }
    $pr['stop']();
    if ((int)@file_get_contents($pidFile) === $myPid) @unlink($pidFile);
}
if ($sent === 0 && !headers_sent()) http_response_code(502);
