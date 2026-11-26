/*
 * «En vivo ahora» de Inicio (homex.php, includes/sports_live.php), como Android y la app de computadora: hasta 20
 * partidos (los que se juegan con marcador y minuto, después los próximos con su hora) y al final «Ir a Deportes»; la cancha del deporte de fondo (y el color del torneo si es uno grande) y el
 * canal exacto de la lista del cliente. Se pregunta cada ttl (30 s) solo con la pestaña visible. Al pulsar, el menú de
 * canales (solo los del cliente, y buscar); Atrás desde el reproductor vuelve con el foco en el mismo partido.
 * Configuración: window.NF_LIVE = {key: clave de «Deporte preferido», T: textos}.
 */
(function () {
    'use strict';
    var C = window.NF_LIVE;
    var box = document.getElementById('nfLive');
    if (!C || !box) return;
    var plat = document.getElementById('nfPlatWrap');
    var slider = box.querySelector('.nf-live-slider');
    var T = C.T, CH = {}, cards = [], timer = 0, shown = false;
    var LAST = 'nf_live_last';

    var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var fill = function (s, p) { for (var k in p) s = s.split('{' + k + '}').join(p[k]); return s; };
    function pref() { try { return localStorage.getItem(C.key) || ''; } catch (x) { return ''; } }
    // Ajustes › Habilitar tarjetas de plataformas: con la fila en vivo, las plataformas quedan debajo
    function platCards() { try { return !!C.platKey && localStorage.getItem(C.platKey) === '1'; } catch (x) { return false; } }
    function hour(s) { return s ? new Intl.DateTimeFormat(window.NF_LOCALE || undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(s * 1000)) : ''; }
    function score(v) { v = v == null ? '' : String(v).trim(); return v === '' ? '0' : v; }

    /* «67'», «Descanso», «Q3 5:21»: lo que dice TheSportsDB del momento del partido */
    function clock(e) {
        if (e.soon) return T.starts + ' ' + hour(e.s);
        var st = String(e.st || '').trim(), pr = String(e.pr || '').trim();
        if (st.toUpperCase() === 'HT' || pr.toUpperCase() === 'HT') return T.ht;
        if (/^\d+$/.test(pr)) return pr + "'";
        return pr || st || T.live;
    }

    /* torneos grandes: un degradado con sus colores encima de la cancha */
    function theme(league) {
        var l = String(league || '').toLowerCase();
        if (l.indexOf('champions league') >= 0 && l.indexOf('afc') < 0 && l.indexOf('caf') < 0) return 'linear-gradient(135deg,rgba(10,26,107,.7),rgba(27,63,176,.55),rgba(10,26,107,.4))';
        if (l.indexOf('europa league') >= 0 || l.indexOf('conference league') >= 0) return 'linear-gradient(135deg,rgba(242,107,29,.6),rgba(0,0,0,.4))';
        if (l.indexOf('libertadores') >= 0) return 'linear-gradient(135deg,rgba(201,162,39,.6),rgba(59,42,0,.5))';
        if (l.indexOf('sudamericana') >= 0) return 'linear-gradient(135deg,rgba(0,82,159,.6),rgba(201,162,39,.4))';
        if (l.indexOf('world cup') >= 0 || l.indexOf('mundial') >= 0) return 'linear-gradient(135deg,rgba(92,10,26,.6),rgba(201,162,39,.5))';
        if (l.indexOf('copa america') >= 0 || l.indexOf('copa américa') >= 0) return 'linear-gradient(135deg,rgba(11,61,145,.6),rgba(200,16,46,.5))';
        if (l === 'nba' || l.indexOf('nba ') === 0) return 'linear-gradient(135deg,rgba(23,64,139,.6),rgba(201,8,42,.5))';
        if (l === 'english premier league') return 'linear-gradient(135deg,rgba(61,25,91,.6),rgba(0,255,133,.4))';
        return '';
    }

    /* la cancha vista desde arriba (SVG, sin imágenes) */
    function kind(sp) {
        switch (String(sp || '').toLowerCase()) {
            case 'soccer': case 'futsal': case 'beach soccer': return 'soccer';
            case 'basketball': return 'basketball';
            case 'american football': case 'australian football': case 'rugby': case 'rugby league': case 'rugby union': return 'american';
            case 'baseball': return 'baseball';
            case 'ice hockey': case 'field hockey': return 'hockey';
            case 'tennis': case 'volleyball': case 'badminton': case 'table tennis': return 'court';
            default: return '';
        }
    }
    function range(n, f) { var o = ''; for (var i = 0; i < n; i++) o += f(i); return o; }
    var FIELD = {
        soccer: function () {
            return range(5, function (i) { return '<rect x="' + (30 + 60 * i) + '" y="0" width="30" height="172" fill="#388E3C" stroke="none"/>'; }) +
                '<rect x="14" y="14" width="272" height="144"/><line x1="150" y1="14" x2="150" y2="158"/><circle cx="150" cy="86" r="26"/>' +
                '<rect x="14" y="45.5" width="35" height="81"/><rect x="251" y="45.5" width="35" height="81"/>' +
                '<rect x="14" y="67.3" width="13.6" height="37.4"/><rect x="272.4" y="67.3" width="13.6" height="37.4"/>' +
                '<g fill="#fff" stroke="none"><circle cx="150" cy="86" r="3"/><circle cx="38.5" cy="86" r="2.5"/><circle cx="261.5" cy="86" r="2.5"/></g>';
        },
        basketball: function () {
            return range(13, function (i) { var y = (172 * (i + 1)) / 14; return '<line x1="0" y1="' + y + '" x2="300" y2="' + y + '" stroke="rgba(0,0,0,.13)" stroke-width="1"/>'; }) +
                '<rect x="12" y="59.4" width="52.4" height="53.3" fill="rgba(163,59,30,.33)"/><rect x="235.6" y="59.4" width="52.4" height="53.3" fill="rgba(163,59,30,.33)"/>' +
                '<rect x="12" y="12" width="276" height="148"/><line x1="150" y1="12" x2="150" y2="160"/><circle cx="150" cy="86" r="25"/>' +
                '<path d="M12 18 A68 68 0 0 1 12 154"/><path d="M288 18 A68 68 0 0 0 288 154"/>' +
                '<g fill="#fff" stroke="none"><circle cx="25.8" cy="86" r="3"/><circle cx="274.2" cy="86" r="3"/></g>';
        },
        american: function () {
            return '<rect x="12" y="12" width="22" height="148" fill="#1B5E20" stroke="none"/><rect x="266" y="12" width="22" height="148" fill="#1B5E20" stroke="none"/>' +
                '<rect x="12" y="12" width="276" height="148"/>' +
                range(11, function (i) { var x = 34 + 23.2 * i; return '<line x1="' + x + '" y1="12" x2="' + x + '" y2="160" stroke-width="' + (i === 5 ? 2.6 : 1.6) + '"/>'; }) +
                '<line x1="34" y1="65.3" x2="266" y2="65.3" stroke="rgba(255,255,255,.55)" stroke-width="6" stroke-dasharray="1 3.64"/>' +
                '<line x1="34" y1="106.7" x2="266" y2="106.7" stroke="rgba(255,255,255,.55)" stroke-width="6" stroke-dasharray="1 3.64"/>';
        },
        baseball: function () {
            return '<path d="M150 164 L78.8 99.4 Q150 6.5 221.2 99.4 Z" fill="#B9773C" stroke="none"/>' +
                '<path d="M150 158.2 L211.9 96.3 L150 34.4 L88.1 96.3 Z" fill="#43A047" stroke-width="2"/>' +
                '<line x1="150" y1="158.2" x2="450" y2="-141.8" stroke-width="2"/><line x1="150" y1="158.2" x2="-150" y2="-141.8" stroke-width="2"/>' +
                '<circle cx="150" cy="96.3" r="9.9" fill="#B9773C" stroke="none"/>' +
                '<g fill="#fff" stroke="none"><rect x="207.9" y="92.3" width="8" height="8"/><rect x="146" y="30.4" width="8" height="8"/><rect x="84.1" y="92.3" width="8" height="8"/><rect x="146" y="154.2" width="8" height="8"/></g>';
        },
        hockey: function () {
            return '<rect x="12" y="12" width="276" height="148" rx="44.4" stroke-width="2.4"/>' +
                '<line x1="150" y1="12" x2="150" y2="160" stroke="#D32F2F" stroke-width="4"/>' +
                '<line x1="103.1" y1="12" x2="103.1" y2="160" stroke="#1565C0" stroke-width="4"/><line x1="196.9" y1="12" x2="196.9" y2="160" stroke="#1565C0" stroke-width="4"/>' +
                '<line x1="31.3" y1="25.3" x2="31.3" y2="146.7" stroke="#D32F2F" stroke-width="2"/><line x1="268.7" y1="25.3" x2="268.7" y2="146.7" stroke="#D32F2F" stroke-width="2"/>' +
                '<circle cx="150" cy="86" r="22.2" stroke="#1565C0" stroke-width="2"/>' +
                [[61.7, 53.4], [61.7, 118.6], [238.3, 53.4], [238.3, 118.6]].map(function (p) {
                    return '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="17.8" stroke="#D32F2F" stroke-width="1.6"/><circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="#D32F2F" stroke="none"/>';
                }).join('');
        },
        court: function () {
            return '<rect x="27.5" y="17.2" width="245" height="137.6" fill="#2F5C8A"/>' +
                '<line x1="27.5" y1="33.7" x2="272.5" y2="33.7" stroke-width="2"/><line x1="27.5" y1="138.3" x2="272.5" y2="138.3" stroke-width="2"/>' +
                '<line x1="93.6" y1="33.7" x2="93.6" y2="138.3" stroke-width="2"/><line x1="206.4" y1="33.7" x2="206.4" y2="138.3" stroke-width="2"/>' +
                '<line x1="93.6" y1="86" x2="206.4" y2="86" stroke-width="2"/><line x1="150" y1="10.3" x2="150" y2="161.7" stroke="#fff" stroke-width="3.5"/>';
        }
    };
    function field(sp) {
        var k = kind(sp);
        var svg = FIELD[k] ? '<svg viewBox="0 0 300 172" preserveAspectRatio="xMidYMid slice" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="2.2">' + FIELD[k]() + '</svg>' : '';
        return '<span class="nf-lv-field nf-lv-f-' + (k || 'none') + '" aria-hidden="true">' + svg + '</span>';
    }

    window.nfLvImg = function (img) {
        if (!img.dataset.r) { img.dataset.r = 1; img.src = img.src.replace(/\/small$/, ''); return; }
        var b = document.createElement('b'); b.textContent = img.getAttribute('data-n') || '?';
        img.replaceWith(b);
    };
    function team(name, src) {
        var ini = esc(String(name || '?').trim().charAt(0).toUpperCase());
        var badge = src ? '<img src="' + esc(src) + '/small" alt="" loading="lazy" data-n="' + ini + '" onerror="nfLvImg(this)">' : '<b>' + ini + '</b>';
        return '<span class="nf-lv-team"><span class="nf-lv-badge">' + badge + '</span><span class="nf-lv-name">' + esc(name) + '</span></span>';
    }
    function title(e) { return e.h || e.a ? (e.soon ? e.h + ' vs ' + e.a : e.h + ' ' + score(e.hs) + ' - ' + score(e.as) + ' ' + e.a) : e.ev || e.lg; }

    function card(e) {
        var best = CH[e.best] ? CH[e.best][0] : '';
        var th = theme(e.lg);
        var mid = e.h || e.a
            ? '<span class="nf-lv-mid">' + team(e.h, e.hb) + (e.soon ? '<span class="nf-lv-score nf-lv-vs">vs</span>'
                : '<span class="nf-lv-score">' + esc(score(e.hs)) + '<small>-</small>' + esc(score(e.as)) + '</span>') + team(e.a, e.ab) + '</span>'
            : '<span class="nf-lv-evname">' + esc(e.ev || e.lg) + '</span>';
        return '<button type="button" class="nf-lv-card" data-id="' + esc(e.id) + '" aria-label="' + esc(title(e) + ', ' + clock(e) + ', ' + best) + '">' +
            field(e.sp) + (th ? '<span class="nf-lv-theme" style="background:' + th + '"></span>' : '') + '<span class="nf-lv-scrim"></span>' +
            '<span class="nf-lv-body"><span class="nf-lv-top"><span class="nf-lv-lg">' + esc(e.lg) + '</span><span class="nf-lv-clock' + (e.soon ? ' soon' : '') + '"><i></i>' + esc(clock(e)) + '</span></span>' +
            mid + '<span class="nf-lv-ch">▶ ' + esc(best) + '</span></span></button>';
    }

    function render() {
        var p = pref();
        var list = cards.filter(function (e) { return !p || e.sp === p; });
        var focused = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.nf-lv-card') : null;
        var keep = focused ? focused.getAttribute('data-id') : '';
        var x = slider.scrollLeft;
        box.hidden = !list.length;
        // al final: toda la agenda en Deportes
        slider.innerHTML = list.map(card).join('') + (list.length ? '<a class="nf-lv-card nf-lv-more" href="sportsschedule.php"><span class="nf-lv-more-body">' +
            '<span class="nf-lv-more-icon" aria-hidden="true">🏟️</span><b>' + esc(T.goSports) + '</b><small>' + esc(T.goSportsSub) + '</small></span></a>' : '');
        slider.scrollLeft = x;
        if (slider._upd) slider._upd();
        var back = '';
        try { back = sessionStorage.getItem(LAST) || ''; sessionStorage.removeItem(LAST); } catch (e2) {}
        var id = keep || back;
        if (id) {
            var el = slider.querySelector('.nf-lv-card[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]');
            if (el) { el.focus({ preventScroll: !!keep }); if (!keep) el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
        }
    }

    function load() {
        clearTimeout(timer);
        if (document.hidden) return;
        fetch('sportsschedule.php?ajax=live', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
            .then(function (j) {
                var ttl = 60;
                if (j && j.on) {
                    shown = true;
                    if (plat) plat.hidden = !platCards();
                    for (var k in j.ch) CH[k] = j.ch[k];
                    cards = j.cards || [];
                    ttl = j.ttl || 30;
                    render();
                } else if (j || !shown) {
                    // sin fila (sin clave de pago, perfil infantil…) o el panel no contestó la primera vez: las plataformas
                    shown = false;
                    box.hidden = true;
                    if (plat) plat.hidden = false;
                    if (j) ttl = j.ttl || 300;
                }
                if (!document.hidden) timer = setTimeout(load, ttl * 1000);
            });
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) clearTimeout(timer); else load(); });

    /* ---------- menú del partido: sus canales (todos del cliente, en verde) y buscar ---------- */
    var menu = document.createElement('div');
    menu.className = 'nf-lv-menu'; menu.hidden = true;
    menu.innerHTML = '<div class="nf-lv-box" role="dialog" aria-modal="true" aria-labelledby="nfLvT"><h3 id="nfLvT"></h3><p></p>' +
        '<div class="nf-lv-type" hidden><input type="search" enterkeyhint="search"><button type="button"></button></div>' +
        '<div class="nf-lv-list"></div><button type="button" class="nf-lv-close"></button></div>';
    document.body.appendChild(menu);
    menu.querySelector('.nf-lv-close').textContent = T.close;
    var opts = [], from = null;
    function closeMenu() { menu.hidden = true; opts = []; if (from) try { from.focus(); } catch (x) {} }
    function showMenu(t, sub, list, typing) {
        opts = list || [];
        menu.querySelector('h3').textContent = t;
        var pp = menu.querySelector('p'); pp.textContent = sub || ''; pp.hidden = !sub;
        var ty = menu.querySelector('.nf-lv-type'); ty.hidden = typing == null;
        menu.querySelector('.nf-lv-list').innerHTML = opts.map(function (o, i) {
            return '<button type="button" data-o="' + i + '" class="' + (o.main ? 'main ' : '') + (o.green ? 'green' : '') + '"><b>' + esc(o.title) + '</b>' + (o.sub ? '<span>' + esc(o.sub) + '</span>' : '') + '</button>';
        }).join('');
        menu.hidden = false;
        if (typing != null) {
            var inp = ty.querySelector('input');
            inp.value = typing; inp.placeholder = T.typeHint; inp.setAttribute('aria-label', T.typeHint);
            ty.querySelector('button').textContent = T.go;
            inp.focus(); inp.select();
        } else {
            var f = menu.querySelector('.nf-lv-list button'); if (f) f.focus();
        }
    }
    function play(e, id) {
        var c = CH[id]; if (!c) return;
        try { sessionStorage.setItem(LAST, String(e.id)); } catch (x) {}
        menu.hidden = true;
        location.href = 'tvguide.php?id=' + encodeURIComponent(id) + '&slug=live&category_id=' + encodeURIComponent(c[1]);
    }
    function findChans(e, q) {
        fetch('sportsschedule.php?ajax=search&q=' + encodeURIComponent(q), { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
            .then(function (j) {
                var list = j && j.ok ? j.list : [];
                if (j && j.ch) for (var c in j.ch) CH[c] = j.ch[c];
                if (!list.length) { NF.toast(fill(T.noChWith, { q: q })); return; }
                showMenu(fill(T.chWith, { q: q }), '', list.map(function (id) { return { title: CH[id][0], green: true, run: function () { play(e, id); } }; }));
            });
    }
    function open(e, btn) {
        from = btn;
        var list = [{ title: '▶  ' + T.auto, sub: CH[e.best] ? CH[e.best][0] : '', green: true, main: true, run: function () { play(e, e.best); } }];
        (e.opts || []).forEach(function (o) {
            if (o[0] === e.best && o[1] !== 'tv') return;
            var name = CH[o[0]] ? CH[o[0]][0] : '';
            if (o[1] === 'tv') list.push({ title: name, sub: fill(T.inList, { c: o[2] || name }), green: true, run: function () { play(e, o[0]); } });
            else if (o[0] !== e.best) list.push({ title: name + ' · ' + (o[1] === 'guide' ? T.inGuide : T.byTeams), green: true, run: function () { play(e, o[0]); } });
        });
        var names = [e.h, e.a].filter(function (n) { return n && String(n).trim(); });
        if (!names.length && e.ev) names = [e.ev];
        names.forEach(function (n) { list.push({ title: fill(T.searchX, { q: n }), run: function () { findChans(e, n); } }); });
        list.push({ title: T.searchAny, run: function () { showMenu(T.searchAny, '', [], names[0] || ''); } });
        showMenu(title(e), clock(e) + (e.lg ? '  ·  ' + e.lg : ''), list);
        menu._e = e;
    }
    function typed() { var q = menu.querySelector('.nf-lv-type input').value.trim(); if (q && menu._e) findChans(menu._e, q); }
    menu.addEventListener('click', function (ev) {
        if (ev.target === menu || ev.target.closest('.nf-lv-close')) { closeMenu(); return; }
        if (ev.target.closest('.nf-lv-type button')) { typed(); return; }
        var b = ev.target.closest('[data-o]'); if (!b) return;
        var o = opts[+b.getAttribute('data-o')]; if (o) o.run();
    });
    menu.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.closest('.nf-lv-type input')) { ev.preventDefault(); typed(); } });
    document.addEventListener('keydown', function (ev) { if (!menu.hidden && ev.key === 'Escape') closeMenu(); });
    slider.addEventListener('click', function (ev) {
        var b = ev.target.closest('.nf-lv-card'); if (!b) return;
        var id = b.getAttribute('data-id');
        var e = cards.filter(function (c) { return String(c.id) === id; })[0];
        if (e) open(e, b);
    });

    load();
})();
