<?php
// se muestra sin esperar el catálogo completo (modo navegador: las filas se llenan solas, includes/xt_client.php)
define('WP_XT_SOFT', 1);
include "session.php";
include "config.php";
$page_title = t('Inicio');
include "header.php";

/* ---------- Sólo títulos que existen en el servidor IPTV actual ---------- */
// los ids del catálogo, guardados aparte (includes/catalog_fast.php): no se lee el catálogo entero en cada Inicio
$have = ['movie' => wp_catalog_ids('movie'), 'series' => wp_catalog_ids('series')];
$in_server = function ($type, $id) use ($have) {
    // si el catálogo no cargó (servidor caído) no se oculta nada
    return !$have[$type] || isset($have[$type][(string)$id]);
};

/* ---------- Mi lista (favoritos guardados en el panel) ---------- */
$favoritos = [];
foreach (wp_user_favorites() as $row) {
    if (!in_array($row['type'], ['movie', 'series'], true)) continue;
    if ($in_server($row['type'], $row['stream_id'])) $favoritos[] = $row;
    if (count($favoritos) >= 30) break;
}

/* ---------- Continuar viendo (progreso guardado en el panel) ---------- */
$continuar_viendo = [];
$user_prog = array_values(wp_user_progress($username));
usort($user_prog, function ($a, $b) {
    return ($b['_when'] ?? 0) <=> ($a['_when'] ?? 0);
});
$user_prog = array_values(array_filter($user_prog, function ($it) use ($in_server) {
    return ($it['type'] ?? 'movie') === 'series'
        ? $in_server('series', $it['series_id'] ?? '')
        : $in_server('movie', $it['stream_id'] ?? '');
}));
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
    // carátula por la caché del panel; en series el título guardado puede traer el episodio: solo la imagen
    $src = wp_poster_sources($type, $item['poster_url'] ?? '', $type == 'series' ? '' : ($item['title'] ?? ''));
    $cont_html .= wp_card_html(['u' => $medialink, 'n' => $item['title'] ?? '', 'i' => $src ? array_shift($src) : WP_NOIMG, 'f' => $src, 'r' => ''], $pct);
}

$fav_html = '';
foreach ($favoritos as $fav) {
    $isS = $fav['type'] === 'series';
    $src = wp_poster_sources($isS ? 'series' : 'movie', $fav['poster_url'], $fav['title']);
    $fav_html .= wp_card_html([
        'u' => $isS ? 'seriesvideo.php?id=' . rawurlencode($fav['stream_id']) : 'Movie_description.php?id=' . rawurlencode($fav['stream_id']),
        'n' => $fav['title'], 'i' => $src ? array_shift($src) : WP_NOIMG, 'f' => $src, 'r' => '',
    ]);
}

$platforms = wp_available_platforms();
$genres = wp_available_genres('all');

/* «En vivo ahora» (includes/sports_live.php): con perfiles, en el lugar de las plataformas; si la última respuesta del
   panel decía que hay fila, las plataformas ni aparecen mientras carga */
require_once __DIR__ . '/includes/sports_live.php';
$live_allowed = wp_sports_live_allowed();
$live_expected = $live_allowed && wp_sports_live_expected();
?>

<?php echo wp_hero_html(t('Destacado')); ?>

<?php if ($live_allowed): ?>
<section class="nf-live" id="nfLive" aria-labelledby="nfLiveT" hidden>
    <h2 class="nf-row-title nf-live-title" id="nfLiveT"><span class="nf-live-dot" aria-hidden="true"></span><?php echo e(t('En vivo ahora')); ?></h2>
    <div class="nf-plats-row"><button class="nf-arrow l" type="button" aria-label="<?php echo e(t('Anterior')); ?>" hidden><?php echo wp_icon('left'); ?></button><div class="nf-slider nf-live-slider"></div><button class="nf-arrow r" type="button" aria-label="<?php echo e(t('Siguiente')); ?>" hidden><?php echo wp_icon('right'); ?></button></div>
