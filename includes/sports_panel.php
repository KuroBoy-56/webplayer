<?php
/**
 * Deportes con el panel (igual que Roku, Vega, Android, Windows e iPhone): Tablas (api/sports_tables.php), los
 * partidos de Equipos / Selecciones (api/sports_fixtures.php, 21 días) y la ficha del equipo (api/sports_team.php).
 * Todo sale de los JSON que prepara el panel (la web nunca consulta TheSportsDB). El hosting guarda una sola copia por
 * distribuidor e idioma para todos los que miran: las tablas hasta 7 días, los partidos 12 h, o hasta que el panel
 * anuncie otra versión (tables.t / fixtures.t de api/sports.php). Si el panel todavía está armando ("p": 1) se
 * devuelve lo que hay y el navegador vuelve a preguntar.
 */
if (defined('WP_SPORTS_PANEL_LOADED')) {
    return;
}
define('WP_SPORTS_PANEL_LOADED', true);

/** Qué pestañas ofrece el panel: [tables, fixtures, nat, tables_rev, fixtures_rev]. */
function wp_sports_extra(array $sp)
{
    $t = is_array($sp['tables'] ?? null) ? $sp['tables'] : [];
    $f = is_array($sp['fixtures'] ?? null) ? $sp['fixtures'] : [];
    return [
        'tables' => !empty($t['on']),
        'fixtures' => !empty($f['on']),
        'nat' => !empty($f['on']) && !empty($f['nat']),
        'trev' => (int)($t['t'] ?? 0),
        'frev' => (int)($f['t'] ?? 0),
    ];
}

/** {on, ok, partial, leagues: [...]} */
function wp_sports_tables($rev)
{
    $ck = wp_panel_ck('sp|tables|' . wp_lang());
    $saved = wp_cache_get($ck, 7 * 86400);
    $leagues = is_array($saved) && is_array($saved['leagues'] ?? null) ? $saved['leagues'] : [];
    // misma versión que anuncia el panel y de menos de un día: sin preguntar
    if ($leagues && $rev > 0 && (int)($saved['mt'] ?? 0) === $rev && time() - (int)($saved['at'] ?? 0) < 86400) {
        return ['on' => true, 'ok' => true, 'partial' => false, 'leagues' => $leagues];
    }
    $j = wp_panel_call('sports_tables.php', null, 20);
    if (!is_array($j)) return ['on' => true, 'ok' => (bool)$leagues, 'partial' => false, 'leagues' => $leagues];
    if (array_key_exists('on', $j) && empty($j['on'])) {
        @unlink(wp_cache_dir('data') . '/' . md5($ck) . '.json');
        return ['on' => false, 'ok' => true, 'partial' => false, 'leagues' => []];
    }
    $partial = (int)($j['p'] ?? 0) === 1;
    $new = is_array($j['leagues'] ?? null) ? array_values(array_filter($j['leagues'], 'is_array')) : [];
    if ($new) {
        // a medio armar sirve de respaldo, pero la próxima vez se vuelve a pedir
        wp_cache_set($ck, ['leagues' => $new, 'mt' => $partial ? 0 : (int)($j['mt'] ?? 0), 'at' => time()]);
        return ['on' => true, 'ok' => true, 'partial' => $partial, 'leagues' => $new];
    }
    return ['on' => true, 'ok' => $partial || (bool)$leagues, 'partial' => $partial, 'leagues' => $leagues];
}

/** {on, ok, partial, leagues: {id: {...}}, events: [...]} */
function wp_sports_fixtures($rev)
{
    $ck = wp_panel_ck('sp|fixtures|' . wp_lang());
    $saved = wp_cache_get($ck, 2 * 86400);
    $has = is_array($saved) && is_array($saved['events'] ?? null);
    if ($has && $rev > 0 && (int)($saved['mt'] ?? 0) === $rev && time() - (int)($saved['at'] ?? 0) < 43200) {
        return ['on' => true, 'ok' => true, 'partial' => false, 'leagues' => (object)$saved['leagues'], 'events' => $saved['events']];
    }
    $j = wp_panel_call('sports_fixtures.php', null, 25);
    if (is_array($j)) {
        if (array_key_exists('on', $j) && empty($j['on'])) {
            @unlink(wp_cache_dir('data') . '/' . md5($ck) . '.json');
            return ['on' => false, 'ok' => true, 'partial' => false, 'leagues' => (object)[], 'events' => []];
        }
        $partial = (int)($j['p'] ?? 0) === 1;
        $events = is_array($j['events'] ?? null) ? array_values(array_filter($j['events'], 'is_array')) : [];
        $leagues = is_array($j['leagues'] ?? null) ? $j['leagues'] : [];
        if ($events) {
            wp_cache_set($ck, ['events' => $events, 'leagues' => $leagues, 'mt' => $partial ? 0 : (int)($j['mt'] ?? 0), 'at' => time()]);
            return ['on' => true, 'ok' => true, 'partial' => $partial, 'leagues' => (object)$leagues, 'events' => $events];
        }
        if ($partial && !$has) return ['on' => true, 'ok' => true, 'partial' => true, 'leagues' => (object)[], 'events' => []];
    }
    if ($has) return ['on' => true, 'ok' => true, 'partial' => false, 'leagues' => (object)$saved['leagues'], 'events' => $saved['events']];
    return ['on' => true, 'ok' => false, 'partial' => false, 'leagues' => (object)[], 'events' => []];
}

/** Ficha del equipo en el idioma de la app (el panel la guarda 30 días; el hosting 7). null si no hay. */
function wp_sports_team($id)
{
    $id = preg_replace('/[^0-9]/', '', (string)$id);
    if ($id === '') return null;
    $ck = 'sp|team|' . $id . '|' . wp_lang();
    $hit = wp_cache_get($ck, 7 * 86400);
    if (is_array($hit)) return $hit['ok'] ? $hit : null;
    $j = wp_panel_call('sports_team.php?id=' . $id, null, 12);
    if (!is_array($j)) return null; // sin respuesta: se vuelve a pedir la próxima vez
    $hon = [];
    foreach ((is_array($j['hon'] ?? null) ? $j['hon'] : []) as $h) {
        if (is_array($h) && (string)($h['t'] ?? '') !== '') $hon[] = ['t' => (string)$h['t'], 'n' => (int)($h['n'] ?? 0)];
    }
    $out = empty($j['ok']) ? ['ok' => false] : [
        'ok' => true, 'n' => (string)($j['n'] ?? ''), 'b' => (string)($j['b'] ?? ''), 'y' => (string)($j['y'] ?? ''),
        'loc' => (string)($j['loc'] ?? ''), 'c' => (string)($j['c'] ?? ''), 'st' => (string)($j['st'] ?? ''), 'cap' => (int)($j['cap'] ?? 0),
        'lg' => (string)($j['lg'] ?? ''), 'hon' => $hon, 'd' => (string)($j['d'] ?? ''),
    ];
    wp_cache_set($ck, $out);
    return $out['ok'] ? $out : null;
}
