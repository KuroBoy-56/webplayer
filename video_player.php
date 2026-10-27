<?php
include "session.php";
include "config.php";

$id = preg_replace('/[^0-9]/', '', (string)($_GET["id"] ?? ''));
$slug = ($_GET["slug"] ?? 'movie') === 'series' ? 'series' : 'movie';
$ext = strtolower(preg_replace('/[^a-z0-9]/i', '', (string)($_GET["ext"] ?? '')));
$restart = isset($_GET["restart"]) ? (int)$_GET["restart"] : 0;
$series_id_get = preg_replace('/[^0-9]/', '', (string)($_GET['series_id'] ?? '0')) ?: '0';
$logo_url = wp_brand_logo();

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
    $dur_secs = (int)($movie_info['info']['duration_secs'] ?? 0);
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
                    'dur' => (int)($ep['info']['duration_secs'] ?? 0),
                    'ext' => strtolower($ep['container_extension'] ?? 'mp4') ?: 'mp4',
                    'label' => t('T{s}:E{e}', ['s' => $season, 'e' => $ep['episode_num'] ?? '']) . (!empty($ep['title']) ? ' · ' . $ep['title'] : ''),
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
        $dur_secs = $episodes_list[$current_index]['dur'];
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
// DEMO: sin descarga ni VLC (sus enlaces llevan el usuario y la contraseña de la línea)
$demo = wp_is_demo();

/* ---------- Descarga: directo desde el servidor IPTV (no pasa por el hosting) ---------- */
if (isset($_GET['action']) && $_GET['action'] === 'download_file' && !$demo) {
    header('Location: ' . wp_client_stream_url($kind, $id, $ext));
    exit;
}

/* ---------- Posición para reanudar ---------- */
$resume_time = 0;
if ($restart == 0) {
    $prog = wp_user_progress($username);
    $resume_time = (int)($prog[$slug . '_' . $id]['current_time'] ?? 0);
}

/* ---------- Fuentes en orden de prueba ---------- */
$use_vlc = (isset($_COOKIE["use_vlc"]) && !$demo) ? $_COOKIE["use_vlc"] : "0";
$exts = [$ext];
if (in_array($ext, ['mkv', 'avi', 'mov', 'wmv', 'flv', 'mpg', 'mpeg', 'm4v', 'divx', 'xvid', '3gp'], true)) {
    array_unshift($exts, 'mp4'); // muchos servidores entregan el mismo archivo como .mp4 (compatible con el navegador)
}
if (!in_array('m3u8', $exts, true)) $exts[] = 'm3u8';
$exts = array_values(array_unique($exts));

/* iPhone: Safari no informa bien los audios de un MP4 (dice 0 o 1 y suenan todos a la vez), así que hay que
   saberlo antes de abrir el video. Se cuenta una sola vez por contenido (luego queda en caché 30 días). */
if (wp_content_direct($kind, $id, $exts) && preg_match('/iPhone|iPad|iPod|Macintosh/i', (string)($_SERVER['HTTP_USER_AGENT'] ?? ''))
    && wp_content_multi_audio($kind, $id, $exts, true) === null) {
    wp_content_multi_audio($kind, $id, $exts);
}
$sources = wp_play_sources($kind, $id, $exts);

/* Motor de conversión: el del panel (api/media_web.php), SOLO en la VPS / VDS de la línea — la VDS propia del
   distribuidor si la eligió (nunca la del dueño), si no la del dueño. El hosting de la web nunca convierte.
   Se usa para elegir el idioma cuando el navegador no puede (varios audios), audio Dolby/DTS y formatos que el
   navegador no abre; con un solo audio compatible no se usa. */
$media_cfg = null;
$panel_tok = wp_panel_tok(); // el token de la línea (las apps usan el mismo): el navegador habla con el motor del panel
$multi_audio = wp_content_multi_audio($kind, $id, $exts, true);
$tracks_base = wp_proxy_url(wp_tracks_target($kind, $id, $exts), 'tracks.php') . '&x=' . rawurlencode($ext) . '&dur=' . (int)($dur_secs ?? 0);
// pistas aún desconocidas: el reproductor las pide en segundo plano (tracks.php) sin retrasar la página
$tracks_url = ($multi_audio === null && wp_content_direct($kind, $id, $exts)) ? $tracks_base : '';
$multi_audio = $multi_audio === true;
require_once __DIR__ . '/includes/media_admin.php';
// el dueño puede apagar el motor de la web (Guía EPG) o quitárselo al distribuidor: entonces el video va directo
// y el reproductor solo muestra este texto si se elige algo que lo necesita
$media_cfg = wp_media_cfg($kind, $id, $exts, $ext, (int)($dur_secs ?? 0), $multi_audio, $media_off);

