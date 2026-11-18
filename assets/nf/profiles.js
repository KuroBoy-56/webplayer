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

    /* fondo: si una dirección falla, la siguiente */
    var bg = d.getElementById('pfBg');
    if (bg) {
        var fb = [];
        try { fb = JSON.parse(bg.getAttribute('data-fb') || '[]'); } catch (e) { fb = []; }
        var showBg = function () { bg.classList.add('ok'); };
        bg.addEventListener('load', showBg);
        bg.addEventListener('error', function () {
            bg.removeAttribute('srcset');
            var next = fb.shift();
            if (next && next !== bg.getAttribute('src')) bg.src = next; else if (next) bg.src = fb.shift() || ''; else bg.style.display = 'none';
        });
        if (bg.complete && bg.naturalWidth) showBg();
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
            + '<span class="pf-edit" aria-hidden="true"><i class="fas fa-pen"></i></span></span>';
    }
    function render(focusId) {
        var h = '';
        S.profiles.forEach(function (p) {
            h += '<li><button type="button" class="pf-item" data-id="' + esc(p.id) + '" aria-label="' + esc(managing ? tr('Editar {n}', {n: p.name}) : p.name) + '">'
                + avatarHtml(p) + '<span class="pf-name">' + esc(p.name) + '</span>'
                + (p.locked ? '<i class="fas fa-lock pf-lock" title="' + esc(tr('Protegido con PIN')) + '"></i>' : '') + '</button></li>';
        });
        if (S.canCreate) {
            h += '<li><button type="button" class="pf-item pf-add" data-add="1"><span class="pf-av"><i class="fas fa-plus" aria-hidden="true"></i></span>'
                + '<span class="pf-name">' + esc(tr('Agregar perfil')) + '</span></button></li>';
        }
        list.innerHTML = h;
        root.classList.toggle('pf-managing', managing);
        if (titleEl) titleEl.textContent = managing ? tr('Administrar perfiles') : tr('¿Quién está viendo?');
        if (manageBtn) manageBtn.innerHTML = managing ? '<span>' + esc(tr('Listo')) + '</span>' : '<i class="fas fa-pen" aria-hidden="true"></i> <span>' + esc(tr('Administrar perfiles')) + '</span>';
        var want = focusId ? list.querySelector('[data-id="' + cssEsc(focusId) + '"]') : null;
        if (want && !matchMedia('(hover: none)').matches) want.focus({preventScroll: true});
    }
    function cssEsc(s) { return String(s).replace(/["\\]/g, '\\$&'); }

    list.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.pf-item') : null;
        if (!b || busy) return;
        lastFocus = b;
        if (b.hasAttribute('data-add')) { openEdit(null); return; }
        var p = find(b.getAttribute('data-id'));
        if (!p) return;
        if (managing) {
            if (p.locked && pins[p.id] === undefined) askPin(p, 'manage', function () { openEdit(find(p.id)); });
            else openEdit(p);
            return;
        }
        if (p.locked) { askPin(p, 'select'); return; }
        b.classList.add('pf-busy');
        select(p, '').then(function (r) {
            b.classList.remove('pf-busy');
            if (!r.ok && r.error) alertBox(r.error);
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
                location.href = r.go;
            }
            return r;
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
        open('<h2 id="pfModalTitle">' + esc(p ? tr('Editar perfil') : tr('Agregar perfil')) + '</h2>'
            + '<div class="pf-edit-top"><button type="button" class="pf-av pf-avbtn" id="pfAvBtn" aria-label="' + esc(tr('Cambiar avatar')) + '">'
            + '<img id="pfAvImg" src="' + esc(shown(avatar)) + '" alt="" onerror="this.onerror=null;this.src=\'assets/nf/noposter.svg\'"><span class="pf-edit" aria-hidden="true"><i class="fas fa-pen"></i></span></button>'
            + '<div class="pf-field"><label for="pfName">' + esc(tr('Nombre')) + '</label><input class="pf-input" id="pfName" maxlength="20" autocomplete="off" value="' + esc(p ? p.name : '') + '"' + (p ? '' : ' autofocus') + '></div></div>'
            + '<div class="pf-avgrid" id="pfAvGrid" hidden>' + grid + '</div>'
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
                chain = post({action: 'create', name: name, avatar: avatar}).then(function (r) {
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
