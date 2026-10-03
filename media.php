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
    foreach ($p['audio'] as &$a) {
        $a['label'] = trim((wp_lang_name($a['lang']) ?: 'Audio ' . ($a['i'] + 1)) . ($a['title'] !== '' && stripos($a['title'], wp_lang_name($a['lang'])) === false ? ' · ' . $a['title'] : '')
            . ' (' . strtoupper(str_replace(['eac3', 'truehd'], ['E-AC3', 'TrueHD'], $a['codec'])) . ($a['ch'] >= 6 ? ' 5.1' : '') . ')');
    }
    unset($a);
    foreach ($p['subs'] as &$s) {
        $s['label'] = trim((wp_lang_name($s['lang']) ?: 'Subtítulo ' . ($s['i'] + 1)) . ($s['title'] !== '' ? ' · ' . $s['title'] : '') . ($s['forced'] ? ' (forzado)' : ''));
    }
    unset($s);
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
// con video copiado se arranca justo en el fotograma clave, así audio, video y subtítulos quedan sincronizados
if ($t > 0) array_push($cmd, '-ss', (string)($vtc ? $t : wp_media_kf($url, (int)$t)));
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
if (is_file($pidFile) && function_exists('posix_kill')) {
    $old = (int)@file_get_contents($pidFile);
    if ($old > 1) @posix_kill($old, 15);
}

$line = 'exec ' . implode(' ', array_map('escapeshellarg', $cmd));
$proc = @proc_open($line, [1 => ['pipe', 'w'], 2 => ['file', '/dev/null', 'w']], $pipes);
if (!is_resource($proc)) {
    http_response_code(500);
    exit;
}
$st = proc_get_status($proc);
@file_put_contents($pidFile, (string)$st['pid']);

header('Content-Type: video/mp4');
header('Cache-Control: no-store');
header('X-Accel-Buffering: no');
header('Accept-Ranges: none');

$sent = 0;
while (!feof($pipes[1])) {
    $chunk = fread($pipes[1], 65536);
    if ($chunk === false) break;
    if ($chunk === '') { usleep(20000); if (!proc_get_status($proc)['running']) break; continue; }
    echo $chunk;
    @flush();
    $sent += strlen($chunk);
    if (connection_aborted()) break;
}
@fclose($pipes[1]);
$st = proc_get_status($proc);
if ($st['running']) @proc_terminate($proc, 15);
@proc_close($proc);
if ((int)@file_get_contents($pidFile) === (int)$st['pid']) @unlink($pidFile);
if ($sent === 0 && !headers_sent()) http_response_code(502);
