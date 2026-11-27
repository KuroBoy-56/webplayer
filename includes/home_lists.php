<?php
/**
 * «Continuar viendo» y «Mi lista» (los guarda el panel: api/progress.php): la fila de Inicio (homex.php) y su «Ver todo»
 * (mylist.php) se arman aquí, así las dos muestran lo mismo. Solo títulos que siguen en el servidor IPTV actual.
 */

/** ¿Sigue en el servidor? Si el catálogo no cargó (servidor caído) no se oculta nada. */
function wp_home_in_server($type, $id)
{
    static $have = null;
    // los ids del catálogo, guardados aparte (includes/catalog_fast.php): no se lee el catálogo entero
    if ($have === null) $have = ['movie' => wp_catalog_ids('movie'), 'series' => wp_catalog_ids('series')];
    return !$have[$type] || isset($have[$type][(string)$id]);
}

/** Tarjetas de «Continuar viendo», lo último visto primero; $limit 0 = todas. Devuelve [html, cuántas hay en total]. */
function wp_continue_cards($username, $limit = 0)
{
    $list = array_values(wp_user_progress($username));
    usort($list, function ($a, $b) {
        return ($b['_when'] ?? 0) <=> ($a['_when'] ?? 0);
    });
    $list = array_values(array_filter($list, function ($it) {
        return ($it['type'] ?? 'movie') === 'series'
            ? wp_home_in_server('series', $it['series_id'] ?? '')
            : wp_home_in_server('movie', $it['stream_id'] ?? '');
    }));
    $total = count($list);
    if ($limit > 0) $list = array_slice($list, 0, $limit);
    $html = '';
    foreach ($list as $item) {
        $stream_id = $item['stream_id'] ?? '';
        $type = $item['type'] ?? 'movie';
        $series_id = $item['series_id'] ?? 0;
        $medialink = ($type == 'series')
            ? 'video_player.php?id=' . rawurlencode($stream_id) . '&slug=series&series_id=' . rawurlencode($series_id)
            : 'video_player.php?id=' . rawurlencode($stream_id) . '&slug=movie';
        $pct = (!empty($item['total_time']) && $item['total_time'] > 0) ? ($item['current_time'] / $item['total_time']) * 100 : 5;
        // carátula por la caché del panel; en series el título guardado puede traer el episodio: solo la imagen
        $src = wp_poster_sources($type, $item['poster_url'] ?? '', $type == 'series' ? '' : ($item['title'] ?? ''));
        $html .= wp_card_html(['u' => $medialink, 'n' => $item['title'] ?? '', 'i' => $src ? array_shift($src) : WP_NOIMG, 'f' => $src, 'r' => ''], $pct);
    }
    return [$html, $total];
}

/** Tarjetas de «Mi lista» (películas y series), en el orden del panel; $limit 0 = todas. Devuelve [html, total]. */
function wp_mylist_cards($limit = 0)
{
    $list = [];
    foreach (wp_user_favorites() as $row) {
        if (!in_array($row['type'], ['movie', 'series'], true)) continue;
        if (wp_home_in_server($row['type'], $row['stream_id'])) $list[] = $row;
    }
    $total = count($list);
    if ($limit > 0) $list = array_slice($list, 0, $limit);
    $html = '';
    foreach ($list as $fav) {
        $isS = $fav['type'] === 'series';
        $src = wp_poster_sources($isS ? 'series' : 'movie', $fav['poster_url'], $fav['title']);
        $html .= wp_card_html([
            'u' => $isS ? 'seriesvideo.php?id=' . rawurlencode($fav['stream_id']) : 'Movie_description.php?id=' . rawurlencode($fav['stream_id']),
            'n' => $fav['title'], 'i' => $src ? array_shift($src) : WP_NOIMG, 'f' => $src, 'r' => '',
        ]);
    }
    return [$html, $total];
}
