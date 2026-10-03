<?php
/** Piezas visuales reutilizables (tarjetas, filas, iconos). */
if (defined('WP_UI_LOADED')) {
    return;
}
define('WP_UI_LOADED', true);
require_once __DIR__ . '/core.php';

function wp_icon($name)
{
    static $p = [
        'play' => '<path fill="currentColor" d="M6 4v16a1 1 0 0 0 1.5.86l13-8a1 1 0 0 0 0-1.72l-13-8A1 1 0 0 0 6 4z"/>',
        'info' => '<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm-1-9h2v6h-2zm0-4h2v2h-2z"/>',
        'plus' => '<path fill="currentColor" d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/>',
        'check' => '<path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
        'search' => '<path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.39-1.42 1.42-5.39-5.39A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/>',
        'home' => '<path fill="currentColor" d="M12 3 2 11h3v9h6v-6h2v6h6v-9h3z"/>',
        'film' => '<path fill="currentColor" d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm1 2v2h2V5zm12 0v2h2V5zM5 9v2h2V9zm12 0v2h2V9zM5 13v2h2v-2zm12 0v2h2v-2zM5 17v2h2v-2zm12 0v2h2v-2zM9 5v14h6V5z"/>',
        'tv' => '<path fill="currentColor" d="M3 5h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-7v2h3v2H7v-2h3v-2H3a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm1 2v9h16V7z"/>',
        'live' => '<path fill="currentColor" d="M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM5.6 5.6l1.4 1.4a7 7 0 0 0 0 10l-1.4 1.4a9 9 0 0 1 0-12.8zm12.8 0a9 9 0 0 1 0 12.8L17 17a7 7 0 0 0 0-10z"/>',
        'series' => '<path fill="currentColor" d="M4 6h16v10H4zm-2-2v14h20V4zm6 16h8v2H8z"/>',
        'user' => '<path fill="currentColor" d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zm0 2c-5 0-9 2.5-9 5.5V22h18v-2.5c0-3-4-5.5-9-5.5z"/>',
        'more' => '<path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z"/>',
        'left' => '<path fill="currentColor" d="M15.4 4.6 8 12l7.4 7.4-1.4 1.4L5.2 12 14 3.2z"/>',
        'right' => '<path fill="currentColor" d="M8.6 4.6 16 12l-7.4 7.4 1.4 1.4 8.8-8.8L10 3.2z"/>',
        'back' => '<path fill="currentColor" d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/>',
        'yt' => '<path fill="currentColor" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2 26 26 0 0 0 2 12a26 26 0 0 0 .4 4.8 2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8A26 26 0 0 0 22 12a26 26 0 0 0-.4-4.8zM10 15V9l5.2 3z"/>',
        'sports' => '<path fill="currentColor" d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 3.3 1.4-1a8 8 0 0 1 4.3 3.2l-.4 1.5-2.1.7L13 7.6zm-3.4-1 1.4 1v2.3L7.9 9.7l-2.1-.7-.5-1.5a8 8 0 0 1 4.3-3.2zM7.1 17.4l-1.5.1A8 8 0 0 1 4 12.9l1.1-1 2.1.7 1.2 3.7zm7.4 2.4a8 8 0 0 1-5 0l-.7-1.4L10 17h4l1.2 1.4zm.3-4.8H9.2l-1.1-3.5L12 8.8l3.9 2.7zm3.6 2.5-1.5-.1-1.3-1.2 1.2-3.7 2.1-.7 1.1 1a8 8 0 0 1-1.6 4.7z"/>',
        'gear' => '<path fill="currentColor" d="M19.4 13a7.5 7.5 0 0 0 0-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.5-1-2 3.5L6.6 11a7.5 7.5 0 0 0 0 2l-2.2 1.6 2 3.5 2.5-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.4-2.7a7.6 7.6 0 0 0 1.7-1l2.5 1 2-3.5zM13 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z"/>',
        'logout' => '<path fill="currentColor" d="M10 17l1.4 1.4L17.8 12l-6.4-6.4L10 7l4 4H3v2h11zM20 3h-8v2h8v14h-8v2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/>',
        'grid' => '<path fill="currentColor" d="M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z"/>',
    ];
    $path = $p[$name] ?? $p['info'];
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' . $path . '</svg>';
}

/** Tarjeta (póster) renderizada en el servidor. $progress en %. */
function wp_card_html(array $c, $progress = null, $extraClass = '')
{
    $cls = 'nf-card' . ($progress !== null ? ' has-pb' : '') . ($extraClass ? ' ' . $extraClass : '');
    $h = '<a class="' . $cls . '" href="' . e($c['u']) . '" title="' . e($c['n']) . '">';
    $h .= '<img src="' . e($c['i']) . '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'ok\')" onerror="NF.imgErr(this)">';
    if ($c['r'] !== '' && (float)$c['r'] > 0) $h .= '<span class="rt">★ ' . e($c['r']) . '</span>';
    $h .= '<span class="nm">' . e($c['n']) . '</span>';
    if ($progress !== null) $h .= '<span class="pb"><i style="width:' . max(2, min(100, (int)$progress)) . '%"></i></span>';
    return $h . '</a>';
}

