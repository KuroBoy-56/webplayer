/* «¿Quién está viendo?» (profiles.php). Elegir, administrar (nombre, avatar, PIN, eliminar) y agregar perfiles: cada
 * acción va a profiles.php (POST) y de ahí al panel (api/profiles.php). El PIN nunca se guarda en el navegador. */
(function () {
    'use strict';
    var tr = window.NF_T || function (s, p) { if (p) for (var k in p) s = s.split('{' + k + '}').join(p[k]); return s; };
    var C = window.PF || {};
    var S = C.state;
    var d = document;
    var root = d.getElementById('pfRoot'), list = d.getElementById('pfList'), manageBtn = d.getElementById('pfManage');
    var modal = d.getElementById('pfModal'), card = d.getElementById('pfCard'), titleEl = d.getElementById('pfTitle');
    var managing = !!C.manage, busy = false, lastFocus = null;
    var pins = {}; // PIN ya comprobado en esta página (para editar un perfil bloqueado)
    // al cambiar de perfil no se arrastra el último destacado del inicio (app.js lo deja de fondo mientras carga):
    // un perfil infantil nunca ve un instante el banner que vio otro perfil
    try { sessionStorage.removeItem('nf_hero_bg'); } catch (e) { /* sin almacenamiento */ }

    /* fondo: lo más destacado de la semana en TMDB (C.bg, 15 a 20 títulos). Cada uno se ve 10 s y al llegar al último
       vuelve al primero. Dos capas: la nueva se pide en la de abajo y, cuando ya cargó, aparece con un fundido encima de
       la anterior (nunca un hueco negro). Si una dirección falla, la siguiente; si no carga ninguna, se salta ese título. */
    var bg = d.getElementById('pfBg');
    // celular en vertical (la misma condición que profiles.css): el póster del título sin textos, como la app de Android
    var portrait = window.matchMedia ? matchMedia(C.portraitMq || '(orientation: portrait) and (max-width: 899px)') : {matches: false};
    if (bg) slides(bg, Array.isArray(C.bg) ? C.bg : []);

    function slides(first, items) {
        var SLIDE_MS = 10000, FADE_MS = 850;
        var hl = d.getElementById('pfHl');
        var layers = [first], top = 0, idx = 0, timer = 0, gen = 0;
        function srcsOf(it) {
            var l = [];
            [portrait.matches ? it.p : '', it.fhd, it.orig].forEach(function (u) { if (u && l.indexOf(u) < 0) l.push(u); });
            return l;
        }
        // la primera capa viene en un <picture> con el póster del celular: al reusarla (o si el póster falla) se quita
        function bare(img) {
            var pic = img.parentNode, gone = false;
            if (pic && pic.tagName === 'PICTURE') [].slice.call(pic.querySelectorAll('source')).forEach(function (sc) { pic.removeChild(sc); gone = true; });
            return gone;
        }
        // la primera ya viene en el HTML (src + srcset del primer título)
        var fb = [];
        try { fb = JSON.parse(first.getAttribute('data-fb') || '[]'); } catch (e) { fb = []; }
        first.addEventListener('load', function onFirst() {
            if (first.getAttribute('data-i') !== null) return; // ya es una capa del pase
            first.classList.add('ok');
            schedule();
        });
        first.addEventListener('error', function onFirstErr() {
            if (first.getAttribute('data-i') !== null) return;
            if (bare(first)) return; // falló el póster: el fondo horizontal del mismo título
            first.removeAttribute('srcset');
            var next = fb.shift();
            if (next && next === first.getAttribute('src')) next = fb.shift();
            if (next) first.src = next; else { first.classList.remove('ok'); schedule(); }
        });
        if (first.complete && first.naturalWidth) { first.classList.add('ok'); schedule(); }
        if (items.length < 2) return;
        // segunda capa, detrás de los degradados (antes de .pf-shade)
        var second = d.createElement('img');
        second.className = 'pf-bg';
        second.alt = '';
        second.setAttribute('decoding', 'async');
        second.setAttribute('aria-hidden', 'true');
        var host = first.parentNode.tagName === 'PICTURE' ? first.parentNode : first; // fuera del <picture>: sus <source> no la tocan
        host.parentNode.insertBefore(second, host.nextSibling);
        layers.push(second);

        function schedule() {
            if (items.length < 2 || timer) return;
            timer = setTimeout(function () { timer = 0; advance(1); }, SLIDE_MS);
            prefetch((idx + 1) % items.length);
        }
        function prefetch(i) {
            var it = items[i];
            if (!it || !it.fhd) return;
            var im = new Image();
            if (portrait.matches && it.p) { im.src = it.p; return; }
            im.sizes = '100vw';
            if (it.orig && it.orig !== it.fhd) im.srcset = it.fhd + ' ' + (it.w || 1920) + 'w, ' + it.orig + ' 3840w';
            im.src = it.fhd;
        }
        // pone el título i en la capa de abajo y, cuando cargó, la sube con el fundido; tries = cuántos se saltaron
        function advance(tries) {
            if (tries > items.length) return; // ninguno carga (sin red): queda el último que se vio
            if (d.hidden) { d.addEventListener('visibilitychange', function back() { if (d.hidden) return; d.removeEventListener('visibilitychange', back); advance(tries); }); return; }
            var i = (idx + 1) % items.length, it = items[i], my = ++gen;
            var under = layers[1 - top], over = layers[top];
            var urls = srcsOf(it);
            under.onload = function () {
                if (my !== gen) return;
                under.onload = under.onerror = null;
                // un cuadro dibujada en 0 antes del fundido (si ya estaba guardada, el fundido igual se ve)
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        if (my !== gen) return;
                        under.classList.add('up', 'ok');
                        over.classList.remove('up');
                        top = 1 - top;
                        idx = i;
                        caption(it);
                        setTimeout(function () { if (my === gen) over.classList.remove('ok'); }, FADE_MS + 50);
                        schedule();
                    });
                });
            };
            under.onerror = function () {
                if (my !== gen) return;
                under.removeAttribute('srcset');
                var next = urls.shift();
                if (next && next === under.getAttribute('src')) next = urls.shift();
                if (next) { under.src = next; return; }
                under.onload = under.onerror = null;
                idx = i; // no carga: se salta
                advance(tries + 1);
            };
            under.classList.remove('ok', 'up');
            bare(under);
            under.removeAttribute('data-fb');
            under.setAttribute('data-i', String(i));
            under.sizes = '100vw';
            if (!(portrait.matches && it.p) && it.orig && it.orig !== it.fhd) under.srcset = it.fhd + ' ' + (it.w || 1920) + 'w, ' + it.orig + ' 3840w';
            else under.removeAttribute('srcset');
            under.src = urls.shift() || '';
        }
        // título, nota, año y tipo abajo a la derecha, con un fundido corto
        function caption(it) {
            if (!hl) return;
            hl.classList.add('pf-hl-off');
            setTimeout(function () {
                var m = '';
                if (it.r > 0) m += '<span class="pf-hl-r"><i class="fas fa-star" aria-hidden="true"></i> ' + esc(Number(it.r).toFixed(1)) + '</span>';
                if (it.y) m += '<span>' + esc(it.y) + '</span>';
                var kind = (C.kinds || {})[it.k] || '';
                m += '<span>' + esc(kind) + '</span>';
                // vertical: el logo del título (si TMDB tiene) y «Película · ★ 7.8»; horizontal: nombre, nota, año y tipo
                hl.innerHTML = (it.lg ? '<img class="pf-hl-lg" alt="' + esc(it.t) + '" src="' + esc(it.lg) + '">' : '')
                    + '<b class="pf-hl-t' + (it.lg ? ' pf-hl-has' : '') + '">' + esc(it.t) + '</b><span class="pf-hl-m">' + m + '</span>'
                    + '<span class="pf-hl-pm">' + esc(kind + (it.r > 0 ? '  ·  ★ ' + Number(it.r).toFixed(1) : '')) + '</span>';
                var lg = hl.querySelector('.pf-hl-lg');
                if (lg) lg.onerror = function () { var t = hl.querySelector('.pf-hl-t'); if (t) t.classList.remove('pf-hl-has'); if (lg.parentNode) lg.parentNode.removeChild(lg); };
                hl.classList.remove('pf-hl-off');
            }, 220);
        }
    }
    if (!S || !list) return;

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; });
    }
    function find(id) {
        for (var i = 0; i < S.profiles.length; i++) if (S.profiles[i].id === id) return S.profiles[i];
        return null;
    }
    function shown(u) {
        for (var i = 0; i < S.avatars.length; i++) if (S.avatars[i].u === u) return S.avatars[i].s;
        for (var j = 0; j < S.profiles.length; j++) if (S.profiles[j].avatar === u) return S.profiles[j].img;
        return u;
    }
    function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* sin almacenamiento */ } }
    function stored(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }

    function post(data) {
        var f = new FormData();
        f.append('csrf', C.csrf || '');
        for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k) && data[k] !== undefined && data[k] !== null) f.append(k, data[k]);
        busy = true;
        return fetch(location.href, {method: 'POST', body: f, credentials: 'same-origin', headers: {'Accept': 'application/json'}})
            .then(function (r) { return r.json(); })
            .catch(function () { return {ok: false, code: 'net', error: tr('No se pudo conectar con el servidor. Inténtalo de nuevo.')}; })
            .then(function (r) {
                busy = false;
                if (r && r.ok && r.off && r.go) { location.href = r.go; return {ok: false, code: 'off', error: ''}; }
                if (r && r.ok && r.state) S = r.state;
                if (r && !r.ok && r.code === 'csrf') setTimeout(function () { location.reload(); }, 1500);
                return r || {ok: false, error: tr('No se pudo conectar con el servidor. Inténtalo de nuevo.')};
            });
    }

    /* ---------- lista ---------- */
    function avatarHtml(p, cls) {
        return '<span class="pf-av' + (cls ? ' ' + cls : '') + '"><img src="' + esc(p.img) + '" alt="" onerror="this.onerror=null;this.src=\'assets/nf/noposter.svg\'">'
            // en el celular la etiqueta «Niños» va sobre el avatar (no suma una línea y los 5 perfiles siguen entrando)
            + (p.kids ? '<span class="pf-kids pf-kids-av" aria-hidden="true">' + esc(tr('Niños')) + '</span>' : '')
            // celular en vertical: el candado en un círculo sobre el avatar (como la app de Android)
            + (p.locked ? '<span class="pf-lock-av" aria-hidden="true"><i class="fas fa-lock"></i></span>' : '')
            + '<span class="pf-edit" aria-hidden="true"><i class="fas fa-pen"></i></span></span>';
    }
    function render(focusId) {
        var h = '';
        S.profiles.forEach(function (p) {
            h += '<li><button type="button" class="pf-item" data-id="' + esc(p.id) + '" aria-label="' + esc(managing ? tr('Editar {n}', {n: p.name}) : p.name) + '">'
                + avatarHtml(p) + '<span class="pf-name">' + esc(p.name) + '</span>'
                + (p.kids ? '<span class="pf-kids">' + esc(tr('Niños')) + '</span>' : '')
                + (p.locked ? '<i class="fas fa-lock pf-lock" title="' + esc(tr('Protegido con PIN')) + '"></i>' : '') + '</button></li>';
        });
        if (S.canCreate) {
            h += '<li><button type="button" class="pf-item pf-add" data-add="1" aria-label="' + esc(tr('Agregar perfil')) + '"><span class="pf-av"><i class="fas fa-plus" aria-hidden="true"></i></span>'
                + '<span class="pf-name"><span class="pf-tl">' + esc(tr('Agregar perfil')) + '</span><span class="pf-tp">' + esc(tr('Agregar')) + '</span></span></button></li>';
        }
        // celular en vertical: el último lugar es «Editar» / «Listo» (en horizontal está el botón «Administrar perfiles»)
        h += '<li class="pf-mcell"><button type="button" class="pf-item pf-act" data-manage="1" aria-pressed="' + managing + '"><span class="pf-av"><i class="fas fa-' + (managing ? 'check' : 'pen') + '" aria-hidden="true"></i></span>'
            + '<span class="pf-name">' + esc(managing ? tr('Listo') : tr('Editar')) + '</span></button></li>';
        list.innerHTML = h;
        root.classList.toggle('pf-managing', managing);
        if (titleEl) titleEl.innerHTML = managing ? '<span>' + esc(tr('Administrar perfiles')) + '</span>'
            : '<span class="pf-tl">' + esc(tr('¿Quién está viendo?')) + '</span><span class="pf-tp">' + esc(tr('Elige tu perfil')) + '</span>';
        if (manageBtn) manageBtn.innerHTML = managing ? '<span>' + esc(tr('Listo')) + '</span>' : '<i class="fas fa-pen" aria-hidden="true"></i> <span>' + esc(tr('Administrar perfiles')) + '</span>';
        fitTop();
        var want = focusId ? list.querySelector('[data-id="' + cssEsc(focusId) + '"]') : null;
        if (want && !matchMedia('(hover: none)').matches) want.focus({preventScroll: true});
    }
    function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }
    /* vertical: «Administrar perfiles» va junto al logo; un logo ancho de distribuidor lo corre a la izquierda y, si el
       texto ya no entra, queda solo el lápiz (con su nombre para el lector de pantalla) */
    function fitTop() {
        if (!manageBtn) return;
        var logo = d.querySelector('.pf-logo');
        if (logo) root.style.setProperty('--pf-logo-w', Math.ceil(logo.getBoundingClientRect().width) + 'px');
        manageBtn.classList.remove('pf-icon-only');
        manageBtn.removeAttribute('aria-label');
        var s = manageBtn.querySelector('span');
        if (s && manageBtn.querySelector('i') && getComputedStyle(manageBtn).position === 'absolute' && s.scrollWidth > s.clientWidth + 1) {
            manageBtn.classList.add('pf-icon-only');
            manageBtn.setAttribute('aria-label', s.textContent);
        }
    }
    (function () {
        var logo = d.querySelector('.pf-logo');
        if (logo && !logo.complete) logo.addEventListener('load', fitTop);
        addEventListener('resize', fitTop);
    })();

    list.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.pf-item') : null;
        if (!b || busy) return;
        lastFocus = b;
        if (b.hasAttribute('data-manage')) { managing = !managing; render(); var m = list.querySelector('[data-manage]'); if (m) m.focus({preventScroll: true}); return; }
        if (b.hasAttribute('data-add')) { openEdit(null); return; }
        var p = find(b.getAttribute('data-id'));
        if (!p) return;
        if (managing) {
            if (p.locked && pins[p.id] === undefined) askPin(p, 'manage', function () { openEdit(find(p.id)); });
            else openEdit(p);
            return;
        }
        if (p.locked) { askPin(p, 'select'); return; }
        enterFx(p);
        select(p, '').then(function (r) {
            if (!r.ok) { enterFx(null); if (r.error) alertBox(r.error); }
        });
    });
    if (manageBtn) manageBtn.addEventListener('click', function () { managing = !managing; render(); });
    // con el mouse se agranda solo el perfil del puntero: el que tenía el foco al abrir la página lo suelta
    list.addEventListener('mouseover', function (e) {
        var b = e.target.closest ? e.target.closest('.pf-item') : null, a = d.activeElement;
        if (b && a && a !== b && list.contains(a)) a.blur();
    });

    // flechas: entre los perfiles (en el celular, de dos en dos hacia arriba y abajo)
    list.addEventListener('keydown', function (e) {
        var items = [].slice.call(list.querySelectorAll('.pf-item'));
        var i = items.indexOf(d.activeElement);
        if (i < 0) return;
        var grid = getComputedStyle(list).display === 'grid';
        var step = {ArrowDown: grid ? 2 : 1, ArrowUp: grid ? -2 : -1, ArrowRight: 1, ArrowLeft: -1}[e.key];
        if (!step) return;
        var j = Math.max(0, Math.min(items.length - 1, i + step));
        if (j !== i) { items[j].focus(); e.preventDefault(); }
    });

    function select(p, pin) {
        return post({action: 'select', id: p.id, pin: pin, next: C.next || ''}).then(function (r) {
            if (r.ok && r.go) {
                store('pf_last', p.id);
                // con el PIN la animación empieza ahora; Inicio se pide cuando el avatar ya llegó al centro
                if (!fx) enterFx(p);
                setTimeout(function () { location.href = r.go; }, Math.max(0, 650 - (Date.now() - fxAt)));
            }
            return r;
        });
    }

    /* al elegir un perfil (como Netflix, Android y la app de computadora): su avatar va al centro con el nombre y el
       circulito mientras se arma Inicio (en el perfil infantil, el filtro del catálogo); null = se quita (error) */
    var fx = null, fxAt = 0;
    function enterFx(p) {
        if (fx) { fx.remove(); fx = null; }
        if (!p) return;
        var img = list.querySelector('[data-id="' + cssEsc(p.id) + '"] img');
        var r = img ? img.getBoundingClientRect() : null;
        fx = d.createElement('div');
        fx.className = 'pf-enter';
        fx.setAttribute('role', 'status');
        fx.setAttribute('aria-label', p.name);
        fx.innerHTML = '<img class="pf-enter-av" alt="" src="' + esc(p.img) + '"><div class="pf-enter-below"><b>' + esc(p.name) + '</b><span class="pf-enter-spin"></span></div>';
        d.body.appendChild(fx);
        fxAt = Date.now();
        var av = fx.firstChild, o = fx;
        if (r) { av.style.left = r.left + 'px'; av.style.top = r.top + 'px'; av.style.width = r.width + 'px'; av.style.height = r.height + 'px'; }
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                o.classList.add('on');
                av.style.left = ''; av.style.top = ''; av.style.width = ''; av.style.height = '';
            });
        });
    }

    /* ---------- ventanas ---------- */
    function open(html) {
        card.innerHTML = html;
        modal.hidden = false;
        d.body.style.overflow = 'hidden';
        var f = card.querySelector('[autofocus]') || card.querySelector('input, button');
        if (f) setTimeout(function () { f.focus(); }, 30);
    }
    function close() {
        modal.hidden = true;
        card.innerHTML = '';
        d.body.style.overflow = '';
        if (lastFocus && d.body.contains(lastFocus)) lastFocus.focus({preventScroll: true});
    }
    modal.addEventListener('click', function (e) { if (e.target === modal || (e.target.closest && e.target.closest('[data-close]'))) close(); });
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !modal.hidden) close(); });
    function err(msg) { var el = card.querySelector('.pf-err'); if (el) el.textContent = msg || ''; }
    function alertBox(msg) {
        open('<h2 id="pfModalTitle">' + esc(tr('No se pudo completar')) + '</h2><p>' + esc(msg) + '</p>'
            + '<div class="pf-actions"><button type="button" class="pf-btn pf-btn-main" data-close autofocus>' + esc(tr('Aceptar')) + '</button></div>');
    }
    function digits(input) { input.value = input.value.replace(/\D+/g, '').slice(0, 4); return input.value; }

    /* PIN: para entrar (select) o para administrar un perfil bloqueado (manage) */
    function askPin(p, mode, done) {
        open('<h2 id="pfModalTitle">' + esc(mode === 'select' ? tr('Escribe el PIN para entrar a {n}', {n: p.name}) : tr('Escribe el PIN de {n}', {n: p.name})) + '</h2>'
            + '<div class="pf-pinbox">' + avatarHtml(p).replace('<span class="pf-edit" aria-hidden="true"><i class="fas fa-pen"></i></span>', '')
            + '<input class="pf-pin" id="pfPin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" aria-label="PIN" autofocus></div>'
            + '<p class="pf-err" role="alert"></p>'
            + '<div class="pf-actions" style="justify-content:space-between;align-items:center"><button type="button" class="pf-link" id="pfForgot">' + esc(tr('¿Olvidaste el PIN?')) + '</button>'
            + '<button type="button" class="pf-btn" data-close>' + esc(tr('Cancelar')) + '</button></div>');
        var input = d.getElementById('pfPin');
        input.addEventListener('input', function () {
            if (digits(input).length < 4 || busy) return;
            var pin = input.value;
            input.disabled = true;
            var req = mode === 'select' ? select(p, pin) : post({action: 'pin_check', id: p.id, pin: pin});
            req.then(function (r) {
                if (r.ok && mode === 'select') return;
                input.disabled = false;
                if (r.ok) { pins[p.id] = pin; close(); if (done) done(); return; }
                input.value = '';
                input.focus();
                err(r.error);
            });
        });
        d.getElementById('pfForgot').addEventListener('click', function () { forgotPin(p, mode, done); });
    }

    /* PIN olvidado: la contraseña de la línea lo quita */
    function forgotPin(p, mode, done) {
        open('<h2 id="pfModalTitle">' + esc(tr('¿Olvidaste el PIN?')) + '</h2>'
            + '<p>' + esc(tr('Escribe la contraseña de tu cuenta (la que usas para iniciar sesión) y se quitará el PIN de {n}.', {n: p.name})) + '</p>'
            + '<div class="pf-field"><label for="pfPass">' + esc(tr('Contraseña')) + '</label><input class="pf-input" id="pfPass" type="password" autocomplete="current-password" autofocus></div>'
            + '<p class="pf-err" role="alert"></p>'
            + '<div class="pf-actions"><button type="button" class="pf-btn pf-btn-main" id="pfReset">' + esc(tr('Quitar el PIN')) + '</button>'
            + '<button type="button" class="pf-btn" data-close>' + esc(tr('Cancelar')) + '</button></div>');
        var pass = d.getElementById('pfPass'), btn = d.getElementById('pfReset');
        function go() {
            if (!pass.value || busy) return;
            btn.disabled = true;
            post({action: 'pin_reset', id: p.id, pass: pass.value}).then(function (r) {
                btn.disabled = false;
                if (!r.ok) { err(r.error); pass.select(); return; }
                pins[p.id] = '';
                render();
                if (mode === 'select') { close(); select(find(p.id) || p, ''); return; }
                close();
                if (done) done();
            });
        }
        btn.addEventListener('click', go);
        pass.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    }

    /* editar (p) o agregar (null) */
    function openEdit(p) {
        var used = {};
        S.profiles.forEach(function (x) { used[x.avatar] = 1; });
        var avatar = p ? p.avatar : '';
        if (!avatar) {
            for (var i = 0; i < S.avatars.length; i++) if (!used[S.avatars[i].u]) { avatar = S.avatars[i].u; break; }
            if (!avatar && S.avatars.length) avatar = S.avatars[0].u;
        }
        var grid = S.avatars.map(function (a) {
            return '<button type="button" class="pf-avopt' + (a.u === avatar ? ' on' : '') + '" data-u="' + esc(a.u) + '" aria-label="' + esc(tr('Elegir este avatar')) + '">'
                + '<img src="' + esc(a.s) + '" alt="" loading="lazy" onerror="this.onerror=null;this.src=\'assets/nf/noposter.svg\'"></button>';
        }).join('');
        var pinSec;
        if (p && p.locked) {
            pinSec = '<div class="pf-sec"><h3><i class="fas fa-lock" aria-hidden="true"></i> ' + esc(tr('Protegido con PIN')) + '</h3>'
                + '<div class="pf-row"><label class="pf-check"><input type="checkbox" id="pfPinChg"> ' + esc(tr('Cambiar el PIN')) + '</label>'
                + '<label class="pf-check"><input type="checkbox" id="pfPinOff"> ' + esc(tr('Quitar el PIN')) + '</label></div>'
                + '<div class="pf-row" id="pfPinNew" hidden>' + pinInputs() + '</div></div>';
        } else {
            pinSec = '<div class="pf-sec"><h3><i class="fas fa-lock-open" aria-hidden="true"></i> ' + esc(tr('Bloqueo con PIN')) + '</h3>'
                + '<label class="pf-check"><input type="checkbox" id="pfPinOn"> ' + esc(tr('Pedir un PIN de 4 números para entrar a este perfil')) + '</label>'
                + '<div class="pf-row" id="pfPinNew" hidden>' + pinInputs() + '</div></div>';
        }
        var kidsSec = p ? (p.kids ? '<div class="pf-sec"><p class="pf-note" style="margin:0!important"><span class="pf-kids">' + esc(tr('Niños')) + '</span> '
                + esc(tr('Perfil infantil: solo contenido para niños. Se elige al crear el perfil y no se cambia.')) + '</p></div>' : '')
            : '<div class="pf-sec"><label class="pf-switch-row"><span><b>' + esc(tr('Perfil infantil')) + '</b><small>'
                + esc(tr('Solo películas y series para niños y Disney. Sin Deportes; TV en vivo solo con canales infantiles (si tu lista no tiene, no aparece). Se elige ahora: después no se cambia.'))
                + '</small></span><input type="checkbox" id="pfKids" role="switch"><span class="pf-tog" aria-hidden="true"></span></label></div>';
        open('<h2 id="pfModalTitle">' + esc(p ? tr('Editar perfil') : tr('Agregar perfil')) + '</h2>'
            + '<div class="pf-edit-top"><button type="button" class="pf-av pf-avbtn" id="pfAvBtn" aria-label="' + esc(tr('Cambiar avatar')) + '">'
            + '<img id="pfAvImg" src="' + esc(shown(avatar)) + '" alt="" onerror="this.onerror=null;this.src=\'assets/nf/noposter.svg\'"><span class="pf-edit" aria-hidden="true"><i class="fas fa-pen"></i></span></button>'
            + '<div class="pf-field"><label for="pfName">' + esc(tr('Nombre')) + '</label><input class="pf-input" id="pfName" maxlength="20" autocomplete="off" value="' + esc(p ? p.name : '') + '"' + (p ? '' : ' autofocus') + '></div></div>'
            + '<div class="pf-avgrid" id="pfAvGrid" hidden>' + grid + '</div>'
            + kidsSec
            + pinSec
            + (p ? '' : '<p class="pf-note">' + esc(tr('Si eliminaste un perfil hace menos de 7 días, créalo con el mismo nombre exacto y volverá con su Continuar viendo y su Mi lista.')) + '</p>')
            + '<p class="pf-err" role="alert"></p>'
            + '<div class="pf-actions"><button type="button" class="pf-btn pf-btn-main" id="pfSave">' + esc(p ? tr('Guardar') : tr('Agregar')) + '</button>'
            + '<button type="button" class="pf-btn" data-close>' + esc(tr('Cancelar')) + '</button>'
            + (p && !p.main ? '<button type="button" class="pf-btn pf-btn-danger" id="pfDel" style="margin-left:auto"><i class="fas fa-trash" aria-hidden="true"></i> ' + esc(tr('Eliminar perfil')) + '</button>' : '')
            + '</div>');
        var gridEl = d.getElementById('pfAvGrid');
        d.getElementById('pfAvBtn').addEventListener('click', function () {
            gridEl.hidden = !gridEl.hidden;
            if (!gridEl.hidden) { var on = gridEl.querySelector('.on') || gridEl.querySelector('button'); if (on) on.focus(); }
        });
        gridEl.addEventListener('click', function (e) {
            var b = e.target.closest ? e.target.closest('.pf-avopt') : null;
            if (!b) return;
            avatar = b.getAttribute('data-u');
            [].forEach.call(gridEl.querySelectorAll('.pf-avopt'), function (x) { x.classList.toggle('on', x === b); });
            d.getElementById('pfAvImg').src = shown(avatar);
            gridEl.hidden = true;
            d.getElementById('pfAvBtn').focus();
        });
        var pinNew = d.getElementById('pfPinNew'), pinOn = d.getElementById('pfPinOn'), pinChg = d.getElementById('pfPinChg'), pinOff = d.getElementById('pfPinOff');
        [pinOn, pinChg].forEach(function (c) {
            if (c) c.addEventListener('change', function () { pinNew.hidden = !c.checked; if (c.checked) { if (pinOff) pinOff.checked = false; d.getElementById('pfPin1').focus(); } });
        });
        if (pinOff) pinOff.addEventListener('change', function () { if (pinOff.checked) { pinChg.checked = false; pinNew.hidden = true; } });
        [].forEach.call(card.querySelectorAll('.pf-pinnew'), function (x) { x.addEventListener('input', function () { digits(x); }); });
        d.getElementById('pfName').addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
        d.getElementById('pfSave').addEventListener('click', save);
        var del = d.getElementById('pfDel');
        if (del) del.addEventListener('click', function () { confirmDelete(p); });

        function save() {
            if (busy) return;
            var name = d.getElementById('pfName').value.replace(/\s+/g, ' ').trim();
            if (!name) { err(tr('Escribe un nombre.')); return; }
            var newPin = '';
            if ((pinOn && pinOn.checked) || (pinChg && pinChg.checked)) {
                var a = d.getElementById('pfPin1').value, b = d.getElementById('pfPin2').value;
                if (!/^\d{4}$/.test(a)) { err(tr('El PIN debe tener 4 números.')); return; }
                if (a !== b) { err(tr('Los dos PIN no coinciden.')); return; }
                newPin = a;
            }
            var btn = d.getElementById('pfSave');
            btn.disabled = true;
            var cur = p ? (pins[p.id] || '') : '';
            var chain;
            if (!p) {
                var kidsEl = d.getElementById('pfKids');
                chain = post({action: 'create', name: name, avatar: avatar, kids: kidsEl && kidsEl.checked ? '1' : ''}).then(function (r) {
                    if (!r.ok || !newPin) return r;
                    var made = null;
                    S.profiles.forEach(function (x) { if (x.name === name) made = x; });
                    return made ? post({action: 'pin_set', id: made.id, new_pin: newPin}) : r;
                });
            } else {
                var data = {action: 'update', id: p.id, pin: cur};
                if (name !== p.name) data.name = name;
                if (avatar !== p.avatar) data.avatar = avatar;
                chain = (data.name !== undefined || data.avatar !== undefined) ? post(data) : Promise.resolve({ok: true});
                chain = chain.then(function (r) {
                    if (!r.ok) return r;
                    if (newPin) return post({action: 'pin_set', id: p.id, new_pin: newPin, pin: cur}).then(function (x) { if (x.ok) pins[p.id] = newPin; return x; });
                    if (pinOff && pinOff.checked) return post({action: 'pin_clear', id: p.id, pin: cur}).then(function (x) { if (x.ok) pins[p.id] = ''; return x; });
                    return r;
                });
            }
            chain.then(function (r) {
                btn.disabled = false;
                if (!r.ok) { if (r.error) err(r.error); render(); return; }
                close();
                render(p ? p.id : null);
            });
        }
    }
    function pinInputs() {
        return '<input class="pf-input pf-pinnew" id="pfPin1" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" placeholder="' + esc(tr('PIN')) + '" aria-label="' + esc(tr('PIN nuevo')) + '">'
            + '<input class="pf-input pf-pinnew" id="pfPin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password" placeholder="' + esc(tr('Repetir')) + '" aria-label="' + esc(tr('Repite el PIN')) + '">';
    }

    function confirmDelete(p) {
        open('<h2 id="pfModalTitle">' + esc(tr('¿Eliminar el perfil {n}?', {n: p.name})) + '</h2>'
            + '<p>' + esc(tr('Se quitará de todos tus equipos. Durante 7 días puedes recuperarlo con su Continuar viendo y su Mi lista creando un perfil con el mismo nombre exacto; después se borra para siempre.')) + '</p>'
            + '<p class="pf-err" role="alert"></p>'
            + '<div class="pf-actions"><button type="button" class="pf-btn pf-btn-danger" id="pfDelOk"><i class="fas fa-trash" aria-hidden="true"></i> ' + esc(tr('Eliminar perfil')) + '</button>'
            + '<button type="button" class="pf-btn" data-close autofocus>' + esc(tr('Cancelar')) + '</button></div>');
        d.getElementById('pfDelOk').addEventListener('click', function () {
            if (busy) return;
            this.disabled = true;
            post({action: 'delete', id: p.id, pin: pins[p.id] || ''}).then(function (r) {
                if (!r.ok) { err(r.error); d.getElementById('pfDelOk').disabled = false; return; }
                if (stored('pf_last') === p.id) store('pf_last', null);
                delete pins[p.id];
                close();
                render();
            });
        });
    }

    render(S.current || stored('pf_last') || (S.profiles[0] && S.profiles[0].id));
})();