</section>
<div id="nfPlatWrap"<?php echo $live_expected ? ' hidden' : ''; ?>><?php echo wp_platform_tiles(); ?></div>
<script>/* Ajustes › Habilitar tarjetas de plataformas: las plataformas siguen debajo de «En vivo ahora» */
try { if (localStorage.getItem(<?php echo json_encode(wp_sports_live_plat_key()); ?>) === '1') document.getElementById('nfPlatWrap').hidden = false; } catch (x) {}</script>
<link rel="stylesheet" href="assets/nf/live.css?v=3">
<script>window.NF_LIVE = { key: <?php echo json_encode(wp_sports_live_pref_key()); ?>, platKey: <?php echo json_encode(wp_sports_live_plat_key()); ?>, T: {
    live: <?php echo tj('En vivo'); ?>, ht: <?php echo tj('Descanso'); ?>, close: <?php echo tj('Cerrar'); ?>, auto: <?php echo tj('Ver el evento (canal automático)'); ?>,
    inList: <?php echo tj('en tu lista: {c}'); ?>, inGuide: <?php echo tj('en la guía'); ?>, byTeams: <?php echo tj('por equipos'); ?>,
    searchX: <?php echo tj('Buscar canales: «{q}»'); ?>, searchAny: <?php echo tj('Buscar canal, equipo o evento…'); ?>, typeHint: <?php echo tj('Canal, equipo o evento'); ?>,
    go: <?php echo tj('Buscar'); ?>, starts: <?php echo tj('Empieza'); ?>, goSports: <?php echo tj('Ir a Deportes'); ?>, goSportsSub: <?php echo tj('Toda la agenda de hoy y mañana'); ?>, chWith: <?php echo tj('Canales con «{q}»'); ?>, noChWith: <?php echo tj('No hay canales con «{q}» en tu lista'); ?> } };</script>
<script src="assets/nf/live.js?v=3" defer></script>
<?php else: ?>
<?php echo wp_platform_tiles(); ?>
<?php endif; ?>

<nav class="nf-chips m-only" aria-label="<?php echo e(t('Géneros')); ?>">
    <?php foreach ($genres as $k => $g): ?>
        <a class="nf-chip" href="browse.php?genre=<?php echo e($k); ?>"><?php echo e($g['label']); ?></a>
    <?php endforeach; ?>
</nav>

<div class="nf-rows">
    <?php
    if ($cont_html) echo wp_row(t('Continuar viendo'), [], '', '', 'sec_continuar', $cont_html);
    if ($fav_html) echo wp_row(t('Mi lista'), [], '', '', 'sec_favoritos', $fav_html);

    echo wp_row(t('Top 10 de hoy'), [], 'browse.php?type=all&sort=rating', 'api.php?action=row&type=movie&sort=top', 'sec_top', null, 'top');
    echo wp_row(t('Películas agregadas recientemente'), [], 'browse.php?type=movie&sort=recent', 'api.php?action=row&type=movie&sort=recent&limit=30', 'sec_peliculas');
    echo wp_row(t('Series nuevas'), [], 'browse.php?type=series&sort=recent', 'api.php?action=row&type=series&sort=recent&limit=30', 'sec_series');

    $i = 0;
    foreach ($platforms as $k => $p) {
        if (in_array($k, ['xmas', 'halloween'], true)) continue;
        echo wp_row(t('Lo mejor de {p}', ['p' => $p['label']]), [], 'browse.php?platform=' . $k, 'api.php?action=row&type=all&platform=' . $k . '&sort=recent&limit=30');
        if (++$i >= 5) break;
    }

    echo wp_row(t('Series para ti'), [], 'seriesondemand.php', 'api.php?action=row&type=series&shuffle=1&limit=24');

    $preferred = ['accion', 'comedia', 'terror', 'anime', 'drama', 'suspenso', 'aventura', 'infantil', 'scifi', 'romance', 'documental'];
    foreach ($preferred as $k) {
        if (!isset($genres[$k])) continue;
        echo wp_row($genres[$k]['label'], [], 'browse.php?genre=' . $k, 'api.php?action=row&type=all&genre=' . $k . '&sort=recent&limit=30');
    }

    echo wp_row(t('Películas para ti'), [], 'moviesondemand.php', 'api.php?action=row&type=movie&shuffle=1&limit=24');
    ?>
</div>

<script>
document.addEventListener('DOMContentLoaded', function () {
    // destacados como en la TV (includes/hero.php): los que ya tienen fondo al momento, los demás se suman al llegar
    NF.heroLoad(document.getElementById('nfHero'), 'all', { empty: function () {
        // sin ningún destacado con fondo: el collage de siempre (en un perfil infantil, ninguno: tiene carátulas para
        // adultos); de carátula el logo propio (Omitir o distribuidor sin logo). El logo de un distribuidor suele ser
        // ancho y en la tarjeta vertical del celular quedaba recortado: sin carátula se usa el fondo
        NF.hero(document.getElementById('nfHero'), [{ title: <?php echo tj('Bienvenido'); ?>, description: <?php echo tj('Selecciona una película o serie de nuestro catálogo para comenzar a disfrutar del contenido.'); ?>, background_image: <?php echo json_encode(wp_kids_on() ? '' : 'assets/images/overlay.webp'); ?>, poster: <?php echo json_encode(wp_brand_logo() === WP_LOGO ? WP_LOGO : '', JSON_UNESCAPED_SLASHES); ?>, play_link: 'moviesondemand.php', info_link: 'browse.php', rating: '' }]);
    } });
});
</script>
<?php include "footer.php"; ?>
