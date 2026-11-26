<?php
/**
 * «En vivo ahora» de Inicio (en el lugar de las plataformas), como Android y la app de computadora: hasta 20 partidos,
 * los que se están jugando con su marcador y minuto y después los próximos con su hora (api/sports_live.php del panel), cada uno con el canal exacto de la lista de
 * esta línea (includes/sports_match.php: el canal que lo transmite, el de la guía del panel o el de los equipos). Un
 * partido que el cliente no puede ver no sale.
 *
 * Solo con perfiles activos para la línea, un perfil elegido que no sea el infantil y Deportes encendido para el
 * distribuidor. El panel contesta enabled false sin una clave de pago de TheSportsDB propia (la del dueño o la del
 * distribuidor, nunca la de otro): entonces quedan las plataformas.
 */
if (defined('WP_SPORTS_LIVE_LOADED')) {
    return;
}
define('WP_SPORTS_LIVE_LOADED', true);
require_once __DIR__ . '/sports_match.php';

/** tarjetas de «En vivo ahora»: en vivo y próximos */
const WP_SPORTS_LIVE_MAX = 20;

/** ¿Esta sesión puede tener la fila? (sin pedir nada a la red) */
function wp_sports_live_allowed()
{
    if (wp_is_demo() || !wp_tenant_feature('sports') || wp_kids_on()) return false;
    $s = wp_prof_state();
    return wp_prof_needed($s) && (string)$s['id'] !== '';
}

/** Lo que dijo el panel (25 s por distribuidor: el panel guarda 30 s); $known = lo último guardado, sin pedir nada. */
function wp_panel_sports_live($known = false)
{
    $ck = wp_panel_ck('panel|sportslive');
    $d = wp_cache_get($ck, 25, $stale);
    if (is_array($d)) return $d;
    if ($known) return is_array($stale) ? $stale : null;
    // next=1: además de los que se juegan, los próximos de las 24 h siguientes (soon: true)
    $j = wp_panel_call('sports_live.php', ['next' => 1], 12);
    if (is_array($j) && isset($j['enabled'])) {
        wp_cache_set($ck, $j);
        return $j;
    }
    return is_array($stale) ? $stale : null;
}

/** La última respuesta conocida decía que hay fila: Inicio la reserva y no muestra las plataformas mientras carga. */
function wp_sports_live_expected()
{
    if (!wp_sports_live_allowed()) return false;
    $p = wp_panel_sports_live(true);
    return is_array($p) && !empty($p['enabled']);
}

/** Clave del navegador para «Deporte preferido» (Ajustes): por línea y perfil. */
/** clave de «Habilitar tarjetas de plataformas» (por línea y perfil, en este navegador) */
function wp_sports_live_plat_key()
{
    return 'nf_plat_cards|' . substr(wp_sports_live_pref_key(), strlen('nf_live_sport|'));
}

function wp_sports_live_pref_key()
{
    $u = wp_user();
    return 'nf_live_sport|' . substr(sha1(strtolower((string)$u['username']) . '@' . strtolower((string)parse_url((string)$u['server'], PHP_URL_HOST))), 0, 12)
        . '|' . (string)(wp_prof_state()['id'] ?? '');
}

/**
 * Para homex (sportsschedule.php?ajax=live):
 *   {on: false, ttl} = sin fila (vuelven las plataformas)
 *   {on: true, ttl, cards: [{id, sp, lg, h, a, hb, ab, hs, as, st, pr, ev, best, soon, s, opts: [[id, motivo, nombre del canal que lo transmite]]}],
 *    ch: {id: [nombre, carpeta]}}
 */
