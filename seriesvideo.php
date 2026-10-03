<?php
include "session.php";
include "config.php";
include "database.php";
require_once __DIR__ . '/includes/ui.php';

$id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
$selected_season = isset($_GET['season']) ? (string)(int)$_GET['season'] : null;
$tmdb_api_key = "54a47dfd36406757c9a6b7a0e3fd9cdc";

if (!$id) {
    header('Location: seriesondemand.php');
    exit;
}

$series_data = xt_get('get_series_info', ['series_id' => $id], 21600);
$series_info = is_array($series_data['info'] ?? null) ? $series_data['info'] : [];
if (!$series_info) {
    $page_title = 'Serie no disponible';
    include "header.php";
    echo '<div class="nf-page"><div class="nf-empty">No se pudo obtener la información de la serie. Inténtalo de nuevo en unos segundos.<br><br><a class="nf-btn nf-btn-white" href="seriesondemand.php">Volver a Series</a></div></div>';
    include "footer.php";
    exit;
}

$title = $series_info['name'] ?? 'Serie';
$description = $series_info['plot'] ?? '';
$genre = $series_info['genre'] ?? '';
$rating = $series_info['rating'] ?? '';
$year = substr((string)($series_info['releaseDate'] ?? ($series_info['release_date'] ?? '')), 0, 4);
$backdrop = $series_info['backdrop_path'] ?? '';
if (is_array($backdrop)) $backdrop = $backdrop[0] ?? '';
$poster = $series_info['cover'] ?? '';
$youtube_trailer = $series_info['youtube_trailer'] ?? '';
if ($genre) wp_genre_index_put('series', (string)$id, $genre);

/* ---------- TMDB con caché ---------- */
$tmdb_key = 'tmdb|tv|' . wp_norm_title($title);
$tmdb = wp_cache_get($tmdb_key, 604800);
if (!is_array($tmdb)) {
    $tmdb = ['id' => null, 'backdrop' => '', 'cast' => [], 'trailer' => ''];
    $clean = trim(preg_replace('/\([^)]*\)|\[[^\]]*\]/', '', $title));
    $body = wp_http_get("https://api.themoviedb.org/3/search/tv?api_key={$tmdb_api_key}&language=es-ES&query=" . urlencode($clean), 4);
    $s = $body ? json_decode($body, true) : null;
    if (!empty($s['results'][0]['id'])) {
        $r0 = $s['results'][0];
        $tmdb['id'] = $r0['id'];
        $tmdb['backdrop'] = !empty($r0['backdrop_path']) ? 'https://image.tmdb.org/t/p/original' . $r0['backdrop_path'] : '';
        $more = wp_http_multi([
            'credits' => "https://api.themoviedb.org/3/tv/{$r0['id']}/credits?api_key={$tmdb_api_key}",
            'videos' => "https://api.themoviedb.org/3/tv/{$r0['id']}/videos?api_key={$tmdb_api_key}",
        ], 4);
        $cd = $more['credits'] ? json_decode($more['credits'], true) : [];
        foreach (array_slice($cd['cast'] ?? [], 0, 10) as $a) {
            $tmdb['cast'][] = ['n' => $a['name'] ?? '', 'c' => $a['character'] ?? '', 'p' => !empty($a['profile_path']) ? 'https://image.tmdb.org/t/p/w185' . $a['profile_path'] : ''];
        }
        $vd = $more['videos'] ? json_decode($more['videos'], true) : [];
        foreach ($vd['results'] ?? [] as $v) {
            if (($v['site'] ?? '') === 'YouTube' && in_array($v['type'] ?? '', ['Trailer', 'Teaser'], true)) { $tmdb['trailer'] = $v['key']; break; }
        }
    }
    wp_cache_set($tmdb_key, $tmdb);
}
if (!$backdrop) $backdrop = $tmdb['backdrop'];
if (!$youtube_trailer) $youtube_trailer = $tmdb['trailer'];
$youtube_trailer = preg_replace('/[^A-Za-z0-9_\-]/', '', (string)$youtube_trailer);

/* ---------- Favorito ---------- */
$is_favorite = false;
if (isset($db)) {
    $stmt_fav = @$db->prepare("SELECT 1 FROM user_favorites WHERE username = :u AND stream_id = :sid AND type = 'series'");
    if ($stmt_fav) {
        $stmt_fav->bindValue(':u', $username, SQLITE3_TEXT);
        $stmt_fav->bindValue(':sid', $id, SQLITE3_INTEGER);
        $res_fav = $stmt_fav->execute();
        if ($res_fav && $res_fav->fetchArray()) $is_favorite = true;
    }
}

/* ---------- Progreso: último episodio visto de esta serie ---------- */
$resume_time = 0;
$resume_total = 0;
$resume_episode_id = 0;
$latest = 0;
foreach (wp_user_progress($username) as $v) {
    if (($v['type'] ?? '') === 'series' && (string)($v['series_id'] ?? '') === (string)$id && ($v['last_watched'] ?? 0) > $latest) {
        $latest = $v['last_watched'];
        $resume_time = (int)$v['current_time'];
        $resume_total = (int)($v['total_time'] ?? 0);
        $resume_episode_id = (int)$v['stream_id'];
    }
}

