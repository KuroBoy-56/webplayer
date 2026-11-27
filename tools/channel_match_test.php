<?php
// Buscador de canales de Deportes (includes/sports_match.php): el canal de la lista del cliente para cada canal que
// transmite. Exacto sin calidad ni país, todas las palabras, pegadas y, como último recurso, el parecido de Levenshtein
// con los mismos números. «ESPN 2» nunca da «ESPN» ni «ESPN 3». Uso: php tools/channel_match_test.php
require __DIR__ . '/../includes/sports_match.php';

// el mismo índice que spm_index, con una lista de nombres
function ix_of(array $names)
{
    $ix = ['chans' => [], 'words' => [], 'keys' => [], 'cats' => [], 'memo' => []];
    foreach ($names as $i => $name) {
        $norm = spm_norm($name);
        $key = strpos($name, '+') !== false ? spm_channel_key($name) : spm_channel_key($norm, true);
        $ix['chans'][] = ['id' => (string)$i, 'cat' => '1', 'name' => $name, 'norm' => $norm, 'ev' => false, 'key' => $key, 'epg' => ''];
        $seen = [];
        foreach (explode(' ', $norm) as $w) if (strlen($w) >= 3 && !isset($seen[$w])) { $seen[$w] = 1; $ix['words'][$w][] = $i; }
        foreach ($key as $w) if (strlen($w) >= 2 && !ctype_digit($w) && !isset($seen[$w])) { $seen[$w] = 1; $ix['words'][$w][] = $i; }
        if ($key) $ix['keys'][implode('', $key)][] = $i;
    }
    return $ix;
}

$fail = 0;
$cases = [
    [['ESPN', 'ESPN 2 HD', 'ESPN 3'], 'ESPN 2', 1, 'el número exacto'],
    [['ESPN', 'ESPN 3'], 'ESPN 2', -1, 'nunca otro número'],
    [['DAZN 1 HD', 'DAZN 2'], 'DAZN', 0, 'un nombre solo es su primer canal'],
    [['ESPN', 'ESPN+'], 'ESPN+', 1, 'el + es plus'],
    [['ESPN', 'ESPN+'], 'ESPN', 0, 'ESPN no es ESPN+'],
    [['MX: Movistar LaLiga FHD'], 'Movistar+ LaLiga', 0, 'sin el plus si la lista no lo tiene'],
    [['TyC Sports HD'], 'TyC Sport', 0, 'parecido: una letra'],
    [['Fox Sports Premium'], 'Fox Sport Premium', 0, 'parecido con varias palabras'],
    [['Fox Sports 1', 'Fox Sports 2'], 'Fox Sport', 0, 'parecido y primer canal'],
    [['ESPN Two'], 'ESPN 2', 0, 'número en palabra'],
    [['US: ESPN Deportes East'], 'ESPN Deportes', 0, 'país y Este no cuentan'],
    [['|ES| DAZN LaLiga 2160p HDR'], 'DAZN LaLiga', 0, 'calidades nuevas'],
    [['Sky Sports F1 UHD'], 'Sky Sports 1', -1, 'F1 no es 1'],
    [['Telemundo'], 'TUDN', -1, 'nada parecido: ninguno'],
];
foreach ($cases as [$names, $q, $want, $why]) {
    $ix = ix_of($names);
    $r = spm_find_by_channel($q, $ix);
    $got = $r ? $r[0] : -1;
    $ok = $got === $want;
    if (!$ok) $fail++;
    echo ($ok ? '  ok    ' : '  FALLA ') . "$q -> $got ($why)\n";
}
echo $fail ? "\n$fail fallas\n" : "\ntodo ok\n";
exit($fail ? 1 : 0);
