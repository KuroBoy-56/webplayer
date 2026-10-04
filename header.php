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
$page_title = $page_title ?? (isset($pagename) ? $pagename : 'Inicio');
$search_query = isset($_GET['q']) ? trim((string)$_GET['q']) : '';
$wp_user_initial = mb_substr((string)$username, 0, 1, 'UTF-8');
$wp_server_name = $_SESSION['server_name'] ?? '';

if (!function_exists('wp_nav_cls')) {
    function wp_nav_cls($k)
    {
        global $nav_active;
        return $nav_active === $k ? ' class="active"' : '';
    }
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
    <meta name="theme-color" content="#141414">
    <meta name="referrer" content="strict-origin-when-cross-origin">
    <title><?php echo e($page_title); ?> - <?php echo e($sitename); ?></title>
    <link rel="icon" href="assets/img/Favicon.ico">
    <link rel="stylesheet" href="assets/vendor/fa/css/all.min.css">
    <link rel="stylesheet" href="assets/nf/app.css?v=6">
    <script>window.NF={imgErr:function(i){i.onerror=null;i.src='assets/nf/noposter.svg';i.classList.add('ok');var c=i.closest&&i.closest('.nf-card');if(c)c.classList.add('noimg');}};</script>
    <script src="assets/nf/app.js?v=4" defer></script>
    <?php if (!empty($wp_head_extra)) echo $wp_head_extra; ?>
</head>
<body class="nf-app <?php echo e($body_class ?? ''); ?>" data-tz="<?php echo e(date_default_timezone_get()); ?>">
<div id="nf-loadbar"></div>

<header class="nf-header" id="nfHeader">
    <a class="nf-logo logo-btn" href="homex.php" id="btnToggleNav" aria-label="Inicio">
        <img src="assets/img/Logo.png" alt="Logo">
    </a>
    <nav>
        <ul class="nf-nav">
            <li><a href="homex.php"<?php echo wp_nav_cls('home'); ?>>Inicio</a></li>
            <li><a href="seriesondemand.php"<?php echo wp_nav_cls('series'); ?>>Series</a></li>
            <li><a href="moviesondemand.php"<?php echo wp_nav_cls('movies'); ?>>Películas</a></li>
            <li><a href="tvguide.php"<?php echo wp_nav_cls('live'); ?>>TV en vivo</a></li>
            <li><a href="sportsschedule.php"<?php echo wp_nav_cls('sports'); ?>>Deportes</a></li>
            <li><a href="browse.php"<?php echo wp_nav_cls('browse'); ?>>Explorar</a></li>
        </ul>
    </nav>
    <div class="nf-header-right">
        <div class="nf-search" id="nfSearch">
            <form action="browse.php" method="GET" id="search-form" role="search">
                <button type="button" class="nf-icon-btn" id="nfSearchBtn" aria-label="Buscar"><?php echo wp_icon('search'); ?></button>
                <input type="search" name="q" id="nfSearchInput" placeholder="Títulos, series, películas" value="<?php echo e($search_query); ?>" autocomplete="off">
            </form>
            <div class="nf-suggest" id="nfSuggest"></div>
        </div>
        <div class="nf-clock fecha-hora-container" id="nfClock" title="Clic para cambiar 12h/24h">
            <div class="t hora-display" id="clockDisplay"></div>
            <div class="d fecha-display" id="dateDisplay"></div>
        </div>
        <div class="nf-profile" id="nfProfile">
            <button type="button" class="nf-profile-btn" id="nfProfileBtn" aria-label="Menú de cuenta">
                <span class="nf-avatar"><?php echo e($wp_user_initial ?: 'U'); ?></span>
                <span class="nf-caret"></span>
            </button>
            <div class="nf-menu" role="menu">
                <div class="who"><b><?php echo e($username); ?></b><?php echo $wp_server_name ? 'Servidor: ' . e($wp_server_name) : ''; ?></div>
                <a href="myaccount.php"><i class="fas fa-user"></i> Mi cuenta</a>
                <a href="settings.php"><i class="fas fa-cog"></i> Ajustes</a>
                <a href="sportsschedule.php"><i class="fas fa-futbol"></i> Deportes</a>
                <div class="sep"><a href="logout.php" data-noprefetch><i class="fas fa-sign-out-alt"></i> Cerrar sesión</a></div>
            </div>
        </div>
    </div>
</header>

<nav class="nf-mobile-pills" id="nfPills">
    <a href="seriesondemand.php"<?php echo wp_nav_cls('series'); ?>>Series</a>
    <a href="moviesondemand.php"<?php echo wp_nav_cls('movies'); ?>>Películas</a>
    <a href="browse.php"<?php echo wp_nav_cls('browse'); ?>>Categorías</a>
    <a href="sportsschedule.php"<?php echo wp_nav_cls('sports'); ?>>Deportes</a>
</nav>

<nav class="nf-tabbar" aria-label="Navegación">
    <a href="homex.php"<?php echo wp_nav_cls('home'); ?>><?php echo wp_icon('home'); ?><span>Inicio</span></a>
    <a href="seriesondemand.php"<?php echo wp_nav_cls('series'); ?>><?php echo wp_icon('series'); ?><span>Series</span></a>
    <a href="moviesondemand.php"<?php echo wp_nav_cls('movies'); ?>><?php echo wp_icon('film'); ?><span>Películas</span></a>
    <a href="tvguide.php"<?php echo wp_nav_cls('live'); ?>><?php echo wp_icon('live'); ?><span>En vivo</span></a>
    <a href="myaccount.php"<?php echo ($nav_active === 'account' || $nav_active === 'settings') ? ' class="active"' : ''; ?>><?php echo wp_icon('user'); ?><span>Mi cuenta</span></a>
</nav>

<main class="nf-main content-area" id="swup">
<?php
// Compatibilidad: búsqueda ?q= en páginas antiguas
if ($search_query !== '' && !in_array($wp_script, ['browse', 'tvguide'], true)) {
    $found = wp_filter('all', '', '', '', $search_query, 'az');
    echo '<div class="nf-page"><h1 class="nf-page-title">Resultados para "' . e($search_query) . '"</h1>';
    if ($found) {
        echo '<div class="nf-grid">';
        foreach (array_slice($found, 0, 120) as $it) echo wp_card_html(wp_card($it));
        echo '</div>';
    } else {
        echo '<div class="nf-empty">No se encontraron resultados.</div>';
    }
    echo '</div>';
}
