<?php
include "session.php";
include "config.php";
// el distribuidor puede tener la sección de deportes apagada
if (!wp_tenant_feature('sports')) {
    header('Location: homex');
    exit;
}

/*
 * Canal de cada partido, igual que Android TV, Roku, Vega OS, webOS y Tizen (includes/sports_match.php):
 *   POST ?ajax=match[&epg=1]  {"events": [{"k", "id", "h", "a", "lg", "ev", "tv": ["ESPN 2", …]}]} (hasta 400)
 *     -> {"ok", "m": {k: {"t": [id del canal del cliente o "" por cada canal que transmite], "tm": id por equipos}},
 *         "g": {id del partido: [ids por la guía del panel]}, "ch": {id: [nombre, carpeta]}, "ev": [id, carpeta, nombre]}
 *   GET ?ajax=search&q=        -> {"ok", "list": [id…], "ch": {…}} (canales por nombre, hasta 12)
 * Solo canales de esta línea; se guarda 10 min por línea y partidos (la guía del panel, 10 min por línea).
 */
if (in_array($_GET['ajax'] ?? '', ['match', 'search'], true)) {
    require_once __DIR__ . '/includes/sports_match.php';
    wp_session_read_close();
    @set_time_limit(90);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: private, no-store');
    $panel = wp_panel_sports();
    $rules = spm_rules($panel);
    $line = xt_cache_key('get_live_streams', []);
    $ix = null;
    $index = function () use (&$ix, $rules) { if ($ix === null) $ix = spm_index($rules); return $ix; };
    $chOut = function (array $ix, array $list) {
        $ch = [];
        foreach ($list as $i) if ($i >= 0 && isset($ix['chans'][$i])) $ch[$ix['chans'][$i]['id']] = [$ix['chans'][$i]['name'], $ix['chans'][$i]['cat']];
        return $ch;
    };
    if ($_GET['ajax'] === 'search') {
        $q = mb_substr(trim((string)($_GET['q'] ?? '')), 0, 80, 'UTF-8');
        $ixs = $index();
        $list = $q === '' ? [] : spm_search($q, $ixs);
        echo json_encode(['ok' => true, 'list' => array_map(function ($i) use ($ixs) { return $ixs['chans'][$i]['id']; }, $list), 'ch' => (object)$chOut($ixs, $list)],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }
    $in = json_decode((string)file_get_contents('php://input'), true);
    $evs = [];
    $cut = function ($v, $n) { return mb_substr(trim((string)$v), 0, $n, 'UTF-8'); };
    foreach (array_slice(is_array($in['events'] ?? null) ? $in['events'] : [], 0, 400) as $e) {
        if (!is_array($e) || !isset($e['k'])) continue;
        $tv = [];
        foreach (array_slice(is_array($e['tv'] ?? null) ? $e['tv'] : [], 0, 24) as $t) if (is_string($t) && trim($t) !== '') $tv[] = $cut($t, 80);
        $evs[] = ['k' => $cut($e['k'], 80), 'h' => $cut($e['h'] ?? '', 120), 'a' => $cut($e['a'] ?? '', 120), 'lg' => $cut($e['lg'] ?? '', 120), 'ev' => $cut($e['ev'] ?? '', 160), 'tv' => $tv];
    }
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
    if (!empty($_GET['epg'])) {
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
    echo json_encode(['ok' => true, 'm' => (object)$res['m'], 'g' => (object)$g, 'ch' => (object)$res['ch'], 'ev' => $res['ev']], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/* Tablas, partidos de Equipos / Selecciones y ficha del equipo: del panel por el hosting (includes/sports_panel.php) */
if (in_array($_GET['ajax'] ?? '', ['tables', 'fixtures', 'team'], true)) {
    require_once __DIR__ . '/includes/sports_panel.php';
    wp_session_read_close();
    @set_time_limit(60);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: private, no-store');
    $sx = wp_sports_extra(wp_panel_sports());
    $aj = $_GET['ajax'];
    if ($aj === 'tables') $res = wp_sports_tables($sx['trev']);
    elseif ($aj === 'fixtures') $res = wp_sports_fixtures($sx['frev']);
    else $res = wp_sports_team($_GET['id'] ?? '') ?: ['ok' => false];
    echo json_encode($res, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
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
    'Soccer' => [t('Fútbol'), '⚽', 120],
    'Basketball' => [t('Baloncesto'), '🏀', 150],
    'American Football' => [t('Fútbol americano'), '🏈', 210],
    'Baseball' => [t('Béisbol'), '⚾', 190],
    'Fighting' => [t('Combate'), '🥊', 240],
    'Motorsport' => [t('Motor'), '🏁', 150],
    'Tennis' => [t('Tenis'), '🎾', 150],
    'Ice Hockey' => [t('Hockey'), '🏒', 160],
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
// pestañas Tablas / Selecciones / Equipos (cuando el panel las ofrece) y los nombres en español de los equipos
require_once __DIR__ . '/includes/sports_panel.php';
$sp_extra = wp_sports_extra($sp_panel);
$sp_alias = is_array($sp_panel['match']['alias'] ?? null) ? $sp_panel['match']['alias'] : [];

$page_title = t('Deportes');
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

.sp-card.tap { cursor: pointer; }
.sp-card.tap:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.sp-chan { font-size: 13px; font-weight: 700; color: var(--sp-mute); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.sp-chan.ok { color: #46d369; }
.sp-agchips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; margin: 0 0 16px; }
.sp-agchips::-webkit-scrollbar { display: none; }
.sp-agchips .nf-chip { white-space: nowrap; flex: none; font-size: 14px; }
.sp-menu-list button { flex-direction: column; align-items: flex-start; gap: 2px; }
.sp-menu-list button b { font-weight: 600; font-size: 15px; color: #fff; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-menu-list button.green b { color: #46d369; }
.sp-menu-list button span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sp-menu-type { display: flex; gap: 8px; padding: 4px 12px 12px; }
.sp-menu-type[hidden], .sp-menu-box p[hidden] { display: none; }
.sp-menu-type input { flex: 1; min-width: 0; background: #000; border: 1px solid #555; color: #fff; padding: 10px 12px; border-radius: 6px; font: inherit; font-size: 15px; }
.sp-menu-type input:focus { outline: none; border-color: #fff; }
.sp-menu-type button { flex: none; border: 0; border-radius: 6px; background: var(--nf-red); color: #fff; font: inherit; font-weight: 700; padding: 0 16px; cursor: pointer; }
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

<link rel="stylesheet" href="assets/nf/sports.css?v=1">
<main class="sp" id="sp">
    <div class="sp-head">
        <div>
            <h1><?php echo t('Deportes'); ?></h1>
            <p><?php echo t('Partidos de hoy y mañana en tu hora local.'); ?></p>
        </div>
        <span class="sp-livecount" id="spLiveCount" hidden><span class="sp-dot"></span><span></span></span>
    </div>
    <nav class="sp-tabs" id="spTabs" role="tablist" aria-label="<?php echo e(t('Deportes')); ?>" hidden></nav>
    <div class="sp-pane" id="spTables" hidden></div>
    <div class="sp-pane" id="spFx" hidden></div>

<div class="sp-pane" id="spAgenda">
<?php if ($events): ?>
    <div class="sp-agchips" id="spChips"></div>
    <div id="spList"></div>
<?php else: ?>
    <?php if (!empty($sports['t1']) || !empty($sports['t2'])): ?>
        <div class="sp-search" style="max-width:420px;margin-bottom:14px"><input type="search" id="spQ2" placeholder="<?php echo e(t('Buscar equipos, ligas o canales')); ?>" aria-label="<?php echo e(t('Buscar')); ?>"></div>
        <?php if (!empty($sports['t1'])): ?><div class="sp-fallback"><?php echo $sports['t1']; ?></div><?php endif; ?>
        <?php if (!empty($sports['t2'])): ?><div class="sp-fallback"><?php echo $sports['t2']; ?></div><?php endif; ?>
    <?php else: ?>
        <div class="sp-empty"><b><?php echo t('La agenda deportiva no está disponible'); ?></b><?php echo t('Vuelve a intentarlo en unos minutos.'); ?></div>
    <?php endif; ?>
<?php endif; ?>
</div>
</main>

<script src="assets/nf/sports.js?v=2"></script>
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
    // «Solo los canales del servidor IPTV» del panel ("chan": "iptv"): en cada partido solo se nombran los que tiene el cliente
    var IPTV = <?php echo json_encode(($sp_panel['chan'] ?? '') === 'iptv'); ?>;
    // zona horaria del panel (la del distribuidor o del dueño): la hora y Hoy / Mañana van en ella, no en la del equipo
    var TZ = <?php echo json_encode(is_string($sp_panel['tz'] ?? null) ? $sp_panel['tz'] : ''); ?>;
    try { new Intl.DateTimeFormat('en', { timeZone: TZ || undefined }); } catch (x) { TZ = ''; }
    var T = {
        live: <?php echo tj('En vivo'); ?>, fin: <?php echo tj('Final'); ?>, pp: <?php echo tj('Aplazado'); ?>, today: <?php echo tj('Hoy'); ?>, tomorrow: <?php echo tj('Mañana'); ?>,
        all: <?php echo tj('Todos'); ?>, seeCh: <?php echo tj('Ver canales'); ?>, liveTv: <?php echo tj('TV en vivo'); ?>, finding: <?php echo tj('Buscando…'); ?>,
        noChan: <?php echo tj('Sin canal'); ?>, tbc: <?php echo tj('Por confirmar'); ?>, onTv: <?php echo tj('En TV:'); ?>, none: <?php echo tj('No hay partidos para mostrar.'); ?>,
        one: <?php echo tj('{n} partido en vivo'); ?>, many: <?php echo tj('{n} partidos en vivo'); ?>, ended: <?php echo tj('Este evento ya terminó'); ?>,
        offline: <?php echo tj('El evento no está en línea'); ?>, postponed: <?php echo tj('El evento está aplazado'); ?>, loading: <?php echo tj('Buscando los canales, un momento…'); ?>,
        auto: <?php echo tj('Ver el evento (canal automático)'); ?>, autoSub: <?php echo tj('Busca el mejor canal automáticamente'); ?>, where: <?php echo tj('¿Dónde quieres verlo?'); ?>,
        inList: <?php echo tj('en tu lista: {c}'); ?>, notInList: <?php echo tj('no está en tu lista: se busca el evento'); ?>, inGuide: <?php echo tj('en la guía'); ?>,
        byTeams: <?php echo tj('por equipos'); ?>, searchX: <?php echo tj('Buscar canales: «{q}»'); ?>, searchAny: <?php echo tj('Buscar canal, equipo o evento…'); ?>,
        typeHint: <?php echo tj('Canal, equipo o evento'); ?>, go: <?php echo tj('Buscar'); ?>, chWith: <?php echo tj('Canales con «{q}»'); ?>,
        noChWith: <?php echo tj('No hay canales con «{q}» en tu lista'); ?>, missing: <?php echo tj('No tienes {c}; te mostramos {d}'); ?>,
        notYet: <?php echo tj('Aún no aparece el canal exacto, te mostramos {c}'); ?>, notFound: <?php echo tj('No encontramos un canal para este evento'); ?>,
        event: <?php echo tj('Evento'); ?>, close: <?php echo tj('Cerrar'); ?>, events: <?php echo tj('eventos'); ?>
    };

    var FIN = /^(FT|AET|AOT|PEN|Match Finished|Finished|After Over Time|Final)$/i;
    var state = { day: 0, sport: '' };
    var fmtT = new Intl.DateTimeFormat(window.NF_LOCALE, { hour: 'numeric', minute: '2-digit', timeZone: TZ || undefined });
    var fmtD = TZ ? new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }) : null;
    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var dayKey = function (d) { return fmtD ? fmtD.format(d) : d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
    var fill = function (s, p) { for (var k in p) s = s.split('{' + k + '}').join(p[k]); return s; };

    var fmtW = new Intl.DateTimeFormat(window.NF_LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ || undefined });
    function prep(e) {
        e.t = +e.s > 0 ? new Date(e.s * 1000) : new Date(e.ts);
        if (isNaN(e.t)) e.t = new Date(String(e.ts).replace(' ', 'T'));
        e.dk = dayKey(e.t);
        // clave del partido para su canal (los de Equipos / Selecciones pueden repetir el id con otra fecha)
        e.k = String(e.id) + '|' + e.t.getTime();
        return e;
    }
    EV.forEach(prep);
    var AG = EV.slice(); // la agenda (Equipos / Selecciones agregan sus partidos a EV para el menú)
    function status(e) {
        var now = Date.now(), dur = ((META[e.sp] || {}).d || 120) * 60000;
        if (e.pp) return 'pp';
        if (FIN.test(e.st || '')) return 'fin';
        if (now >= e.t.getTime() && now < e.t.getTime() + dur) return 'live';
        if (now >= e.t.getTime() + dur) return 'fin';
        return 'soon';
    }
    function ending(e) { return e.t.getTime() + ((META[e.sp] || {}).d || 120) * 60000; }
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
    function hasTv(e) { return Array.isArray(e.tv) && e.tv.length > 0; }

    /* ---------- canal de cada partido (sportsschedule.php?ajax=match, una vez y en segundo plano) ---------- */
    var M = {}, G = {}, CH = {}, EVF = null, ready = false, pending = {}, asking = false, fxTimer = 0, sports = null;
    function payload(list) {
        return list.map(function (e) { return { k: e.k, h: e.h || '', a: e.a || '', lg: e.lg || '', ev: e.ev || '', tv: (e.tv || []).map(function (t) { return t.n; }) }; });
    }
    function ask(list, epg) {
        return fetch('sportsschedule.php?ajax=match' + (epg ? '&epg=1' : ''), { method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ events: payload(list) }) })
            .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
            .then(function (j) {
                if (!j || !j.ok) return false;
                for (var k in j.m) M[k] = j.m[k];
                for (var c in j.ch) CH[c] = j.ch[c];
                if (epg) G = j.g || {};
                if (j.ev) { EVF = j.ev; CH[j.ev[0]] = CH[j.ev[0]] || ['', j.ev[1]]; }
                return true;
            });
    }
    // los de hoy, mañana y los que siguen en vivo; con la guía del panel
    function loadAgenda() {
        var now = Date.now(), k0 = dayKey(new Date(now)), k1 = dayKey(new Date(now + 86400000));
        var list = AG.filter(function (e) { return e.dk === k0 || e.dk === k1 || status(e) === 'live'; });
        ask(list, true).then(function (ok) {
            ready = true;
            if (!ok) { list.forEach(function (e) { if (!M[e.k]) M[e.k] = { t: [], tm: '' }; }); }
            render();
            flushFx();
        });
    }
    // los partidos de Equipos / Selecciones buscan su canal al mostrarse (una vez cada uno, mismas reglas)
    function needFx(e) { if (!M[e.k] && !pending[e.k]) { pending[e.k] = e; clearTimeout(fxTimer); fxTimer = setTimeout(flushFx, 200); } }
    function flushFx() {
        if (!ready || asking) return;
        var list = Object.keys(pending).map(function (k) { return pending[k]; }).slice(0, 400);
        if (!list.length) return;
        asking = true;
        ask(list, false).then(function () {
            list.forEach(function (e) { delete pending[e.k]; if (!M[e.k]) M[e.k] = { t: [], tm: '' }; });
            asking = false;
            if (sports && sports.refresh) sports.refresh();
            if (Object.keys(pending).length) flushFx();
        });
    }
    // el canal de un partido: el que lo transmite (si el cliente lo tiene), el de la guía o el de los equipos
    function resolve(e) {
        var m = M[e.k];
        if (!ready || !m) return null;
        var tv = (e.tv || []).map(function (t, i) { return [t, m.t[i] || '']; });
        var tvOwned = '';
        tv.some(function (x) { if (x[1]) { tvOwned = x[1]; return true; } return false; });
        var g = (G[e.id] || []).filter(function (id) { return CH[id]; });
        return { best: tvOwned || (g.length ? g[0] : m.tm), teams: m.tm, tv: tv, g: g };
    }
    function owned(r) {
        var out = [], seen = {};
        [r.best].concat(r.tv.map(function (x) { return x[1]; }), r.g, [r.teams]).forEach(function (id) { if (id && !seen[id] && CH[id]) { seen[id] = 1; out.push(id); } });
        return out;
    }
    function chanOf(e, withDate) {
        if (!M[e.k]) { if (e.fx || ready) needFx(e); return [T.finding, false]; }
        var r = resolve(e);
        if (r && r.best && CH[r.best]) return [CH[r.best][0], true];
        return [withDate ? T.tbc : T.noChan, false];
    }
    // "En TV: ESPN 2 · TUDN · Fox Sports +3": los del partido o, en modo "iptv", solo los que tiene el cliente
    function tvLine(e) {
        var names;
        if (IPTV) { var r = resolve(e); names = r ? owned(r).map(function (id) { return CH[id][0]; }) : []; }
        else names = (e.tv || []).map(function (t) { return t.n; });
        if (!names.length) return '';
        return '<div class="sp-tvline" title="' + esc(names.join(', ')) + '">' + esc(T.onTv) + ' <b>' + esc(names.slice(0, 4).join(' · ')) + '</b>' + (names.length > 4 ? ' +' + (names.length - 4) : '') + '</div>';
    }

    /* ---------- tarjetas ---------- */
    var today = new Date(), tomorrow = new Date(Date.now() + 86400000);
    var keys = [dayKey(today), dayKey(tomorrow)];
    // partidos de Equipos / Selecciones (21 días): Hoy / Mañana / el día, y la hora
    function when(e) {
        var d = e.dk === keys[0] ? T.today : e.dk === keys[1] ? T.tomorrow : fmtW.format(e.t);
        return d + ' · ' + fmtT.format(e.t);
    }
    function card(e) {
        var st = status(e), pill;
        if (st === 'live') pill = '<span class="sp-pill live"><span class="sp-dot"></span>' + esc(T.live) + '</span>';
        else if (st === 'fin') pill = '<span class="sp-pill fin">' + esc(T.fin) + '</span>';
        else if (st === 'pp') pill = '<span class="sp-pill fin">' + esc(T.pp) + '</span>';
        else pill = '<span class="sp-pill time">' + esc(e.fx ? when(e) : fmtT.format(e.t)) + '</span>';
        var hasScore = e.hs != null && e.hs !== '' && e.as != null && e.as !== '' && st !== 'soon';
        var mid;
        if (e.h && e.a) {
            mid = '<div class="sp-teams"><div class="sp-team home">' + badge(e.hb, e.h) + '<b>' + esc(e.h) + '</b></div>' +
                (hasScore ? '<div class="sp-score">' + esc(e.hs) + ' - ' + esc(e.as) + '</div>' : '<div class="sp-vs">VS</div>') +
                '<div class="sp-team away">' + badge(e.ab, e.a) + '<b>' + esc(e.a) + '</b></div></div>';
        } else {
            mid = '<div class="sp-single">' + esc(e.ev) + '</div>';
        }
        var m = META[e.sp] || { n: e.sp, i: '' };
        var c = chanOf(e, !!e.fx);
        if (EV.indexOf(e) < 0) EV.push(e);
        return '<article class="sp-card tap' + (st === 'live' ? ' live' : '') + '" role="button" tabindex="0" data-i="' + EV.indexOf(e) + '">' +
            '<div class="sp-top"><span class="lg">' + esc((m.i + ' ' + (e.lg || m.n)).trim()) + '</span>' + pill + '</div>' + mid +
            tvLine(e) +
            '<div class="sp-chan' + (c[1] ? ' ok' : '') + '">▶ ' + esc(c[0]) + '</div>' +
            '<div class="sp-foot"><span class="v">' + esc(e.v || (st === 'soon' ? fmtT.format(e.t) : '')) + '</span>' +
            '<a href="tvguide.php" class="sp-tv">' + esc(hasTv(e) ? T.seeCh : T.liveTv) + '</a></div></article>';
    }

    /* ---------- agenda: Hoy (los de hoy y los que siguen en vivo) o Mañana; en vivo, después por hora y al final los terminados ---------- */
    function renderChips() {
        var seen = {}, list = [];
        AG.forEach(function (e) { if (e.sp && !seen[e.sp]) { seen[e.sp] = 1; list.push(e.sp); } });
        var h = '<button type="button" class="nf-chip' + (state.sport ? '' : ' active') + '" data-sp="">' + esc(T.all) + '</button>';
        list.forEach(function (k) {
            var info = META[k];
            h += '<button type="button" class="nf-chip' + (state.sport === k ? ' active' : '') + '" data-sp="' + esc(k) + '">' + esc(((info ? info.i : '') + ' ' + (info ? info.n : k)).trim()) + '</button>';
        });
        document.getElementById('spChips').innerHTML = h;
    }
    function render() {
        if (!AG.length) return;
        var now = Date.now();
        keys = [dayKey(new Date(now)), dayKey(new Date(now + 86400000))];
        var live = [], next = [], done = [];
        AG.filter(function (e) { return !state.sport || e.sp === state.sport; }).sort(function (a, b) { return a.t - b.t; }).forEach(function (e) {
            var st = status(e);
            if (!((state.day === 0 && (e.dk === keys[0] || st === 'live')) || (state.day === 1 && e.dk === keys[1]))) return;
            (st === 'live' ? live : st === 'soon' ? next : done).push(e);
        });
        var rows = live.concat(next, done);
        var liveCount = AG.filter(function (e) { return status(e) === 'live'; }).length;
        var lc = document.getElementById('spLiveCount');
        lc.hidden = !liveCount;
        lc.lastChild.textContent = (liveCount === 1 ? T.one : T.many).replace('{n}', liveCount);
        document.getElementById('spList').innerHTML = rows.length ? '<div class="sp-grid">' + rows.map(card).join('') + '</div>' : '<div class="sp-empty"><b>' + esc(T.none) + '</b></div>';
    }

    /* ---------- menú del partido (y de una búsqueda) ---------- */
    var menu = document.createElement('div');
    menu.className = 'sp-menu'; menu.hidden = true;
    menu.innerHTML = '<div class="sp-menu-box" role="dialog" aria-modal="true" aria-labelledby="spMenuT"><h3 id="spMenuT"></h3><p></p><div class="sp-menu-type" hidden><input type="search" enterkeyhint="search"><button type="button"></button></div><div class="sp-menu-list"></div><button type="button" class="sp-menu-close"></button></div>';
    document.body.appendChild(menu);
    menu.querySelector('.sp-menu-close').textContent = T.close;
    var opts = [], back = null;
    function closeMenu() { menu.hidden = true; opts = []; if (back) try { back.focus(); } catch (x) {} }
    function showMenu(title, sub, list, typing) {
        opts = list || [];
        menu.querySelector('h3').textContent = title;
        menu.querySelector('p').textContent = sub || '';
        menu.querySelector('p').hidden = !sub;
        var ty = menu.querySelector('.sp-menu-type');
        ty.hidden = typing == null;
        menu.querySelector('.sp-menu-list').innerHTML = opts.map(function (o, i) {
            return '<button type="button" data-o="' + i + '"' + (o.green ? ' class="green"' : '') + '><b>' + esc(o.title) + '</b>' + (o.sub ? '<span>' + esc(o.sub) + '</span>' : '') + '</button>';
        }).join('');
        menu.hidden = false;
        if (typing != null) {
            var inp = ty.querySelector('input');
            inp.value = typing; inp.placeholder = T.typeHint; inp.setAttribute('aria-label', T.typeHint);
            ty.querySelector('button').textContent = T.go;
            inp.focus(); inp.select();
        } else {
            var f = menu.querySelector('.sp-menu-list button');
            if (f) f.focus();
        }
    }
    menu.addEventListener('click', function (ev) {
        if (ev.target === menu || ev.target.closest('.sp-menu-close')) { closeMenu(); return; }
        if (ev.target.closest('.sp-menu-type button')) { typed(); return; }
        var b = ev.target.closest('[data-o]'); if (!b) return;
        var o = opts[+b.getAttribute('data-o')];
        if (o) o.run();
    });
    menu.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.closest('.sp-menu-type input')) { ev.preventDefault(); typed(); } });
    document.addEventListener('keydown', function (ev) { if (!menu.hidden && ev.key === 'Escape') closeMenu(); });
    function typed() { var q = menu.querySelector('.sp-menu-type input').value.trim(); if (q) findChans(q); }

    // abre el canal con su carpeta como lista (para cambiar de canal)
    function play(id, msg) {
        var c = CH[id]; if (!c) return;
        var url = 'tvguide.php?id=' + encodeURIComponent(id) + '&slug=live&category_id=' + encodeURIComponent(c[1]);
        closeMenu();
        if (msg) { NF.toast(msg); setTimeout(function () { location.href = url; }, 1200); }
        else location.href = url;
    }
    // sin canal exacto: la primera carpeta de eventos
    function folder() {
        if (EVF) play(EVF[0], fill(T.notYet, { c: EVF[2] || T.events }));
        else { closeMenu(); NF.toast(T.notFound); }
    }
    // buscar en la lista del cliente por un nombre (canal, equipo o evento): todos en verde, son del servidor
    function findChans(q) {
        fetch('sportsschedule.php?ajax=search&q=' + encodeURIComponent(q), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
            .then(function (j) {
                var list = j && j.ok ? j.list : [];
                if (j && j.ch) for (var c in j.ch) CH[c] = j.ch[c];
                if (!list.length) { NF.toast(fill(T.noChWith, { q: q })); return; }
                showMenu(fill(T.chWith, { q: q }), '', list.map(function (id) { return { title: CH[id][0], green: true, run: function () { play(id); } }; }));
            });
    }
    function playable(e) {
        var st = status(e), now = Date.now();
        if (st === 'pp') { NF.toast(T.postponed); return false; }
        if (st === 'fin' || now >= ending(e)) { NF.toast(T.ended); return false; }
        if (e.dk !== dayKey(new Date(now)) && st !== 'live') { NF.toast(T.offline); return false; }
        return true;
    }
    // el automático, los canales que lo transmiten, los de la guía y los equipos (en verde los que tiene el cliente),
    // buscar por el nombre de cada equipo y escribir otro nombre
    function open(e, from) {
        back = from;
        if (!playable(e)) return;
        if (!ready || !M[e.k]) { if (ready) needFx(e); NF.toast(T.loading); return; }
        var r = resolve(e), best = r.best && CH[r.best] ? r.best : '';
        var list = [{ title: '▶  ' + T.auto, sub: best ? CH[best][0] : T.autoSub, green: !!best, run: function () { if (best) play(best); else folder(); } }];
        var seen = {};
        r.tv.forEach(function (x) {
            var t = x[0], ch = x[1] && CH[x[1]] ? x[1] : '';
            if (ch && seen[ch]) return;
            if (IPTV && !ch) return;
            if (ch) seen[ch] = 1;
            list.push({
                title: IPTV && ch ? CH[ch][0] : t.n + (t.c ? ' (' + t.c + ')' : ''),
                sub: ch ? fill(T.inList, { c: CH[ch][0] }) : T.notInList, green: !!ch,
                run: function () {
                    if (ch) play(ch);
                    else if (r.teams && CH[r.teams]) play(r.teams, fill(T.missing, { c: t.n, d: CH[r.teams][0] }));
                    else folder();
                }
            });
        });
        r.g.map(function (id) { return [id, T.inGuide]; }).concat(r.teams && CH[r.teams] ? [[r.teams, T.byTeams]] : []).forEach(function (x) {
            if (seen[x[0]] || list.length > 10) return;
            seen[x[0]] = 1;
            list.push({ title: CH[x[0]][0] + ' · ' + x[1], green: true, run: function () { play(x[0]); } });
        });
        var names = [e.h, e.a].filter(function (n) { return n && String(n).trim(); });
        if (!names.length && e.ev) names = [e.ev];
        names.forEach(function (n) { list.push({ title: fill(T.searchX, { q: n }), run: function () { findChans(n); } }); });
        list.push({ title: T.searchAny, run: function () { showMenu(T.searchAny, '', [], names[0] || ''); } });
        showMenu(e.h && e.a ? e.h + ' vs ' + e.a : (e.ev || T.event), T.where, list);
    }

    document.addEventListener('click', function (ev) {
        var c = ev.target.closest('.sp-card.tap'); if (!c) return;
        ev.preventDefault();
        var e = EV[+c.getAttribute('data-i')]; if (e) open(e, c);
    });
    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        var c = ev.target.closest && ev.target.closest('.sp-card.tap'); if (!c) return;
        ev.preventDefault();
        var e = EV[+c.getAttribute('data-i')]; if (e) open(e, c);
    });

    if (AG.length) {
        document.getElementById('spChips').addEventListener('click', function (ev) {
            var b = ev.target.closest('.nf-chip'); if (!b) return;
            state.sport = b.getAttribute('data-sp'); renderChips(); render();
        });
        renderChips(); render();
        setInterval(render, 60000);
        loadAgenda();
    } else {
        // sin agenda (solo Tablas / Selecciones / Equipos): sus partidos buscan su canal al mostrarse
        ready = true;
    }

    // Tablas / Selecciones / Equipos (assets/nf/sports.js)
    // pestañas Hoy / Mañana y, si el panel las ofrece, Tablas / Selecciones / Equipos (assets/nf/sports.js)
    if (window.NFSports) sports = NFSports({ extra: <?php echo json_encode(['tables' => $sp_extra['tables'], 'fixtures' => $sp_extra['fixtures'], 'nat' => $sp_extra['nat']]); ?>,
        alias: <?php echo json_encode((object)$sp_alias, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP); ?>, meta: META, prep: prep, card: card,
        day: function (d) { if (state.day !== d) { state.day = d; state.sport = ''; if (AG.length) { renderChips(); render(); } } } });
})();
</script>
<?php include "footer.php"; ?>