function wp_sports_live()
{
    if (!wp_sports_live_allowed()) return ['on' => false, 'ttl' => 300];
    $p = wp_panel_sports_live();
    if (!is_array($p)) return ['on' => false, 'ttl' => 60];
    if (empty($p['enabled'])) return ['on' => false, 'ttl' => max(60, min(3600, (int)($p['ttl'] ?? 3600)))];
    $ttl = max(15, min(300, (int)($p['ttl'] ?? 30)));
    $now = time();
    $events = array_values(array_filter(is_array($p['events'] ?? null) ? $p['events'] : [], function ($e) use ($now) {
        // un próximo que «empezaba» hace más de 5 min y el livescore no trae: fuera
        return is_array($e) && (string)($e['id'] ?? '') !== '' && !(!empty($e['soon']) && (int)($e['s'] ?? 0) > 0 && (int)$e['s'] < $now - 300);
    }));
    if (!$events) return ['on' => true, 'ttl' => $ttl, 'cards' => [], 'ch' => (object)[]];
    $rules = spm_rules($p);
    $ix = null;
    $index = function () use (&$ix, $rules) { if ($ix === null) $ix = spm_index($rules); return $ix; };
    $evs = [];
    foreach ($events as $e) {
        $tv = [];
        foreach ((array)($e['tv'] ?? []) as $t) if (is_array($t) && trim((string)($t['n'] ?? '')) !== '') $tv[] = (string)$t['n'];
        $evs[] = ['k' => (string)$e['id'], 'h' => (string)($e['h'] ?? ''), 'a' => (string)($e['a'] ?? ''), 'lg' => (string)($e['lg'] ?? ''), 'ev' => (string)($e['ev'] ?? ''), 'tv' => $tv];
    }
    $res = spm_resolve($evs, true, $rules, $index);
    $ch = $res['ch'];
    $cards = [];
    foreach ($events as $i => $e) {
        $id = (string)$e['id'];
        $m = $res['m'][$id] ?? ['t' => [], 'tm' => ''];
        // el menú: los canales del cliente (el que lo transmite, el de la guía y el de los equipos), sin repetir
        $opts = [];
        $seen = [];
        foreach ($m['t'] as $k => $cid) {
            if ($cid === '' || !isset($ch[$cid]) || isset($seen[$cid])) continue;
            $seen[$cid] = 1;
            $opts[] = [$cid, 'tv', $evs[$i]['tv'][$k] ?? ''];
        }
        foreach ((array)($res['g'][$id] ?? []) as $cid) {
            if (!isset($ch[$cid]) || isset($seen[$cid])) continue;
            $seen[$cid] = 1;
            $opts[] = [$cid, 'guide', ''];
        }
        if ($m['tm'] !== '' && isset($ch[$m['tm']]) && !isset($seen[$m['tm']])) $opts[] = [$m['tm'], 'teams', ''];
        // sin un canal exacto de su lista el partido no sale
        if (!$opts) continue;
        $cards[] = [
            'id' => $id, 'sp' => (string)($e['sp'] ?? ''), 'lg' => (string)($e['lg'] ?? ''), 'ev' => (string)($e['ev'] ?? ''),
            'h' => (string)($e['h'] ?? ''), 'a' => (string)($e['a'] ?? ''), 'hb' => (string)($e['hb'] ?? ''), 'ab' => (string)($e['ab'] ?? ''),
            'hs' => (string)($e['hs'] ?? ''), 'as' => (string)($e['as'] ?? ''), 'st' => (string)($e['st'] ?? ''), 'pr' => (string)($e['pr'] ?? ''),
            'best' => $opts[0][0], 'opts' => array_slice($opts, 0, 10), 'soon' => !empty($e['soon']), 's' => (int)($e['s'] ?? 0),
        ];
    }
    // en vivo primero, después los próximos por hora; como mucho 20 (al final va «Ir a Deportes»)
    usort($cards, function ($x, $y) {
        return ((int)$x['soon'] <=> (int)$y['soon']) ?: (($x['s'] ?: PHP_INT_MAX) <=> ($y['s'] ?: PHP_INT_MAX));
    });
    $cards = array_slice($cards, 0, WP_SPORTS_LIVE_MAX);
    $used = [];
    foreach ($cards as $c) foreach ($c['opts'] as $o) $used[$o[0]] = $ch[$o[0]];
    return ['on' => true, 'ttl' => $ttl, 'cards' => $cards, 'ch' => (object)$used];
}
