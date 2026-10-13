<?php
/**
 * Motor multimedia opcional (requiere ffmpeg en el hosting o en la carpeta bin/).
 *  ?do=probe  → pistas de audio y subtítulos del contenido (JSON)
 *  ?do=tc     → video sin cambios + audio convertido a AAC estéreo (para audio Dolby AC3/E-AC3/DTS).
 *               t = segundo de inicio, a = pista de audio, v=1 convierte también el video (formatos antiguos)
 *  ?do=sub    → subtítulo interno convertido a WebVTT (i = pista)
 *  ?do=hls    → lo mismo que tc pero en HLS (iPhone/Safari y TV en vivo sin MSE); ?do=seg = sus segmentos
 * Sólo acepta enlaces firmados por el propio servidor.
 */
require_once __DIR__ . '/includes/core.php';

/* Si el servidor IPTV deja de mandar datos, ffmpeg corta la lectura a los 15 s y se reconecta
 * (-reconnect) en vez de esperar para siempre: antes la conversión quedaba "Convirtiendo" sin fin. */
const WP_FF_RW_TIMEOUT = '15000000';
/* Sin datos de ffmpeg durante este tiempo la conversión se da por colgada y se detiene (segundos).
 * FIRST: desde que arranca ffmpeg hasta el primer fragmento con video y audio (o el primer segmento HLS);
 * si no llega se responde error y el reproductor vuelve al video original en vez de quedarse "Cargando". */
const WP_TC_FIRST_WAIT = 25;
const WP_TC_IDLE_WAIT = 45;

