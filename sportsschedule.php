<?php
include "session.php";
include "config.php";
// el distribuidor puede tener la sección de deportes apagada
if (!wp_tenant_feature('sports')) {
    header('Location: homex');
    exit;
}

/* ---- "TV en vivo": busca el canal que transmite el partido ---- */
function sp_tokens($s)
{
    $s = preg_replace('/[^a-z0-9]+/', ' ', wp_norm($s));
    $stop = ['fc', 'cf', 'sc', 'ac', 'cd', 'ca', 'club', 'de', 'del', 'la', 'el', 'los', 'las', 'the', 'and', 'vs', 'v', 'city', 'united', 'real', 'sporting', 'atletico', 'deportivo', 'union', 'women', 'femenil', 'w', 'u20', 'u21', 'u23', 'sub'];
    $out = [];
    foreach (explode(' ', trim($s)) as $t) if (strlen($t) >= 3 && !in_array($t, $stop, true)) $out[] = $t;
    return $out;
}

/** nombres en inglés de TheSportsDB → como suelen escribirse en los canales en español */
function sp_alias($name)
{
    static $map = ['spain' => 'espana', 'germany' => 'alemania', 'england' => 'inglaterra', 'france' => 'francia', 'brazil' => 'brasil', 'italy' => 'italia',
        'netherlands' => 'holanda', 'united states' => 'estados unidos', 'usa' => 'estados unidos', 'mexico' => 'mexico', 'argentina' => 'argentina', 'portugal' => 'portugal',
        'colombia' => 'colombia', 'belgium' => 'belgica', 'switzerland' => 'suiza', 'croatia' => 'croacia', 'japan' => 'japon', 'south korea' => 'corea', 'peru' => 'peru',
        'bayern munich' => 'bayern', 'inter milan' => 'inter', 'atletico madrid' => 'atletico madrid', 'paris sg' => 'psg', 'paris saint germain' => 'psg',
        'manchester united' => 'man united', 'manchester city' => 'man city', 'tottenham hotspur' => 'tottenham', 'wolverhampton wanderers' => 'wolves',
        'america' => 'america', 'club america' => 'america', 'guadalajara' => 'chivas', 'unam' => 'pumas', 'uanl' => 'tigres'];
    $n = trim(preg_replace('/[^a-z0-9]+/', ' ', wp_norm($name)));
    return isset($map[$n]) ? [$n, $map[$n]] : [$n];
}

/** 0 = no aparece, 1 = coincide una palabra distintiva, 2 = nombre completo */
function sp_team_score($chan, $team)
{
    if (trim($team) === '') return 0;
    $best = 0;
    foreach (sp_alias($team) as $n) {
        if ($n !== '' && strlen($n) >= 3 && preg_match('/(^| )' . preg_quote($n, '/') . '( |$)/', $chan)) return 2;
        foreach (sp_tokens($n) as $t) if (strlen($t) >= 4 && preg_match('/(^| )' . preg_quote($t, '/') . '( |$)/', $chan)) $best = 1;
    }
    return $best;
}

/** canales de la lista en vivo (cacheada 30 min) con sus carpetas de eventos */
function sp_live_index()
{
    static $ix = null;
    if ($ix !== null) return $ix;
    $eventCats = [];
    foreach (wp_category_names('live') as $cid => $cn) if (preg_match('/event|ppv|pay per view|deportes? en vivo|live sport|partidos? (de )?hoy/i', wp_norm($cn))) $eventCats[$cid] = $cn;
    $chans = [];
    $keys = [];   // nombre compacto ("espn2") => canales
    $words = [];  // palabra del nombre sin calidad/país => canales
    foreach ((array)xt_get('get_live_streams', [], 1800, 30) as $st) {
        if (!is_array($st) || empty($st['stream_id'])) continue;
        $name = (string)($st['name'] ?? '');
        $norm = trim(preg_replace('/[^a-z0-9]+/', ' ', wp_norm($name)));
        $key = sp_channel_key($norm, true);
        $i = count($chans);
        $chans[] = ['id' => (string)$st['stream_id'], 'cat' => (string)($st['category_id'] ?? ''), 'name' => $name, 'norm' => $norm, 'key' => $key];
        if ($key) {
            $keys[implode('', $key)][] = $i;
            foreach (array_unique($key) as $w) $words[$w][] = $i;
        }
    }
    return $ix = ['chans' => $chans, 'eventCats' => $eventCats, 'keys' => $keys, 'words' => $words];
}

function sp_chan_url($c)
{
    return 'tvguide.php?id=' . rawurlencode($c['id']) . '&slug=live&category_id=' . rawurlencode($c['cat']);
}

