<?php
include "session.php";
include "config.php";
include "database.php";
require_once __DIR__ . '/includes/ui.php';

$id = preg_replace('/[^0-9]/', '', (string)($_GET["id"] ?? ''));
if ($id === '') {
    header('Location: moviesondemand.php');
    exit;
}

$channel_api = xt_get('get_vod_info', ['vod_id' => $id], 21600);
$info = is_array($channel_api["info"] ?? null) ? $channel_api["info"] : [];
$movie_data = is_array($channel_api["movie_data"] ?? null) ? $channel_api["movie_data"] : [];

$title = $info["name"] ?? ($movie_data['name'] ?? 'Desconocido');
$description = $info["plot"] ?? ($info['description'] ?? '');
$youtube_trailer = $info["youtube_trailer"] ?? '';
$movie_genre = $info["genre"] ?? '';
$releasedate = $info["releasedate"] ?? ($info['release_date'] ?? '');
$movie_rating = $info["rating"] ?? '';
$duration = $info['duration'] ?? '';
$director = $info['director'] ?? '';
$actors_txt = $info['cast'] ?? ($info['actors'] ?? '');
$container_extension = strtolower($movie_data["container_extension"] ?? 'mp4') ?: 'mp4';
$backdrop = $info["backdrop_path"] ?? '';
if (is_array($backdrop)) $backdrop = $backdrop[0] ?? '';
$img = !empty($info["movie_image"]) ? $info["movie_image"] : ($info['cover_big'] ?? '');
if ($movie_genre) wp_genre_index_put('movie', $id, $movie_genre);

/* ---------- TMDB (carátula en alta calidad, fondo, elenco y tráiler; caché 7 días) ---------- */
$tmdb = wp_tmdb_details('movie', $info['tmdb_id'] ?? ($info['tmdb'] ?? ''), $title, substr((string)$releasedate, 0, 4));
if (!empty($tmdb['poster'])) $img = $tmdb['poster'];
if (!empty($tmdb['backdrop'])) $backdrop = $tmdb['backdrop'];
if (empty($youtube_trailer)) $youtube_trailer = $tmdb['trailer'];
if ($description === '' && $tmdb['overview'] !== '') $description = $tmdb['overview'];
$youtube_trailer = preg_replace('/[^A-Za-z0-9_\-]/', '', (string)$youtube_trailer);
$img_url = wp_img($img);
$bg_url = $backdrop ? wp_img($backdrop, '') : $img_url;

/* ---------- Favorito / progreso ---------- */
$is_favorite = false;
if (isset($db)) {
    $stmt_fav = @$db->prepare("SELECT 1 FROM user_favorites WHERE username = :u AND stream_id = :sid AND type = 'movie'");
    if ($stmt_fav) {
        $stmt_fav->bindValue(':u', $username, SQLITE3_TEXT);
        $stmt_fav->bindValue(':sid', $id, SQLITE3_INTEGER);
        $res_fav = $stmt_fav->execute();
        if ($res_fav && $res_fav->fetchArray()) $is_favorite = true;
    }
}
$prog = wp_user_progress($username);
$resume_time = (int)($prog['movie_' . $id]['current_time'] ?? 0);
$total_time = (int)($prog['movie_' . $id]['total_time'] ?? 0);
$pct = $total_time > 0 ? min(100, $resume_time / $total_time * 100) : 0;

$play = "video_player.php?id={$id}&slug=movie&ext=" . rawurlencode($container_extension);

/* ---------- Similares (misma categoría) ---------- */
$similar = [];
$self = null;
foreach (wp_catalog('movie') as $m) {
    if ($m['id'] === $id) { $self = $m; break; }
}
if ($self) {
    foreach (wp_catalog('movie') as $m) {
        if ($m['id'] !== $id && array_intersect($m['cats'], $self['cats'])) $similar[] = $m;
    }
    usort($similar, function ($a, $b) { return $b['added'] <=> $a['added']; });
    $similar = array_slice($similar, 0, 80);
    shuffle($similar);
    $similar = array_slice($similar, 0, 24);
}

