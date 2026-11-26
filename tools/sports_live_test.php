<?php
// Fila «En vivo ahora» de Inicio (includes/sports_live.php) con el panel y la lista de canales simulados.
// Uso: php tools/sports_live_test.php
if (PHP_SAPI !== 'cli') exit;
$GLOBALS['cache'] = [];
$GLOBALS['calls'] = 0;
$GLOBALS['st'] = ['on' => true, 'max' => 3, 'id' => 'p1', 'kids' => false];
$GLOBALS['feat'] = true;
$GLOBALS['panel'] = null;
function wp_is_demo() { return false; }
function wp_tenant_feature($n) { return $GLOBALS['feat']; }
function wp_kids_on() { return !empty($GLOBALS['st']['kids']); }
function wp_prof_state() { return $GLOBALS['st']; }
function wp_prof_needed(array $s) { return !empty($s['on']) && (int)$s['max'] > 1; }
function wp_panel_ck($k) { return $k; }
function wp_cache_get($k, $ttl, &$stale = null) { $stale = null; return $GLOBALS['cache'][$k] ?? null; }
function wp_cache_set($k, $v) { $GLOBALS['cache'][$k] = $v; }
function wp_panel_call($ep, $body = null, $t = 8) {
    $GLOBALS['calls']++;
    if ($ep === 'sports_live.php') $GLOBALS['body'] = $body;
    if ($ep === 'sports_epg.php') return ['map' => ['3' => ['30']]];
    return $GLOBALS['panel'];
}
function xt_cache_key($a, $b) { return 'line1'; }
function wp_category_names($t) { return ['1' => 'Deportes', '2' => 'Eventos PPV', '3' => 'Noticias']; }
function xt_get($a) { return [
    ['stream_id' => 10, 'category_id' => '1', 'name' => 'MX: ESPN 2 HD', 'epg_channel_id' => 'espn2.mx'],
    ['stream_id' => 20, 'category_id' => '2', 'name' => 'PPV 1: Real Madrid vs Barcelona', 'epg_channel_id' => ''],
    ['stream_id' => 30, 'category_id' => '1', 'name' => 'NBA TV', 'epg_channel_id' => 'nbatv.us'],
    ['stream_id' => 40, 'category_id' => '3', 'name' => 'CNN', 'epg_channel_id' => 'cnn'],
    ['stream_id' => 50, 'category_id' => '1', 'name' => 'DAZN 1 ES FHD', 'epg_channel_id' => ''],
]; }
function wp_user() { return ['username' => 'Juan', 'password' => 'x', 'server' => 'http://srv.example:8080']; }
require __DIR__ . '/../includes/sports_live.php';

$fail = 0;
$ok = function ($c, $n) use (&$fail) { echo ($c ? '  ok    ' : '  FAIL  ') . $n . "\n"; if (!$c) $fail++; };
$ev = function ($id, $h, $a, $sp = 'Soccer', $tv = []) {
    return ['id' => $id, 'sp' => $sp, 'lg' => 'UEFA Champions League', 'h' => $h, 'a' => $a, 'hb' => '', 'ab' => '', 'hs' => '1', 'as' => '0', 'st' => '2H', 'pr' => '67', 'ev' => '', 'tv' => $tv];
};

$GLOBALS['panel'] = ['enabled' => true, 'ttl' => 30, 'events' => [
    $ev('1', 'Real Madrid', 'Barcelona', 'Soccer', [['n' => 'ESPN 2', 'c' => 'MX'], ['n' => 'Fox Sports', 'c' => '']]),
    $ev('2', 'Club Uno', 'Club Dos'),
    $ev('3', 'Lakers', 'Celtics', 'Basketball'),
], 'match' => []];
$r = wp_sports_live();
$ids = array_map(function ($c) { return $c['id']; }, $r['cards']);
$ok($r['on'] === true && $r['ttl'] === 30, 'con perfiles y clave de pago: fila, cada 30 s');
$ok($ids === ['1', '3'], 'solo partidos con un canal exacto de la lista (sin canal, no sale): ' . json_encode($ids));
$c1 = $r["cards"][0];
$ok($c1['best'] === '10' && $c1['opts'][0] === ['10', 'tv', 'ESPN 2'], 'primero el canal que lo transmite (ESPN 2 -> MX: ESPN 2 HD)');
$ok(in_array(['20', 'teams', ''], $c1['opts'], true), 'después el de los equipos');
$ok($r['cards'][1]['best'] === '30' && $r['cards'][1]['opts'][0][1] === 'guide', 'sin canal que lo transmita: el de la guía del panel');
$ok(isset($r['ch']->{'10'}) && $r['ch']->{'10'}[0] === 'MX: ESPN 2 HD' && !isset($r['ch']->{'40'}), 'solo los canales que se usan, con su nombre y carpeta');