/**
 * Fila horizontal. $items = tarjetas (wp_card) ya preparadas, o $src = URL de api.php para carga diferida.
 */
function wp_row($title, array $items = [], $more = '', $src = '', $id = '', $html = null, $variant = '')
{
    $o = '<section class="nf-row' . ($variant ? ' nf-' . e($variant) : '') . '"' . ($id ? ' id="' . e($id) . '"' : '') . '>';
    $o .= '<div class="nf-row-head"><h2 class="nf-row-title">' . e($title) . '</h2>';
    if ($more) $o .= '<a class="nf-row-more" href="' . e($more) . '">Ver todo ›</a>';
    $o .= '</div><div class="nf-row-viewport">';
    $o .= '<button class="nf-arrow l" type="button" aria-label="Anterior" hidden>' . wp_icon('left') . '</button>';
    $o .= '<div class="nf-slider"' . ($src ? ' data-src="' . e($src) . '"' : '') . ($variant ? ' data-variant="' . e($variant) . '"' : '') . '>';
    if ($html !== null) {
        $o .= $html;
    } elseif ($items) {
        foreach ($items as $c) $o .= wp_card_html($c);
    } elseif ($src) {
        $o .= str_repeat('<div class="nf-skel"></div>', 8);
    }
    $o .= '</div><button class="nf-arrow r" type="button" aria-label="Siguiente">' . wp_icon('right') . '</button>';
    return $o . '</div></section>';
}

function wp_genre_chips($baseUrl, $active = '', $type = 'all', $withAll = true)
{
    $sep = strpos($baseUrl, '?') === false ? '?' : '&';
    $o = '<nav class="nf-chips" aria-label="Géneros">';
    if ($withAll) $o .= '<a class="nf-chip' . ($active === '' ? ' active' : '') . '" href="' . e($baseUrl) . '">Todo</a>';
    foreach (wp_available_genres($type) as $k => $g) {
        $o .= '<a class="nf-chip' . ($active === $k ? ' active' : '') . '" href="' . e($baseUrl . $sep . 'genre=' . $k) . '">' . e($g['label']) . '</a>';
    }
    return $o . '</nav>';
}

function wp_platform_tiles()
{
    $o = '';
    foreach (wp_available_platforms() as $k => $p) {
        $o .= '<a class="nf-plat" href="browse.php?platform=' . e($k) . '" title="' . e($p['label']) . '" style="--accent:' . e($p['color']) . '">';
        if ($p['img']) {
            $o .= '<img src="' . e($p['img']) . '" alt="' . e($p['label']) . '" loading="lazy">';
        } else {
            $o .= '<span class="txt" style="color:' . e($p['color']) . '">' . e($p['label']) . '</span>';
        }
        $o .= '</a>';
    }
    return $o ? '<nav class="nf-platforms" aria-label="Plataformas">' . $o . '</nav>' : '';
}

function wp_footer_html()
{
    return '<footer class="nf-footer"><p>© ' . date('Y') . ' <a href="https://www.latmpx.com" target="_blank" rel="noopener">Garevyn TV</a></p></footer>';
}

function wp_hero_html($kindLabel = 'Destacado')
{
    $o = '<section class="nf-hero" id="nfHero">';
    $o .= '<div class="nf-hero-bg"></div><div class="nf-hero-bg"></div>';
    $o .= '<div class="nf-hero-info">';
    // vista celular (póster centrado como la app)
    $o .= '<div class="nf-hero-poster m-only"><div class="in"><div class="nf-hero-kicker" data-h="kicker"><span class="n">N</span>' . e($kindLabel) . '</div><h2 class="nf-hero-title" data-h="title">&nbsp;</h2><div class="nf-hero-meta" data-h="meta"></div></div></div>';
    $o .= '<div class="nf-hero-btns m-only"><a class="nf-btn nf-btn-white" data-h="play" href="#">' . wp_icon('play') . 'Reproducir</a><a class="nf-btn nf-btn-gray" data-h="info" href="#">' . wp_icon('info') . 'Info</a></div>';
    // vista PC
    $o .= '<div class="d-only"><div class="nf-hero-kicker" data-h="kicker"><span class="n">N</span>' . e($kindLabel) . '</div>';
    $o .= '<h1 class="nf-hero-title" data-h="title">&nbsp;</h1><div class="nf-hero-meta" data-h="meta"></div><p class="nf-hero-desc" data-h="desc"></p>';
    $o .= '<div class="nf-hero-btns"><a class="nf-btn nf-btn-white" data-h="play" href="#">' . wp_icon('play') . 'Reproducir</a><a class="nf-btn nf-btn-gray" data-h="info" href="#">' . wp_icon('info') . 'Más información</a></div></div>';
    $o .= '</div><div class="nf-hero-dots"></div></section>';
    return $o;
}