/* ---------- Temporadas y episodios ---------- */
$seasons = (isset($series_data['episodes']) && is_array($series_data['episodes'])) ? $series_data['episodes'] : [];
uksort($seasons, function ($a, $b) { return (int)$a - (int)$b; });
$eps_js = [];
$resume_season = null;
$resume_label = '';
$first_ep = null;
foreach ($seasons as $sn => $eps) {
    if (!is_array($eps)) continue;
    foreach ($eps as $ep) {
        $epid = (string)($ep['id'] ?? '');
        $ext = strtolower($ep['container_extension'] ?? 'mp4') ?: 'mp4';
        $epInfo = is_array($ep['info'] ?? null) ? $ep['info'] : [];
        $row = [
            'id' => $epid,
            'num' => (int)($ep['episode_num'] ?? 0),
            'title' => (string)($ep['title'] ?? ''),
            'img' => wp_img($epInfo['movie_image'] ?? ($epInfo['cover_big'] ?? ''), $poster ? wp_img($poster) : WP_NOIMG),
            'plot' => (string)($epInfo['plot'] ?? ''),
            'dur' => (string)($epInfo['duration'] ?? ''),
            'url' => 'video_player.php?id=' . rawurlencode($epid) . '&slug=series&ext=' . rawurlencode($ext) . '&series_id=' . $id,
            'pct' => 0,
        ];
        if ($first_ep === null) $first_ep = $row;
        if ((int)$epid === $resume_episode_id && $resume_episode_id) {
            $resume_season = (string)$sn;
            $resume_label = 'T' . $sn . ':E' . $row['num'];
            $row['pct'] = $resume_total > 0 ? round($resume_time / $resume_total * 100) : 5;
            $row['current'] = true;
        }
        $eps_js[(string)$sn][] = $row;
    }
}
if ($selected_season === null || !isset($eps_js[$selected_season])) {
    $selected_season = $resume_season ?? (string)(wp_first_key($eps_js) ?? '1');
}

/* ---------- Similares ---------- */
$similar = [];
$self = null;
foreach (wp_catalog('series') as $s) {
    if ($s['id'] === (string)$id) { $self = $s; break; }
}
if ($self) {
    foreach (wp_catalog('series') as $s) {
        if ($s['id'] !== (string)$id && array_intersect($s['cats'], $self['cats'])) $similar[] = $s;
    }
    shuffle($similar);
    $similar = array_slice($similar, 0, 24);
}

$bg_url = $backdrop ? wp_img($backdrop, '') : wp_img($poster);
$page_title = $title;
include "header.php";
?>
<section class="nf-detail-hero">
    <div class="nf-detail-bg" style="background-image:url('<?php echo e($bg_url); ?>')"></div>
    <div class="nf-detail-inner">
        <div class="nf-detail-poster"><img src="<?php echo e(wp_img($poster)); ?>" alt="" onerror="NF.imgErr(this)"></div>
        <div class="nf-detail-info">
            <h1><?php echo e($title); ?></h1>
            <div class="nf-detail-meta">
                <?php if ($rating !== '' && (float)$rating > 0): ?><span class="nf-match"><?php echo min(99, round((float)$rating * 10)); ?>% para ti</span><?php endif; ?>
                <?php if ($year): ?><span><?php echo e($year); ?></span><?php endif; ?>
                <span><?php echo count($eps_js); ?> temporada<?php echo count($eps_js) === 1 ? '' : 's'; ?></span>
                <span class="nf-badge">HD</span>
            </div>
            <p class="nf-detail-plot clamp"><?php echo e($description ?: 'Sin descripción disponible.'); ?></p>
            <div class="nf-detail-btns buttons">
                <?php if ($resume_time > 0 && $resume_episode_id > 0): ?>
                    <a href="video_player.php?id=<?php echo $resume_episode_id; ?>&slug=series&series_id=<?php echo $id; ?>" class="nf-btn nf-btn-white button"><?php echo wp_icon('play'); ?>Reanudar <?php echo e($resume_label); ?></a>
                <?php elseif ($first_ep): ?>
                    <a href="<?php echo e($first_ep['url']); ?>" class="nf-btn nf-btn-white button"><?php echo wp_icon('play'); ?>Reproducir T<?php echo e(wp_first_key($eps_js)); ?>:E<?php echo (int)$first_ep['num']; ?></a>
                <?php endif; ?>
                <div class="icons" style="gap:12px">
                    <button type="button" class="nf-btn nf-btn-dark<?php echo $is_favorite ? ' on' : ''; ?>" id="toggleFavorite">
                        <span class="ic" style="display:inline-flex"><?php echo $is_favorite ? wp_icon('check') : wp_icon('plus'); ?></span><span class="lbl"><?php echo $is_favorite ? 'En mi lista' : 'Mi lista'; ?></span>
                    </button>
                    <?php if ($youtube_trailer): ?>
                        <button type="button" class="nf-btn nf-btn-dark" id="btnTrailer"><?php echo wp_icon('yt'); ?>Tráiler</button>
                    <?php endif; ?>
                    <a href="#episodios" class="nf-btn nf-btn-dark" id="openModal">Episodios</a>
                </div>
            </div>
            <div class="nf-detail-extra">
                <?php if ($genre): ?><div><b>Géneros:</b> <?php echo e($genre); ?></div><?php endif; ?>
                <?php if (!empty($series_info['cast']) && !$tmdb['cast']): ?><div><b>Elenco:</b> <?php echo e($series_info['cast']); ?></div><?php endif; ?>
            </div>
        </div>
    </div>
