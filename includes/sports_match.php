<?php
/**
 * Deportes: el canal de cada partido en la lista del cliente, igual que Android TV, Roku, Vega OS, webOS y Tizen
 * (Sports.kt de Android TV): el que lo transmite si el cliente lo tiene (por su nombre sin calidad ni país: «ESPN 2»
 * da «MX: ESPN 2 HD», nunca «ESPN» ni «ESPN 3»; «M+» = Movistar; al final por las palabras pegadas), el de la guía del
 * panel (api/sports_epg.php) o el de los equipos / nombre del evento (reglas «match» de api/sports.php). Los canales se
 * indexan por palabras una sola vez por pedido: cada partido compara solo los canales que comparten alguna palabra con
 * sus equipos o con su canal de TV (no todos contra todos).
 */
if (defined('WP_SPORTS_MATCH_LOADED')) {
    return;
}
define('WP_SPORTS_MATCH_LOADED', true);

const SPM_DEFAULT_STOP = ['fc', 'cf', 'sc', 'ac', 'cd', 'ca', 'club', 'de', 'del', 'la', 'el', 'los', 'las', 'the', 'and', 'vs', 'v',
    'city', 'united', 'real', 'sporting', 'atletico', 'deportivo', 'union', 'women', 'femenil', 'w', 'u20', 'u21', 'u23', 'sub'];
const SPM_DEFAULT_EVENT_CAT = 'event|ppv|pay per view|deportes? en vivo|live sport|partidos? (de )?hoy';

/** minúsculas y sin acentos (sin tocar los signos), como Platforms.fold */
function spm_fold($s)
{
    $s = mb_strtolower((string)$s, 'UTF-8');
    if (class_exists('Normalizer')) {
        $d = Normalizer::normalize($s, Normalizer::FORM_D);
        if (is_string($d)) return preg_replace('/\p{M}+/u', '', $d);
    }
    return strtr($s, ['á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n', 'à' => 'a', 'è' => 'e', 'ì' => 'i',
        'ò' => 'o', 'ù' => 'u', 'ç' => 'c', 'â' => 'a', 'ê' => 'e', 'î' => 'i', 'ô' => 'o', 'û' => 'u', 'ã' => 'a', 'õ' => 'o', 'ä' => 'a', 'ë' => 'e',
        'ï' => 'i', 'ö' => 'o']);
}

/** minúsculas, sin acentos, todo lo que no sea [a-z0-9] -> espacio */
function spm_norm($s)
{
    return trim(preg_replace('/[^a-z0-9]+/', ' ', spm_fold($s)));
}

/** reglas «match» del panel (api/sports.php); sin ellas, las de siempre */
function spm_rules(array $panel)
{
    $m = is_array($panel['match'] ?? null) ? $panel['match'] : [];
    $stop = [];
    foreach ((array)($m['stop'] ?? []) as $w) if (is_string($w) && $w !== '') $stop[$w] = 1;
    if (!$stop) $stop = array_fill_keys(SPM_DEFAULT_STOP, 1);
    $alias = [];
    foreach ((is_array($m['alias'] ?? null) ? $m['alias'] : []) as $k => $v) $alias[spm_norm($k)] = spm_norm((string)$v);
    $ev = is_string($m['eventCategory'] ?? null) && $m['eventCategory'] !== '' ? $m['eventCategory'] : SPM_DEFAULT_EVENT_CAT;
    $re = '~' . str_replace('~', '\~', $ev) . '~iu';
    if (@preg_match($re, '') === false) $re = '~' . SPM_DEFAULT_EVENT_CAT . '~iu';
    $sc = is_array($m['scoring'] ?? null) ? $m['scoring'] : [];
    $w = function ($k, $d) use ($sc) { return isset($sc[$k]) && is_numeric($sc[$k]) ? (int)$sc[$k] : $d; };
    return ['stop' => $stop, 'alias' => $alias, 'evcat' => $re, 'fullName' => $w('fullName', 2), 'token' => $w('token', 1),
        'teamWeight' => $w('teamWeight', 10), 'bothTeamsBonus' => $w('bothTeamsBonus', 15), 'leagueBonus' => $w('leagueBonus', 3),
        'eventCategoryBonus' => $w('eventCategoryBonus', 6), 'singleTokenWeight' => $w('singleTokenWeight', 8)];
}

