<?php
include "session.php";
include "config.php";
require_once __DIR__ . '/includes/ui.php';

$id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
$selected_season = isset($_GET['season']) ? (string)(int)$_GET['season'] : null;

if (!$id) {
    header('Location: seriesondemand.php');
    exit;
}

$series_data = xt_get('get_series_info', ['series_id' => $id], 21600);
$series_info = is_array($series_data['info'] ?? null) ? $series_data['info'] : [];
if (!$series_info) {
    $page_title = t('Serie no disponible');
    include "header.php";
    echo '<div class="nf-page"><div class="nf-empty">' . e(t('No se pudo obtener la información de la serie. Inténtalo de nuevo en unos segundos.')) . '<br><br><a class="nf-btn nf-btn-white" href="seriesondemand.php">' . e(t('Volver a Series')) . '</a></div></div>';
    include "footer.php";
    exit;
}

$title = $series_info['name'] ?? t('Serie');
$description = $series_info['plot'] ?? '';
$genre = $series_info['genre'] ?? '';
$rating = $series_info['rating'] ?? '';
$year = substr((string)($series_info['releaseDate'] ?? ($series_info['release_date'] ?? '')), 0, 4);
$backdrop = $series_info['backdrop_path'] ?? '';
if (is_array($backdrop)) $backdrop = $backdrop[0] ?? '';
$poster = $series_info['cover'] ?? '';
$youtube_trailer = $series_info['youtube_trailer'] ?? '';
if ($genre) wp_genre_index_put('series', (string)$id, $genre);

/* ---------- TMDB (carátula en alta calidad, fondo, elenco y tráiler; caché 7 días) ---------- */
$tmdb = wp_tmdb_details('tv', $series_info['tmdb_id'] ?? ($series_info['tmdb'] ?? ''), $title, $year);
if (!empty($tmdb['poster'])) $poster = $tmdb['poster'];
if (!empty($tmdb['backdrop'])) $backdrop = $tmdb['backdrop'];
if (!$youtube_trailer) $youtube_trailer = $tmdb['trailer'];
if ($description === '' && $tmdb['overview'] !== '') $description = $tmdb['overview'];
$youtube_trailer = preg_replace('/[^A-Za-z0-9_\-]/', '', (string)$youtube_trailer);

/* ---------- Favorito ---------- */
$is_favorite = wp_is_favorite('series', $id);

