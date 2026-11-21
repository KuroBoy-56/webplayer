<?php
include "session.php";
include "config.php";

// Los canales favoritos se guardan en el panel (api/progress.php)
$fav_file = null;
// perfil infantil sin categorías de niños en la lista: no hay TV en vivo (con alguna, solo esas: includes/kids.php)
if (wp_kids_on() && !wp_kids_has_live() && !isset($_GET['ajax'])) {
    header('Location: homex.php');
    exit;
}

function tv_fav_channels($username, $fav_file)
{
    $channels = [];
    foreach (wp_user_favorites('live') as $f) {
        $channels[] = ['stream_id' => (string)$f['stream_id'], 'name' => $f['title'], 'stream_icon' => $f['poster_url']];
    }
    return $channels;
}

function tv_channels($category_id, $username, $fav_file)
{
    if ($category_id === 'favorites') return tv_fav_channels($username, $fav_file);
    $list = xt_get('get_live_streams', ['category_id' => $category_id], 1800);
    return is_array($list) ? $list : [];
}

function tv_decode($t)
{
    $t = (string)$t;
    $c = preg_replace('/\s+/', '', $t);
    if ($c === '' || !preg_match('~^[A-Za-z0-9+/]+={0,2}$~', $c) || strlen($c) % 4 === 1) return $t;
    $d = base64_decode($c, true);
    // texto en base64 (lo normal en Xtream); si no decodifica a texto legible, se deja tal cual
    if ($d === false || !mb_check_encoding($d, 'UTF-8') || preg_match('/[\x00-\x08\x0E-\x1F\x7F]/', $d)) return $t;
    return trim($d);
}

function tv_ts($v)
{
    if (is_numeric($v)) return $v > 10000000000 ? (int)($v / 1000) : (int)$v;
    $t = strtotime((string)$v);
    return $t ?: 0;
}

/** Guía de programas: la del servidor IPTV y, si no tiene, la guía pública de respaldo. Devuelve [ ['s','e','t','d'], ... ] */
function tv_epg($id, $name)
{
    require_once __DIR__ . '/includes/epg.php';
    $prefer_alt = ($_COOKIE['epg_source'] ?? 'server') === 'custom';
    $server = function () use ($id) {
        $out = [];
        $epg = xt_get('get_short_epg', ['stream_id' => $id, 'limit' => 12], 600, 8);
        foreach (($epg['epg_listings'] ?? []) as $p) {
            $s = isset($p['start_timestamp']) ? (int)$p['start_timestamp'] : tv_ts($p['start'] ?? 0);
            $e = isset($p['stop_timestamp']) ? (int)$p['stop_timestamp'] : tv_ts($p['end'] ?? ($p['stop'] ?? 0));
            if ($e > time() - 1800) $out[] = ['s' => $s, 'e' => $e, 't' => tv_decode($p['title'] ?? ''), 'd' => tv_decode($p['description'] ?? '')];
        }
        return $out;
    };
    $out = $prefer_alt ? wp_epg_for($id, $name) : $server();
    if (!$out) $out = $prefer_alt ? $server() : wp_epg_for($id, $name);
    usort($out, function ($a, $b) { return $a['s'] - $b['s']; });
    return array_slice($out, 0, 15);
}

function tv_channel_data($id, $username, $fav_file)
{
    $info = null;
    $all = xt_get('get_live_streams', [], 1800, 25);
    if (is_array($all)) {
        foreach ($all as $c) {
            if (is_array($c) && (string)($c['stream_id'] ?? '') === (string)$id) { $info = $c; break; }
        }
    }
    $name = $info['name'] ?? t('Canal');
    $settings = isset($_COOKIE["settings_array"]) ? json_decode($_COOKIE["settings_array"], true) : [];
    $pref = (isset($settings["stream_type"]) && $settings["stream_type"] === 'ts') ? 'ts' : 'm3u8';
    $order = $pref === 'ts' ? ['ts', 'm3u8'] : ['m3u8', 'ts'];
    // Directo del servidor IPTV al navegador (el reproductor pone primero el m3u8 en iPhone/Safari)
    $http = wp_handoff_url(['kind' => 'live', 'id' => (string)$id, 'exts' => $order, 'vlcExt' => $pref, 'slug' => 'live',
        'title' => $name, 'back' => wp_handoff_abs('tvguide.php?id=' . rawurlencode((string)$id) . '&slug=live')]);
    // web https con canal http: la VPS / VDS de la línea o "Ver canal" por http (nunca el hosting, 2.9.1)
    $sources = wp_play_sources('live', $id, $order);
    return [
        'id' => (string)$id,
        'name' => $name,
        'logo' => wp_logo($info['stream_icon'] ?? ''),
        'poster' => (string)($info['stream_icon'] ?? ''),
        'sources' => $sources,
        'http' => $http,
        'direct' => $http === '' || !wp_needs_handoff('live', $id, $sources),
        // DEMO: sin VLC (el enlace lleva el usuario y la contraseña de la línea)
        'vlc' => wp_is_demo() ? '' : 'vlc://' . wp_stream_url('live', $id, $pref),
        'stream' => wp_is_demo() ? '' : wp_stream_url('live', $id, $pref),
        'vlcPc' => wp_is_demo() ? '' : 'playlist.php?' . http_build_query(['id' => (string)$id, 'slug' => 'live', 'ext' => $pref, 'title' => $name]),
        'diag' => 'diag.php?slug=live&id=' . rawurlencode((string)$id),
        'fav' => wp_is_favorite('live', $id),
        'epg' => tv_epg($id, $name),
    ];
}

