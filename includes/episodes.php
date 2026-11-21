<?php
/**
 * Vista previa de los capítulos de una serie (web player 2.9.2), como Roku, Vega y Android TV: la imagen del capítulo
 * del servidor IPTV (por el puente del Worker si el navegador no puede cargarla) → la foto del capítulo en TMDB → el
 * fondo de la serie → su carátula. Si el servidor no trae el nombre o la sinopsis del capítulo, los de TMDB.
 * TMDB: /tv/{id}/season/{n} con la clave de la línea (la del distribuidor o la del dueño) o por el panel
 * (wp_tmdb_url), 7 días en la caché.
 */
if (defined('WP_EPISODES_LOADED')) {
    return;
}
define('WP_EPISODES_LOADED', true);

/** Capítulos de una temporada en TMDB: [número => ['still' => url, 'name' => …, 'plot' => …]] ([] sin clave o sin datos). */
function wp_tmdb_season($tvId, $season, $wait = 5)
{
    $tvId = preg_replace('/\D/', '', (string)$tvId);
    $season = (int)$season;
    if ($tvId === '' || $season < 0 || !wp_tmdb_on()) return [];
    $tl = wp_tmdb_lang();
    $ck = 'tmdbseason1|' . $tl . '|' . $tvId . '|' . $season;
    $hit = wp_cache_get($ck, 604800);
    if (is_array($hit)) return $hit;
    $body = wp_http_get(wp_tmdb_url('tv/' . $tvId . '/season/' . $season, 'language=' . $tl), $wait);
    $j = $body ? json_decode($body, true) : null;
    if (!is_array($j)) return []; // sin respuesta: se vuelve a preguntar la próxima vez
    $out = [];
    foreach ((array)($j['episodes'] ?? []) as $e) {
        if (!is_array($e) || !isset($e['episode_number'])) continue;
        $out[(int)$e['episode_number']] = [
            'still' => !empty($e['still_path']) ? 'https://image.tmdb.org/t/p/w300' . $e['still_path'] : '',
            'name' => trim((string)($e['name'] ?? '')),
            'plot' => trim((string)($e['overview'] ?? '')),
        ];
    }
    wp_cache_set($ck, $out);
    return $out;
}

/** ¿El nombre que trae el servidor es solo «Episodio 3», «S01E03», «Serie - S01E03» (sin nombre de verdad)? */
function wp_ep_generic_title($title, $series = '')
{
    $t = trim((string)$title);
    if ($t === '') return true;
    $s = trim((string)$series);
    if ($s !== '' && stripos($t, $s) === 0) $t = trim(substr($t, strlen($s)), " -–:|.");
    return $t === '' || (bool)preg_match('/^(?:(?:s\d{1,3}\s*e\d{1,4})|(?:t\d{1,3}\s*e\d{1,4})|(?:\d{1,3}x\d{1,4})|(?:(?:episodio|episode|cap[ií]tulo|ep\.?|e)\s*\d{1,4}))$/i', $t);
}

/**
 * Completa los capítulos de una temporada ($rows de seriesvideo.php) con TMDB: img (la primera dirección que se prueba)
 * y fb (las siguientes), y el nombre / la sinopsis que falten. $art = [fondo de la serie, carátula].
 */
function wp_eps_fill(array $rows, array $tm, $series, array $art)
{
    foreach ($rows as &$r) {
        $t = $tm[(int)$r['num']] ?? null;
        $chain = [];
        if ($r['src'] !== '') $chain[] = $r['src'];
        if ($t && $t['still'] !== '') $chain[] = $t['still'];
        foreach ($art as $a) if ($a !== '') $chain[] = $a;
        $chain = array_values(array_unique($chain));
        $r['img'] = $chain ? array_shift($chain) : WP_NOIMG;
        $r['fb'] = $chain;
        if ($t) {
            if ($t['name'] !== '' && wp_ep_generic_title($r['title'], $series)) $r['title'] = $t['name'];
            if (trim((string)$r['plot']) === '' && $t['plot'] !== '') $r['plot'] = $t['plot'];
        }
        unset($r['src']);
    }
    unset($r);
    return $rows;
}