/** palabras que identifican el canal; un número va pegado a la palabra anterior ("espn 2" -> "espn2"); "m" = movistar */
function spm_channel_key($name, $isNorm = false)
{
    static $noise = null;
    if ($noise === null) $noise = array_flip(['hd', 'fhd', 'uhd', 'sd', '4k', '8k', 'hq', 'hevc', 'h264', 'h265', '1080', '1080p', '720', '720p', '50fps', '60fps', 'fps',
        'backup', 'bk', 'alt', 'vip', 'op1', 'op2', 'tv', 'channel', 'canal',
        'mx', 'mex', 'mexico', 'us', 'usa', 'eeuu', 'ar', 'arg', 'argentina', 'co', 'col', 'colombia', 'cl', 'chile', 'pe', 'peru', 'ec', 'ecuador',
        've', 'venezuela', 'uy', 'uruguay', 'py', 'paraguay', 'bo', 'bolivia', 'cr', 'pa', 'panama', 'gt', 'hn', 'sv', 'ni', 'do', 'pr',
        'latam', 'latin', 'latino', 'latina', 'lat', 'america', 'es', 'esp', 'spain', 'espana', 'uk', 'gb', 'int', 'intl', 'international',
        'br', 'bra', 'brasil', 'brazil', 'pt', 'portugal', 'ca', 'can', 'canada', 'fr', 'france', 'it', 'italy', 'de', 'germany',
        'nl', 'netherlands', 'au', 'australia', 'nz', 'zealand', 'new', 'ie', 'ireland', 'en', 'network', 'net',
        'hdr', 'fd', '2160', '2160p', '1080i', 'fullhd', 'east', 'west', 'eastern', 'western', 'eng', 'english', 'raw', 'dual']);
    // números en palabra («ESPN Two», «Canal Dos»): como cifra, así se pegan igual que «ESPN 2»
    static $num = ['one' => '1', 'two' => '2', 'three' => '3', 'four' => '4', 'five' => '5', 'six' => '6', 'seven' => '7', 'eight' => '8',
        'nine' => '9', 'ten' => '10', 'eleven' => '11', 'twelve' => '12', 'uno' => '1', 'dos' => '2', 'tres' => '3', 'cuatro' => '4',
        'cinco' => '5', 'seis' => '6', 'siete' => '7', 'ocho' => '8', 'nueve' => '9', 'diez' => '10'];
    $out = [];
    // «ESPN+», «Star+», «M+»: el + es «plus» (spm_norm lo borraba y «ESPN+» daba el canal «ESPN»)
    foreach (explode(' ', $isNorm ? $name : spm_norm(str_replace('+', ' plus ', $name))) as $t) {
        // "M+ LaLiga" (Movistar Plus) llega como "m laliga"
        if ($t === 'm') $t = 'movistar';
        if (isset($num[$t])) $t = $num[$t];
        if ($t === '' || isset($noise[$t])) continue;
        $last = count($out) - 1;
        if (ctype_digit($t) && $last >= 0 && !ctype_digit($out[$last])) $out[$last] .= $t;
        else $out[] = $t;
    }
    return $out;
}

/**
 * Canales en vivo del cliente con su carpeta, indexados por palabras. $hiddenCats: carpetas que no ve (no cuentan).
 * ['chans' => [[id, cat, name, norm, isEvent, key, epg]], 'words' => palabra => [i], 'keys' => nombre pegado => [i],
 *  'cats' => id => nombre, 'memo' => []]
 */
function spm_index(array $rules, array $hiddenCats = [])
{
    $cats = wp_category_names('live');
    $evCats = [];
    foreach ($cats as $cid => $cn) if (preg_match($rules['evcat'], spm_fold($cn))) $evCats[(string)$cid] = 1;
    $ix = ['chans' => [], 'words' => [], 'keys' => [], 'cats' => $cats, 'memo' => []];
    foreach ((array)xt_get('get_live_streams', [], 1800, 30) as $st) {
        if (!is_array($st) || empty($st['stream_id'])) continue;
        $cat = (string)($st['category_id'] ?? '');
        if (isset($hiddenCats[$cat])) continue;
        $name = (string)($st['name'] ?? '');
        $norm = spm_norm($name);
        $key = strpos($name, '+') !== false ? spm_channel_key($name) : spm_channel_key($norm, true);
        $i = count($ix['chans']);
        $ix['chans'][] = ['id' => (string)$st['stream_id'], 'cat' => $cat, 'name' => $name, 'norm' => $norm, 'ev' => isset($evCats[$cat]), 'key' => $key,
            'epg' => (string)($st['epg_channel_id'] ?? '')];
        $seen = [];
        foreach (explode(' ', $norm) as $w) if (strlen($w) >= 3 && !isset($seen[$w])) { $seen[$w] = 1; $ix['words'][$w][] = $i; }
        foreach ($key as $w) if (strlen($w) >= 2 && !ctype_digit($w) && !isset($seen[$w])) { $seen[$w] = 1; $ix['words'][$w][] = $i; }
        if ($key) $ix['keys'][implode('', $key)][] = $i;
    }
    return $ix;
}

