<?php
/*
 * Reproductor directo por http (ver includes/handoff.php).
 * Se abre solo cuando la página es https y el servidor IPTV entrega el video por http:
 * así el navegador lee el video directo del servidor IPTV y nada pasa por el hosting.
 */
define('WP_HANDOFF', true);
require_once __DIR__ . '/includes/core.php';
require_once __DIR__ . '/includes/progress_save.php';
wp_security_headers();
header('Cache-Control: no-store');

$d = wp_handoff_open((string)($_GET['d'] ?? ''));
if (!$d || empty($d['srv']) || empty($d['usr'])) {
    http_response_code(403);
    echo '<!DOCTYPE html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#000;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px">'
        . '<h2>Este enlace caducó</h2><p>Vuelve a abrir el contenido desde la web.</p></body>';
    exit;
}
// Safari (iPhone) y Chrome cambian solos http por https cuando la web tiene SSL. Se devuelve a http
// una sola vez: el navegador ve el ciclo y se queda en http, así el video va directo del servidor IPTV.
if (wp_is_https() && $_SERVER['REQUEST_METHOD'] === 'GET' && empty($_GET['h'])) {
    header('Location: http://' . ($_SERVER['HTTP_HOST'] ?? 'localhost') . ($_SERVER['REQUEST_URI'] ?? '/play.php') . '&h=1', true, 302);
    exit;
}
$get_dns = rtrim((string)$d['srv'], '/');
$username = (string)$d['usr'];
$password = (string)($d['pwd'] ?? '');
$_SESSION = ['server' => $get_dns, 'username' => $username, 'password' => $password, 'panel_token' => (string)($d['pt'] ?? '')];

/* ---------- Guardar progreso (misma lógica que save_progress.php) ---------- */
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    header('Content-Type: application/json');
    echo json_encode(wp_progress_save($_POST, $username));
    exit;
}

$kind = in_array($d['kind'] ?? '', ['movie', 'series', 'live'], true) ? $d['kind'] : 'movie';
$id = preg_replace('/[^0-9]/', '', (string)($d['id'] ?? ''));
$exts = array_values(array_filter(array_map(function ($x) { return preg_replace('/[^a-z0-9]/', '', strtolower((string)$x)); }, (array)($d['exts'] ?? ['mp4']))));
$ext = $exts[0] ?? 'mp4';
$live = $kind === 'live';

$sources = [];
foreach ($exts as $x) {
    $sources[] = ['url' => wp_stream_url($kind, $id, $x), 'engine' => $x === 'm3u8' ? 'hls' : ($x === 'ts' ? 'mpegts' : 'native'), 'ext' => $x];
}
// el navegador volvió a forzar https (Safari en iPhone lo hace cuando la web tiene SSL): un video http
// se bloquearía, así que se usan las mismas fuentes https que la página normal (https directo o relay de Cloudflare)
if (wp_is_https()) $sources = wp_play_sources($kind, $id, $exts);
$raw_url = wp_stream_url($kind, $id, (string)($d['vlcExt'] ?? $ext));
$title = (string)($d['title'] ?? '');
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#000000">
    <meta name="referrer" content="no-referrer">
    <title><?php echo e($title ?: 'Reproductor'); ?></title>
    <link rel="icon" href="assets/img/Favicon.ico">
    <link rel="stylesheet" href="assets/nf/app.css?v=6">
    <link rel="stylesheet" href="assets/nf/player.css?v=8">
    <style>
        html, body { height: 100%; overflow: hidden; background: #000; }
        #player-container { position: fixed; inset: 0; }
    </style>
</head>
<body>
    <div id="player-container"></div>
    <script src="assets/vendor/hls.min.js" defer></script>
    <script src="assets/vendor/mpegts.min.js" defer></script>
    <script src="assets/nf/mp4mse.js?v=1" defer></script>
    <script src="assets/nf/player.js?v=20" defer></script>
    <script>
    document.addEventListener('DOMContentLoaded', function () {
        var cfg = <?php echo json_encode([
            'live' => $live,
            'title' => $title,
            'subtitle' => (string)($d['sub'] ?? ''),
            'sources' => $sources,
            'resume' => isset($_GET['t']) ? max(0, (int)$_GET['t']) : (int)($d['resume'] ?? 0),
            'backUrl' => (string)($d['back'] ?? ''),
            'nextUrl' => (string)($d['next'] ?? ''),
            'vlcUrl' => 'vlc://' . $raw_url,
            'streamUrl' => $raw_url,
            'media' => null,
            'ext' => $ext,
            'extraMenu' => [],
            'id' => $id,
            'slug' => (string)($d['slug'] ?? $kind),
            'seriesId' => (string)($d['sid'] ?? '0'),
            'diagUrl' => 'diag.php?id=' . $id . '&slug=' . ($kind === 'series' ? 'series' : $kind) . '&ext=' . rawurlencode((string)($d['vlcExt'] ?? $ext)) . (!empty($d['sid']) ? '&series_id=' . rawurlencode((string)$d['sid']) : ''),
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP); ?>;

        if (!cfg.live) {
            var lastSave = 0, lastSent = -1, here = location.href;
            var save = function (v, beacon) {
                var cur = Math.floor(v.currentTime || 0), tot = Math.floor(isFinite(v.duration) ? v.duration : 0);
                if (cur <= 0 || cur === lastSent) return;
                lastSent = cur;
                var fd = new FormData();
                fd.append('id', cfg.id);
                fd.append('slug', cfg.slug);
                fd.append('series_id', cfg.seriesId);
                fd.append('current_time', cur);
                fd.append('total_time', tot > 0 ? tot : 0);
                if (beacon && navigator.sendBeacon) { navigator.sendBeacon(here, fd); return; }
                fetch(here, { method: 'POST', body: fd, keepalive: true }).catch(function () {});
            };
            cfg.onTime = function (v) { var now = Date.now(); if (now - lastSave > 10000) { lastSave = now; save(v); } };
            cfg.onPause = function (v) { save(v); };
            cfg.onEnded = function (v) { save(v); };
            cfg.onBeforeNext = function (v) { save(v, true); };
        }
        var player = new NFPlayer(document.getElementById('player-container'), cfg);
        if (cfg.onTime) {
            window.addEventListener('pagehide', function () { cfg.onBeforeNext(player.timeInfo()); });
        }
    });
    </script>
</body>
</html>
