<?php
include "session.php";
$pagename = t('Ajustes');
include "config.php";

/* Equipos favoritos (con perfiles): se guardan en la nube del panel (api/alerts.php, por línea y perfil); el celular y la
   computadora avisan 30 y 10 minutos antes y al empezar. GET = la lista; POST {teams} = reemplazarla. */
if (($_GET['ajax'] ?? '') === 'teams') {
    require_once __DIR__ . '/includes/sports_live.php';
    wp_session_read_close();
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: private, no-store');
    if (!wp_sports_live_allowed()) { echo json_encode(['ok' => false, 'enabled' => false]); exit; }
    $prof = (string)(wp_prof_state()['id'] ?? '');
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        // solo desde esta misma página (un formulario de otro sitio no puede mandar esta cabecera)
        if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'XMLHttpRequest') { http_response_code(403); echo json_encode(['ok' => false]); exit; }
        $in = json_decode((string)file_get_contents('php://input'), true);
        $teams = [];
        foreach (array_slice(is_array($in['teams'] ?? null) ? $in['teams'] : [], 0, 40) as $t) {
            if (!is_array($t) || trim((string)($t['n'] ?? '')) === '') continue;
            $teams[] = ['n' => mb_substr((string)$t['n'], 0, 120), 'l' => mb_substr((string)($t['l'] ?? ''), 0, 120), 'b' => mb_substr((string)($t['b'] ?? ''), 0, 300),
                'lg' => mb_substr((string)($t['lg'] ?? ''), 0, 20), 'sp' => mb_substr((string)($t['sp'] ?? ''), 0, 40)];
        }
        $j = wp_panel_call('alerts.php', ['action' => 'set_teams', 'teams' => $teams, 'profile' => $prof], 12);
    } else {
        $j = wp_panel_call('alerts.php' . ($prof !== '' ? '?profile=' . rawurlencode($prof) : ''), null, 12);
    }
    $on = is_array($j) && !empty($j['success']) && !empty($j['enabled']);
    echo json_encode(['ok' => $on, 'teams' => $on && is_array($j['teams'] ?? null) ? $j['teams'] : []], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
if (isset($_COOKIE["settings_array"])) {
    $SettingArray = json_decode($_COOKIE["settings_array"], true);
    $stream_type = isset($SettingArray["stream_type"]) ? $SettingArray["stream_type"] : "m3u8";
} else {
    $stream_type = "m3u8";
}
$use_vlc = isset($_COOKIE["use_vlc"]) ? $_COOKIE["use_vlc"] : "0";
$epg_source = isset($_COOKIE["epg_source"]) ? $_COOKIE["epg_source"] : "server";
$body_class = 'nf-solid';
// «Deporte preferido» de la fila «En vivo ahora» de Inicio (includes/sports_live.php): solo cuando la fila existe
require_once __DIR__ . '/includes/sports_live.php';
$live_p = wp_sports_live_allowed() ? wp_panel_sports_live() : null;
$live_on = is_array($live_p) && !empty($live_p['enabled']);
$lg_agenda = [];
$live_sports = ['Soccer' => 'Fútbol', 'Basketball' => 'Baloncesto', 'American Football' => 'Fútbol americano', 'Baseball' => 'Béisbol',
    'Ice Hockey' => 'Hockey sobre hielo', 'Tennis' => 'Tenis', 'Motorsport' => 'Automovilismo', 'Fighting' => 'Artes marciales',
    'Boxing' => 'Boxeo', 'Rugby' => 'Rugby', 'Volleyball' => 'Vóleibol', 'Handball' => 'Balonmano', 'Golf' => 'Golf',
    'Cricket' => 'Críquet', 'Esports' => 'Esports'];
// y todas las disciplinas que da el panel (api/sports.php: las de la agenda y todas las encendidas), con su nombre
if ($live_on) {
    $ag = wp_panel_sports();
    foreach ((array)($ag['sports'] ?? []) as $k => $info) {
        if (is_string($k) && $k !== '' && !isset($live_sports[$k])) $live_sports[$k] = (string)(is_array($info) ? ($info['label'] ?? $k) : $k);
    }
    uasort($live_sports, function ($a, $b) { return strcasecmp(t($a), t($b)); });
    // Ligas favoritas: las de la agenda con la hora de cada partido (el navegador cuenta las de hoy en su zona)
    foreach ((array)($ag['events'] ?? []) as $ev) {
        $id = (string)($ev['li'] ?? '');
        if ($id === '' || (string)($ev['lg'] ?? '') === '') continue;
        if (!isset($lg_agenda[$id])) $lg_agenda[$id] = ['id' => $id, 'n' => (string)$ev['lg'], 'b' => (string)($ev['lb'] ?? ''), 'sp' => (string)($ev['sp'] ?? ''), 's' => []];
        $lg_agenda[$id]['s'][] = (int)($ev['s'] ?? 0);
    }
}
include "header.php";

function opt($name, $value, $label, $desc, $current)
{
    $id = $name . '_' . $value;
    return '<label class="st-opt" for="' . $id . '"><input type="radio" id="' . $id . '" name="' . $name . '" value="' . e($value) . '"' . ($current === $value ? ' checked' : '') . '><span class="dot"></span><span><b>' . e(t($label)) . '</b><small>' . e(t($desc)) . '</small></span></label>';
}
?>
<style>
    .st-wrap { max-width: 860px; margin: 0 auto; }
    .st-card { background: #1a1a1a; border-radius: 8px; padding: 22px 24px; margin-bottom: 16px; scroll-margin-top: calc(var(--nf-header, 68px) + 14px); }
    .st-card h3 { margin: 0 0 4px; font-size: 18px; color: #fff; display: flex; align-items: center; gap: 10px; }
    .st-card h3 i { color: var(--nf-red); }
    .ft-list { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .ft-list:empty { display: none; }
    .ft-chip { display: inline-flex; align-items: center; gap: 8px; padding: 6px 8px 6px 6px; border-radius: 999px; background: #262626; border: 1px solid #3a3a3a; color: #fff; font-size: 14px; }
    .ft-chip img, .ft-chip .ph { width: 26px; height: 26px; object-fit: contain; border-radius: 50%; background: #333; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 12px; }
    .ft-chip button { border: 0; background: transparent; color: #aaa; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
    .ft-chip button:hover { color: #fff; }
    .ft-add { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; align-items: center; }
    .ft-note { margin: 14px 0 0 !important; font-size: 13px !important; color: #8c8c8c !important; }
    .st-card > p { margin: 0 0 16px; color: #999; font-size: 14px; }
    .st-opts { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
    .st-opt { display: flex; gap: 12px; align-items: flex-start; padding: 14px; border: 1px solid #333; border-radius: 6px; cursor: pointer; transition: border-color .2s, background .2s; }
    .st-opt:hover { border-color: #666; }
    .st-opt input { position: absolute; opacity: 0; pointer-events: none; }
    .st-opt .dot { width: 20px; height: 20px; border-radius: 50%; border: 2px solid #777; flex-shrink: 0; margin-top: 1px; position: relative; }
    .st-opt input:checked + .dot { border-color: var(--nf-red); }
    .st-opt input:checked + .dot::after { content: ""; position: absolute; inset: 3px; border-radius: 50%; background: var(--nf-red); }
    .st-opt:has(input:checked) { border-color: var(--nf-red); background: rgba(229,9,20,.08); }
    .st-opt b { display: block; color: #fff; font-size: 15px; }
    .st-opt small { color: #999; font-size: 13px; }
    .vlc-downloads { display: flex; gap: 10px; margin-top: 14px; flex-wrap: wrap; }
    .st-select { min-width: 240px; padding: 10px 12px; border-radius: 6px; border: 1px solid #444; background: #111; color: #fff; font: inherit; font-size: 15px; }
    .st-saved { background: #2e7d32; color: #fff; padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; }
</style>
<div class="nf-page settings-wrapper">
    <div class="st-wrap">
        <h1 class="nf-page-title"><?php echo t('Ajustes'); ?></h1>
        <p class="nf-page-sub"><?php echo t('Personaliza la reproducción según tu dispositivo.'); ?></p>
        <?php if (isset($_GET['saved'])): ?><div class="st-saved" id="flash"><?php echo t('Ajustes guardados correctamente.'); ?></div><?php endif; ?>
        <form action="setting/save" method="POST" id="settings-form">
            <div class="st-card">
                <h3><i class="fa fa-play-circle"></i> <?php echo t('Formato de TV en vivo'); ?></h3>
                <p><?php echo t('Si un canal no carga, prueba con el otro formato. El reproductor también cambia solo si uno falla.'); ?></p>
                <div class="st-opts">
                    <?php echo opt('stream_format', 'm3u8', 'HLS (m3u8)', 'Recomendado, compatible con todos los navegadores y celulares', $stream_type); ?>
                    <?php echo opt('stream_format', 'ts', 'MPEG (ts)', 'Menor retraso en PC y Android', $stream_type); ?>
                </div>
            </div>
            <div class="st-card">
                <h3><i class="fa fa-list-alt"></i> <?php echo t('Guía de programas (EPG)'); ?></h3>
                <p><?php echo t('Origen de la guía de programación de los canales.'); ?></p>
                <div class="st-opts">
                    <?php echo opt('epg_source', 'server', 'Servidor primero', 'Guía de tu proveedor; si un canal no tiene, se usa la guía del panel', $epg_source); ?>
                    <?php echo opt('epg_source', 'custom', 'Guía del panel primero', 'Usa primero la guía de respaldo del panel (guías públicas configuradas en el panel)', $epg_source); ?>
                </div>
            </div>
            <div class="st-card">
                <h3><i class="fa fa-mobile"></i> <?php echo t('Reproductor en celulares'); ?></h3>
                <p><?php echo t('Elige si en el celular se reproduce aquí mismo o en la app VLC.'); ?></p>
                <div class="st-opts">
                    <?php echo opt('use_vlc', '0', 'Reproductor web', 'Se reproduce dentro de la página', $use_vlc); ?>
                    <?php echo opt('use_vlc', '1', 'VLC (externo)', 'Abre los videos en la app VLC', $use_vlc); ?>
                </div>
                <div class="vlc-downloads" id="vlc-downloads" style="display: <?php echo ($use_vlc == "1" ? 'flex' : 'none'); ?>;">
                    <a href="https://play.google.com/store/apps/details?id=org.videolan.vlc" target="_blank" rel="noopener" class="nf-btn nf-btn-dark"><i class="fab fa-google-play"></i> <?php echo t('VLC para Android'); ?></a>
                    <a href="https://apps.apple.com/app/vlc-media-player/id650377962" target="_blank" rel="noopener" class="nf-btn nf-btn-dark"><i class="fab fa-apple"></i> <?php echo t('VLC para iPhone'); ?></a>
                </div>
            </div>
            <button name="submit" type="submit" class="nf-btn nf-btn-red submit-btn"><?php echo t('Guardar ajustes'); ?></button>
        </form>
        <?php if ($live_on): ?>
            <div class="st-card" id="live-sport" style="margin-top: 16px;">
                <h3><i class="fa fa-futbol"></i> <label for="liveSport"><?php echo t('Deporte preferido'); ?></label></h3>
                <p><?php echo t('Los partidos en vivo de Inicio muestran solo este deporte.'); ?></p>
                <select id="liveSport" class="st-select" data-key="<?php echo e(wp_sports_live_pref_key()); ?>">
                    <option value=""><?php echo t('Todos los deportes'); ?></option>
                    <?php foreach ($live_sports as $k => $label): ?>
                        <option value="<?php echo e($k); ?>"><?php echo e(t($label)); ?></option>
                    <?php endforeach; ?>
                </select>
                <h3 style="margin-top:20px;"><i class="fa fa-trophy"></i> <?php echo t('Ligas favoritas'); ?></h3>
                <p><?php echo t('«En vivo ahora» de Inicio muestra solo los partidos de las ligas que elijas.'); ?> <b id="lgSum"></b></p>
                <div id="lgList" class="lg-list" style="max-height:320px;overflow-y:auto;padding-right:6px;"></div>
                <?php if (wp_available_platforms()): ?>
                    <label class="st-plat" style="display:flex;align-items:center;gap:10px;margin-top:16px;cursor:pointer;">
                        <input type="checkbox" id="platCards" data-key="<?php echo e(wp_sports_live_plat_key()); ?>" style="width:18px;height:18px;accent-color:var(--nf-red,#e50914);">
                        <span><b><?php echo t('Habilitar tarjetas de plataformas'); ?></b><br><small style="opacity:.7;"><?php echo t('Las plataformas (Netflix, Disney+…) vuelven en Inicio, debajo de «En vivo ahora».'); ?></small></span>
                    </label>
                <?php endif; ?>
        <?php if (wp_sports_live_allowed()): ?>
            <div class="st-card" id="fav-teams" style="margin-top: 16px;">
                <h3><i class="fa fa-star"></i> <?php echo t('Equipos favoritos'); ?></h3>
                <p><?php echo t('Te avisamos 30 y 10 minutos antes de cada partido y cuando empieza.'); ?></p>
                <div class="ft-list" id="ftList"></div>
                <div class="ft-add">
                    <select id="ftSport" class="st-select" aria-label="<?php echo e(t('Deporte')); ?>"><option value=""><?php echo t('Deporte'); ?>…</option></select>
                    <select id="ftLeague" class="st-select" aria-label="<?php echo e(t('Liga')); ?>" disabled><option value=""><?php echo t('Liga'); ?>…</option></select>
                    <select id="ftTeam" class="st-select" aria-label="<?php echo e(t('Equipo')); ?>" disabled><option value=""><?php echo t('Equipo'); ?>…</option></select>
                    <button type="button" id="ftAdd" class="nf-btn nf-btn-red" disabled><i class="fa fa-plus"></i> <?php echo t('Agregar equipo'); ?></button>
                </div>
                <p class="ft-note"><i class="fa fa-mobile-alt"></i> <?php echo t('Se guarda en la nube con tu usuario y perfil. Las notificaciones solo llegan a la app de celular (Android o iOS) y a la de computadora; aquí no se avisa.'); ?></p>
            </div>
        <?php endif; ?>
            </div>
        <?php endif; ?>
    </div>
</div>
<script>
document.addEventListener('DOMContentLoaded', function () {
    Array.prototype.forEach.call(document.querySelectorAll('input[name="use_vlc"]'), function (r) {
        r.addEventListener('change', function () { document.getElementById('vlc-downloads').style.display = this.value === '1' ? 'flex' : 'none'; });
    });
    // por línea y perfil, en este navegador (assets/nf/live.js lo lee en Inicio)
    var pc = document.getElementById('platCards');
    if (pc) {
        try { pc.checked = localStorage.getItem(pc.getAttribute('data-key')) === '1'; } catch (x) {}
        pc.addEventListener('change', function () {
            try { if (pc.checked) localStorage.setItem(pc.getAttribute('data-key'), '1'); else localStorage.removeItem(pc.getAttribute('data-key')); } catch (x) {}
        });
    }
    var ls = document.getElementById('liveSport');
    if (ls) {
        try { ls.value = localStorage.getItem(ls.getAttribute('data-key')) || ''; } catch (x) {}
        ls.addEventListener('change', function () {
            try { if (ls.value) localStorage.setItem(ls.getAttribute('data-key'), ls.value); else localStorage.removeItem(ls.getAttribute('data-key')); } catch (x) {}
            if (window.NF && NF.toast) NF.toast(<?php echo tj('Ajustes guardados correctamente.'); ?>);
        });
    }
    // Ligas favoritas: varias a la vez (las de la agenda y las de los próximos 21 días, las que juegan hoy primero, con
    // su escudo); assets/nf/live.js deja en «En vivo ahora» solo los partidos de esas ligas. Por línea y perfil.
    (function () {
        var box = document.getElementById('lgList'), sum = document.getElementById('lgSum');
        if (!box || !ls) return;
        var KEY = ls.getAttribute('data-key') + '|lg';
        var AG = <?php echo json_encode(array_values($lg_agenda), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG); ?>;
        var SPN = <?php echo json_encode(array_map('t', $live_sports), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG); ?>;
        var T = { all: <?php echo tj('Todas las ligas'); ?>, n: <?php echo tj('{n} ligas'); ?>, today: <?php echo tj('{n} hoy'); ?>, none: <?php echo tj('El panel todavía no tiene ligas para elegir.'); ?> };
        var FX = {}, known = {};
        var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
        function chosen() {
            try { var j = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(j) ? j.filter(function (x) { return x && x.id; }) : []; } catch (x) { return []; }
        }
        function store(l) { try { if (l.length) localStorage.setItem(KEY, JSON.stringify(l)); else localStorage.removeItem(KEY); } catch (x) {} }
        function row(id, n, b, sub, on) {
            return '<label class="lg-row" style="display:flex;align-items:center;gap:10px;margin:8px 0;cursor:pointer;"><input type="checkbox" data-id="' + esc(id) + '"' + (on ? ' checked' : '') +
                ' style="width:18px;height:18px;accent-color:var(--nf-red,#e50914);">' + (b ? '<img src="' + esc(b) + '/tiny" alt="" loading="lazy" style="width:22px;height:22px;object-fit:contain;" onerror="this.remove()">' : '') +
                '<span>' + esc(n) + (sub ? ' <small style="opacity:.7;">· ' + esc(sub) + '</small>' : '') + '</span></label>';
        }
        function draw() {
            var sp = ls.value, sel = chosen(), ids = {}, today = new Date().toDateString(), out = [];
            known = {};
            sel.forEach(function (x) { ids[x.id] = 1; });
            AG.forEach(function (l) {
                var c = 0;
                (l.s || []).forEach(function (t) { if (t && new Date(t * 1000).toDateString() === today) c++; });
                known[l.id] = { id: l.id, n: l.n, b: l.b, sp: l.sp, today: c };
            });
            Object.keys(FX).forEach(function (id) { var l = FX[id]; if (!known[id] && l && l.n) known[id] = { id: id, n: l.n, b: l.b || '', sp: l.sp || '', today: 0 }; });
            sel.forEach(function (l) { if (!known[l.id]) known[l.id] = { id: l.id, n: l.n, b: l.b || '', sp: l.sp || '', today: 0 }; });
            Object.keys(known).forEach(function (k) { if (!sp || known[k].sp === sp) out.push(known[k]); });
            out.sort(function (a, b) { return (b.today > 0) - (a.today > 0) || a.sp.localeCompare(b.sp) || a.n.localeCompare(b.n); });
            sum.textContent = !sel.length ? T.all : sel.length === 1 ? sel[0].n : T.n.replace('{n}', sel.length);
            box.innerHTML = row('', T.all, '', '', !sel.length) + (out.length ? out.map(function (l) {
                var sub = [sp ? '' : (SPN[l.sp] || l.sp), l.today ? T.today.replace('{n}', l.today) : ''].filter(Boolean).join(' · ');
                return row(l.id, l.n, l.b, sub, !!ids[l.id]);
            }).join('') : '<p style="opacity:.7;">' + esc(T.none) + '</p>');
        }
        box.addEventListener('change', function (ev) {
            var id = ev.target.getAttribute('data-id');
            if (id === null) return;
            var sel = chosen();
            if (id === '') sel = [];
            else if (sel.some(function (x) { return x.id === id; })) sel = sel.filter(function (x) { return x.id !== id; });
            else if (known[id]) sel.push({ id: id, n: known[id].n, b: known[id].b, sp: known[id].sp });
            store(sel);
            draw();
            if (window.NF && NF.toast) NF.toast(<?php echo tj('Ajustes guardados correctamente.'); ?>);
        });
        // al elegir un deporte se quitan las ligas de otro
        ls.addEventListener('change', function () { if (ls.value) store(chosen().filter(function (x) { return x.sp === ls.value; })); draw(); });
        draw();
        fetch('sportsschedule.php?ajax=fixtures', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
            .then(function (j) { if (j && j.on && j.leagues) { FX = j.leagues; draw(); } });
    })();
    // Equipos favoritos: deporte → liga (selecciones y clubes) → equipo, de los próximos partidos que el panel ya guarda
    (function () {
        var box = document.getElementById('fav-teams');
        if (!box) return;
        var SP = <?php echo json_encode(array_map('t', $live_sports), JSON_UNESCAPED_UNICODE); ?>;
        var T = { nat: <?php echo tj('Selecciones nacionales'); ?>, clubs: <?php echo tj('Ligas y copas'); ?>, saved: <?php echo tj('Guardado en la nube. Las notificaciones solo llegan a la app de celular (Android o iOS) y a la de computadora.'); ?>,
            fail: <?php echo tj('No se pudo guardar. Inténtalo otra vez.'); ?>, none: <?php echo tj('Todavía no hay próximos partidos. Prueba en unos minutos.'); ?>, remove: <?php echo tj('Quitar'); ?> };
        var sSel = document.getElementById('ftSport'), lSel = document.getElementById('ftLeague'), tSel = document.getElementById('ftTeam'), add = document.getElementById('ftAdd');
        var list = document.getElementById('ftList');
        var fx = null, teams = [], cur = [];
        var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
        function get(u, body) {
            return fetch(u, body ? { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify(body) }
                : { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
        }
        function opts(sel, first, items) {
            sel.innerHTML = '<option value="">' + esc(first) + '…</option>' + items;
            sel.disabled = !items;
        }
        function drawList() {
            list.innerHTML = teams.map(function (t, i) {
                var b = t.b ? '<img src="' + esc(t.b) + '/tiny" alt="" onerror="this.remove()">' : '<span class="ph">' + esc((t.l || t.n).charAt(0)) + '</span>';
                return '<span class="ft-chip">' + b + esc(t.l || t.n) + '<button type="button" data-i="' + i + '" aria-label="' + esc(T.remove) + '">×</button></span>';
            }).join('');
        }
        function save(msg) {
            get('settings.php?ajax=teams', { teams: teams }).then(function (j) {
                if (j && j.ok) { teams = j.teams || teams; drawList(); if (msg && window.NF && NF.toast) NF.toast(T.saved); }
                else if (window.NF && NF.toast) NF.toast(T.fail);
            });
        }
        list.addEventListener('click', function (ev) {
            var b = ev.target.closest('[data-i]'); if (!b) return;
            teams.splice(+b.getAttribute('data-i'), 1); drawList(); save(false);
        });
        function sports() {
            var seen = {}, h = '';
            Object.keys(fx.leagues || {}).forEach(function (id) { var sp = fx.leagues[id].sp || ''; if (sp && !seen[sp]) seen[sp] = 1; });
            Object.keys(seen).sort().forEach(function (sp) { h += '<option value="' + esc(sp) + '">' + esc(SP[sp] || sp) + '</option>'; });
            opts(sSel, <?php echo tj('Deporte'); ?>, h);
            // el «Deporte preferido» elegido abre directo sus ligas
            var pref = document.getElementById('liveSport');
            if (pref && pref.value && seen[pref.value]) { sSel.value = pref.value; leagues(); }
        }
        function leagues() {
            var sp = sSel.value, nat = '', clubs = '';
            opts(tSel, <?php echo tj('Equipo'); ?>, ''); add.disabled = true;
            Object.keys(fx.leagues || {}).forEach(function (id) {
                var l = fx.leagues[id]; if (l.sp !== sp) return;
                var o = '<option value="' + esc(id) + '">' + esc(l.n || id) + '</option>';
                if (l.rg === 'nat') nat += o; else clubs += o;
            });
            var h = (nat ? '<optgroup label="' + esc(T.nat) + '">' + nat + '</optgroup>' : '') + (clubs ? '<optgroup label="' + esc(T.clubs) + '">' + clubs + '</optgroup>' : '');
            opts(lSel, <?php echo tj('Liga'); ?>, sp ? h : '');
        }
        function teamList() {
            var lg = lSel.value, sp = (fx.leagues[lg] || {}).sp || '', m = {};
            (fx.events || []).forEach(function (e) {
                if (e.l !== lg) return;
                if (e.h && !m[e.h]) m[e.h] = { n: e.h, l: e.hn || '', b: e.hb || '', lg: lg, sp: sp };
                if (e.a && !m[e.a]) m[e.a] = { n: e.a, l: e.an || '', b: e.ab || '', lg: lg, sp: sp };
            });
            cur = Object.keys(m).map(function (k) { return m[k]; }).sort(function (x, y) { return (x.l || x.n).localeCompare(y.l || y.n); });
            opts(tSel, <?php echo tj('Equipo'); ?>, cur.map(function (t, i) { return '<option value="' + i + '">' + esc(t.l || t.n) + '</option>'; }).join(''));
            add.disabled = true;
        }
        sSel.addEventListener('change', leagues);
        lSel.addEventListener('change', teamList);
        tSel.addEventListener('change', function () { add.disabled = tSel.value === ''; });
        add.addEventListener('click', function () {
            var t = cur[+tSel.value]; if (!t) return;
            if (!teams.some(function (x) { return x.n === t.n; })) teams.push(t);
            drawList(); save(true);
            tSel.value = ''; add.disabled = true;
        });
        var pref = document.getElementById('liveSport');
        if (pref) pref.addEventListener('change', function () { if (fx && pref.value && Array.prototype.some.call(sSel.options, function (o) { return o.value === pref.value; })) { sSel.value = pref.value; leagues(); } });
        get('settings.php?ajax=teams').then(function (j) { if (j && j.ok) { teams = j.teams || []; drawList(); } });
        get('sportsschedule.php?ajax=fixtures').then(function (j) {
            if (!j || !j.on) { box.hidden = true; return; }
            fx = j;
            if (!(fx.events || []).length) { opts(sSel, T.none, ''); return; }
            sports();
        });
    })();
    var f = document.getElementById('flash');
    if (f) setTimeout(function () { f.style.display = 'none'; }, 3000);
});
</script>
<?php include "footer.php"; ?>