/** canales del cliente que son el canal que transmite (índices), el mejor primero */
function spm_find_by_channel($tvName, array &$ix)
{
    if (isset($ix['memo'][$tvName])) return $ix['memo'][$tvName];
    $q = spm_channel_key($tvName);
    $qc = implode('', $q);
    if (!$q || strlen($qc) < 2) return $ix['memo'][$tvName] = [];
    $cand = [];
    foreach ($ix['keys'][$qc] ?? [] as $i) $cand[$i] = 1;
    foreach ($ix['words'][$q[0]] ?? [] as $i) $cand[$i] = 1;
    ksort($cand);
    $scored = [];
    foreach (array_keys($cand) as $i) {
        $k = $ix['chans'][$i]['key'];
        if (!$k) continue;
        if ($k === $q) $s = 1000 - count($k);
        elseif (implode('', $k) === $qc) $s = 900 - count($k);
        elseif (!array_diff($q, $k)) $s = 500 - 10 * (count($k) - count($q));
        else continue;
        $scored[] = [$s, strlen($ix['chans'][$i]['name']), $i];
    }
    if (!$scored) {
        $loose = spm_find_loose($q, $ix);
        if (!$loose) $loose = spm_find_fuzzy($q, $ix);
        // un nombre solo es su primer canal ("ESPN" = "ESPN 1", "DAZN" = "DAZN 1")
        if (!$loose && !ctype_digit(substr($qc, -1)) && substr($tvName, -2) !== ' 1') $loose = spm_find_by_channel($tvName . ' 1', $ix);
        // «Movistar+ LaLiga» en una lista que lo llama «Movistar LaLiga»: sin el plus
        if (!$loose && strpos($tvName, '+') !== false) $loose = spm_find_by_channel(str_replace('+', ' ', $tvName), $ix);
        return $ix['memo'][$tvName] = $loose;
    }
    usort($scored, function ($a, $b) { return $b[0] <=> $a[0] ?: $a[1] <=> $b[1] ?: $a[2] <=> $b[2]; });
    return $ix['memo'][$tvName] = array_column($scored, 2);
}

/** último intento: las palabras del canal pegadas contienen cada palabra buscada sin que la siga un número
 *  ("Fox Sports" da "FOXSPORTS PREMIUM", nunca "FoxSports2") */
function spm_find_loose(array $q, array &$ix)
{
    $first = $q[0];
    if (strlen($first) < 3) return [];
    $want = strlen(implode('', $q));
    $cand = [];
    for ($len = strlen($first); $len >= 2; $len--) foreach ($ix['words'][substr($first, 0, $len)] ?? [] as $i) $cand[$i] = 1;
    ksort($cand);
    $scored = [];
    foreach (array_keys($cand) as $i) {
        $c = $ix['chans'][$i];
        $compact = implode('', $c['key']);
        if ($compact === '') continue;
        $ok = true;
        foreach ($q as $t) {
            $p = strpos($compact, $t);
            $nx = $p === false ? '' : substr($compact, $p + strlen($t), 1);
            if ($p === false || ($nx !== '' && ctype_digit($nx))) { $ok = false; break; }
        }
        if ($ok) $scored[] = [300 - (strlen($compact) - $want) - strlen($c['name']), $i];
    }
    usort($scored, function ($a, $b) { return $b[0] <=> $a[0] ?: $a[1] <=> $b[1]; });
    return array_column($scored, 1);
}

/**
 * Último recurso, como los emparejadores de canales de IPTV (Stream-Mapparr): parecido de Levenshtein entre las palabras
 * ordenadas («TyC Sport» = «TyC Sports»). Solo canales que comparten la mitad de las palabras, con los mismos números
 * («ESPN 2» nunca «ESPN 3» ni «ESPN») y más estricto con los nombres cortos (≤ 4 letras 95 %, ≤ 8 90 %, si no 86 %).
 */
