/* Aviso del panel (Alertas): bienvenida o vencimiento, una vez por sesión del navegador */
(function () {
    'use strict';
    var d = document, KEY = 'nfAlertShown';
    var tr = window.NF_T || function (s) { return s; }; // idioma de la app (includes/i18n.php)

    function seen() { try { return sessionStorage.getItem(KEY) === '1'; } catch (e) { return false; } }
    function mark() { try { sessionStorage.setItem(KEY, '1'); } catch (e) { } }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function show(a) {
        if (d.getElementById('nfAlert')) return;
        var box = d.createElement('div');
        box.id = 'nfAlert';
        box.className = 'nf-alert ' + (a.type === 'expiry' ? 'is-expiry' : 'is-welcome');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'nfAlertTitle');
        box.innerHTML =
            '<div class="nf-alert-card">' +
            '<img class="nf-alert-logo" src="' + esc(a.logo || 'assets/img/Logo.png') + '" alt="" onerror="this.onerror=null;this.src=\'assets/img/Logo.png\'">' +
            '<h2 class="nf-alert-title" id="nfAlertTitle">' + esc(a.title) + '</h2>' +
            (a.message ? '<p class="nf-alert-msg">' + esc(a.message) + '</p>' : '') +
            (a.image ? '<img class="nf-alert-img" src="' + esc(a.image) + '" alt="" onerror="this.remove()">' : '') +
            '<button type="button" class="nf-btn nf-btn-white nf-alert-btn">' + esc(a.button || tr('Entendido')) + '</button>' +
            '</div>';
        var prev = d.activeElement;
        function close() {
            d.removeEventListener('keydown', onKey, true);
            box.remove();
            d.documentElement.classList.remove('nf-alert-open');
            if (prev && prev.focus) try { prev.focus(); } catch (e) { }
        }
        function onKey(e) {
            if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); }
            else if (e.key === 'Tab') { e.preventDefault(); btn.focus(); }
        }
        d.body.appendChild(box);
        d.documentElement.classList.add('nf-alert-open');
        var btn = box.querySelector('.nf-alert-btn');
        btn.addEventListener('click', close);
        d.addEventListener('keydown', onKey, true);
        btn.focus();
    }

    function run() {
        if (seen()) return;
        mark();
        fetch('api.php?action=alerta', { credentials: 'same-origin', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (a) { if (a && a.show) show(a); })
            .catch(function () { });
    }
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', run); else run();
})();