$url = null;
if (!wp_verify_signed($url) || !isset($_GET['e'])) {
    http_response_code(403);
    exit;
}
$do = $_GET['do'] ?? 'probe';
// motor apagado desde el panel (Guía EPG): el reproductor sigue con el video directo
require_once __DIR__ . '/includes/media_admin.php';
if (!wp_media_enabled() && $do !== 'seg') {
    http_response_code(503);
    exit;
}
// DNS elegido por el usuario: ffmpeg no usa curl, se le pasa la IP resuelta y la cabecera Host
list($ffurl, $ffhdr) = wp_doh_ffmpeg($url);

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
function wp_media_kf($url, $t, $cacheOnly = false)
{
    if ($t <= 0) return 0.0;
    $ck = 'kf|' . md5($url) . '|' . $t;
    $hit = wp_cache_get($ck, 86400 * 7);
    if ($hit !== null) return (float)$hit;
    // el reproductor lo pide mientras se convierte: otra conexión al servidor IPTV podría cortar la conversión
    if ($cacheOnly) return (float)$t;
    $fp = wp_bin('ffprobe');
    list($in, $hdr) = wp_doh_ffmpeg($url);
    $out = $fp ? wp_run(array_merge([$fp, '-v', 'error', '-user_agent', WP_UA, '-rw_timeout', WP_FF_RW_TIMEOUT], $hdr, ['-read_intervals', $t . '%+#1', '-select_streams', 'v:0', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', $in]), 12) : '';
    if (!is_string($out) || !preg_match('/^\s*([0-9.]+)/', $out, $m)) return (float)$t; // sin respuesta: no se guarda
    $k = (float)$m[1];
    if ($k > $t || $k < $t - 60) $k = (float)$t;
    wp_cache_set($ck, $k);
    return $k;
}

/**
 * Opciones de inicio (-ss) de la conversión.
 * Con el video copiado ffmpeg solo puede empezar en un fotograma clave (k, anterior a t). Antes se pedía
 * "-ss t": el video arrancaba en k pero el audio convertido se recortaba exacto en t, así que el audio
 * empezaba (t - k) segundos después del video (hasta 10 s, según el archivo) y quedaba desfasado o con un
 * hueco al inicio. Ahora video y audio arrancan juntos en k (-noaccurate_seek: el audio no se recorta) y k es
 * el mismo segundo que el reproductor lee con do=kf. Se busca k + 0,5 s porque ffmpeg corre el -ss hacia atrás
 * (el inicio del archivo, a veces -0,005 s por el audio, y 0,13 s si el video tiene cuadros B): con "-ss k" o
 * "-ss t" justo en un fotograma clave caía en el anterior (10 s antes) y el tiempo del reproductor quedaba corrido.
 * Con el video convertido el corte sí es exacto en t para los dos.
 */
function wp_media_seek($url, $t, $vcopy)
{
    if ($t <= 0) return [];
    if (!$vcopy) return ['-ss', (string)$t];
    return ['-ss', sprintf('%.3F', wp_media_kf($url, $t) + 0.5), '-noaccurate_seek'];
}

/** La preparación (ffprobe de pistas y fotograma clave) tardó tanto (servidor IPTV sin responder) que el reproductor
 *  ya vuelve al video original: no se abre ffmpeg, que solo ocuparía otra conexión de la cuenta IPTV. */
function wp_media_late()
{
    return microtime(true) - (float)($_SERVER['REQUEST_TIME_FLOAT'] ?? microtime(true)) > 20;
}

/* audio convertido: aresample=async=1 rellena con silencio (o recorta) los huecos y saltos de tiempo del audio
 * original, así el AAC dura lo mismo que el video y no se va desfasando a lo largo de la película */
const WP_FF_AUDIO_SYNC = 'aresample=async=1';

if ($do === 'kf') {
    header('Content-Type: application/json');
    header('Cache-Control: private, max-age=86400');
    $t = max(0, (int)($_GET['t'] ?? 0));
    echo json_encode(['k' => empty($_GET['v']) ? wp_media_kf($url, $t, !empty($_GET['c'])) : (float)$t]);
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

if ($do === 'check') {
    // "Solucionar" del reproductor: comprueba si ffmpeg puede leer y convertir este contenido
    header('Content-Type: application/json');
    header('Cache-Control: no-store');
    @set_time_limit(120);
    $base = [$ff, '-nostdin', '-hide_banner', '-v', 'error', '-user_agent', WP_UA, '-rw_timeout', '20000000', '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err'];
    $base = array_merge($base, $ffhdr);
    $r = wp_exec(array_merge($base, ['-t', '8', '-i', $ffurl, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'copy', '-c:a', 'aac', '-ac', '2',
        '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-y', '/dev/null']), 45);
    if ($r['ok']) { echo json_encode(['ok' => true, 'mode' => 'audio', 'speed' => $r['ms'] ? round(8000 / $r['ms'], 1) : 0]); exit; }
    $r2 = wp_exec(array_merge($base, ['-t', '5', '-i', $ffurl, '-map', '0:v:0?', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'ultrafast', '-vf', "scale='min(1280,iw)':-2",
        '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ac', '2', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-y', '/dev/null']), 60);
    if ($r2['ok']) { echo json_encode(['ok' => true, 'mode' => 'video', 'speed' => $r2['ms'] ? round(5000 / $r2['ms'], 1) : 0]); exit; }
    // archivo dañado o con marcas de tiempo rotas: modo seguro a 480p con audio resincronizado
    $r3 = wp_exec(array_merge($base, ['-t', '5', '-i', $ffurl, '-map', '0:v:0?', '-map', '0:a:0?', '-max_muxing_queue_size', '2048', '-c:v', 'libx264', '-preset', 'ultrafast',
        '-vf', "scale='min(854,iw)':-2,fps=30", '-pix_fmt', 'yuv420p', '-af', 'aresample=async=1000', '-c:a', 'aac', '-ac', '2', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov', '-y', '/dev/null']), 60);
    if ($r3['ok']) { echo json_encode(['ok' => true, 'mode' => 'safe', 'speed' => $r3['ms'] ? round(5000 / $r3['ms'], 1) : 0]); exit; }
    echo json_encode(['ok' => false, 'err' => mb_substr($r3['err'] ?: ($r2['err'] ?: $r['err']), -300, null, 'UTF-8')], JSON_UNESCAPED_UNICODE);
    exit;
}

/* ---------- HLS convertido (celulares sin MSE, sobre todo iPhone/Safari) ----------
 * ?do=hls  → lista m3u8 que ffmpeg va generando en segundo plano (t, a, v igual que tc; live=1 para TV en vivo)
 * ?do=seg  → segmento de esa lista (f = nombre del archivo)
 * Safari en iPhone no reproduce un MP4 "en flujo" sin saltos (lo que entrega do=tc), pero sí HLS.
 * El proceso se detiene solo cuando el celular deja de pedir segmentos (45 s).
 */
if ($do === 'hls' || $do === 'seg') {
    $t = max(0, (int)($_GET['t'] ?? 0));
    $a = max(0, (int)($_GET['a'] ?? 0));
    $v = (string)($_GET['v'] ?? '');
    $v = $v === '2' ? '2' : ($v === '1' ? '1' : '');
    $live = !empty($_GET['live']);
    $dir = wp_cache_dir('hls') . '/' . md5($url . '|' . $t . '|' . $a . '|' . $v . '|' . ($live ? 'L' : 'V'));
    $q = ['u' => (string)$_GET['u'], 'e' => (string)$_GET['e'], 's' => (string)$_GET['s'], 't' => $t, 'a' => $a, 'v' => $v, 'live' => $live ? '1' : ''];
    header('Cache-Control: no-store');

    if ($do === 'seg') {
        $f = (string)($_GET['f'] ?? '');
        if (!preg_match('/^(s\d{1,6}\.m4s|init\.mp4)$/', $f) || !is_file($dir . '/' . $f)) { http_response_code(404); exit; }
        @touch($dir . '/ping');
        header('Content-Type: ' . ($f === 'init.mp4' ? 'video/mp4' : 'video/iso.segment'));
        header('Content-Length: ' . filesize($dir . '/' . $f));
        while (ob_get_level() > 0) @ob_end_clean();
        readfile($dir . '/' . $f);
        exit;
    }

    $alive = 'wp_media_pid_alive';
    $index = $dir . '/index.m3u8';
    $pid = (int)@file_get_contents($dir . '/pid');
    $m3u = is_file($index) ? (string)@file_get_contents($index) : '';
    // terminada solo si tiene segmentos: una conversión que falló sin entregar nada se vuelve a lanzar
    $done = strpos($m3u, '#EXT-X-ENDLIST') !== false && strpos($m3u, '#EXTINF') !== false;
    if (!$done && !$alive($pid)) {
        $ff = wp_bin('ffmpeg');
        if (!$ff || !wp_exec_mode()) { http_response_code(501); exit; }
        $sess = wp_session_read_close();
        $who = md5((string)($sess['username'] ?? '') . '|' . ($_SERVER['REMOTE_ADDR'] ?? ''));
        $pidFile = wp_cache_dir() . '/ff_' . $who . '.pid';
        // una sola conversión por usuario (la cuenta IPTV suele permitir una conexión)
        $old = (int)@file_get_contents($pidFile);
        if ($old > 1 && $alive($old)) {
            if (function_exists('posix_kill')) @posix_kill($old, 15); else wp_bg('kill ' . $old);
            usleep(300000);
        }
        // limpieza de conversiones viejas
        foreach ((array)glob(wp_cache_dir('hls') . '/*', GLOB_ONLYDIR) as $old_dir) {
            if ($old_dir !== $dir && @filemtime($old_dir . '/ping') < time() - 7200) {
                foreach ((array)glob($old_dir . '/*') as $x) @unlink($x);
                @rmdir($old_dir);
            }
        }
        if (!is_dir($dir)) @mkdir($dir, 0775, true);
        foreach ((array)glob($dir . '/*') as $x) @unlink($x);
        @touch($dir . '/ping');
        $probe = $live ? null : wp_probe($url);
        $vcodec = $probe['video'] ?? '';
        $cmd = [$ff, '-nostdin', '-v', 'error', '-user_agent', WP_UA, '-rw_timeout', WP_FF_RW_TIMEOUT, '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'];
        // inicio en el fotograma clave con video y audio juntos (ver wp_media_seek); k se calcula antes de abrir la conversión
        if ($t > 0 && !$live) array_push($cmd, ...wp_media_seek($url, $t, $v === ''));
        array_push($cmd, '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err');
        if ($ffhdr) array_push($cmd, ...$ffhdr);
        array_push($cmd, '-i', $ffurl, '-map', '0:v:0?', '-map', '0:a:' . $a . '?', '-sn', '-dn', '-max_muxing_queue_size', '2048');
        if ($v === '2') {
            array_push($cmd, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27', '-g', '48', '-vf', "scale='min(854,iw)':-2,fps=30", '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-af', 'aresample=async=1000');
        } elseif ($v === '1') {
            array_push($cmd, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25', '-g', '48', '-vf', "scale='min(1280,iw)':-2", '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-af', WP_FF_AUDIO_SYNC);
        } else {
            array_push($cmd, '-c:v', 'copy', '-af', WP_FF_AUDIO_SYNC);
            if (in_array($vcodec, ['hevc', 'h265'], true)) array_push($cmd, '-tag:v', 'hvc1');
        }
        array_push($cmd, '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-ar', '48000',
            '-f', 'hls', '-hls_time', '4', '-hls_segment_type', 'fmp4', '-hls_fmp4_init_filename', 'init.mp4',
            '-hls_segment_filename', $dir . '/s%05d.m4s');
        if ($live) array_push($cmd, '-hls_list_size', '8', '-hls_flags', 'delete_segments+independent_segments+omit_endlist+temp_file');
        else array_push($cmd, '-hls_list_size', '0', '-hls_playlist_type', 'event', '-hls_flags', 'independent_segments+temp_file');
        array_push($cmd, $index);
        $d = escapeshellarg($dir);
        $ix = escapeshellarg($index);
        $er = escapeshellarg($dir . '/err');
        // ffmpeg en segundo plano + vigilante: se detiene si nadie pide la lista o los segmentos en 45 s,
        // si no entrega el primer segmento en WP_TC_FIRST_WAIT s o si la lista deja de avanzar 60 s sin terminar
        // (servidor IPTV colgado): así nunca queda una conversión trabada que el reproductor espere para siempre
        $sh = 'cd ' . $d . ' && ' . wp_cmd_line($cmd) . ' 2>' . $er . ' & FF=$!; echo $FF > ' . escapeshellarg($dir . '/pid') . '; echo $FF > ' . escapeshellarg($pidFile)
            . '; S=$(date +%s); while kill -0 $FF 2>/dev/null; do sleep 2; NOW=$(date +%s); P=$(stat -c %Y ' . escapeshellarg($dir . '/ping') . ' 2>/dev/null || echo 0);'
            . ' if [ $((NOW - P)) -gt 45 ]; then kill $FF; fi;'
            . ' if [ ! -s ' . $ix . ' ]; then if [ $((NOW - S)) -gt ' . WP_TC_FIRST_WAIT . ' ]; then echo "sin el primer segmento en ' . WP_TC_FIRST_WAIT . ' s" >> ' . $er . '; kill $FF; fi;'
            . ' else M=$(stat -c %Y ' . $ix . ' 2>/dev/null || echo $NOW); if [ $((NOW - M)) -gt 60 ] && ! grep -q ENDLIST ' . $ix . '; then echo "la conversión dejó de avanzar" >> ' . $er . '; kill $FF; fi; fi; done';
        if (wp_media_late()) { http_response_code(502); exit; }
        if (!wp_bg($sh)) { http_response_code(501); exit; }
    }
    @touch($dir . '/ping');
    // se espera a que estén listos los primeros segmentos (el vigilante detiene ffmpeg si no llegan a tiempo)
    $need = $live ? 2 : 1;
    $end = microtime(true) + WP_TC_FIRST_WAIT + 5;
    $m3u = '';
    while (microtime(true) < $end) {
        $m3u = is_file($index) ? (string)@file_get_contents($index) : '';
        if (substr_count($m3u, '#EXTINF') >= $need || strpos($m3u, '#EXT-X-ENDLIST') !== false) break;
        // ffmpeg terminó o lo detuvo el vigilante: no se sigue esperando
        $pid = (int)@file_get_contents($dir . '/pid');
        if ($pid > 1 && !$alive($pid)) { clearstatcache(); $m3u = is_file($index) ? (string)@file_get_contents($index) : ''; break; }
        if (connection_aborted()) exit;
        usleep(400000);
    }
    if (substr_count($m3u, '#EXTINF') < 1) {
        // sin video: error para que el reproductor vuelva al original (la próxima vez se convierte de nuevo)
        $pid = (int)@file_get_contents($dir . '/pid');
        if ($alive($pid)) { if (function_exists('posix_kill')) @posix_kill($pid, 15); else wp_bg('kill ' . $pid); }
        http_response_code(502);
        exit;
    }
    $self = 'media.php?' . http_build_query($q + ['do' => 'seg']) . '&f=';
    $out = [];
    foreach (preg_split('/\r?\n/', $m3u) as $line) {
        if ($line !== '' && $line[0] !== '#') {
            $out[] = $self . rawurlencode(basename(trim($line)));
        } elseif (strpos($line, '#EXT-X-MAP:') === 0) {
            $out[] = preg_replace_callback('/URI="([^"]+)"/', function ($m) use ($self) { return 'URI="' . $self . rawurlencode(basename($m[1])) . '"'; }, $line);
        } else {
            $out[] = $line;
        }
    }
    header('Content-Type: application/vnd.apple.mpegurl');
    echo implode("\n", $out);
    exit;
}

if ($do === 'sub') {
    $i = max(0, (int)($_GET['i'] ?? 0));
    $ck = wp_cache_dir() . '/sub_' . md5($url . '|' . $i) . '.vtt';
    header('Content-Type: text/vtt; charset=utf-8');
    header('Cache-Control: private, max-age=86400');
    if (is_file($ck) && filesize($ck) >= 10) { readfile($ck); exit; }
    // el subtítulo está repartido en todo el archivo y ffmpeg tiene que leerlo completo: se prepara en segundo plano
    // (así no lo corta el límite de tiempo del hosting) y el reproductor vuelve a preguntar cada pocos segundos
    $job = $ck . '.job';
    $bad = $ck . '.bad';
    header('Cache-Control: no-store');
    if (is_file($bad) && time() - filemtime($bad) < 3600) { http_response_code(404); exit; }
    // el trabajo guarda el pid de ffmpeg: si el hosting lo mató (sin dejar resultado ni error) se vuelve a lanzar
    // en vez de responder "espera" durante 25 minutos
    $jage = is_file($job) ? time() - filemtime($job) : -1;
    if ($jage < 0 || $jage > 1500 || ($jage > 10 && !wp_media_pid_alive((int)@file_get_contents($job)))) {
        @file_put_contents($job, '');
        $part = $ck . '.part';
        $cmd = wp_cmd_line(array_merge([$ff, '-nostdin', '-v', 'error', '-user_agent', WP_UA, '-rw_timeout', '30000000', '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'], $ffhdr, ['-i', $ffurl, '-map', '0:s:' . $i, '-vn', '-an', '-dn', '-c:s', 'webvtt', '-f', 'webvtt', '-y', $part]));
        $ok = wp_bg($cmd . ' & FF=$!; echo $FF > ' . escapeshellarg($job) . '; wait $FF && grep -q WEBVTT ' . escapeshellarg($part) . ' && mv ' . escapeshellarg($part) . ' ' . escapeshellarg($ck)
            . ' || touch ' . escapeshellarg($bad) . '; rm -f ' . escapeshellarg($job) . ' ' . escapeshellarg($part));
        if (!$ok) { @unlink($job); http_response_code(404); exit; }
    }
    http_response_code(202);
    header('Content-Type: application/json');
    echo '{"wait":true}';
    exit;
}

if ($do !== 'tc') {
    http_response_code(400);
    exit;
}

$t = max(0, (int)($_GET['t'] ?? 0));
$a = max(0, (int)($_GET['a'] ?? 0));
$vtc = !empty($_GET['v']);
$vsafe = ($_GET['v'] ?? '') === '2';
$probe = wp_probe($url);
$vcodec = $probe['video'] ?? '';

$cmd = [$ff, '-nostdin', '-v', 'error', '-user_agent', WP_UA, '-rw_timeout', WP_FF_RW_TIMEOUT, '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5'];
// con video copiado la conversión arranca en el fotograma clave anterior a t, con video y audio juntos (ver wp_media_seek).
// Ese segundo se calcula antes de abrir la conversión (una conexión a la vez al servidor IPTV) y el reproductor
// lo lee después de la caché (do=kf&c=1) para cuadrar el tiempo
if ($t > 0) array_push($cmd, ...wp_media_seek($url, $t, !$vtc));
// archivos dañados o con marcas de tiempo rotas: se ignoran los paquetes corruptos en vez de detener la conversión
array_push($cmd, '-fflags', '+genpts+discardcorrupt', '-err_detect', 'ignore_err');
if ($ffhdr) array_push($cmd, ...$ffhdr);
array_push($cmd, '-i', $ffurl, '-map', '0:v:0?', '-map', '0:a:' . $a . '?', '-sn', '-dn', '-max_muxing_queue_size', '2048', '-avoid_negative_ts', 'make_zero');
if ($vtc && $vsafe) {
    // modo seguro (último recurso del navegador): 480p, cuadros constantes y audio resincronizado
    array_push($cmd, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '27', '-g', '48', '-vf', "scale='min(854,iw)':-2,fps=30", '-pix_fmt', 'yuv420p',
        '-profile:v', 'main', '-af', 'aresample=async=1000');
} elseif ($vtc) {
    // formatos antiguos (XviD, MPEG-2, WMV...): se convierte el video a H.264 a 720p (rápido para que el hosting alcance a convertir en tiempo real)
    array_push($cmd, '-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-crf', '25', '-g', '48', '-vf', "scale='min(1280,iw)':-2", '-pix_fmt', 'yuv420p', '-af', WP_FF_AUDIO_SYNC);
} else {
    array_push($cmd, '-c:v', 'copy', '-af', WP_FF_AUDIO_SYNC);
    if (in_array($vcodec, ['hevc', 'h265'], true)) array_push($cmd, '-tag:v', 'hvc1');
}
array_push($cmd, '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-frag_duration', '2000000', 'pipe:1');

if (wp_media_late()) {
    http_response_code(502);
    exit;
}

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
// (un servidor que no manda nada no se reintenta: el reproductor ya pasa a otro modo)
$stalled = false;
// el primer fragmento tiene que llegar en WP_TC_FIRST_WAIT s desde el primer intento (contando los reintentos)
$t0 = microtime(true);
for ($try = 0; $try < 3 && $sent === 0 && !$stalled; $try++) {
    if ($try > 0) { sleep(2); if (connection_aborted()) break; }
    $pr = wp_spawn_stream($cmd, $errFile, $pidFile);
    if (!$pr) break;
    $myPid = (int)@file_get_contents($pidFile);
    // lectura sin bloquear: si ffmpeg se queda sin datos (servidor IPTV colgado) se detiene a tiempo
    // y el reproductor pasa a otro modo, en vez de quedarse "Convirtiendo" para siempre
    @stream_set_blocking($pr['h'], false);
    $last = microtime(true);
    // la cabecera del MP4 (ftyp+moov) sale al instante, antes de leer el video: se guarda hasta el primer
    // fragmento (moof). Antes se mandaba enseguida, la respuesta ya era un 200 "con datos" y se esperaba 45 s
    // más sin video; ahora, sin fragmento a tiempo, se responde 502 y el reproductor vuelve al video original
    $head = '';
    while (true) {
        $r = [$pr['h']]; $w = null; $x = null;
        $n = @stream_select($r, $w, $x, 1, 0);
        $chunk = $n ? @fread($pr['h'], 262144) : '';
        if ($chunk === false) break;
        if ($chunk === '') {
            if (feof($pr['h'])) break;
            if (!$pr['alive']()) { $chunk = (string)@stream_get_contents($pr['h']); if ($chunk === '') break; }
            else {
                $wait = $sent === 0 ? WP_TC_FIRST_WAIT : WP_TC_IDLE_WAIT;
                if (microtime(true) - ($sent === 0 ? $t0 : $last) > $wait) { @file_put_contents($errFile, "sin datos de ffmpeg en {$wait} s\n", FILE_APPEND); $stalled = true; break; }
                if (connection_aborted()) break;
                continue;
            }
        }
        $last = microtime(true);
        if ($sent === 0) {
            $head .= $chunk;
            if (strpos($head, 'moof') === false && strlen($head) < 4194304) continue;
            $chunk = $head;
            $head = '';
        }
        echo $chunk;
        @flush();
        $sent += strlen($chunk);
        if (connection_aborted()) break;
    }
    $pr['stop']();
    if ((int)@file_get_contents($pidFile) === $myPid) @unlink($pidFile);
    // solo se reintenta un rechazo inmediato; si ffmpeg tardó en fallar ya no hay tiempo: el reproductor vuelve al original
    if ($sent === 0 && microtime(true) - $t0 > 10) break;
}
if ($sent === 0 && !headers_sent()) http_response_code(502);