function spm_find_fuzzy(array $q, array &$ix)
{
    $qLen = strlen(implode('', $q));
    if ($qLen < 3) return [];
    $sq = $q;
    sort($sq);
    $qs = implode(' ', $sq);
    $qDig = spm_key_digits($q);
    $need = (int)ceil(count($q) / 2);
    $thr = $qLen <= 4 ? 0.95 : ($qLen <= 8 ? 0.9 : 0.86);
    $hits = [];
    foreach ($q as $t) {
        $l = $ix['words'][$t] ?? (strlen($t) >= 4 ? ($ix['words'][substr($t, 0, -1)] ?? []) : []);
        foreach ($l as $i) $hits[$i] = ($hits[$i] ?? 0) + 1;
    }
    $scored = [];
    $tried = 0;
    foreach ($hits as $i => $n) {
        if ($n < $need && count($q) > 1) continue;
        $k = $ix['chans'][$i]['key'];
        if (spm_key_digits($k) !== $qDig) continue;
        sort($k);
        $r = spm_similarity($qs, implode(' ', $k));
        if ($r >= $thr) $scored[] = [$r, strlen($ix['chans'][$i]['name']), $i];
        if (++$tried >= 200) break;
    }
    usort($scored, function ($a, $b) { return $b[0] <=> $a[0] ?: $a[1] <=> $b[1]; });
    return array_column($scored, 2);
}

/** los números del nombre, en orden («espn2» -> "2", «fox sports 1 hd» -> "1") */
function spm_key_digits(array $words)
{
    return trim(preg_replace('/[^0-9]+/', ' ', implode(' ', $words)));
}

/** 1 - distancia de Levenshtein / largo mayor (el ratio normalizado de rapidfuzz) */
function spm_similarity($a, $b)
{
    if ($a === '' || $b === '') return 0.0;
    if ($a === $b) return 1.0;
    $mx = max(strlen($a), strlen($b));
    if (abs(strlen($a) - strlen($b)) > $mx * 0.15) return 0.0;
    return 1.0 - levenshtein($a, $b) / $mx;
}

function spm_has_word($chan, $w)
{
    return $w !== '' && strpos(' ' . $chan . ' ', ' ' . $w . ' ') !== false;
}

function spm_tokens($s, array $r)
{
    $out = [];
    foreach (explode(' ', spm_norm($s)) as $t) if (strlen($t) >= 3 && !isset($r['stop'][$t])) $out[] = $t;
    return $out;
}

/** un equipo ya normalizado (con su alias) y sus palabras distintivas */
function spm_team($name, array $r)
{
    if (trim((string)$name) === '') return null;
    $n = spm_norm($name);
    $names = isset($r['alias'][$n]) ? [$n, $r['alias'][$n]] : [$n];
    $toks = [];
    foreach ($names as $a) $toks[] = array_values(array_filter(spm_tokens($a, $r), function ($t) { return strlen($t) >= 4; }));
    return ['names' => $names, 'toks' => $toks];
}

function spm_team_score($chan, $t, array $r)
{
    if ($t === null) return 0;
    $best = 0;
    foreach ($t['names'] as $i => $n) {
        if (strlen($n) >= 3 && spm_has_word($chan, $n)) return $r['fullName'];
        foreach ($t['toks'][$i] as $w) if (spm_has_word($chan, $w)) { $best = $r['token']; break; }
    }
    return $best;
}

