<?php
// «Continuar viendo» y «Mi lista» (includes/home_lists.php): la fila de Inicio corta, su «Ver todo» (mylist.php) completo.
// Uso: php tools/home_lists_test.php
if (PHP_SAPI !== 'cli') exit;
const WP_NOIMG = 'noimg.png';
function wp_catalog_ids($t) { return $t === 'movie' ? ['1' => 1, '2' => 1, '3' => 1] : ['9' => 1]; }
function wp_poster_sources($t, $p, $n) { return $p ? [$p] : []; }
function wp_card_html(array $c, $pct = null) { return '[' . $c['n'] . ($pct !== null ? ':' . (int)$pct : '') . ']'; }
function wp_user_progress($u) {
    return [
        ['type' => 'movie', 'stream_id' => '1', 'title' => 'Vieja', 'current_time' => 10, 'total_time' => 100, '_when' => 1],
        ['type' => 'movie', 'stream_id' => '2', 'title' => 'Nueva', 'current_time' => 50, 'total_time' => 100, '_when' => 3],
        ['type' => 'movie', 'stream_id' => '7', 'title' => 'Ya no está', 'current_time' => 5, 'total_time' => 100, '_when' => 9],
        ['type' => 'series', 'stream_id' => '55', 'series_id' => '9', 'title' => 'Serie', 'current_time' => 0, 'total_time' => 0, '_when' => 2],
    ];
}
function wp_user_favorites() {
    return [
        ['type' => 'movie', 'stream_id' => '3', 'title' => 'A', 'poster_url' => ''],
        ['type' => 'live', 'stream_id' => '4', 'title' => 'Canal', 'poster_url' => ''],
        ['type' => 'series', 'stream_id' => '9', 'title' => 'B', 'poster_url' => ''],
        ['type' => 'movie', 'stream_id' => '8', 'title' => 'Fuera', 'poster_url' => ''],
    ];
}
require __DIR__ . '/../includes/home_lists.php';
$fails = 0;
$ok = function ($c, $m) use (&$fails) { echo ($c ? '  ok    ' : '  FALLA ') . $m . "\n"; if (!$c) $fails++; };

list($h, $n) = wp_continue_cards('u');
$ok($h === '[Nueva:50][Serie:5][Vieja:10]' && $n === 3, 'Continuar viendo completo: lo último primero, sin lo que ya no está en el servidor (' . $h . ')');
list($h, $n) = wp_continue_cards('u', 2);
$ok($h === '[Nueva:50][Serie:5]' && $n === 3, 'la fila de Inicio corta, el total sigue siendo de todos');
list($h, $n) = wp_mylist_cards();
$ok($h === '[A][B]' && $n === 2, 'Mi lista: películas y series del servidor, sin canales (' . $h . ')');
list($h, $n) = wp_mylist_cards(1);
$ok($h === '[A]' && $n === 2, 'Mi lista con tope (Inicio)');
// «Ver todo» salía en blanco: mylist.php armaba las tarjetas antes del encabezado (que carga ui.php, donde está
// wp_card_html) y PHP se detenía. ui.php tiene que cargarse antes de la primera tarjeta.
$page = file_get_contents(__DIR__ . '/../mylist.php');
$ui = strpos($page, "includes/ui.php");
$first = min(strpos($page, 'wp_mylist_cards('), strpos($page, 'wp_continue_cards('));
$ok($ui !== false && $ui < $first, 'mylist.php carga ui.php antes de armar las tarjetas (si no, la página queda en blanco)');
echo $fails ? "\n$fails falla(s)\n" : "\ntodo ok\n";
exit($fails ? 1 : 0);
