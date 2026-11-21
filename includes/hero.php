<?php
/**
 * Destacados (carrusel) de Inicio, Películas y Series como en la TV (Roku, Vega, Android TV) — web player 2.9.4.
 *
 * Antes la web esperaba a tener TODOS los destacados con su fondo (16 en Inicio: la ficha de cada uno del servidor y,
 * si no traía fondo, TMDB) para mostrar el primero: con un servidor lento o el modo navegador el pedido tardaba tanto
 * que se cortaba y quedaba la imagen fija, y lo que llegaba se guardaba 20 min aunque fuera uno solo (sin carrusel).
 * Ahora api.php?action=hero contesta al momento con los que ya tienen fondo conocido y la lista de los que faltan;
 * la página los pide de a uno (api.php?action=heroart) y los va sumando al carrusel a medida que llegan.
 */
if (defined('WP_HERO_LOADED')) {
    return;
}
define('WP_HERO_LOADED', true);

/**
 * Los títulos candidatos (de lo más nuevo con carátula, al azar, 8 por tipo), los mismos 20 minutos. En Inicio, si uno
 * de los dos catálogos todavía no llegó (modo navegador: se trae por detrás), se empieza con el que ya está, como la TV,
 * en lugar de esperarlo: esa lista parcial vale 90 s y después se arma la completa.
 */
function wp_hero_pool($type, $platform)
{
    $pk = 'heropool|hero|' . $type . '|' . $platform . '|' . xt_cache_key('', []) . (wp_kids_on() ? '|kids' : '');
    $pool = wp_cache_get($pk, 1200);
    if (is_array($pool) && $pool) return $pool;
    $types = $type === 'all' ? ['movie', 'series'] : [$type];
    $partial = false;
    if (count($types) > 1 && !$platform && function_exists('wp_catalog_have')) {
        $have = array_values(array_filter($types, 'wp_catalog_have'));
        if ($have && count($have) < count($types)) {
            $pp = wp_cache_get($pk . '|p', 90);
            if (is_array($pp) && $pp) return $pp;
            $partial = true;
            $types = $have;
            foreach (array_diff(['movie', 'series'], $have) as $miss) {
                if (function_exists('wp_xt_client') && wp_xt_client()) wp_xt_need($miss === 'series' ? 'get_series' : 'get_vod_streams', [], false);
            }
        }
    }
    $pool = [];
    foreach ($types as $t) {
        $list = $platform ? wp_filter($t, $platform, '', '', '', 'recent') : wp_catalog($t);
        if (!$platform) wp_sort_items($list, 'added');
        $list = array_slice(array_values(array_filter($list, function ($i) { return $i['icon'] !== ''; })), 0, 150);
        shuffle($list);
        foreach (array_slice($list, 0, 8) as $it) { $it['t'] = $t; $pool[] = $it; }
    }
    shuffle($pool);
    if ($pool) wp_cache_set($partial ? $pk . '|p' : $pk, $pool);
    return $pool;
}

/** Candidatos donde buscar uno que pidió la página: la lista actual y, si la hubo, la parcial de antes. */
function wp_hero_pools($type, $platform)
{
    $pk = 'heropool|hero|' . $type . '|' . $platform . '|' . xt_cache_key('', []) . (wp_kids_on() ? '|kids' : '');
    $pp = wp_cache_get($pk . '|p', 1200);
    return array_merge(wp_hero_pool($type, $platform), is_array($pp) ? $pp : []);
}

/**
 * Fondo horizontal de un título (2.9.9): primero el de TMDB en alta calidad (con el id de TMDB del servidor o del
 * catálogo, o por nombre y año; la clave de panel_secret.php, la del panel o TMDB por el panel), como el póster de las
 * tarjetas; el de la ficha del servidor solo si TMDB no tiene (muchos servidores ponen ahí la misma carátula, o una
 * imagen que no carga, y se veía la carátula estirada). Con TMDB no hace falta esperar la ficha del servidor.
 * $net = false: solo lo ya guardado (sin pedir nada). Devuelve [fondo, ficha, ¿se sabe?] (se sabe = ya se buscó: con
 * fondo, o sin él en ningún lado).
 */