$year = substr((string)$releasedate, 0, 4);
$page_title = $title;
$body_class = 'nf-detail';
include "header.php";
?>
<section class="nf-detail-hero">
    <div class="nf-detail-bg" style="background-image:url('<?php echo e($bg_url); ?>')"></div>
    <div class="nf-detail-inner">
        <div class="nf-detail-poster"><img src="<?php echo e($img_url); ?>" alt="" onerror="NF.imgErr(this)"></div>
        <div class="nf-detail-info">
            <h1><?php echo e($title); ?></h1>
            <div class="nf-detail-meta">
                <?php if ($movie_rating !== '' && (float)$movie_rating > 0): ?><span class="nf-match"><?php echo min(99, round((float)$movie_rating * 10)); ?>% para ti</span><?php endif; ?>
                <?php if ($year): ?><span><?php echo e($year); ?></span><?php endif; ?>
                <?php if ($duration): ?><span><?php echo e($duration); ?></span><?php endif; ?>
                <span class="nf-badge"><?php echo e(strtoupper($container_extension)); ?></span>
                <span class="nf-badge">HD</span>
                <?php if ($movie_rating !== '' && (float)$movie_rating > 0): ?><span>★ <?php echo e(round((float)$movie_rating, 1)); ?>/10</span><?php endif; ?>
            </div>
            <?php if ($resume_time > 0 && $total_time > 0): ?>
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;max-width:380px">
                    <div style="flex:1;height:4px;background:#555;border-radius:2px;overflow:hidden"><div style="height:100%;width:<?php echo (int)$pct; ?>%;background:var(--nf-red)"></div></div>
                    <span style="font-size:13px;color:#bbb">Quedan <?php echo max(1, round(($total_time - $resume_time) / 60)); ?> min</span>
                </div>
            <?php endif; ?>
            <p class="nf-detail-plot"><?php echo e($description ?: 'Sin descripción disponible.'); ?></p>
            <div class="nf-detail-btns">
                <?php if ($resume_time > 0): ?>
                    <a href="<?php echo e($play); ?>" class="nf-btn nf-btn-white button-primary"><?php echo wp_icon('play'); ?>Reanudar</a>
                    <a href="<?php echo e($play); ?>&restart=1" class="nf-btn nf-btn-gray">Ver desde el inicio</a>
                <?php else: ?>
                    <a href="<?php echo e($play); ?>" class="nf-btn nf-btn-white button-primary"><?php echo wp_icon('play'); ?>Reproducir</a>
                <?php endif; ?>
                <div class="icons" style="gap:12px">
                    <button type="button" class="nf-btn nf-btn-dark<?php echo $is_favorite ? ' on' : ''; ?>" id="toggleFavorite">
                        <span class="ic" style="display:inline-flex"><?php echo $is_favorite ? wp_icon('check') : wp_icon('plus'); ?></span><span class="lbl"><?php echo $is_favorite ? 'En mi lista' : 'Mi lista'; ?></span>
                    </button>
                    <?php if ($youtube_trailer): ?>
                        <button type="button" class="nf-btn nf-btn-dark" id="btnTrailer"><?php echo wp_icon('yt'); ?>Tráiler</button>
                    <?php endif; ?>
                </div>
            </div>
            <div class="nf-detail-extra">
                <?php if ($director): ?><div><b>Dirección:</b> <?php echo e($director); ?></div><?php endif; ?>
                <?php if (!$tmdb['cast'] && $actors_txt): ?><div><b>Elenco:</b> <?php echo e($actors_txt); ?></div><?php endif; ?>
            </div>
        </div>
    </div>
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
    foreach ($similar as $s) $cards[] = wp_card($s, 'movie');
    echo wp_row('Más títulos similares', $cards, $self ? 'movies.php?id=' . rawurlencode($self['cat']) : '');
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
    var fav = document.getElementById('toggleFavorite');
    if (fav) fav.addEventListener('click', function () {
        NF.fav(fav, { id: <?php echo json_encode($id); ?>, type: 'movie', title: <?php echo json_encode($title); ?>, poster: <?php echo json_encode($img); ?> });
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