$GLOBALS['cache'] = [];
$GLOBALS['panel'] = ['enabled' => false, 'ttl' => 3600];
$r = wp_sports_live();
$ok($r['on'] === false && $r['ttl'] === 3600, 'sin clave de pago (enabled false): sin fila, vuelven las plataformas');

$GLOBALS['cache'] = [];
$GLOBALS['st']['kids'] = true;
$n = $GLOBALS['calls'];
$ok(wp_sports_live()['on'] === false && $GLOBALS['calls'] === $n, 'perfil infantil: sin fila y sin preguntar al panel');
$GLOBALS['st'] = ['on' => true, 'max' => 1, 'id' => 'main', 'kids' => false];
$ok(!wp_sports_live_allowed(), 'una sola conexión (sin elegir perfil): sin fila');
$GLOBALS['st'] = ['on' => false, 'max' => 3, 'id' => '', 'kids' => false];
$ok(!wp_sports_live_allowed(), 'perfiles apagados: sin fila');
$GLOBALS['st'] = ['on' => true, 'max' => 3, 'id' => 'p1', 'kids' => false];
$GLOBALS['feat'] = false;
$ok(!wp_sports_live_allowed(), 'Deportes apagado para el distribuidor: sin fila');
$GLOBALS['feat'] = true;
$ok(wp_sports_live_pref_key() === 'nf_live_sport|' . substr(sha1('juan@srv.example'), 0, 12) . '|p1', 'Deporte preferido por línea y perfil');
$GLOBALS['cache'] = ['panel|sportslive' => ['enabled' => true]];
$ok(wp_sports_live_expected(), 'lo último guardado decía que hay fila: Inicio no muestra las plataformas mientras carga');

$GLOBALS['cache'] = [];
$now = time();
$evs = [];
for ($i = 0; $i < 30; $i++) {
    $e = $ev('n' . $i, 'Local ' . $i, 'Visita ' . $i, 'Soccer', [['n' => 'ESPN 2', 'c' => 'MX']]);
    $e['s'] = $i < 2 ? $now - 600 : $now + 3600 * (30 - $i);
    if ($i >= 2) $e['soon'] = true;
    $evs[] = $e;
}
$old = $ev('viejo', 'A', 'B', 'Soccer', [['n' => 'ESPN 2', 'c' => 'MX']]);
$old['soon'] = true;
$old['s'] = $now - 600;
$evs[] = $old;
$GLOBALS['panel'] = ['enabled' => true, 'ttl' => 30, 'events' => $evs, 'match' => []];
$r = wp_sports_live();
$ids = array_map(function ($c) { return $c['id']; }, $r['cards']);
$ok(($GLOBALS['body']['next'] ?? 0) === 1, 'pide next=1 al panel (también los próximos)');
$ok(count($ids) === 20 && $ids[0] === 'n0' && $ids[1] === 'n1' && $ids[2] === 'n29', 'en vivo primero, después los próximos por hora, como mucho 20');
$ok(!in_array('viejo', $ids, true) && $r['cards'][2]['soon'] === true && $r['cards'][0]['soon'] === false, 'uno que «empezaba» hace 10 min sin marcador no sale; soon marcado');

// un nombre solo es su primer canal; con número, nunca otro
$ixt = spm_index(spm_rules([]));
$ok(spm_find_by_channel('DAZN', $ixt) === [4] && spm_find_by_channel('ESPN 2', $ixt) === [0] && spm_find_by_channel('DAZN 2', $ixt) === [], '«DAZN» = «DAZN 1», «DAZN 2» no');
// la fila de Inicio no usa los canales habituales (tvh): solo un canal exacto
$GLOBALS['cache'] = [];
$u = $ev('u1', 'Lyon', 'Lens', 'Soccer', []);
$u['tvh'] = [['n' => 'ESPN 2', 'c' => 'MX']];
$u['s'] = $now - 60;
$GLOBALS['panel'] = ['enabled' => true, 'ttl' => 30, 'events' => [$u], 'match' => []];
$ok(wp_sports_live()['cards'] === [], 'un partido solo con canal habitual no sale en «En vivo ahora»');

echo $fail ? "\n$fail fallidas\n" : "\ntodo ok\n";
exit($fail ? 1 : 0);
