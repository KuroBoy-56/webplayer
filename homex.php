<?php
include "session.php";
include "config.php";
$page_title = 'Inicio';
include "header.php";
include "database.php";

/* ---------- Mi lista (favoritos guardados en SQLite) ---------- */
$favoritos = [];
if (isset($db)) {
    $stmt_fav = $db->prepare("SELECT stream_id, title, poster_url, type FROM user_favorites WHERE username = :username AND type IN ('movie', 'series') ORDER BY added_at DESC LIMIT 30");
    $stmt_fav->bindValue(':username', $username, SQLITE3_TEXT);
    $res_fav = $stmt_fav->execute();
    while ($res_fav && ($row = $res_fav->fetchArray(SQLITE3_ASSOC))) {
        $favoritos[] = $row;
    }
}

/* ---------- Continuar viendo (progress.json) ---------- */
$continuar_viendo = [];
$user_prog = array_values(wp_user_progress($username));
usort($user_prog, function ($a, $b) {
    return ($b['last_watched'] ?? 0) <=> ($a['last_watched'] ?? 0);
});
$continuar_viendo = array_slice($user_prog, 0, 20);

$cont_html = '';
foreach ($continuar_viendo as $item) {
    $stream_id = $item["stream_id"] ?? '';
    $type = $item["type"] ?? 'movie';
    $series_id = $item["series_id"] ?? 0;
    $medialink = ($type == 'series')
        ? "video_player.php?id=" . rawurlencode($stream_id) . "&slug=series&series_id=" . rawurlencode($series_id)
        : "video_player.php?id=" . rawurlencode($stream_id) . "&slug=movie";
    $pct = (!empty($item["total_time"]) && $item["total_time"] > 0) ? ($item["current_time"] / $item["total_time"]) * 100 : 5;
    $cont_html .= wp_card_html(['u' => $medialink, 'n' => $item['title'] ?? '', 'i' => wp_img($item['poster_url'] ?? ''), 'r' => ''], $pct);
}

$fav_html = '';
foreach ($favoritos as $fav) {
    $isS = $fav['type'] === 'series';
    $fav_html .= wp_card_html([
        'u' => $isS ? 'seriesvideo.php?id=' . rawurlencode($fav['stream_id']) : 'Movie_description.php?id=' . rawurlencode($fav['stream_id']),
        'n' => $fav['title'], 'i' => wp_img($fav['poster_url']), 'r' => '',
    ]);
}

$platforms = wp_available_platforms();
$genres = wp_available_genres('all');
?>

<?php echo wp_hero_html('Destacado'); ?>

<?php echo wp_platform_tiles(); ?>

<nav class="nf-chips" aria-label="Géneros">
    <?php foreach ($genres as $k => $g): ?>
        <a class="nf-chip" href="browse.php?genre=<?php echo e($k); ?>"><?php echo e($g['label']); ?></a>
    <?php endforeach; ?>
</nav>

<div class="nf-rows">
    <?php
    if ($cont_html) echo wp_row('Continuar viendo', [], '', '', 'sec_continuar', $cont_html);
    if ($fav_html) echo wp_row('Mi lista', [], '', '', 'sec_favoritos', $fav_html);

    echo wp_row('Top 10 de hoy', [], 'browse.php?type=all&sort=rating', 'api.php?action=row&type=movie&sort=top', 'sec_top', null, 'top');
    echo wp_row('Películas agregadas recientemente', [], 'browse.php?type=movie&sort=recent', 'api.php?action=row&type=movie&sort=recent&limit=30', 'sec_peliculas');
    echo wp_row('Series nuevas', [], 'browse.php?type=series&sort=recent', 'api.php?action=row&type=series&sort=recent&limit=30', 'sec_series');

    $i = 0;
    foreach ($platforms as $k => $p) {
        if (in_array($k, ['xmas', 'halloween'], true)) continue;
        echo wp_row('Lo mejor de ' . $p['label'], [], 'browse.php?platform=' . $k, 'api.php?action=row&type=all&platform=' . $k . '&sort=recent&limit=30');
        if (++$i >= 5) break;
    }

    echo wp_row('Series para ti', [], 'seriesondemand.php', 'api.php?action=row&type=series&shuffle=1&limit=24');

    $preferred = ['accion', 'comedia', 'terror', 'anime', 'drama', 'suspenso', 'aventura', 'infantil', 'scifi', 'romance', 'documental'];
    foreach ($preferred as $k) {
        if (!isset($genres[$k])) continue;
        echo wp_row($genres[$k]['label'], [], 'browse.php?genre=' . $k, 'api.php?action=row&type=all&genre=' . $k . '&sort=recent&limit=30');
    }

    echo wp_row('Películas para ti', [], 'moviesondemand.php', 'api.php?action=row&type=movie&shuffle=1&limit=24');
    ?>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {
    NF.api({ action: 'hero', type: 'all' }).then(function (res) {
        var items = res.items || [];
        if (!items.length) {
            items = [{ title: 'Bienvenido', description: 'Selecciona una película o serie de nuestro catálogo para comenzar a disfrutar del contenido.', background_image: 'assets/images/overlay.webp', poster: 'assets/img/Logo.png', play_link: 'moviesondemand.php', info_link: 'browse.php', rating: '' }];
        }
        NF.hero(document.getElementById('nfHero'), items);
    }).catch(function () {});
});
</script>
<?php include "footer.php"; ?>
