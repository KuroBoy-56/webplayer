<?php
/* Guarda "Continuar viendo" en el panel (api/progress.php). Nada se guarda en el hosting.
 * Lo usan save_progress.php (sesión normal) y play.php (reproductor http). */
/** Guarda y deja un registro de los últimos 30 intentos (se ve en estado.php). */
function wp_progress_save(array $in, $username)
{
    $GLOBALS['wp_progress_why'] = '';
    $r = wp_progress_save_do($in, $username);
    $log = wp_cache_get('progress|log', 864000);
    $log = is_array($log) ? $log : [];
    array_unshift($log, ['t' => time(), 'id' => (string)($in['id'] ?? ''), 'slug' => (string)($in['slug'] ?? ''),
        'pos' => (int)($in['current_time'] ?? 0), 'dur' => (int)($in['total_time'] ?? 0), 'ok' => !empty($r['ok']),
        'why' => (string)$GLOBALS['wp_progress_why'], 'title' => (string)($GLOBALS['wp_progress_title'] ?? ''),
        'err' => (string)($GLOBALS['wp_panel_last_error'] ?? '')]);
    wp_cache_set('progress|log', array_slice($log, 0, 30));
    return $r;
}

function wp_progress_save_do(array $in, $username)
{
    $stream_id = preg_replace('/[^0-9]/', '', (string)($in['id'] ?? ''));
    $slug = ($in['slug'] ?? 'movie') === 'series' ? 'series' : 'movie';
    $series_id = preg_replace('/[^0-9]/', '', (string)($in['series_id'] ?? '0')) ?: '0';
    $current_time = max(0, (int)($in['current_time'] ?? 0));
    $total_time = max(0, (int)($in['total_time'] ?? 0));

    if (!$stream_id || !$username || ($slug === 'series' && $series_id === '0')) {
        $GLOBALS['wp_progress_why'] = 'faltan datos (id/serie)';
        return ['ok' => false];
    }

    // Título, póster, categoría y extensión (desde la caché de la API Xtream)
    $title = '';
    $poster = '';
    $category = '';
    $ext = 'mp4';
    if ($slug === 'series') {
        $apiData = xt_get('get_series_info', ['series_id' => $series_id], 21600);
        $title = (string)($apiData['info']['name'] ?? '');
        $poster = (string)($apiData['info']['cover'] ?? '');
        $category = (string)($apiData['info']['category_id'] ?? '');
        foreach ((array)($apiData['episodes'] ?? []) as $eps) {
            foreach ((array)$eps as $ep) {
                if (is_array($ep) && (string)($ep['id'] ?? '') === $stream_id) {
                    $ext = (string)($ep['container_extension'] ?? 'mp4');
                    break 2;
                }
            }
        }
    } else {
        $apiData = xt_get('get_vod_info', ['vod_id' => $stream_id], 21600);
        $title = (string)($apiData['info']['name'] ?? ($apiData['movie_data']['name'] ?? ''));
        $poster = (string)($apiData['info']['movie_image'] ?? ($apiData['info']['cover_big'] ?? ''));
        $category = (string)($apiData['movie_data']['category_id'] ?? '');
        $ext = (string)($apiData['movie_data']['container_extension'] ?? 'mp4');
    }
    $title = trim($title);
    $GLOBALS['wp_progress_title'] = $title;
    if ($title === '') {
        // Sin nombre no hay clave en el panel (el panel guarda una entrada por título)
        $GLOBALS['wp_progress_why'] = 'sin título (la API Xtream no respondió)';
        return ['ok' => false];
    }

    // Visto al 95 % o más: se quita de "Continuar viendo"
    if ($total_time > 0 && $current_time / $total_time >= 0.95) {
        $ok = wp_panel_post('delete', ['title' => $title]);
        $GLOBALS['wp_progress_why'] = 'visto (se quita de Continuar viendo)';
        return ['ok' => $ok];
    }

    // Series: una sola entrada por serie (clave = nombre de la serie) con el último episodio visto
    $ok = wp_panel_post('save', [
        'title' => $title,
        'position' => $current_time,
        'duration' => $total_time,
        'url' => wp_stream_url($slug === 'series' ? 'series' : 'movie', $stream_id, $ext),
        'poster' => wp_panel_url($poster),
        'type' => $slug === 'series' ? 'episode' : 'movie',
        'id' => $stream_id,
        'seriesId' => $slug === 'series' ? $series_id : '',
        'categoryId' => $category,
    ]);
    return ['ok' => $ok];
}