/* ---------- Peticiones AJAX ---------- */
if (isset($_GET['ajax'])) {
    header('Content-Type: application/json; charset=utf-8');
    if ($_GET['ajax'] === 'channels') {
        $out = [];
        foreach (tv_channels((string)($_GET['category_id'] ?? ''), $username, $fav_file) as $c) {
            if (!is_array($c)) continue;
            $out[] = ['id' => (string)$c['stream_id'], 'n' => (string)$c['name'], 'i' => wp_logo($c['stream_icon'] ?? '')];
        }
        echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    } elseif ($_GET['ajax'] === 'channel') {
        echo json_encode(tv_channel_data(preg_replace('/[^0-9]/', '', (string)($_GET['id'] ?? '')), $username, $fav_file), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }
    exit;
}

/* compatibilidad: ?category_id=X devolvía el HTML de canales */
if (isset($_GET['category_id']) && !isset($_GET['slug']) && isset($_SERVER['HTTP_X_REQUESTED_WITH'])) {
    foreach (tv_channels((string)$_GET['category_id'], $username, $fav_file) as $c) {
        echo "<div class='channel-item' data-id='" . e($c['stream_id']) . "'><img src='" . e(wp_logo($c['stream_icon'] ?? '')) . "' alt=''><p>" . e($c['name']) . "</p></div>";
    }
    exit;
}

$id = isset($_GET["id"]) ? preg_replace('/[^0-9]/', '', (string)$_GET["id"]) : '';
$selectedCategoryId = isset($_GET['category_id']) ? (string)$_GET['category_id'] : '';
$categories = wp_categories('live');
if ($selectedCategoryId === '' && !$id) $selectedCategoryId = tv_fav_channels($username, $fav_file) ? 'favorites' : (string)($categories[0]['category_id'] ?? '');
$initial = $id ? tv_channel_data($id, $username, $fav_file) : null;
$use_vlc = (isset($_COOKIE["use_vlc"]) && !wp_is_demo()) ? $_COOKIE["use_vlc"] : "0";

$page_title = t('TV en vivo');
$body_class = 'nf-solid nf-live';
$wp_head_extra = '<link rel="stylesheet" href="assets/nf/player.css?v=9">';
include "header.php";
?>
<style>
    .tv-wrap { display: grid; grid-template-columns: 230px 330px 1fr; gap: 14px; height: calc(100vh - var(--nf-header) - 16px); margin-top: calc(var(--nf-header) + 8px); padding: 0 14px 0 var(--nf-pad); }
    .tv-col { background: #1a1a1a; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; min-height: 0; }
    .tv-col h3 { margin: 0; padding: 14px 16px 10px; font-size: 16px; color: #fff; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .tv-list { overflow-y: auto; flex: 1; padding: 0 8px 10px; overscroll-behavior: contain; }
    .tv-cat { padding: 10px 12px; border-radius: 4px; cursor: pointer; font-size: 14px; color: #ccc; transition: background .15s; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tv-cat:hover { background: #2a2a2a; color: #fff; }
    .tv-cat.active { background: var(--nf-red); color: #fff; font-weight: 700; }
    .tv-filter { margin: 0 12px 10px; }
    .tv-filter input { width: 100%; background: #0f0f0f; border: 1px solid #333; color: #fff; padding: 8px 12px; border-radius: 4px; outline: 0; font-size: 14px; }
    .tv-filter input:focus { border-color: #fff; }
    .tv-ch { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 4px; cursor: pointer; transition: background .15s; }
    .tv-ch:hover { background: #2a2a2a; }
    .tv-ch.active { background: #333; box-shadow: inset 3px 0 0 var(--nf-red); }
    .tv-ch img { width: 54px; height: 36px; object-fit: contain; background: #0d0d0d; border-radius: 3px; flex-shrink: 0; }
    .tv-ch span { font-size: 14px; color: #eee; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tv-main { display: flex; flex-direction: column; gap: 14px; min-height: 0; }
    /* vista previa en 16:9 y más chica (46 % del alto de la pantalla, antes hasta 62 %): deja lugar a la guía de programas */
    .tv-player { position: relative; aspect-ratio: 16/9; width: min(100%, calc(46vh * 16 / 9)); align-self: center; background: #000; border-radius: 8px; overflow: hidden; flex-shrink: 0; }
    .tv-player .ph { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #888; gap: 12px; }
    .tv-player .ph svg { width: 54px; height: 54px; opacity: .5; }
    .tv-info { display: flex; align-items: center; gap: 12px; padding: 0 4px; }
    .tv-info img { width: 64px; height: 42px; object-fit: contain; background: #0d0d0d; border-radius: 4px; }
    .tv-info h2 { margin: 0; font-size: 20px; color: #fff; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tv-ttl { flex: 1; min-width: 0; }
    .tv-now { display: none; font-size: 13px; color: #ccc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
    .tv-now b { color: var(--nf-red); font-weight: 600; margin-right: 6px; font-variant-numeric: tabular-nums; }
    .tv-epg { flex: 1; min-height: 120px; }
    .tv-prog { display: flex; gap: 14px; padding: 10px 12px; border-bottom: 1px solid #262626; font-size: 14px; }
    .tv-prog .h { color: #999; width: 98px; flex-shrink: 0; font-variant-numeric: tabular-nums; }
    .tv-prog .t { color: #ddd; }
    .tv-prog.now { background: rgba(229,9,20,.12); }
    .tv-prog.now .t { color: #fff; font-weight: 700; }
    .tv-prog.now .h { color: var(--nf-red); }
    .tv-prog .bar { height: 3px; background: #444; margin-top: 6px; border-radius: 2px; overflow: hidden; }
    .tv-prog .bar i { display: block; height: 100%; background: var(--nf-red); }
    .tv-empty { color: #888; padding: 16px; text-align: center; font-size: 14px; }
    .tv-mcat { display: none; }
    @media (max-width: 1100px) { .tv-wrap { grid-template-columns: 190px 270px 1fr; } }
    @media (max-width: 899px) {
        .nf-live .nf-mobile-pills { display: none; }
        /* Teléfono, como una app: la página no se desplaza. Arriba quedan fijos el reproductor (16:9) y el canal; abajo,
           una sola zona que se desplaza con el dedo: la guía y, debajo, la carpeta y los canales. Al subir por los
           canales la guía se va hacia arriba con el propio desplazamiento del teléfono (nada cambia de alto, no hay
           saltos ni parpadeos), la carpeta queda fija arriba de la lista y bajo el nombre del canal aparece lo que se
           transmite ahora; al volver al principio la guía baja otra vez. La zona queda fija entre la barra de arriba y
           la de abajo (las dos son fijas), así calza con cualquier barra de Safari. */
        .nf-live .nf-main { min-height: 0; }
        .tv-wrap { position: fixed; top: var(--nf-header); left: 0; right: 0; bottom: calc(var(--nf-tabbar) + env(safe-area-inset-bottom));
            height: auto; margin: 0; display: flex; flex-direction: column; padding: 0; gap: 0; overflow: hidden; }
        .tv-main { order: -1; flex: none; background: var(--nf-bg); gap: 0; }
        /* siempre 16:9 (el reproductor pide height: 100%, que aquí lo estiraría); en horizontal como mucho media pantalla */
        .tv-main .tv-player { width: 100%; height: auto; border-radius: 0; max-height: 50vh; max-height: 50dvh; }
        /* pantalla completa propia del iPhone: toda la pantalla y por encima de las barras */
        .tv-main .tv-player.nfp-fakefs { max-height: none; }
        .tv-wrap:has(.nfp-fakefs) { z-index: 100000; }
        .tv-info { padding: 8px 12px; }
        .tv-info h2 { font-size: 16px; }
        .tv-cats { display: none; }
        .tv-col { border-radius: 0; background: transparent; }
        .tv-list { overflow: visible; }
        .tv-chcol { display: block; position: relative; flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto;
            -webkit-overflow-scrolling: touch; overscroll-behavior: contain; }
        /* la guía (dentro de la zona que se desplaza): el programa de ahora y los 2 siguientes */
        .tv-epg { display: none; min-height: 0; }
        .tv-wrap.has-epg .tv-epg { display: flex; }
        .tv-chcol .tv-prog.past, .tv-chcol .tv-prog.later { display: none; }
        /* la carpeta queda fija arriba de la lista */
        .tv-mcat { display: block; position: sticky; top: 0; z-index: 3; background: var(--nf-bg); padding: 10px 12px 8px; }
        /* lo que se transmite ahora, bajo el nombre del canal cuando la guía ya no se ve: solo se desvanece y se desliza
           (nada cambia de alto) */
        .tv-ttl { position: relative; }
        .tv-info h2 { transition: transform .3s cubic-bezier(.2, .8, .2, 1); }
        .tv-now { display: block; position: absolute; left: 0; right: 0; top: 100%; margin: 0; opacity: 0; transform: translateY(4px);
            pointer-events: none; transition: opacity .25s ease, transform .3s cubic-bezier(.2, .8, .2, 1); }
        .tv-wrap.compact.has-now .tv-info h2 { transform: translateY(-9px); }
        .tv-wrap.compact.has-now .tv-now { opacity: 1; transform: translateY(-9px); }
    }
    @media (max-width: 899px) and (prefers-reduced-motion: reduce) {
        .tv-info h2, .tv-now { transition: none; }
    }
</style>

<div class="tv-wrap">
    <aside class="tv-col tv-cats">
        <h3><?php echo t('Categorías'); ?></h3>
        <div class="tv-list" id="catList">
            <div class="tv-cat" data-id="favorites">⭐ <?php echo t('Favoritos'); ?></div>
            <?php foreach ($categories as $c): ?>
                <div class="tv-cat" data-id="<?php echo e($c['category_id']); ?>"><?php echo e($c['category_name']); ?></div>
            <?php endforeach; ?>
        </div>
    </aside>

    <section class="tv-col tv-chcol">
        <div class="tv-mcat">
            <select class="nf-select" id="catSel" style="width:100%">
                <option value="favorites">⭐ <?php echo t('Favoritos'); ?></option>
                <?php foreach ($categories as $c): ?>
                    <option value="<?php echo e($c['category_id']); ?>"><?php echo e($c['category_name']); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <h3><?php echo t('Canales'); ?> <span id="chCount" style="font-size:12px;color:#888;font-weight:400"></span></h3>
        <div class="tv-filter"><input type="search" id="chFilter" placeholder="<?php echo e(t('Buscar canal...')); ?>"></div>
        <div class="tv-list" id="channel-list"><div class="tv-empty"><?php echo t('Cargando canales...'); ?></div></div>
    </section>

    <section class="tv-main" id="tvMain">
        <div class="tv-player" id="tvPlayer">
            <div class="ph"><?php echo wp_icon('tv'); ?><span><?php echo t('Selecciona un canal para comenzar a ver'); ?></span></div>
        </div>
        <div class="tv-info" id="tvInfo" style="display:none">
            <img id="tvLogo" src="" alt="" onerror="this.onerror=null;this.src=<?php echo e(json_encode(wp_channel_fallback(), JSON_UNESCAPED_SLASHES)); ?>">
            <div class="tv-ttl"><h2 id="tvName"></h2><div class="tv-now" id="tvNow"></div></div>
            <button type="button" class="nf-btn-circle" id="toggleLiveFav" title="<?php echo e(t('Favorito')); ?>"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.4 14l-1.6 7z"/></svg></button>
        </div>
        <div class="tv-col tv-epg">
            <h3><?php echo t('Guía de programas'); ?></h3>
            <div class="tv-list" id="epg-list"><div class="tv-empty"><?php echo t('Selecciona un canal para ver su guía.'); ?></div></div>
        </div>
    </section>
</div>

<script src="assets/vendor/hls.min.js" defer></script>
<script src="assets/vendor/mpegts.min.js" defer></script>
<script src="assets/nf/player.js?v=33" defer></script>
<script>
// imagen de un canal sin logo: la de la marca (el logo del dueño solo con Omitir)
var CH_FB = <?php echo json_encode(wp_channel_fallback(), JSON_UNESCAPED_SLASHES); ?>;
document.addEventListener('DOMContentLoaded', function () {
    var state = { cat: <?php echo json_encode($selectedCategoryId); ?>, ch: null, player: null, channels: [] };
    var initial = <?php echo json_encode($initial, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG); ?>;
    var useVLC = <?php echo json_encode($use_vlc === '1'); ?>;
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    var list = document.getElementById('channel-list'), filter = document.getElementById('chFilter');

    function hm(ts) { return new Date(ts * 1000).toLocaleTimeString(window.NF_LOCALE, { hour: '2-digit', minute: '2-digit' }); }

    function renderChannels() {
        var q = filter.value.trim().toLowerCase();
        var items = state.channels.filter(function (c) { return !q || c.n.toLowerCase().indexOf(q) > -1; });
        document.getElementById('chCount').textContent = items.length ? '(' + items.length + ')' : '';
        if (!items.length) { list.innerHTML = '<div class="tv-empty">' + (state.cat === 'favorites' ? <?php echo tj('Aún no tienes canales favoritos.'); ?> : <?php echo tj('No hay canales en esta sección.'); ?>) + '</div>'; return; }
        list.innerHTML = items.map(function (c) {
            return '<div class="tv-ch' + (state.ch === c.id ? ' active' : '') + '" data-id="' + NF.esc(c.id) + '"><img src="' + NF.esc(c.i) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=CH_FB"><span>' + NF.esc(c.n) + '</span></div>';
        }).join('');
    }

    function loadChannels(cat) {
        state.cat = cat;
        Array.prototype.forEach.call(document.querySelectorAll('.tv-cat'), function (x) { x.classList.toggle('active', x.getAttribute('data-id') === cat); });
        document.getElementById('catSel').value = cat;
        // teléfono: si la guía ya no se veía, la carpeta nueva empieza en su primer canal con la guía arriba, fuera de la
        // vista; mientras carga la lista guarda su alto (así nada salta)
        var top = phone() ? epgEl.offsetHeight : 0, keep = phone() && chCol.scrollTop >= top;
        if (phone()) list.style.minHeight = list.offsetHeight + 'px';
        var done = function () {
            list.style.minHeight = '';
            if (keep) chCol.scrollTop = top;
            onListScroll();
        };
        list.innerHTML = '<div class="tv-empty">' + <?php echo tj('Cargando canales...'); ?> + '</div>';
        fetch('tvguide.php?ajax=channels&category_id=' + encodeURIComponent(cat), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) { state.channels = d || []; renderChannels(); done(); })
            .catch(function () { list.innerHTML = '<div class="tv-empty">' + <?php echo tj('No se pudieron cargar los canales.'); ?> + '</div>'; done(); });
    }

    function renderEpg(epg) {
        var box = document.getElementById('epg-list'), now = Date.now() / 1000;
        // teléfono con la guía arriba, fuera de la vista: la lista queda en el mismo lugar aunque la guía cambie de alto
        var before = epgEl.offsetHeight, y = chCol.scrollTop;
        wrap.classList.toggle('has-epg', !!(epg && epg.length));
        var cur = (epg || []).filter(function (p) { return p.s <= now && p.e > now; })[0];
        wrap.classList.toggle('has-now', !!cur);
        // bajo el nombre del canal (teléfono, cuando la guía ya no se ve): solo lo que se transmite ahora, en una línea
        document.getElementById('tvNow').innerHTML = cur ? '<b>' + hm(cur.s) + ' - ' + hm(cur.e) + '</b>' + NF.esc(cur.t) : '';
        if (!epg || !epg.length) box.innerHTML = '<div class="tv-empty">' + <?php echo tj('No hay información de la guía de programas para este canal.'); ?> + '</div>';
        else {
            var next = 0;
            box.innerHTML = epg.map(function (p) {
                var on = p.s <= now && p.e > now, pct = on ? Math.round((now - p.s) / (p.e - p.s) * 100) : 0;
                // en el teléfono la guía muestra el programa de ahora y los 2 siguientes (past / later quedan ocultos)
                var cls = p.e <= now ? ' past' : (++next > 3 ? ' later' : '');
                return '<div class="tv-prog' + (on ? ' now' : '') + cls + '"><div class="h">' + hm(p.s) + ' - ' + hm(p.e) + '</div><div style="flex:1"><div class="t">' + NF.esc(p.t) + '</div>' + (on ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '</div></div>';
            }).join('');
        }
        if (phone() && y > 0) chCol.scrollTop = Math.max(0, y + epgEl.offsetHeight - before);
        onListScroll();
    }

    /* Teléfono: la guía va dentro de la zona que se desplaza, arriba de la carpeta y los canales (en la computadora
       vuelve a su columna). Cuando el programa de ahora sube fuera de la vista, aparece bajo el nombre del canal. */
    var wrap = document.querySelector('.tv-wrap'), tvMain = document.getElementById('tvMain'), chCol = document.querySelector('.tv-chcol');
    var epgEl = document.querySelector('.tv-epg'), compact = false, ticking = false;
    var mq = window.matchMedia('(max-width: 899px)');
    var phone = function () { return mq.matches; };
    function setCompact(on) {
        if (compact === on) return;
        compact = on;
        wrap.classList.toggle('compact', on);
    }
    function onListScroll() {
        ticking = false;
        var r = phone() && epgEl.offsetHeight ? epgEl.querySelector('.tv-prog.now') : null;
        setCompact(!!r && chCol.scrollTop >= r.offsetTop + r.offsetHeight - 6);
    }
    function placeEpg() {
        if (phone()) { if (epgEl.parentNode !== chCol) chCol.insertBefore(epgEl, chCol.firstChild); }
        else if (epgEl.parentNode !== tvMain) tvMain.appendChild(epgEl);
        onListScroll();
    }
    placeEpg();
    if (mq.addEventListener) mq.addEventListener('change', placeEpg); else if (mq.addListener) mq.addListener(placeEpg);
    chCol.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onListScroll); } }, { passive: true });

    function play(data) {
        state.ch = data.id;
        renderChannels();
        document.getElementById('tvInfo').style.display = '';
        document.getElementById('tvName').textContent = data.name;
        document.getElementById('tvLogo').src = data.logo;
        var fav = document.getElementById('toggleLiveFav');
        fav.classList.toggle('on', !!data.fav);
        fav.onclick = function () {
            NF.fav(fav, { id: data.id, type: 'live', title: data.name, poster: data.poster });
            if (state.cat === 'favorites') setTimeout(function () { loadChannels('favorites'); }, 400);
        };
        renderEpg(data.epg);
        if (isMobile && useVLC) { NFPlayer.openVlc({ live: true, vlcUrl: data.vlc, streamUrl: data.stream, vlcPc: data.vlcPc }); return; }
        var box = document.getElementById('tvPlayer');
        if (state.player) state.player.destroy();
        state.player = null;
        if (!data.direct && data.http) {
            // página https y canal por http: se abre el reproductor directo por http (no pasa por el hosting)
            box.innerHTML = '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:#000">'
                + '<a class="nf-btn nf-btn-red" href="' + data.http.replace(/"/g, '&quot;') + '">&#9654; ' + NF.esc(<?php echo tj('Ver {n}'); ?>.replace('{n}', data.name)) + '</a></div>';
            return;
        }
        box.innerHTML = '';
        state.player = new NFPlayer(box, { live: true, title: data.name, sources: data.sources, vlcUrl: data.vlc, streamUrl: data.stream, vlcPc: data.vlcPc, diagUrl: data.diag, fallbackUrl: data.http });
    }

    function openChannel(id, push) {
        fetch('tvguide.php?ajax=channel&id=' + encodeURIComponent(id), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                play(d);
                if (push) history.replaceState(null, '', location.pathname + '?_r=1&id=' + encodeURIComponent(id) + '&slug=live&category_id=' + encodeURIComponent(state.cat));
            })
            .catch(function () { NF.toast(<?php echo tj('No se pudo abrir el canal'); ?>); });
    }

    document.getElementById('catList').addEventListener('click', function (e) { var c = e.target.closest('.tv-cat'); if (c) loadChannels(c.getAttribute('data-id')); });
    document.getElementById('catSel').addEventListener('change', function () {
        loadChannels(this.value);
    });
    // el reproductor siempre está a la vista (también en el teléfono): la lista se queda donde estaba
    list.addEventListener('click', function (e) { var c = e.target.closest('.tv-ch'); if (c) openChannel(c.getAttribute('data-id'), true); });
    filter.addEventListener('input', renderChannels);

    loadChannels(state.cat || 'favorites');
    if (initial) play(initial);
});
</script>
</main>
</body>
</html>