function wp_hero_art(array $it, $net)
{
    $act = $it['t'] === 'series' ? 'get_series_info' : 'get_vod_info';
    $par = $it['t'] === 'series' ? ['series_id' => $it['id']] : ['vod_id' => $it['id']];
    // la ficha del servidor si ya está guardada (su id de TMDB, sinopsis y género; y el fondo de respaldo)
    $data = wp_cache_get(xt_cache_key($act, $par), 86400, $stale);
    if ($data === null) $data = $stale;
    $info = is_array($data) && is_array($data['info'] ?? null) ? $data['info'] : [];
    // 1. TMDB
    if (wp_tmdb_on()) {
        $tmid = is_scalar($info['tmdb_id'] ?? ($info['tmdb'] ?? '')) ? (string)($info['tmdb_id'] ?? ($info['tmdb'] ?? '')) : '';
        $tmx = wp_tmdb_details($it['t'] === 'series' ? 'tv' : 'movie', $tmid !== '' ? $tmid : (string)($it['tm'] ?? ''), (string)($info['name'] ?? $it['name']), (string)($it['year'] ?? ''), !$net);
        if (is_array($tmx) && (string)($tmx['backdrop'] ?? '') !== '') {
            if (trim((string)($info['plot'] ?? ($info['description'] ?? ''))) === '' && !empty($tmx['overview'])) $info['plot'] = $tmx['overview'];
            if (empty($info['tmdb_id']) && !empty($tmx['id'])) $info['tmdb_id'] = (string)$tmx['id'];
            return [(string)$tmx['backdrop'], $info, true];
        }
        if (!is_array($tmx)) return ['', $info, false]; // TMDB todavía no se buscó (lo busca action=heroart)
    }
    // 2. el de la ficha del servidor
    if (!is_array($data)) {
        if (!$net) return ['', [], false];
        $data = xt_get($act, $par, 86400, 8);
        // modo navegador: la ficha la trae el navegador y este pedido se repite (xtneed)
        if (function_exists('wp_xt_blocking') && wp_xt_blocking()) return ['', [], false];
        $info = is_array($data) && is_array($data['info'] ?? null) ? $data['info'] : [];
    }
    $bd = $info['backdrop_path'] ?? '';
    if (is_array($bd)) $bd = $bd[0] ?? '';
    return [is_string($bd) ? trim($bd) : '', $info, true];
}

/** Un destacado para la página (antes de wp_hero_kind). */
function wp_hero_item(array $it, array $info, $bd)
{
    $isS = $it['t'] === 'series';
    if (!empty($info['genre'])) wp_genre_index_put($it['t'], $it['id'], $info['genre']);
    $link = $isS ? 'seriesvideo.php?id=' . rawurlencode($it['id']) : 'Movie_description.php?id=' . rawurlencode($it['id']);
    $year = substr((string)($info['releasedate'] ?? ($info['releaseDate'] ?? ($info['release_date'] ?? ''))), 0, 4);
    // (con el fondo de TMDB puede no estar la ficha del servidor: año y género del catálogo)
    if ($year === '') $year = (string)($it['year'] ?? '');
    return [
        'title' => (string)($info['name'] ?? $it['name']) ?: $it['name'],
        'description' => (string)($info['plot'] ?? ($info['description'] ?? '')),
        'rating' => (string)($info['rating'] ?? $it['rating']),
        'year' => $year,
        'genre' => implode(', ', array_slice(array_map('trim', explode(',', (string)($info['genre'] ?? ($it['genre'] ?? '')))), 0, 2)),
        'background_image' => wp_img($bd, ''),
        'poster' => wp_img($it['icon'], ''),
        'bd' => $bd,
        'icon' => $it['icon'],
        'play_link' => $link,
        'info_link' => $link,
        'kind' => $isS ? 'Serie' : 'Película',
        'tm' => is_scalar($info['tmdb_id'] ?? ($info['tmdb'] ?? '')) ? (string)($info['tmdb_id'] ?? ($info['tmdb'] ?? '')) : '',
    ];
}

/** api.php?action=hero: los que ya tienen fondo (hasta 6) y los que faltan buscar ({t, id, n}), al momento. */
function wp_hero_list($type, $platform)
{
    $items = [];
    $pending = [];
    foreach (wp_hero_pool($type, $platform) as $it) {
        [$bd, $info, $known] = wp_hero_art($it, false);
        if ($bd !== '') {
            if (count($items) < 6) $items[] = wp_hero_item($it, $info, $bd);
        } elseif (!$known) {
            $pending[] = ['t' => $it['t'], 'id' => (string)$it['id'], 'n' => (string)$it['name']];
        }
    }
    return [$items, count($items) >= 6 ? [] : $pending];
}

/** api.php?action=heroart: el destacado de un candidato (su ficha del servidor y, sin fondo, TMDB) o null. */
function wp_hero_one($type, $platform, $t, $id)
{
    foreach (wp_hero_pools($type, $platform) as $it) {
        if ($it['t'] !== $t || (string)$it['id'] !== (string)$id) continue;
        [$bd, $info] = wp_hero_art($it, true);
        return $bd !== '' ? wp_hero_item($it, $info, $bd) : null;
    }
    return null;
}