/* ---------- Progreso: último episodio visto de esta serie ---------- */
$resume_time = 0;
$resume_total = 0;
$resume_episode_id = 0;
$latest = 0;
foreach (wp_user_progress($username) as $v) {
    if (($v['type'] ?? '') === 'series' && (string)($v['series_id'] ?? '') === (string)$id && ($v['_when'] ?? 0) > $latest) {
        $latest = $v['_when'];
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
            $resume_label = t('T{s}:E{e}', ['s' => $sn, 'e' => $row['num']]);
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
                <?php if ($rating !== '' && (float)$rating > 0): ?><span class="nf-match"><?php echo min(99, round((float)$rating * 10)); ?>% <?php echo t('para ti'); ?></span><?php endif; ?>
                <?php if ($year): ?><span><?php echo e($year); ?></span><?php endif; ?>
                <span><?php echo t(count($eps_js) === 1 ? '{n} temporada' : '{n} temporadas', ['n' => count($eps_js)]); ?></span>
                <span class="nf-badge">HD</span>
            </div>
            <p class="nf-detail-plot clamp"><?php echo e($description ?: t('Sin descripción disponible.')); ?></p>
            <div class="nf-detail-btns buttons">
                <?php if ($resume_time > 0 && $resume_episode_id > 0): ?>
                    <a href="video_player.php?id=<?php echo $resume_episode_id; ?>&slug=series&series_id=<?php echo $id; ?>" class="nf-btn nf-btn-white button"><?php echo wp_icon('play'); ?><?php echo e(t('Reanudar {e}', ['e' => $resume_label])); ?></a>
                <?php elseif ($first_ep): ?>
                    <a href="<?php echo e($first_ep['url']); ?>" class="nf-btn nf-btn-white button"><?php echo wp_icon('play'); ?><?php echo e(t('Reproducir') . ' ' . t('T{s}:E{e}', ['s' => wp_first_key($eps_js), 'e' => (int)$first_ep['num']])); ?></a>
                <?php endif; ?>
                <div class="icons" style="gap:12px">
                    <button type="button" class="nf-btn nf-btn-dark<?php echo $is_favorite ? ' on' : ''; ?>" id="toggleFavorite">
                        <span class="ic" style="display:inline-flex"><?php echo $is_favorite ? wp_icon('check') : wp_icon('plus'); ?></span><span class="lbl"><?php echo $is_favorite ? t('En mi lista') : t('Mi lista'); ?></span>
                    </button>
                    <?php if ($youtube_trailer): ?>
                        <button type="button" class="nf-btn nf-btn-dark" id="btnTrailer"><?php echo wp_icon('yt'); ?><?php echo t('Tráiler'); ?></button>
                    <?php endif; ?>
                    <a href="#episodios" class="nf-btn nf-btn-dark" id="openModal"><?php echo t('Episodios'); ?></a>
                </div>
            </div>
            <div class="nf-detail-extra">
                <?php if (!empty($series_info['cast']) && !$tmdb['cast']): ?><div><b><?php echo t('Elenco:'); ?></b> <?php echo e($series_info['cast']); ?></div><?php endif; ?>
            </div>
        </div>
    </div>
</section>

<section class="nf-section" id="episodios">
    <div class="nf-eps-head">
        <h2 style="margin:0"><?php echo t('Episodios'); ?></h2>
        <?php if (count($eps_js) > 0): ?>
        <select class="nf-select" id="seasonSel" aria-label="<?php echo e(t('Temporada')); ?>">
            <?php foreach (array_keys($eps_js) as $sn): ?>
                <option value="<?php echo e($sn); ?>" <?php echo (string)$sn === (string)$selected_season ? 'selected' : ''; ?>><?php echo e(t('Temporada {n}', ['n' => $sn])); ?> (<?php echo count($eps_js[$sn]); ?>)</option>
            <?php endforeach; ?>
        </select>
        <?php endif; ?>
    </div>
    <div class="nf-eps" id="epList"></div>
</section>

<?php if ($tmdb['cast']): ?>
<section class="nf-section">
    <h2><?php echo t('Elenco'); ?></h2>
    <div class="nf-cast">
        <?php foreach ($tmdb['cast'] as $a): ?>
            <a class="nf-actor" href="<?php echo e(wp_actor_url($a)); ?>" title="<?php echo e(t('Ver filmografía de {n}', ['n' => $a['n']])); ?>">
                <img src="<?php echo e($a['p'] ?: 'https://ui-avatars.com/api/?name=' . urlencode($a['n']) . '&background=333&color=fff'); ?>" alt="" loading="lazy">
                <div class="a"><?php echo e($a['n']); ?></div>
                <div class="c"><?php echo e($a['c']); ?></div>
            </a>
        <?php endforeach; ?>
    </div>
</section>
<?php endif; ?>

<?php if ($similar): ?>
<div class="nf-rows">
    <?php
    $cards = [];
    foreach ($similar as $s) $cards[] = wp_card($s, 'series');
    echo wp_row(t('Más series similares'), $cards, $self ? 'series.php?id=' . rawurlencode($self['cat']) : '');
    ?>
</div>
<?php endif; ?>

<div class="nf-modal" id="trailerModal" role="dialog" aria-label="<?php echo e(t('Tráiler')); ?>">
    <div class="nf-modal-box">
        <button class="nf-modal-close" type="button" aria-label="<?php echo e(t('Cerrar')); ?>">&times;</button>
        <div class="nf-ratio" id="trailerBox"></div>
    </div>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {
    var EPS = <?php echo json_encode($eps_js, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG); ?>;
    var list = document.getElementById('epList'), sel = document.getElementById('seasonSel');
    function render(sn) {
        var eps = EPS[sn] || [];
        if (!eps.length) { list.innerHTML = '<div class="nf-empty">' + <?php echo tj('No hay episodios disponibles.'); ?> + '</div>'; return; }
        list.innerHTML = eps.map(function (ep, i) {
            return '<a class="nf-ep' + (ep.current ? ' current' : '') + '" href="' + NF.esc(ep.url) + '">' +
                '<span class="no">' + (ep.num || (i + 1)) + '</span>' +
                '<span class="th"><img src="' + NF.esc(ep.img) + '" alt="" loading="lazy" onerror="NF.imgErr(this)"><span class="pl">' + NF.svg.play + '</span>' +
                (ep.pct ? '<span class="pb"><i style="width:' + Math.max(3, ep.pct) + '%"></i></span>' : '') + '</span>' +
                '<span class="tx"><span class="tt"><span>' + NF.esc(ep.title || <?php echo tj('Episodio {n}'); ?>.replace('{n}', ep.num || i + 1)) + '</span><span class="du">' + NF.esc(ep.dur) + '</span></span>' +
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
