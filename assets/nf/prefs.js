/*
 * Deporte preferido y Eventos favoritos en la nube del panel (settings.php?ajax=prefs -> api/alerts.php «prefs»), por
 * línea y perfil: lo elegido en la TV, el celular o la computadora se ve aquí y al revés. El navegador guarda una copia
 * (localStorage: la clave de NF_LIVE.key y la misma + '|lg') que leen Inicio (assets/nf/live.js) y Ajustes. La nube
 * manda; si nunca se guardó (at = 0) se sube lo que este navegador tenía.
 */
(function () {
    'use strict';
    function get(k) { try { return localStorage.getItem(k) || ''; } catch (x) { return ''; } }
    function set(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (x) {} }
    function lgOf(key) {
        try { var j = JSON.parse(get(key + '|lg') || '[]'); return Array.isArray(j) ? j.filter(function (x) { return x && x.id; }) : []; } catch (x) { return []; }
    }
    function ids(l) { return l.map(function (x) { return String(x.id); }).join(','); }
    // un cambio recién hecho aquí (todavía subiendo) gana sobre una respuesta vieja
    var hold = 0;
    var api = window.NFPrefs = {
        /* baja lo de la nube; cb(true) si cambió lo guardado en este navegador */
        pull: function (key, cb) {
            var done = function (v) { if (cb) cb(v); };
            fetch('settings.php?ajax=prefs', { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
                .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
                .then(function (j) {
                    var p = j && j.ok ? j.prefs : null;
                    if (!p || Date.now() < hold) return done(false);
                    if (!(Number(p.at) > 0)) {
                        if (get(key) || lgOf(key).length) api.push(key, '');
                        return done(false);
                    }
                    var lg = (Array.isArray(p.lg) ? p.lg : []).filter(function (x) { return x && x.id; });
                    var old = lgOf(key), byId = {};
                    old.forEach(function (x) { byId[x.id] = x; });
                    if (String(p.sp || '') === get(key) && ids(lg) === ids(old)) return done(false);
                    set(key, String(p.sp || ''));
                    set(key + '|lg', lg.length ? JSON.stringify(lg.map(function (x) { return { id: String(x.id), n: String(x.n || ''), b: (byId[x.id] || {}).b || '', sp: String(x.sp || '') }; })) : '');
                    done(true);
                });
        },
        /* sube lo guardado en este navegador (spn = el nombre del deporte en el idioma de la página) */
        push: function (key, spn) {
            hold = Date.now() + 15000;
            var sp = get(key);
            fetch('settings.php?ajax=prefs', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({ sp: sp, spn: sp ? (spn || '') : '', lg: lgOf(key).map(function (x) { return { id: x.id, n: x.n, sp: x.sp }; }) })
            }).catch(function () {});
        }
    };
})();
