<?php
include "session.php";
include "config.php";

// Los canales favoritos se guardan en el panel (api/progress.php)
$fav_file = null;

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
    $name = $info['name'] ?? 'Canal';
    $settings = isset($_COOKIE["settings_array"]) ? json_decode($_COOKIE["settings_array"], true) : [];
    $pref = (isset($settings["stream_type"]) && $settings["stream_type"] === 'ts') ? 'ts' : 'm3u8';
    $order = $pref === 'ts' ? ['ts', 'm3u8'] : ['m3u8', 'ts'];
    // Directo del servidor IPTV al navegador (el reproductor pone primero el m3u8 en iPhone/Safari)
    $sources = wp_play_sources('live', $id, $order);
    $http = wp_handoff_url(['kind' => 'live', 'id' => (string)$id, 'exts' => $order, 'vlcExt' => $pref, 'slug' => 'live',
        'title' => $name, 'back' => wp_handoff_abs('tvguide.php?id=' . rawurlencode((string)$id) . '&slug=live')]);
    return [
        'id' => (string)$id,
        'name' => $name,
        'logo' => wp_logo($info['stream_icon'] ?? ''),
        'poster' => (string)($info['stream_icon'] ?? ''),
        'sources' => $sources,
        'http' => $http,
        'direct' => $http === '' || !wp_needs_handoff('live', $id, $sources),
        'vlc' => 'vlc://' . wp_stream_url('live', $id, $pref),
        'stream' => wp_stream_url('live', $id, $pref),
        'vlcPc' => 'playlist.php?' . http_build_query(['id' => (string)$id, 'slug' => 'live', 'ext' => $pref, 'title' => $name]),
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
$use_vlc = isset($_COOKIE["use_vlc"]) ? $_COOKIE["use_vlc"] : "0";

$page_title = 'TV en vivo';
$body_class = 'nf-solid nf-live';
$wp_head_extra = '<link rel="stylesheet" href="assets/nf/player.css?v=5">';
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
    .tv-player { position: relative; aspect-ratio: 16/9; max-height: 62vh; background: #000; border-radius: 8px; overflow: hidden; flex-shrink: 0; }
    .tv-player .ph { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #888; gap: 12px; }
    .tv-player .ph svg { width: 54px; height: 54px; opacity: .5; }
    .tv-info { display: flex; align-items: center; gap: 12px; padding: 0 4px; }
    .tv-info img { width: 64px; height: 42px; object-fit: contain; background: #0d0d0d; border-radius: 4px; }
    .tv-info h2 { margin: 0; font-size: 20px; color: #fff; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
        .tv-wrap { display: flex; flex-direction: column; height: auto; margin-top: var(--nf-header); padding: 0; gap: 0; }
        .tv-main { order: -1; position: sticky; top: var(--nf-header); z-index: 20; background: var(--nf-bg); gap: 0; }
        .tv-player { border-radius: 0; max-height: none; }
        .tv-info { padding: 8px 12px; }
        .tv-info h2 { font-size: 16px; }
        .tv-epg { display: none; }
        .tv-main.has-epg .tv-epg { display: block; max-height: 30vh; border-radius: 0; }
        .tv-cats { display: none; }
        .tv-mcat { display: block; padding: 10px 12px 0; }
        .tv-col { border-radius: 0; background: transparent; }
        .tv-list { overflow: visible; }
    }
</style>

<div class="tv-wrap">
    <aside class="tv-col tv-cats">
        <h3>Categorías</h3>
        <div class="tv-list" id="catList">
            <div class="tv-cat" data-id="favorites">⭐ Favoritos</div>
            <?php foreach ($categories as $c): ?>
                <div class="tv-cat" data-id="<?php echo e($c['category_id']); ?>"><?php echo e($c['category_name']); ?></div>
            <?php endforeach; ?>
        </div>
    </aside>

    <section class="tv-col">
        <div class="tv-mcat">
            <select class="nf-select" id="catSel" style="width:100%">
                <option value="favorites">⭐ Favoritos</option>
                <?php foreach ($categories as $c): ?>
                    <option value="<?php echo e($c['category_id']); ?>"><?php echo e($c['category_name']); ?></option>
                <?php endforeach; ?>
            </select>
        </div>
        <h3>Canales <span id="chCount" style="font-size:12px;color:#888;font-weight:400"></span></h3>
        <div class="tv-filter"><input type="search" id="chFilter" placeholder="Buscar canal..."></div>
        <div class="tv-list" id="channel-list"><div class="tv-empty">Cargando canales...</div></div>
    </section>

    <section class="tv-main" id="tvMain">
        <div class="tv-player" id="tvPlayer">
            <div class="ph"><?php echo wp_icon('tv'); ?><span>Selecciona un canal para comenzar a ver</span></div>
        </div>
        <div class="tv-info" id="tvInfo" style="display:none">
            <img id="tvLogo" src="" alt="" onerror="this.onerror=null;this.src='assets/img/Logo.png'">
            <h2 id="tvName"></h2>
            <button type="button" class="nf-btn-circle" id="toggleLiveFav" title="Favorito"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 17.3 18.2 21l-1.6-7L22 9.2l-7.2-.6L12 2 9.2 8.6 2 9.2 7.4 14l-1.6 7z"/></svg></button>
        </div>
        <div class="tv-col tv-epg">
            <h3>Guía de programas</h3>
            <div class="tv-list" id="epg-list"><div class="tv-empty">Selecciona un canal para ver su guía.</div></div>
        </div>
    </section>
</div>

<script src="assets/vendor/hls.min.js" defer></script>
<script src="assets/vendor/mpegts.min.js" defer></script>
<script src="assets/nf/player.js?v=10" defer></script>
<script>
document.addEventListener('DOMContentLoaded', function () {
    var state = { cat: <?php echo json_encode($selectedCategoryId); ?>, ch: null, player: null, channels: [] };
    var initial = <?php echo json_encode($initial, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG); ?>;
    var useVLC = <?php echo json_encode($use_vlc === '1'); ?>;
    var isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    var list = document.getElementById('channel-list'), filter = document.getElementById('chFilter');

    function hm(ts) { return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

    function renderChannels() {
        var q = filter.value.trim().toLowerCase();
        var items = state.channels.filter(function (c) { return !q || c.n.toLowerCase().indexOf(q) > -1; });
        document.getElementById('chCount').textContent = items.length ? '(' + items.length + ')' : '';
        if (!items.length) { list.innerHTML = '<div class="tv-empty">' + (state.cat === 'favorites' ? 'Aún no tienes canales favoritos.' : 'No hay canales en esta sección.') + '</div>'; return; }
        list.innerHTML = items.map(function (c) {
            return '<div class="tv-ch' + (state.ch === c.id ? ' active' : '') + '" data-id="' + NF.esc(c.id) + '"><img src="' + NF.esc(c.i) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'assets/img/Logo.png\'"><span>' + NF.esc(c.n) + '</span></div>';
        }).join('');
    }

    function loadChannels(cat) {
        state.cat = cat;
        Array.prototype.forEach.call(document.querySelectorAll('.tv-cat'), function (x) { x.classList.toggle('active', x.getAttribute('data-id') === cat); });
        document.getElementById('catSel').value = cat;
        list.innerHTML = '<div class="tv-empty">Cargando canales...</div>';
        fetch('tvguide.php?ajax=channels&category_id=' + encodeURIComponent(cat), { credentials: 'same-origin' })
            .then(function (r) { return r.json(); })
            .then(function (d) { state.channels = d || []; renderChannels(); })
            .catch(function () { list.innerHTML = '<div class="tv-empty">No se pudieron cargar los canales.</div>'; });
    }

    function renderEpg(epg) {
        var box = document.getElementById('epg-list'), now = Date.now() / 1000;
        document.getElementById('tvMain').classList.toggle('has-epg', !!(epg && epg.length));
        if (!epg || !epg.length) { box.innerHTML = '<div class="tv-empty">No hay información de la guía de programas para este canal.</div>'; return; }
        box.innerHTML = epg.map(function (p) {
            var on = p.s <= now && p.e > now, pct = on ? Math.round((now - p.s) / (p.e - p.s) * 100) : 0;
            return '<div class="tv-prog' + (on ? ' now' : '') + '"><div class="h">' + hm(p.s) + ' - ' + hm(p.e) + '</div><div style="flex:1"><div class="t">' + NF.esc(p.t) + '</div>' + (on ? '<div class="bar"><i style="width:' + pct + '%"></i></div>' : '') + '</div></div>';
        }).join('');
    }

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
                + '<a class="nf-btn nf-btn-red" href="' + data.http.replace(/"/g, '&quot;') + '">&#9654; Ver ' + NF.esc(data.name) + '</a></div>';
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
                if (push) history.replaceState(null, '', 'tvguide.php?id=' + encodeURIComponent(id) + '&slug=live&category_id=' + encodeURIComponent(state.cat));
            })
            .catch(function () { NF.toast('No se pudo abrir el canal'); });
    }

    document.getElementById('catList').addEventListener('click', function (e) { var c = e.target.closest('.tv-cat'); if (c) loadChannels(c.getAttribute('data-id')); });
    document.getElementById('catSel').addEventListener('change', function () { loadChannels(this.value); });
    list.addEventListener('click', function (e) { var c = e.target.closest('.tv-ch'); if (c) { openChannel(c.getAttribute('data-id'), true); if (window.innerWidth < 900) window.scrollTo({ top: 0, behavior: 'smooth' }); } });
    filter.addEventListener('input', renderChannels);

    loadChannels(state.cat || 'favorites');
    if (initial) play(initial);
});
</script>
</main>
</body>
</html>