/** nombre de un canal sin calidad ni país, con el número pegado ("MX: ESPN 2 HD" → ["espn2"]); igual que las apps */
function sp_channel_key($name, $isNorm = false)
{
    static $noise = null;
    if ($noise === null) $noise = array_flip(['hd', 'fhd', 'uhd', 'sd', '4k', '8k', 'hq', 'hevc', 'h264', 'h265', '1080', '1080p', '720', '720p', '50fps', '60fps', 'fps', 'backup', 'bk', 'alt', 'vip', 'op1', 'op2', 'tv', 'channel', 'canal',
        'mx', 'mex', 'mexico', 'us', 'usa', 'eeuu', 'ar', 'arg', 'argentina', 'co', 'col', 'colombia', 'cl', 'chile', 'pe', 'peru', 'ec', 'ecuador', 've', 'venezuela', 'uy', 'uruguay', 'py', 'paraguay', 'bo', 'bolivia',
        'cr', 'pa', 'panama', 'gt', 'hn', 'sv', 'ni', 'do', 'pr', 'latam', 'latin', 'latino', 'latina', 'lat', 'america', 'es', 'esp', 'spain', 'espana', 'uk', 'gb', 'int', 'intl', 'international',
        'br', 'bra', 'brasil', 'brazil', 'pt', 'portugal', 'ca', 'can', 'canada', 'fr', 'france', 'it', 'italy', 'de', 'germany', 'nl', 'netherlands', 'au', 'australia', 'nz', 'zealand', 'new', 'ie', 'ireland']);
    $n = $isNorm ? $name : trim(preg_replace('/[^a-z0-9]+/', ' ', wp_norm($name)));
    $out = [];
    foreach (explode(' ', $n) as $t) {
        if ($t === '' || isset($noise[$t])) continue;
        $last = count($out) - 1;
        if (ctype_digit($t) && $last >= 0 && !ctype_digit($out[$last])) $out[$last] .= $t;
        else $out[] = $t;
    }
    return $out;
}

/** canal del cliente que corresponde al canal que transmite: primero el mismo nombre, luego el que contiene todas sus palabras ("ESPN 2" nunca da "ESPN 3") */
function sp_find_by_tv($tv)
{
    $q = sp_channel_key($tv);
    $compact = implode('', $q);
    if (!$q || strlen($compact) < 2) return null;
    $ix = sp_live_index();
    $exact = isset($ix['keys'][$compact]);
    $best = null;
    $bestScore = PHP_INT_MIN;
    foreach ($exact ? $ix['keys'][$compact] : ($ix['words'][$q[0]] ?? []) as $i) {
        $c = $ix['chans'][$i];
        $k = $c['key'];
        if ($exact) {
            $score = 1000 - count($k) * 10 - strlen($c['name']) + ($k === $q ? 100 : 0);
        } elseif (!array_diff($q, $k)) {
            $score = 500 - 10 * (count($k) - count($q)) - strlen($c['name']);
        } else {
            continue;
        }
        if ($score > $bestScore) { $bestScore = $score; $best = $c; }
    }
    return $best;
}

/** mejor canal por equipos (o por el nombre del evento si no hay equipos) */
function sp_find_by_teams($h, $a, $lg, $ev)
{
    $ix = sp_live_index();
    $leagueToks = sp_tokens($lg);
    $single = sp_tokens($h === '' && $a === '' ? $ev : '');
    $best = null;
    foreach ($ix['chans'] as $c) {
        $isEv = isset($ix['eventCats'][$c['cat']]);
        $chan = $c['norm'];
        if ($h !== '' || $a !== '') {
            $hs = sp_team_score($chan, $h);
            $as = sp_team_score($chan, $a);
            if (!$hs && !$as) continue;
            // fuera de las carpetas de eventos solo cuenta si aparecen los dos equipos (evita "Real Madrid TV")
            if (!$isEv && !($hs && $as)) continue;
            // "Real Madrid vs Barcelona" no sirve para "Real Madrid vs Getafe"
            if (!($hs && $as) && preg_match('/ (vs|v|x) /', ' ' . $chan . ' ')) continue;
            $score = $hs * 10 + $as * 10 + ($hs && $as ? 15 : 0);
        } else {
            $hit = 0;
            foreach ($single as $t) if (strlen($t) >= 3 && preg_match('/(^| )' . preg_quote($t, '/') . '( |$)/', $chan)) $hit++;
            if (!$hit || (!$isEv && $hit < 2)) continue;
            $score = $hit * 8;
        }
        foreach ($leagueToks as $t) if (preg_match('/(^| )' . preg_quote($t, '/') . '( |$)/', $chan)) { $score += 3; break; }
        if ($isEv) $score += 6;
        if (!$best || $score > $best['score']) $best = $c + ['score' => $score];
    }
    return $best;
}

/**
 * mode=tv: el canal elegido del menú; si el cliente no lo tiene, se busca el partido (aviso "fallback").
 * mode=auto: los canales que transmiten (en orden), luego los equipos y al final la carpeta de eventos.
 * mode=teams: solo equipos / nombre del evento.
 */