</section>

<section class="nf-section" id="episodios">
    <div class="nf-eps-head">
        <h2 style="margin:0">Episodios</h2>
        <?php if (count($eps_js) > 0): ?>
        <select class="nf-select" id="seasonSel" aria-label="Temporada">
            <?php foreach (array_keys($eps_js) as $sn): ?>
                <option value="<?php echo e($sn); ?>" <?php echo (string)$sn === (string)$selected_season ? 'selected' : ''; ?>>Temporada <?php echo e($sn); ?> (<?php echo count($eps_js[$sn]); ?>)</option>
            <?php endforeach; ?>
        </select>
        <?php endif; ?>
    </div>
    <div class="nf-eps" id="epList"></div>
</section>

<?php if ($tmdb['cast']): ?>
<section class="nf-section">
    <h2>Elenco</h2>
    <div class="nf-cast">
        <?php foreach ($tmdb['cast'] as $a): ?>
            <div class="nf-actor">
                <img src="<?php echo e($a['p'] ?: 'https://ui-avatars.com/api/?name=' . urlencode($a['n']) . '&background=333&color=fff'); ?>" alt="" loading="lazy">
                <div class="a"><?php echo e($a['n']); ?></div>
                <div class="c"><?php echo e($a['c']); ?></div>
            </div>
        <?php endforeach; ?>
    </div>
</section>
<?php endif; ?>

<?php if ($similar): ?>
<div class="nf-rows">
    <?php
    $cards = [];
    foreach ($similar as $s) $cards[] = wp_card($s, 'series');
    echo wp_row('Más series similares', $cards, $self ? 'series.php?id=' . rawurlencode($self['cat']) : '');
    ?>
</div>
<?php endif; ?>

<div class="nf-modal" id="trailerModal" role="dialog" aria-label="Tráiler">
    <div class="nf-modal-box">
        <button class="nf-modal-close" type="button" aria-label="Cerrar">&times;</button>
        <div class="nf-ratio" id="trailerBox"></div>
    </div>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {
    var EPS = <?php echo json_encode($eps_js, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG); ?>;
    var list = document.getElementById('epList'), sel = document.getElementById('seasonSel');
    function render(sn) {
        var eps = EPS[sn] || [];
        if (!eps.length) { list.innerHTML = '<div class="nf-empty">No hay episodios disponibles.</div>'; return; }
        list.innerHTML = eps.map(function (ep, i) {
            return '<a class="nf-ep' + (ep.current ? ' current' : '') + '" href="' + NF.esc(ep.url) + '">' +
                '<span class="no">' + (ep.num || (i + 1)) + '</span>' +
                '<span class="th"><img src="' + NF.esc(ep.img) + '" alt="" loading="lazy" onerror="NF.imgErr(this)"><span class="pl">' + NF.svg.play + '</span>' +
                (ep.pct ? '<span class="pb"><i style="width:' + Math.max(3, ep.pct) + '%"></i></span>' : '') + '</span>' +
                '<span class="tx"><span class="tt"><span>' + NF.esc(ep.title || ('Episodio ' + (ep.num || i + 1))) + '</span><span class="du">' + NF.esc(ep.dur) + '</span></span>' +
                '<span class="ds">' + NF.esc(ep.plot) + '</span></span></a>';
        }).join('');
    }
    if (sel) sel.addEventListener('change', function () { render(this.value); });
    render(<?php echo json_encode((string)$selected_season); ?>);

    var fav = document.getElementById('toggleFavorite');
    if (fav) fav.addEventListener('click', function () {
        NF.fav(fav, { id: <?php echo json_encode((string)$id); ?>, type: 'series', title: <?php echo json_encode($title); ?>, poster: <?php echo json_encode($poster); ?> });
    });
    var tb = document.getElementById('btnTrailer'), modal = document.getElementById('trailerModal'), box = document.getElementById('trailerBox');
    function close() { modal.classList.remove('open'); box.innerHTML = ''; }
    if (tb) tb.addEventListener('click', function () {
        box.innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/<?php echo e($youtube_trailer); ?>?autoplay=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe>';
        modal.classList.add('open');
    });
    modal.addEventListener('click', function (e) { if (e.target === modal || e.target.closest('.nf-modal-close')) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
});
</script>
<?php include "footer.php"; ?>
