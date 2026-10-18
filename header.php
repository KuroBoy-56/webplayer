<?php
include_once __DIR__ . "/session.php";
include_once __DIR__ . "/config.php";
include_once __DIR__ . "/dirhome/time_config.php";
require_once __DIR__ . "/includes/ui.php";

if (defined('WP_HEADER_DONE')) {
    return;
}
define('WP_HEADER_DONE', true);

$wp_script = strtolower(basename($_SERVER['SCRIPT_NAME'] ?? '', '.php'));
$wp_nav_map = [
    'homex' => 'home', 'home' => 'home',
    'seriesondemand' => 'series', 'series' => 'series', 'seriesvideo' => 'series',
    'moviesondemand' => 'movies', 'movies' => 'movies', 'movie_description' => 'movies',
    'tvguide' => 'live', 'sportsschedule' => 'sports', 'browse' => 'browse',
    'myaccount' => 'account', 'settings' => 'settings',
];
$nav_active = $nav_active ?? ($wp_nav_map[$wp_script] ?? '');
$page_title = $page_title ?? (isset($pagename) ? $pagename : t('Inicio'));
$search_query = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
// DEMO: nunca se muestra el usuario de la línea
$wp_demo = wp_is_demo();
$wp_user_initial = $wp_demo ? 'D' : mb_substr((string)$username, 0, 1, 'UTF-8');
$wp_server_name = !empty($_SESSION['server_id']) ? t('Servidor {n}', ['n' => $_SESSION['server_id']]) : ($_SESSION['server_name'] ?? '');
// Marca del distribuidor (Omitir: logo, nombre y colores de siempre)
$wp_dist_cfg = wp_tenant_cfg();
$wp_dist_pal = wp_tenant_palette($wp_dist_cfg);
$wp_show_sports = wp_tenant_feature('sports');

if (!function_exists('wp_nav_cls')) {
    function wp_nav_cls($k)
    {
        global $nav_active;
        return $nav_active === $k ? ' class="active"' : '';
    }
}
?>
<!DOCTYPE html>
<html lang="<?php echo wp_lang(); ?>">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="<?php echo e($wp_dist_pal ? $wp_dist_pal['bg'] : '#141414'); ?>">
    <meta name="referrer" content="strict-origin-when-cross-origin">
    <title><?php echo e($page_title); ?> - <?php echo e($sitename); ?></title>
    <link rel="icon" href="assets/img/Favicon.ico">
    <link rel="stylesheet" href="assets/vendor/fa/css/all.min.css">
    <link rel="stylesheet" href="assets/nf/app.css?v=10">
    <?php echo wp_tenant_css($wp_dist_cfg); ?>
    <?php if (wp_panel_tenant() !== '' || wp_dist_choice() === 'skip') echo wp_brand_store_script($wp_dist_cfg); ?>
    <script>window.NF={demo:<?php echo $wp_demo ? 'true' : 'false'; ?>,imgErr:function(i){i.onerror=null;i.src='assets/nf/noposter.svg';i.classList.add('ok');var c=i.closest&&i.closest('.nf-card');if(c)c.classList.add('noimg');}};</script>
    <?php echo wp_i18n_script(); ?>
    <script src="assets/nf/app.js?v=7" defer></script>
    <script src="assets/nf/alert.js?v=3" defer></script>
    <?php if (!empty($wp_head_extra)) echo $wp_head_extra; ?>
</head>
<body class="nf-app <?php echo e($body_class ?? ''); ?>" data-tz="<?php echo e(date_default_timezone_get()); ?>">
<div id="nf-loadbar"></div>