function sp_find_channel($h, $a, $lg, $ev, $mode = 'teams', $tvs = [])
{
    if ($mode === 'tv' || $mode === 'auto') {
        foreach ($tvs as $tv) {
            $c = sp_find_by_tv($tv);
            if ($c) return ['ok' => true, 'url' => sp_chan_url($c), 'name' => $c['name'], 'by' => 'tv'];
        }
    }
    $best = sp_find_by_teams($h, $a, $lg, $ev);
    $miss = $mode === 'tv' && $tvs ? $tvs[0] : '';
    if ($best) return ['ok' => true, 'url' => sp_chan_url($best), 'name' => $best['name'], 'by' => 'teams', 'missing' => $miss];
    $eventCats = sp_live_index()['eventCats'];
    if ($eventCats) {
        $cid = (string)array_key_first_compat($eventCats);
        return ['ok' => true, 'partial' => true, 'url' => 'tvguide.php?category_id=' . rawurlencode($cid), 'name' => $eventCats[$cid], 'missing' => $miss];
    }
    return ['ok' => false, 'missing' => $miss];
}

function array_key_first_compat(array $a)
{
    foreach ($a as $k => $_) return $k;
    return null;
}

if (($_GET['ajax'] ?? '') === 'channel') {
    wp_session_read_close();
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: private, max-age=300');
    $g = function ($k) { return mb_substr(trim((string)($_GET[$k] ?? '')), 0, 120, 'UTF-8'); };
    $mode = in_array($_GET['mode'] ?? '', ['auto', 'tv', 'teams'], true) ? $_GET['mode'] : 'teams';
    // canales que transmiten, separados por "|" (como mucho 24, igual que el panel)
    $tvs = [];
    foreach (array_slice(explode('|', mb_substr((string)($_GET['tv'] ?? ''), 0, 1500, 'UTF-8')), 0, 24) as $t) {
        $t = trim($t);
        if ($t !== '') $tvs[] = mb_substr($t, 0, 80, 'UTF-8');
    }
    echo json_encode(sp_find_channel($g('h'), $g('a'), $g('lg'), $g('ev'), $mode, $tvs), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/* Respaldo: extrae tablas limpias de la web de TheSportsDB */
function fetchAndProcessContent($target_url) {
    $content = wp_http_get($target_url, 12);
    if (!$content) return null;
    
    $dom = new DOMDocument();
    libxml_use_internal_errors(true);
    @$dom->loadHTML('<?xml encoding="UTF-8">' . $content);
    libxml_use_internal_errors(false);
    
    $xpath = new DOMXPath($dom);
    
    // 1. LIMPIEZA NUCLEAR: Quitamos atributos que rompen el móvil desde el origen
    $allElements = $xpath->query('//table|//tr|//td|//th|//span|//div');
    foreach ($allElements as $el) {
        $el->removeAttribute('style'); // Borra estilos en línea de la página original
        $el->removeAttribute('width'); // Borra anchos fijos
        $el->removeAttribute('height'); // Borra altos fijos
        $el->removeAttribute('nowrap'); // Borra el bloqueo de salto de línea
    }

    // 2. Procesar imágenes
    $images = $xpath->query('//img');
    foreach ($images as $img) {
        $src = $img->getAttribute('src');
        if (!empty($src) && !preg_match('/^https?:\/\//i', $src)) {
            $src = 'https://www.thesportsdb.com/' . ltrim($src, './');
            $img->setAttribute('src', $src);
        }
        
        $w = $img->getAttribute('width');
        // Mantener iconos y logos pequeños
        if (($w && $w <= 30) || preg_match('/(icon|flag|time|calendar|\.ico)/i', $src)) {
            $img->setAttribute('class', 'img-icon');
        } else {
            $img->setAttribute('class', 'img-banner');
        }
        $img->removeAttribute('width');
        $img->removeAttribute('height');
        $img->removeAttribute('style');
    }
    
    // Seguridad: sin scripts ni eventos
    foreach ($xpath->query('//script|//iframe|//style') as $bad) {
        $bad->parentNode->removeChild($bad);
    }
    foreach ($xpath->query('//@*[starts-with(name(), "on")]') as $attr) {
        $attr->ownerElement->removeAttribute($attr->nodeName);
    }
    // 3. Quitar enlaces
    $links = $xpath->query('//a');
    foreach ($links as $link) {
        $link->removeAttribute('href');
        $link->setAttribute('style', 'color: inherit; text-decoration: none; cursor: default;');
    }
    
    return $dom;
}


/* ---------- Agenda deportiva: la entrega el panel (api/sports.php, caché 10 min) ---------- */
$sp_sports = [
    'Soccer' => ['Fútbol', '⚽', 120],
    'Basketball' => ['Baloncesto', '🏀', 150],
    'American Football' => ['Fútbol americano', '🏈', 210],
    'Baseball' => ['Béisbol', '⚾', 190],
    'Fighting' => ['Combate', '🥊', 240],
    'Motorsport' => ['Motor', '🏁', 150],
    'Tennis' => ['Tenis', '🎾', 150],
    'Ice Hockey' => ['Hockey', '🏒', 160],
];

$sp_panel = wp_panel_sports();
// Deportes que publica el panel (nombre, ícono y duración del partido en minutos)
foreach ((is_array($sp_panel['sports'] ?? null) ? $sp_panel['sports'] : []) as $k => $m) {
    if (is_array($m) && !empty($m['label'])) {
        $sp_sports[(string)$k] = [(string)$m['label'], (string)($m['icon'] ?? ''), (int)($m['minutes'] ?? 120) ?: 120];
    }
}
$events = [];
foreach ((is_array($sp_panel['events'] ?? null) ? $sp_panel['events'] : []) as $ev) {
    if (is_array($ev) && !empty($ev['id']) && !empty($ev['ts'])) $events[] = $ev;
}


/* Respaldo: tablas de la web de TheSportsDB si la API no devuelve partidos */
$sports = ['t1' => '', 't2' => ''];
if (!$events) {
    $sports = wp_cache_get('sports|tables', 1800, $sports_stale);
    if (!is_array($sports)) {
        $dom1 = fetchAndProcessContent("https://www.thesportsdb.com/browse_tv");
        $table1 = $dom1 ? (new DOMXPath($dom1))->query('//table')->item(0) : null;
        $dom2 = fetchAndProcessContent("https://www.thesportsdb.com/");
        $table2 = $dom2 ? (new DOMXPath($dom2))->query('//table')->item(4) : null;
        $sports = ['t1' => $table1 ? $dom1->saveXML($table1) : '', 't2' => $table2 ? $dom2->saveXML($table2) : ''];
        if ($sports['t1'] || $sports['t2']) wp_cache_set('sports|tables', $sports);
        elseif (is_array($sports_stale)) $sports = $sports_stale;
    }
}

$sp_meta = [];
foreach ($sp_sports as $k => $m) $sp_meta[$k] = ['n' => $m[0], 'i' => $m[1], 'd' => $m[2]];

$page_title = 'Deportes';
$nav_active = 'sports';
$body_class = 'nf-solid';
include "header.php";
?>
<style>
.sp { --sp-line: rgba(255,255,255,.08); --sp-card: #1c1c1c; --sp-card2: #232323; --sp-live: #e50914; --sp-win: #fff; --sp-mute: #9a9a9a;
      padding: calc(var(--nf-header) + 18px) var(--nf-pad) 48px; color: var(--nf-text); min-height: 70vh; }
.sp-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
.sp-head h1 { margin: 0; font-size: clamp(28px, 3.4vw, 44px); font-weight: 800; letter-spacing: -.5px; }
.sp-head p { margin: 4px 0 0; color: var(--sp-mute); font-size: 15px; }
.sp-livecount[hidden], .sp-livewrap[hidden] { display: none !important; }
.sp-livecount { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border-radius: 999px; background: rgba(229,9,20,.14); color: #fff; font-weight: 700; font-size: 14px; }
.sp-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--sp-live); box-shadow: 0 0 0 0 rgba(229,9,20,.7); animation: spPulse 1.6s infinite; flex: none; }
@keyframes spPulse { 70% { box-shadow: 0 0 0 9px rgba(229,9,20,0); } 100% { box-shadow: 0 0 0 0 rgba(229,9,20,0); } }

.sp-bar { position: sticky; top: var(--nf-header); z-index: 40; margin: 0 calc(var(--nf-pad) * -1) 18px; padding: 10px var(--nf-pad); background: rgba(20,20,20,.94); backdrop-filter: blur(8px); border-bottom: 1px solid var(--sp-line); display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; }
.sp-days { display: inline-flex; background: #2a2a2a; border-radius: 6px; padding: 3px; flex: none; }
.sp-days button { border: 0; background: transparent; color: #ccc; font: inherit; font-weight: 700; font-size: 14px; padding: 8px 16px; border-radius: 4px; cursor: pointer; }
.sp-days button.on { background: #fff; color: #000; }
.sp-chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; flex: 1 1 360px; min-width: 0; }
.sp-chips::-webkit-scrollbar { display: none; }
.sp-chips .nf-chip { white-space: nowrap; flex: none; font-size: 14px; }
.sp-chips .nf-chip b { font-weight: 400; opacity: .6; margin-left: 4px; }
.sp-search { flex: 0 1 260px; min-width: 0; }
.sp-search input { width: 100%; background: #000; border: 1px solid #555; color: #fff; padding: 9px 12px; border-radius: 4px; font: inherit; font-size: 14px; }
.sp-search input:focus { outline: none; border-color: #fff; }

.sp-livewrap { margin-bottom: 26px; }
.sp-h2 { display: flex; align-items: center; gap: 10px; font-size: clamp(18px, 1.6vw, 22px); font-weight: 700; margin: 0 0 12px; }
.sp-live-row { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(300px, 380px); gap: 12px; overflow-x: auto; padding-bottom: 6px; scroll-snap-type: x mandatory; scrollbar-width: thin; }
.sp-live-row .sp-card { scroll-snap-align: start; }

.sp-league { margin-bottom: 26px; }
.sp-lhead { display: flex; align-items: center; gap: 10px; margin: 0 0 10px; }
.sp-lhead img { width: 28px; height: 28px; object-fit: contain; }
.sp-lhead h3 { margin: 0; font-size: 17px; font-weight: 700; }
.sp-lhead span { color: var(--sp-mute); font-size: 13px; }
.sp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 330px), 1fr)); gap: 10px; }

.sp-card { position: relative; background: var(--sp-card); border: 1px solid var(--sp-line); border-radius: 8px; padding: 14px 16px; display: grid; gap: 10px; transition: transform .18s ease, background .18s ease, border-color .18s; overflow: hidden; }
.sp-card:hover { transform: translateY(-2px); background: var(--sp-card2); border-color: rgba(255,255,255,.16); }
.sp-card.live { border-color: rgba(229,9,20,.55); background: linear-gradient(180deg, rgba(229,9,20,.12), var(--sp-card) 60%); }
.sp-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; color: var(--sp-mute); }
.sp-top .lg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sp-pill { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 4px; font-size: 12px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; background: #333; color: #ddd; }
.sp-pill.live { background: var(--sp-live); color: #fff; }
.sp-pill.live .sp-dot { background: #fff; width: 7px; height: 7px; }
.sp-pill.fin { background: #2b2b2b; color: #9a9a9a; }
.sp-pill.time { background: #fff; color: #000; font-size: 13px; letter-spacing: 0; text-transform: none; }
.sp-teams { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 10px; }
.sp-team { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; min-width: 0; }
.sp-team img, .sp-team .ph { width: 52px; height: 52px; object-fit: contain; }
.sp-team .ph { display: grid; place-items: center; border-radius: 50%; background: #2c2c2c; color: #888; font-weight: 800; font-size: 18px; }
.sp-team b { font-size: 14px; font-weight: 600; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
.sp-score { font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: 1px; white-space: nowrap; }
.sp-vs { color: #666; font-weight: 800; font-size: 15px; }
.sp-single { font-size: 16px; font-weight: 700; text-align: center; line-height: 1.3; }
.sp-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 12.5px; color: var(--sp-mute); min-width: 0; }
.sp-foot .v { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sp-foot a { flex: none; color: #fff; text-decoration: none; font-weight: 700; display: inline-flex; align-items: center; gap: 5px; padding: 5px 10px; border-radius: 4px; background: rgba(255,255,255,.1); }
.sp-foot a:hover { background: var(--nf-red); }
.sp-tvline { font-size: 12px; color: var(--sp-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sp-tvline b { color: #ddd; font-weight: 600; }
.sp-menu { position: fixed; inset: 0; z-index: 200; background: rgba(0,0,0,.66); display: flex; align-items: center; justify-content: center; padding: 16px; }
.sp-menu[hidden] { display: none; }
.sp-menu-box { width: 100%; max-width: 420px; max-height: 80vh; display: flex; flex-direction: column; background: #1c1c1c; border: 1px solid var(--sp-line); border-radius: 10px; overflow: hidden; }
.sp-menu-box h3 { margin: 0; padding: 16px 18px 6px; font-size: 16px; }
.sp-menu-box p { margin: 0; padding: 0 18px 10px; font-size: 12.5px; color: var(--sp-mute); }
.sp-menu-list { overflow-y: auto; padding: 4px 8px 8px; }
.sp-menu-list button { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 10px; text-align: left; background: none; border: 0; color: #fff; font: inherit; font-size: 14px; padding: 11px 12px; border-radius: 6px; cursor: pointer; }
.sp-menu-list button:hover, .sp-menu-list button:focus-visible { background: rgba(255,255,255,.1); outline: none; }
.sp-menu-list button.main { font-weight: 700; color: #fff; background: rgba(229,9,20,.18); }
.sp-menu-list button span { color: var(--sp-mute); font-size: 12px; flex: none; }
.sp-menu-close { margin: 0 8px 10px; padding: 10px; background: rgba(255,255,255,.08); border: 0; border-radius: 6px; color: #fff; font: inherit; cursor: pointer; }

.sp-empty { text-align: center; padding: 60px 16px; color: var(--sp-mute); }
.sp-empty b { display: block; color: #fff; font-size: 20px; margin-bottom: 6px; }

/* respaldo (tablas) */
.sp-fallback { background: #1a1a1a; border-radius: 8px; padding: 12px; overflow-x: auto; margin-bottom: 18px; }
.sp-fallback table { width: 100%; border-collapse: collapse; font-size: 14px; }
.sp-fallback td, .sp-fallback th { padding: 10px 8px; border-bottom: 1px solid #262626; text-align: left; vertical-align: middle; }
.sp-fallback .img-icon { width: 18px; height: 18px; vertical-align: middle; }
.sp-fallback .img-banner { max-height: 34px; width: auto; vertical-align: middle; }

@media (max-width: 899px) {
    .sp { padding-top: calc(var(--nf-header) + 54px); padding-bottom: calc(var(--nf-tabbar) + 32px); }
    .sp-bar { position: static; margin-top: 4px; }
}
@media (max-width: 700px) {
    .sp-head p { font-size: 13.5px; }
    .sp-bar { gap: 10px; padding-top: 8px; padding-bottom: 8px; }
    .sp-days { order: 1; }
    .sp-search { order: 2; flex: 1 1 140px; }
    .sp-chips { order: 3; flex-basis: 100%; }
    .sp-live-row { grid-auto-columns: 86%; }
    .sp-grid { grid-template-columns: 1fr; gap: 8px; }
    /* tarjeta compacta en fila, como la app */
    .sp-card { padding: 12px; gap: 8px; }
    .sp-team { flex-direction: row; justify-content: flex-start; text-align: left; gap: 8px; }
    .sp-team.away { flex-direction: row-reverse; text-align: right; }
    .sp-team img, .sp-team .ph { width: 34px; height: 34px; }
    .sp-team b { font-size: 13.5px; }
    .sp-score { font-size: 20px; }
}
@media (prefers-reduced-motion: reduce) { .sp-dot { animation: none; } .sp-card { transition: none; } }
</style>

<main class="sp" id="sp">
    <div class="sp-head">
        <div>
            <h1>Deportes</h1>
            <p>Partidos de hoy y mañana en tu hora local.</p>
        </div>
        <span class="sp-livecount" id="spLiveCount" hidden><span class="sp-dot"></span><span></span></span>
    </div>

<?php if ($events): ?>
    <div class="sp-bar">
        <div class="sp-days" role="tablist" aria-label="Día">
            <button type="button" class="on" data-day="0" role="tab">Hoy</button>
            <button type="button" data-day="1" role="tab">Mañana</button>
        </div>
        <div class="sp-search"><input type="search" id="spQ" placeholder="Buscar equipo o liga" aria-label="Buscar equipo o liga"></div>
        <div class="sp-chips" id="spChips"></div>
    </div>
    <section class="sp-livewrap" id="spLive" hidden>
        <h2 class="sp-h2"><span class="sp-dot"></span>En vivo ahora</h2>
        <div class="sp-live-row"></div>
    </section>
    <div id="spList"></div>
<?php else: ?>
    <?php if (!empty($sports['t1']) || !empty($sports['t2'])): ?>
        <div class="sp-search" style="max-width:420px;margin-bottom:14px"><input type="search" id="spQ2" placeholder="Buscar equipos, ligas o canales" aria-label="Buscar"></div>
        <?php if (!empty($sports['t1'])): ?><div class="sp-fallback"><?php echo $sports['t1']; ?></div><?php endif; ?>
        <?php if (!empty($sports['t2'])): ?><div class="sp-fallback"><?php echo $sports['t2']; ?></div><?php endif; ?>
    <?php else: ?>
        <div class="sp-empty"><b>La agenda deportiva no está disponible</b>Vuelve a intentarlo en unos minutos.</div>
    <?php endif; ?>
<?php endif; ?>
</main>

<script>
(function () {
    var q2 = document.getElementById('spQ2');
    if (q2) q2.addEventListener('input', function () {
        var f = q2.value.toLowerCase();
        document.querySelectorAll('.sp-fallback tr').forEach(function (tr) {
            if (tr.querySelector('th')) return;
            tr.style.display = (tr.textContent || '').toLowerCase().indexOf(f) > -1 ? '' : 'none';
        });
    });

    var EV = <?php echo json_encode($events, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP); ?>;
    var META = <?php echo json_encode($sp_meta, JSON_UNESCAPED_UNICODE); ?>;
    if (!EV.length) return;

    var FIN = /^(FT|AET|AOT|PEN|Match Finished|Finished|After Over Time|Final)$/i;
    var state = { day: 0, sport: '', q: '' };
    var fmtT = new Intl.DateTimeFormat('es', { hour: 'numeric', minute: '2-digit' });
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var dayKey = function (d) { return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };

    EV.forEach(function (e) {
        e.t = new Date(e.ts);
        if (isNaN(e.t)) e.t = new Date(e.ts.replace(' ', 'T'));
        e.dk = dayKey(e.t);
    });
    function status(e) {
        var now = Date.now(), dur = ((META[e.sp] || {}).d || 120) * 60000;
        if (e.pp) return 'pp';
        if (FIN.test(e.st || '')) return 'fin';
        if (now >= e.t.getTime() && now < e.t.getTime() + dur) return 'live';
        if (now >= e.t.getTime() + dur) return 'fin';
        return 'soon';
    }
    window.spImg = function (img) {
        if (!img.dataset.r) { img.dataset.r = 1; img.src = img.src.replace(/\/small$/, ''); return; }
        var ph = document.createElement('span'); ph.className = 'ph'; ph.textContent = img.getAttribute('data-n') || '?';
        img.replaceWith(ph);
    };
    function badge(src, name) {
        var ini = esc((name || '?').charAt(0).toUpperCase());
        if (src) return '<img src="' + esc(src) + '/small" alt="" loading="lazy" data-n="' + ini + '" onerror="spImg(this)">';
        return '<span class="ph">' + ini + '</span>';
    }
    // canales que transmiten el evento (los manda el panel; no siempre hay)
    function hasTv(e) { return Array.isArray(e.tv) && e.tv.length > 0; }
    function tvLine(e) {
        if (!hasTv(e)) return '';
        var names = e.tv.slice(0, 3).map(function (c) { return esc(c.n); }).join(' · ');
        var more = e.tv.length > 3 ? ' +' + (e.tv.length - 3) : '';
        return '<div class="sp-tvline" title="' + esc(e.tv.map(function (c) { return c.n; }).join(', ')) + '">📺 <b>' + names + '</b>' + more + '</div>';
    }
    function card(e) {
        var st = status(e), pill;
        if (st === 'live') pill = '<span class="sp-pill live"><span class="sp-dot"></span>En vivo</span>';
        else if (st === 'fin') pill = '<span class="sp-pill fin">Final</span>';
        else if (st === 'pp') pill = '<span class="sp-pill fin">Aplazado</span>';
        else pill = '<span class="sp-pill time">' + esc(fmtT.format(e.t)) + '</span>';
        var hasScore = e.hs !== null && e.hs !== '' && e.as !== null && e.as !== '' && st !== 'soon';
        var mid;
        if (e.h && e.a) {
            mid = '<div class="sp-teams"><div class="sp-team home">' + badge(e.hb, e.h) + '<b>' + esc(e.h) + '</b></div>' +
                (hasScore ? '<div class="sp-score">' + esc(e.hs) + ' - ' + esc(e.as) + '</div>' : '<div class="sp-vs">VS</div>') +
                '<div class="sp-team away">' + badge(e.ab, e.a) + '<b>' + esc(e.a) + '</b></div></div>';
        } else {
            mid = '<div class="sp-single">' + esc(e.ev) + '</div>';
        }
        var m = META[e.sp] || { n: e.sp, i: '' };
        return '<article class="sp-card' + (st === 'live' ? ' live' : '') + '">' +
            '<div class="sp-top"><span class="lg">' + esc(m.i + ' ' + (e.lg || m.n)) + '</span>' + pill + '</div>' + mid +
            tvLine(e) +
            '<div class="sp-foot"><span class="v">' + esc(e.v || (st === 'soon' ? fmtT.format(e.t) : '')) + '</span>' +
            '<a href="tvguide.php" class="sp-tv" data-i="' + EV.indexOf(e) + '">' + (hasTv(e) ? 'Ver canales' : 'TV en vivo') + '</a></div></article>';
    }

    var today = new Date(), tomorrow = new Date(Date.now() + 86400000);
    var keys = [dayKey(today), dayKey(tomorrow)];

    function visible() {
        var q = state.q.toLowerCase();
        return EV.filter(function (e) {
            if (e.dk !== keys[state.day]) return false;
            if (state.sport && e.sp !== state.sport) return false;
            if (q && (e.h + ' ' + e.a + ' ' + e.lg + ' ' + e.ev).toLowerCase().indexOf(q) < 0) return false;
            return true;
        });
    }
    function renderChips() {
        var count = {}, total = 0;
        EV.forEach(function (e) { if (e.dk === keys[state.day]) { count[e.sp] = (count[e.sp] || 0) + 1; total++; } });
        var h = '<button type="button" class="nf-chip' + (state.sport ? '' : ' active') + '" data-sp="">Todos<b>' + total + '</b></button>';
        Object.keys(META).forEach(function (k) {
            if (!count[k]) return;
            h += '<button type="button" class="nf-chip' + (state.sport === k ? ' active' : '') + '" data-sp="' + esc(k) + '">' + META[k].i + ' ' + esc(META[k].n) + '<b>' + count[k] + '</b></button>';
        });
        document.getElementById('spChips').innerHTML = h;
    }
    function render() {
        var list = visible();
        // en vivo (siempre de hoy)
        var live = EV.filter(function (e) { return status(e) === 'live' && (!state.sport || e.sp === state.sport); });
        var lc = document.getElementById('spLiveCount');
        lc.hidden = !live.length;
        lc.lastChild.textContent = live.length + (live.length === 1 ? ' partido en vivo' : ' partidos en vivo');
        var lw = document.getElementById('spLive');
        lw.hidden = !(live.length && state.day === 0 && !state.q);
        if (!lw.hidden) lw.querySelector('.sp-live-row').innerHTML = live.map(card).join('');

        var groups = {}, order = [];
        list.forEach(function (e) {
            if (!lw.hidden && status(e) === 'live') return;
            var g = e.lg || (META[e.sp] || {}).n || e.sp;
            if (!groups[g]) { groups[g] = { lb: e.lb, items: [] }; order.push(g); }
            groups[g].items.push(e);
        });
        var h = order.map(function (g) {
            var G = groups[g];
            return '<section class="sp-league"><div class="sp-lhead">' + (G.lb ? '<img src="' + esc(G.lb) + '/tiny" alt="" loading="lazy" onerror="this.remove()">' : '') +
                '<h3>' + esc(g) + '</h3><span>' + G.items.length + '</span></div><div class="sp-grid">' + G.items.map(card).join('') + '</div></section>';
        }).join('');
        if (!h && lw.hidden) h = '<div class="sp-empty"><b>No hay partidos con estos filtros</b>Prueba con otro día o deporte.</div>';
        document.getElementById('spList').innerHTML = h;
    }

    document.querySelector('.sp-days').addEventListener('click', function (ev) {
        var b = ev.target.closest('button'); if (!b) return;
        this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
        state.day = +b.getAttribute('data-day'); state.sport = '';
        renderChips(); render();
    });
    document.getElementById('spChips').addEventListener('click', function (ev) {
        var b = ev.target.closest('.nf-chip'); if (!b) return;
        state.sport = b.getAttribute('data-sp'); renderChips(); render();
    });
    var qi = document.getElementById('spQ'), qt;
    qi.addEventListener('input', function () { clearTimeout(qt); qt = setTimeout(function () { state.q = qi.value.trim(); render(); }, 150); });


    // TV en vivo: abre el canal del cliente que transmite el partido.
    // Con canales del panel se abre un menú: el evento (prueba los canales y luego los equipos), cada canal o los equipos.
    var menu = document.createElement('div');
    menu.className = 'sp-menu'; menu.hidden = true;
    menu.innerHTML = '<div class="sp-menu-box" role="dialog" aria-modal="true" aria-labelledby="spMenuT"><h3 id="spMenuT"></h3><p></p><div class="sp-menu-list"></div><button type="button" class="sp-menu-close">Cerrar</button></div>';
    document.body.appendChild(menu);
    var menuEv = null, menuBtn = null;
    function closeMenu() { menu.hidden = true; if (menuBtn) menuBtn.focus(); menuEv = null; }
    menu.addEventListener('click', function (ev) {
        if (ev.target === menu || ev.target.closest('.sp-menu-close')) { closeMenu(); return; }
        var o = ev.target.closest('[data-m]'); if (!o || !menuEv) return;
        var e = menuEv, b = menuBtn, mode = o.getAttribute('data-m'), k = o.getAttribute('data-k');
        closeMenu();
        watch(e, b, mode, mode === 'tv' ? [e.tv[+k].n] : null);
    });
    document.addEventListener('keydown', function (ev) { if (!menu.hidden && ev.key === 'Escape') closeMenu(); });

    function openMenu(e, b) {
        menuEv = e; menuBtn = b;
        menu.querySelector('h3').textContent = e.h && e.a ? e.h + ' vs ' + e.a : (e.ev || 'Evento');
        menu.querySelector('p').textContent = 'Se transmite por ' + e.tv.length + (e.tv.length === 1 ? ' canal' : ' canales') + '. Elige uno o deja que lo busquemos.';
        var h = '<button type="button" class="main" data-m="auto">▶ Ver el evento</button>';
        e.tv.forEach(function (c, i) { h += '<button type="button" data-m="tv" data-k="' + i + '">' + esc(c.n) + (c.c ? '<span>' + esc(c.c) + '</span>' : '') + '</button>'; });
        h += '<button type="button" data-m="teams">🔎 Buscar por equipos</button>';
        menu.querySelector('.sp-menu-list').innerHTML = h;
        menu.hidden = false;
        menu.querySelector('.sp-menu-list button').focus();
    }

    function watch(e, b, mode, tvs) {
        if (b.classList.contains('busy')) return;
        b.classList.add('busy'); var txt = b.textContent; b.textContent = 'Buscando canal…';
        if (mode === 'auto') tvs = hasTv(e) ? e.tv.map(function (c) { return c.n; }) : [];
        var url = 'sportsschedule.php?ajax=channel&mode=' + mode + '&h=' + encodeURIComponent(e.h || '') + '&a=' + encodeURIComponent(e.a || '') +
            '&lg=' + encodeURIComponent(e.lg || '') + '&ev=' + encodeURIComponent(e.ev || '') + '&tv=' + encodeURIComponent((tvs || []).join('|'));
        fetch(url, { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (j) {
                var miss = j.missing ? 'No tienes ' + j.missing + '. ' : '';
                if (!j.ok) { NF.toast(miss + 'No encontramos un canal para este evento'); return; }
                if (j.partial) { NF.toast(miss + 'Aún no aparece el canal exacto, te mostramos ' + j.name); setTimeout(function () { location.href = j.url; }, 1200); return; }
                if (miss) { NF.toast(miss + 'Te mostramos ' + j.name); setTimeout(function () { location.href = j.url; }, 1200); return; }
                location.href = j.url;
            })
            .catch(function () { location.href = 'tvguide.php'; })
            .then(function () { b.classList.remove('busy'); b.textContent = txt; });
    }

    document.addEventListener('click', function (ev) {
        var b = ev.target.closest('.sp-tv'); if (!b) return;
        ev.preventDefault();
        var e = EV[+b.getAttribute('data-i')]; if (!e) return;
        var st = status(e);
        if (e.dk !== keys[0] || st === 'fin' || st === 'pp') { NF.toast(st === 'fin' && e.dk === keys[0] ? 'Este evento ya terminó' : 'El evento no está en línea'); return; }
        if (hasTv(e)) openMenu(e, b);
        else watch(e, b, 'teams', null);
    });

    // si hoy no queda nada, se abre mañana
    if (!EV.some(function (e) { return e.dk === keys[0]; })) document.querySelector('.sp-days [data-day="1"]').click();
    else { renderChips(); render(); }
    setInterval(render, 60000);
})();
</script>
<?php include "footer.php"; ?>
