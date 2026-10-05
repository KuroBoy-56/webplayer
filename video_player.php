<?php
include "session.php";
include "config.php";

$id = preg_replace('/[^0-9]/', '', (string)($_GET["id"] ?? ''));
$slug = ($_GET["slug"] ?? 'movie') === 'series' ? 'series' : 'movie';
$ext = strtolower(preg_replace('/[^a-z0-9]/i', '', (string)($_GET["ext"] ?? '')));
$restart = isset($_GET["restart"]) ? (int)$_GET["restart"] : 0;
$series_id_get = preg_replace('/[^0-9]/', '', (string)($_GET['series_id'] ?? '0')) ?: '0';
$logo_url = "assets/img/Logo.png";

if ($id === '') {
    header('Location: homex.php');
    exit;
}

$content_name = '';
$episode_label = '';
$has_prev = false;
$has_next = false;
$prev_url = "";
$next_url = "";
$poster = '';

if ($slug == "movie") {
    $movie_info = xt_get('get_vod_info', ['vod_id' => $id], 21600);
    $content_name = $movie_info['info']['name'] ?? ($movie_info['movie_data']['name'] ?? '');
    $poster = $movie_info['info']['movie_image'] ?? '';
    if ($ext === '') $ext = strtolower($movie_info['movie_data']['container_extension'] ?? 'mp4') ?: 'mp4';
    $kind = 'movie';
} else {
    $series_info = xt_get('get_series_info', ['series_id' => $series_id_get], 21600);
    $content_name = $series_info['info']['name'] ?? '';
    $poster = $series_info['info']['cover'] ?? '';
    $episodes_list = [];
    if (isset($series_info['episodes']) && is_array($series_info['episodes'])) {
        $eps = $series_info['episodes'];
        uksort($eps, function ($a, $b) { return (int)$a - (int)$b; });
        foreach ($eps as $season => $episodes) {
            if (!is_array($episodes)) continue;
            foreach ($episodes as $ep) {
                $episodes_list[] = [
                    'id' => (string)$ep['id'],
                    'ext' => strtolower($ep['container_extension'] ?? 'mp4') ?: 'mp4',
                    'label' => 'T' . $season . ':E' . ($ep['episode_num'] ?? '') . (!empty($ep['title']) ? ' Â· ' . $ep['title'] : ''),
                ];
            }
        }
    }
    $current_index = -1;
    foreach ($episodes_list as $index => $ep) {
        if ($ep['id'] === $id) { $current_index = $index; break; }
    }
    if ($current_index !== -1) {
        $episode_label = $episodes_list[$current_index]['label'];
        if ($ext === '') $ext = $episodes_list[$current_index]['ext'];
        if ($current_index > 0) {
            $has_prev = true;
            $p = $episodes_list[$current_index - 1];
            $prev_url = "video_player.php?id=" . $p['id'] . "&slug=series&series_id=" . $series_id_get . "&ext=" . $p['ext'] . "&restart=1";
        }
        if ($current_index < count($episodes_list) - 1) {
            $has_next = true;
            $n = $episodes_list[$current_index + 1];
            $next_url = "video_player.php?id=" . $n['id'] . "&slug=series&series_id=" . $series_id_get . "&ext=" . $n['ext'] . "&restart=1";
        }
    }
    if ($ext === '') $ext = 'mp4';
    $kind = 'series';
}

$raw_url = wp_stream_url($kind, $id, $ext);

/* ---------- Descarga: directo desde el servidor IPTV (no pasa por el hosting) ---------- */
if (isset($_GET['action']) && $_GET['action'] === 'download_file') {
    header('Location: ' . wp_client_stream_url($kind, $id, $ext));
    exit;
}

/* ---------- PosiciÃ³n para reanudar ---------- */
$resume_time = 0;
if ($restart == 0) {
    $prog = wp_user_progress($username);
    $resume_time = (int)($prog[$slug . '_' . $id]['current_time'] ?? 0);
}

/* ---------- Fuentes en orden de prueba ---------- */
$use_vlc = isset($_COOKIE["use_vlc"]) ? $_COOKIE["use_vlc"] : "0";
$exts = [$ext];
if (in_array($ext, ['mkv', 'avi', 'mov', 'wmv', 'flv', 'mpg', 'mpeg', 'm4v', 'divx', 'xvid', '3gp'], true)) {
    array_unshift($exts, 'mp4'); // muchos servidores entregan el mismo archivo como .mp4 (compatible con el navegador)
}
if (!in_array('m3u8', $exts, true)) $exts[] = 'm3u8';
$exts = array_values(array_unique($exts));

$sources = wp_play_sources($kind, $id, $exts);

/* ---------- PÃ¡gina https y video http: reproductor directo por http (play.php) ---------- */
$http_url = wp_handoff_url([
    'kind' => $kind, 'id' => $id, 'exts' => $exts, 'vlcExt' => $ext, 'slug' => $slug, 'sid' => $series_id_get,
    'title' => $content_name, 'sub' => $episode_label, 'resume' => $resume_time,
    'back' => wp_handoff_abs($slug == 'movie' ? 'Movie_description.php?id=' . $id : 'seriesvideo.php?id=' . $series_id_get),
    'next' => $has_next ? wp_handoff_abs($next_url) : '',
]);
if ($http_url !== '' && $use_vlc !== '1' && wp_needs_handoff($kind, $id, $sources)) {
    header('Location: ' . $http_url);
    exit;
}