<header class="nf-header" id="nfHeader">
    <a class="nf-logo logo-btn" href="homex.php" id="btnToggleNav" aria-label="<?php echo e(t('Inicio')); ?>">
        <img src="<?php echo e(wp_brand_logo($wp_dist_cfg)); ?>" alt="<?php echo e(wp_brand_name('Logo', $wp_dist_cfg)); ?>" onerror="this.onerror=null;this.src='assets/img/Logo.png'">
    </a>
    <nav>
        <ul class="nf-nav">
            <li><a href="homex.php"<?php echo wp_nav_cls('home'); ?>><?php echo t('Inicio'); ?></a></li>
            <li><a href="seriesondemand.php"<?php echo wp_nav_cls('series'); ?>><?php echo t('Series'); ?></a></li>
            <li><a href="moviesondemand.php"<?php echo wp_nav_cls('movies'); ?>><?php echo t('Películas'); ?></a></li>
            <li><a href="tvguide.php"<?php echo wp_nav_cls('live'); ?>><?php echo t('TV en vivo'); ?></a></li>
            <?php if ($wp_show_sports): ?><li><a href="sportsschedule.php"<?php echo wp_nav_cls('sports'); ?>><?php echo t('Deportes'); ?></a></li><?php endif; ?>
            <li><a href="browse.php"<?php echo wp_nav_cls('browse'); ?>><?php echo t('Explorar'); ?></a></li>
        </ul>
    </nav>
    <div class="nf-header-right">
        <div class="nf-search" id="nfSearch">
            <form action="browse.php" method="GET" id="search-form" role="search">
                <button type="button" class="nf-icon-btn" id="nfSearchBtn" aria-label="<?php echo e(t('Buscar')); ?>"><?php echo wp_icon('search'); ?></button>
                <input type="search" name="q" id="nfSearchInput" placeholder="<?php echo e(t('Títulos, series, películas')); ?>" value="<?php echo e($search_query); ?>" autocomplete="off">
            </form>
            <div class="nf-suggest" id="nfSuggest"></div>
        </div>
        <div class="nf-clock fecha-hora-container" id="nfClock" title="<?php echo e(t('Clic para cambiar 12h/24h')); ?>">
            <div class="t hora-display" id="clockDisplay"></div>
            <div class="d fecha-display" id="dateDisplay"></div>
        </div>
        <div class="nf-profile" id="nfProfile">
            <button type="button" class="nf-profile-btn" id="nfProfileBtn" aria-label="<?php echo e(t('Menú de cuenta')); ?>">
                <span class="nf-avatar"><?php echo e($wp_user_initial ?: 'U'); ?></span>
                <span class="nf-caret"></span>
            </button>
            <div class="nf-menu" role="menu">
                <div class="who"><b><?php echo $wp_demo ? e(t('Cuenta DEMO')) : e($username); ?></b><?php echo $wp_server_name ? e(t('Servidor: {s}', ['s' => $wp_server_name])) : ''; ?></div>
                <a href="myaccount.php"><i class="fas fa-user"></i> <?php echo t('Mi cuenta'); ?></a>
                <a href="settings.php"><i class="fas fa-cog"></i> <?php echo t('Ajustes'); ?></a>
                <?php if ($wp_show_sports): ?><a href="sportsschedule.php"><i class="fas fa-futbol"></i> <?php echo t('Deportes'); ?></a><?php endif; ?>
                <label class="lang"><span><i class="fas fa-globe"></i> <?php echo t('Idioma de la app'); ?></span><?php echo wp_lang_select('nf-select'); ?></label>
                <div class="sep"><a href="logout.php" data-noprefetch><i class="fas fa-sign-out-alt"></i> <?php echo t('Cerrar sesión'); ?></a></div>
            </div>
        </div>
    </div>
</header>

<?php if (!in_array($wp_script, ['movie_description', 'series', 'seriesvideo'], true)): ?>
<nav class="nf-mobile-pills" id="nfPills">
    <a href="seriesondemand.php"<?php echo wp_nav_cls('series'); ?>><?php echo t('Series'); ?></a>
    <a href="moviesondemand.php"<?php echo wp_nav_cls('movies'); ?>><?php echo t('Películas'); ?></a>
    <a href="browse.php"<?php echo wp_nav_cls('browse'); ?>><?php echo t('Categorías'); ?></a>
    <?php if ($wp_show_sports): ?><a href="sportsschedule.php"<?php echo wp_nav_cls('sports'); ?>><?php echo t('Deportes'); ?></a><?php endif; ?>
</nav>
<?php endif; ?>

<nav class="nf-tabbar" aria-label="<?php echo e(t('Navegación')); ?>">
    <a href="homex.php"<?php echo wp_nav_cls('home'); ?>><?php echo wp_icon('home'); ?><span><?php echo t('Inicio'); ?></span></a>
    <a href="seriesondemand.php"<?php echo wp_nav_cls('series'); ?>><?php echo wp_icon('series'); ?><span><?php echo t('Series'); ?></span></a>
    <a href="moviesondemand.php"<?php echo wp_nav_cls('movies'); ?>><?php echo wp_icon('film'); ?><span><?php echo t('Películas'); ?></span></a>
    <a href="tvguide.php"<?php echo wp_nav_cls('live'); ?>><?php echo wp_icon('live'); ?><span><?php echo t('En vivo'); ?></span></a>
    <a href="myaccount.php"<?php echo ($nav_active === 'account' || $nav_active === 'settings') ? ' class="active"' : ''; ?>><?php echo wp_icon('user'); ?><span><?php echo t('Mi cuenta'); ?></span></a>
</nav>

<main class="nf-main content-area" id="swup">
<?php
// Compatibilidad: búsqueda ?q= en páginas antiguas
if ($search_query !== '' && !in_array($wp_script, ['browse', 'tvguide'], true)) {
    $found = wp_filter('all', '', '', '', $search_query, 'az');
    echo '<div class="nf-page"><h1 class="nf-page-title">' . e(t('Resultados para "{q}"', ['q' => $search_query])) . '</h1>';
    if ($found) {
        echo '<div class="nf-grid">';
        foreach (array_slice($found, 0, 120) as $it) echo wp_card_html(wp_card($it));
        echo '</div>';
    } else {
        echo '<div class="nf-empty">' . e(t('No se encontraron resultados.')) . '</div>';
    }
    echo '</div>';
}