/* ---------- Página https y video http: reproductor directo por http (play.php) ---------- */
$http_url = wp_handoff_url([
    'kind' => $kind, 'id' => $id, 'exts' => $exts, 'vlcExt' => $ext, 'slug' => $slug, 'sid' => $series_id_get,
    'title' => $content_name, 'sub' => $episode_label, 'resume' => $resume_time, 'dur' => (int)($dur_secs ?? 0), 'multi' => $multi_audio ? 1 : 0,
    'back' => wp_handoff_abs($slug == 'movie' ? 'Movie_description.php?id=' . $id : 'seriesvideo.php?id=' . $series_id_get),
    'next' => $has_next ? wp_handoff_abs($next_url) : '',
]);
if ($http_url !== '' && $use_vlc !== '1' && wp_needs_handoff($kind, $id, $sources)) {
    header('Location: ' . $http_url);
    exit;
}

$back_url = ($slug == 'movie') ? 'Movie_description.php?id=' . $id : 'seriesvideo.php?id=' . $series_id_get;
$download_url = '?' . http_build_query(array_merge($_GET, ['action' => 'download_file']));
$extra = $demo ? [] : [['label' => t('Descargar contenido'), 'href' => $download_url]];
if ($has_prev) $extra[] = ['label' => t('Capítulo anterior'), 'href' => $prev_url];
if ($slug === 'series') $extra[] = ['label' => t('Ver episodios'), 'href' => $back_url . '#episodios'];
$diag_url = 'diag.php?id=' . $id . '&slug=' . $slug . '&ext=' . rawurlencode($ext) . ($series_id_get ? '&series_id=' . rawurlencode($series_id_get) : '');
if ($media_cfg && $multi_audio) $extra[] = ['label' => t('¿Sin audio o no carga? Solucionar'), 'act' => 'fix'];
?>
<!DOCTYPE html>
<html lang="<?php echo wp_lang(); ?>">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#000000">
    <meta name="referrer" content="no-referrer">
    <title><?php echo e($content_name ?: t('Reproductor')); ?> - <?php echo e($sitename); ?></title>
    <link rel="icon" href="assets/img/Favicon.ico">
    <link rel="stylesheet" href="assets/nf/app.css?v=10">
    <link rel="stylesheet" href="assets/nf/player.css?v=9">
    <?php echo wp_i18n_script(); ?>
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
        <h2><?php echo t('Abriendo VLC Player...'); ?></h2>
        <p><?php echo t('Si el contenido no se abre automáticamente, presiona el botón.'); ?></p>
        <a href="<?php echo $demo ? '#' : 'vlc://' . e($raw_url); ?>" class="nf-btn nf-btn-red"><?php echo t('Reproducir en VLC'); ?></a>
        <p style="margin-top:22px"><a href="<?php echo e($back_url); ?>" style="color:#aaa"><?php echo t('Volver'); ?></a></p>
    </div>
    <div id="player-container"></div>

    <script src="assets/vendor/hls.min.js" defer></script>
    <script src="assets/vendor/mpegts.min.js" defer></script>
    <script src="assets/nf/mp4mse.js?v=2" defer></script>
    <script src="assets/nf/player.js?v=32" defer></script>
    <script>
    document.addEventListener('DOMContentLoaded', function () {
        var cfg = <?php echo json_encode([
            'title' => $content_name,
            'subtitle' => $episode_label,
            'sources' => $sources,
            'resume' => $resume_time,
            'debug' => !empty($_GET['debug']),
            'backUrl' => $back_url,
            'nextUrl' => $has_next ? $next_url : '',
            'vlcUrl' => $demo ? '' : 'vlc://' . $raw_url,
            'streamUrl' => $demo ? '' : $raw_url,
            'vlcPc' => $demo ? '' : 'playlist.php?' . http_build_query(['id' => $id, 'slug' => $slug, 'ext' => $ext, 'title' => trim($content_name . ' ' . $episode_label)]),
            'downloadUrl' => $demo ? '' : $download_url,
            'demo' => $demo,
            'media' => $media_cfg,
            'mediaOff' => $media_cfg ? '' : $media_off,
            'multi' => $multi_audio,
            'tracks' => $tracks_url,
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

        var openedAt = Date.now(), resumeAt = cfg.resume || 0, lastSave = 0, lastSent = -1;
        function save(v, beacon) {
            if (cfg.demo) return; // DEMO: no se guarda "Continuar viendo"
            var cur = Math.floor(v.currentTime || 0), tot = Math.floor(isFinite(v.duration) ? v.duration : 0);
            if (cur < 10 || cur === lastSent) return;
            // al abrir, el video arranca en 0 unos instantes antes de saltar al punto guardado (y al cambiar de motor se pausa):
            // esos segundos iniciales no deben borrar el progreso que ya había
            if (resumeAt > 60 && cur < resumeAt - 60 && Date.now() - openedAt < 120000) return;
            lastSent = cur;
            var fd = new FormData();
            fd.append('id', cfg.id);
            fd.append('slug', cfg.slug);
            fd.append('series_id', cfg.seriesId);
            fd.append('current_time', cur);
            fd.append('total_time', tot > 0 ? tot : 0);
            if (beacon && navigator.sendBeacon) { navigator.sendBeacon('save_progress.php', fd); return; }
            fetch('save_progress.php', { method: 'POST', body: fd, credentials: 'same-origin', keepalive: true })
                .then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok) lastSent = -1, lastSave = 0; })
                .catch(function () { lastSent = -1; lastSave = 0; }); // no se guardó: se reintenta en el siguiente aviso
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