$back_url = ($slug == 'movie') ? 'Movie_description.php?id=' . $id : 'seriesvideo.php?id=' . $series_id_get;
$download_url = '?' . http_build_query(array_merge($_GET, ['action' => 'download_file']));
$extra = [['label' => 'Descargar contenido', 'href' => $download_url]];
if ($has_prev) $extra[] = ['label' => 'CapÃ­tulo anterior', 'href' => $prev_url];
if ($slug === 'series') $extra[] = ['label' => 'Ver episodios', 'href' => $back_url . '#episodios'];
$diag_url = 'diag.php?id=' . $id . '&slug=' . $slug . '&ext=' . rawurlencode($ext) . ($series_id_get ? '&series_id=' . rawurlencode($series_id_get) : '');
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#000000">
    <meta name="referrer" content="no-referrer">
    <title><?php echo e($content_name ?: 'Reproductor'); ?> - <?php echo e($sitename); ?></title>
    <link rel="icon" href="assets/img/Favicon.ico">
    <link rel="stylesheet" href="assets/nf/app.css?v=6">
    <link rel="stylesheet" href="assets/nf/player.css?v=5">
    <style>
        html, body { height: 100%; overflow: hidden; background: #000; }
        #player-container { position: fixed; inset: 0; }
        .vlc-overlay { position: fixed; inset: 0; z-index: 20; display: none; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px; background: #000; color: #fff; }
        .vlc-overlay h2 { color: var(--nf-red); margin: 0 0 12px; }
        .vlc-overlay p { color: #ccc; margin: 0 0 22px; }
    </style>
</head>
<body>
    <div id="vlc-overlay" class="vlc-overlay">
        <h2>Abriendo VLC Player...</h2>
        <p>Si el contenido no se abre automÃ¡ticamente, presiona el botÃ³n.</p>
        <a href="vlc://<?php echo e($raw_url); ?>" class="nf-btn nf-btn-red">Reproducir en VLC</a>
        <p style="margin-top:22px"><a href="<?php echo e($back_url); ?>" style="color:#aaa">Volver</a></p>
    </div>
    <div id="player-container"></div>

    <script src="assets/vendor/hls.min.js" defer></script>
    <script src="assets/vendor/mpegts.min.js" defer></script>
    <script src="assets/nf/player.js?v=13" defer></script>
    <script>
    document.addEventListener('DOMContentLoaded', function () {
        var cfg = <?php echo json_encode([
            'title' => $content_name,
            'subtitle' => $episode_label,
            'sources' => $sources,
            'resume' => $resume_time,
            'backUrl' => $back_url,
            'nextUrl' => $has_next ? $next_url : '',
            'vlcUrl' => 'vlc://' . $raw_url,
            'streamUrl' => $raw_url,
            'vlcPc' => 'playlist.php?' . http_build_query(['id' => $id, 'slug' => $slug, 'ext' => $ext, 'title' => trim($content_name . ' ' . $episode_label)]),
            'downloadUrl' => $download_url,
            'media' => null,
            'ext' => $ext,
            'diagUrl' => $diag_url,
            'extraMenu' => $extra,
            'id' => $id,
            'slug' => $slug,
            'seriesId' => $series_id_get,
            'useVlc' => $use_vlc === '1',
            'fallbackUrl' => $http_url,
        ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP); ?>;

        var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        if (isMobile && cfg.useVlc) {
            document.getElementById('vlc-overlay').style.display = 'flex';
            var vb = document.querySelector('#vlc-overlay a.nf-btn');
            vb.addEventListener('click', function (e) { e.preventDefault(); NFPlayer.openVlc(cfg); });
            NFPlayer.openVlc(cfg);
            return;
        }

        var lastSave = 0, lastSent = -1;
        function save(v, beacon) {
            var cur = Math.floor(v.currentTime || 0), tot = Math.floor(isFinite(v.duration) ? v.duration : 0);
            if (cur <= 0 || cur === lastSent) return;
            lastSent = cur;
            var fd = new FormData();
            fd.append('id', cfg.id);
            fd.append('slug', cfg.slug);
            fd.append('series_id', cfg.seriesId);
            fd.append('current_time', cur);
            fd.append('total_time', tot > 0 ? tot : 0);
            if (beacon && navigator.sendBeacon) { navigator.sendBeacon('save_progress.php', fd); return; }
            fetch('save_progress.php', { method: 'POST', body: fd, credentials: 'same-origin', keepalive: true }).catch(function () {});
        }

        cfg.onTime = function (v) {
            var now = Date.now();
            if (now - lastSave > 10000) { lastSave = now; save(v); }
        };
        cfg.onPause = function (v) { save(v); };
        cfg.onEnded = function (v) { save(v); };
        cfg.onBeforeNext = function (v) { save(v, true); };

        var player = new NFPlayer(document.getElementById('player-container'), cfg);
        window.addEventListener('pagehide', function () { save(player.timeInfo(), true); });
        document.addEventListener('visibilitychange', function () { if (document.hidden) save(player.timeInfo(), true); });
    });
    </script>
</body>
</html>