/** el canal del partido por sus equipos (o el nombre del evento); índice o -1 */
function spm_find(array $ev, array &$ix, array $r)
{
    $h = trim((string)($ev['h'] ?? ''));
    $a = trim((string)($ev['a'] ?? ''));
    $leagueToks = spm_tokens((string)($ev['lg'] ?? ''), $r);
    $single = $h === '' && $a === '' ? spm_tokens((string)($ev['ev'] ?? ''), $r) : [];
    $ht = spm_team($h, $r);
    $at = spm_team($a, $r);
    $want = [];
    foreach ([$ht, $at] as $t) {
        if ($t === null) continue;
        foreach ($t['names'] as $n) {
            $tk = spm_tokens($n, $r);
            if ($tk) foreach ($tk as $w) $want[$w] = 1;
            else foreach (explode(' ', $n) as $w) if (strlen($w) >= 3) $want[$w] = 1;
        }
    }
    foreach ($single as $w) $want[$w] = 1;
    $cand = [];
    foreach (array_keys($want) as $w) foreach ($ix['words'][$w] ?? [] as $i) $cand[$i] = 1;
    ksort($cand);
    $best = -1;
    $bestScore = PHP_INT_MIN;
    foreach (array_keys($cand) as $i) {
        $c = $ix['chans'][$i];
        $chan = $c['norm'];
        if ($h !== '' || $a !== '') {
            $hs = spm_team_score($chan, $ht, $r);
            $as = spm_team_score($chan, $at, $r);
            if (!$hs && !$as) continue;
            $both = $hs > 0 && $as > 0;
            // fuera de las carpetas de eventos solo cuenta si aparecen los dos equipos
            if (!$c['ev'] && !$both) continue;
            // "Real Madrid vs Barcelona" no sirve para "Real Madrid vs Getafe"
            if (!$both && preg_match('/ (vs|v|x) /', ' ' . $chan . ' ')) continue;
            $score = $hs * $r['teamWeight'] + $as * $r['teamWeight'] + ($both ? $r['bothTeamsBonus'] : 0);
        } else {
            $hit = 0;
            foreach ($single as $t) if (strlen($t) >= 3 && spm_has_word($chan, $t)) $hit++;
            if (!$hit || (!$c['ev'] && $hit < 2)) continue;
            $score = $hit * $r['singleTokenWeight'];
        }
        foreach ($leagueToks as $t) if (spm_has_word($chan, $t)) { $score += $r['leagueBonus']; break; }
        if ($c['ev']) $score += $r['eventCategoryBonus'];
        if ($best < 0 || $score > $bestScore) { $best = $i; $bestScore = $score; }
    }
    return $best;
}

/** canales de un partido: cada canal que lo transmite (el del cliente o -1) y el de los equipos (o -1) */
function spm_match(array $ev, array &$ix, array $r)
{
    $tv = [];
    foreach ((array)($ev['tv'] ?? []) as $t) {
        $l = spm_find_by_channel((string)$t, $ix);
        $tv[] = $l ? $l[0] : -1;
    }
    return ['t' => $tv, 'tm' => spm_find($ev, $ix, $r)];
}

/**
 * Canal de cada partido en la lista de esta línea (agenda de Deportes y fila «En vivo ahora» de Inicio):
 *   $evs: [{k, h, a, lg, ev, tv: [nombres]}]; $epg: también la guía del panel (api/sports_epg.php)
 *   -> ['m' => {k: {t: [id o ''], tm: id}}, 'g' => {id del partido: [ids]}, 'ch' => {id: [nombre, carpeta]}, 'ev' => [id, carpeta, nombre]]
 * Se guarda 10 min por línea y partidos (la guía del panel, 10 min por línea). $index devuelve spm_index() (una vez).
 */
function spm_resolve(array $evs, $epg, array $rules, callable $index)
{
    $line = xt_cache_key('get_live_streams', []);
    $chOut = function (array $ix, array $list) {
        $ch = [];
        foreach ($list as $i) if ($i >= 0 && isset($ix['chans'][$i])) $ch[$ix['chans'][$i]['id']] = [$ix['chans'][$i]['name'], $ix['chans'][$i]['cat']];
        return $ch;
    };
    $ck = 'spmatch|' . $line . '|' . md5(json_encode([$evs, $rules['alias'], array_keys($rules['stop']), $rules['evcat']]));
    $res = wp_cache_get($ck, 600);
    if (!is_array($res)) {
        $ixs = $index();
        $m = [];
        $used = [];
        foreach ($evs as $e) {
            $r = spm_match($e, $ixs, $rules);
            $m[$e['k']] = ['t' => array_map(function ($i) use ($ixs) { return $i >= 0 ? $ixs['chans'][$i]['id'] : ''; }, $r['t']), 'tm' => $r['tm'] >= 0 ? $ixs['chans'][$r['tm']]['id'] : ''];
            foreach ($r['t'] as $i) if ($i >= 0) $used[] = $i;
            if ($r['tm'] >= 0) $used[] = $r['tm'];
        }
        // sin canal exacto: la primera carpeta de eventos
        $evf = null;
        foreach ($ixs['chans'] as $i => $c) if ($c['ev']) { $evf = [$c['id'], $c['cat'], (string)($ixs['cats'][$c['cat']] ?? '')]; $used[] = $i; break; }
        $res = ['m' => $m, 'ch' => $chOut($ixs, $used), 'ev' => $evf];
        wp_cache_set($ck, $res);
    }
    // además, la guía del panel: el canal que tiene el partido en su programación a esa hora (api/sports_epg.php)
    $g = [];
    if ($epg) {
        $gk = 'spepg|' . wp_panel_ck($line);
        $gr = wp_cache_get($gk, 600);
        if (!is_array($gr)) {
            $ixs = $index();
            $chans = [];
            $byId = [];
            foreach (spm_epg_channels($ixs) as $i) {
                $c = $ixs['chans'][$i];
                $chans[] = ['id' => $c['id'], 'epg' => $c['epg'], 'name' => $c['name']];
                $byId[$c['id']] = [$c['name'], $c['cat']];
            }
            $j = $chans ? wp_panel_call('sports_epg.php', ['channels' => $chans], 25) : null;
            $map = [];
            $gch = [];
            foreach ((is_array($j['map'] ?? null) ? $j['map'] : []) as $eid => $ids) {
                $ok = [];
                foreach ((array)$ids as $id) if (isset($byId[(string)$id])) { $ok[] = (string)$id; $gch[(string)$id] = $byId[(string)$id]; }
                if ($ok) $map[(string)$eid] = $ok;
            }
            $gr = ['map' => $map, 'ch' => $gch];
            if (is_array($j)) wp_cache_set($gk, $gr);
        }
        $g = $gr['map'];
        $res['ch'] = $res['ch'] + $gr['ch'];
    }
    $res['g'] = $g;
    return $res;
}

/** canales deportivos para buscar el partido en la guía del panel (api/sports_epg.php): por el nombre del canal o de su
 *  carpeta, sin las carpetas de eventos; primero los que tienen guía propia (hasta 600, como Android TV y Vega) */
function spm_epg_channels(array $ix, $max = 600)
{
    $re = '/sport|deport|espn|fox|tnt|tudn|dazn|bein|sky|movistar|futbol|soccer|nba|nfl|mlb|nhl|ufc|liga|win |directv|dsports|claro|vix|paramount|peacock|tyc|gol|telemundo|univision|azteca|canal 5|caracol|rcn|tsn|eurosport|teledeporte|cbs|nbc|usa network|f1|golf|tenis|tennis|box|universo|sportsnet|telefe|tv publica|teletica|tigo|max|apple tv/i';
    $sportCat = [];
    foreach ($ix['cats'] as $cid => $cn) if (preg_match($re, spm_fold($cn))) $sportCat[(string)$cid] = 1;
    $with = [];
    $without = [];
    foreach ($ix['chans'] as $i => $c) {
        if ($c['ev']) continue;
        if (!isset($sportCat[$c['cat']]) && !preg_match($re, $c['norm'])) continue;
        if (trim($c['epg']) !== '') $with[] = $i; else $without[] = $i;
        if (count($with) >= $max) break;
    }
    return array_slice(array_merge($with, $without), 0, $max);
}

/**
 * Canales de la lista del cliente por nombre (canal, equipo o evento), sin acentos: primero los que tienen todas las
 * palabras; si ninguno, los que tienen alguna palabra importante (4 letras o más). Dentro de cada grupo, las carpetas
 * de deportes / eventos primero. Hasta 12 (como Android TV, Roku y Vega).
 */
function spm_search($q, array $ix)
{
    $noise = array_flip(['club', 'united', 'city', 'real', 'deportivo', 'atletico', 'sporting', 'vs']);
    $words = array_values(array_filter(explode(' ', spm_norm($q)), function ($w) { return strlen($w) >= 2; }));
    if (!$words) return [];
    $sportCat = [];
    foreach ($ix['cats'] as $cid => $cn) if (preg_match('/sport|deport|event|ppv|futbol/', spm_fold($cn))) $sportCat[(string)$cid] = 1;
    $groups = [[], [], [], []];
    foreach ($ix['chans'] as $i => $c) {
        $all = true;
        $some = false;
        foreach ($words as $w) {
            if (strpos($c['norm'], $w) !== false) { if (strlen($w) >= 4 && !isset($noise[$w])) $some = true; }
            else $all = false;
        }
        if (!$all && !$some) continue;
        $sp = isset($sportCat[$c['cat']]);
        $g = $all ? ($sp ? 0 : 1) : ($sp ? 2 : 3);
        if (count($groups[$g]) < 12) $groups[$g][] = $i;
    }
    $last = count($groups[0]) + count($groups[1]) > 0 ? 1 : 3;
    return array_slice(array_merge(...array_slice($groups, 0, $last + 1)), 0, 12);
}
