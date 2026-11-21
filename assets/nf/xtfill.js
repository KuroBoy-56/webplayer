/* Modo navegador (includes/xt_client.php): el navegador le pide al servidor IPTV lo que la web necesita, con la IP del
 * usuario (nunca la del hosting), y se lo pasa a la web (xtfill.php). Tres casos:
 *  - página «Cargando…» (XT_CFG.need): trae lo que falta y vuelve a cargar la página;
 *  - cargas en segundo plano de la web que contestan {"xtneed": [...]}: lo trae y repite el pedido (envuelve fetch);
 *  - XT_CFG.bg: lo vencido, que se renueva después de mostrar la página.
 * Si el navegador no puede leer el servidor IPTV (sin permiso CORS, sin red), la sesión pasa al hosting. */
(function () {
    'use strict';
    if (window.XTFill) return;
    var C = window.XT_CFG || {};
    var FILL = C.fill || 'xtfill.php';
    var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    var inflight = {};

    function gz(text) {
        if (!window.CompressionStream || !window.Blob || !window.Response) return Promise.resolve(null);
        try {
            var s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
            return new Response(s).blob().catch(function () { return null; });
        } catch (e) { return Promise.resolve(null); }
    }

    function upload(n, text) {
        return gz(text).then(function (z) {
            var h = { 'Content-Type': 'text/plain', 'X-Requested-With': 'XMLHttpRequest' };
            if (z) h['X-Gz'] = '1';
            return nativeFetch(FILL + '?id=' + encodeURIComponent(n.id), { method: 'POST', credentials: 'same-origin', headers: h, body: z || text });
        }).then(function (r) { return r.json(); }).then(function (j) { return !!(j && j.ok); });
    }

    // una dirección del servidor IPTV: directo desde el navegador (CORS), sin cookies ni referer
    function getOne(n) {
        if (inflight[n.id]) return inflight[n.id];
        var ctl = window.AbortController ? new AbortController() : null;
        // el catálogo completo de un servidor grande tarda más (20-40 MB): 3 minutos; lo demás, 1 minuto
        var big = /[?&]action=get_(vod_streams|series)(&|$)/.test(n.u) && !/[?&]category_id=/.test(n.u);
        var timer = setTimeout(function () { if (ctl) ctl.abort(); }, big ? 180000 : 60000);
        inflight[n.id] = nativeFetch(n.u, { mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: ctl ? ctl.signal : undefined })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.text();
            })
            .then(function (t) {
                clearTimeout(timer);
                return upload(n, t);
            }, function (e) {
                clearTimeout(timer);
                throw e;
            })
            .then(function (ok) { delete inflight[n.id]; return ok; }, function (e) { delete inflight[n.id]; throw e; });
        return inflight[n.id];
    }

    // de a 2 a la vez (como una app): true si se pudo todo
    function run(list) {
        list = (list || []).slice();
        var bad = null;
        function worker() {
            var n = list.shift();
            if (!n) return Promise.resolve();
            return getOne(n).then(function (ok) { if (!ok && !bad) bad = 'upload'; }, function (e) { if (!bad) bad = (e && e.message) || 'fetch'; }).then(worker);
        }
        return Promise.all([worker(), worker()]).then(function () { return bad; });
    }

    // el navegador no puede leer el servidor IPTV: la sesión sigue por el hosting (una sola vez)
    var off = false;
    function giveUp(why) {
        if (off) return Promise.resolve();
        off = true;
        return nativeFetch(FILL + '?fail=1', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'text/plain' }, body: String(why || '') })
            .catch(function () {});
    }

    window.XTFill = { run: run };

    // cargas en segundo plano de la web (api.php, tvguide.php?ajax=…): si contestan {"xtneed"}, se trae y se repite
    if (nativeFetch) {
        window.fetch = function (input, init) {
            var url = typeof input === 'string' ? input : (input && input.url) || '';
            var same = !/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || url.indexOf(location.origin + '/') === 0;
            var p = nativeFetch(input, init);
            if (!same) return p;
            return p.then(function (res) {
                var ct = (res.headers.get('content-type') || '').toLowerCase();
                if (ct.indexOf('json') < 0) return res;
                return res.clone().json().then(function (j) {
                    if (!j || !j.xtneed) return res;
                    return run(j.xtneed).then(function (bad) {
                        if (bad) return giveUp(bad).then(function () { return nativeFetch(input, init); });
                        return nativeFetch(input, init);
                    });
                }, function () { return res; });
            });
        };
    }

    // página «Cargando…»: trae lo que falta y vuelve a cargar (si no se puede, sigue por el hosting)
    if (C.need && C.need.length) {
        // nunca en vueltas sin fin: más de 6 «Cargando…» seguidos en 1 minuto = sigue por el hosting
        var loops = 0;
        try {
            var lp = JSON.parse(sessionStorage.getItem('xt_loops') || '{}');
            loops = lp.t > Date.now() - 60000 ? (lp.n || 0) + 1 : 1;
            sessionStorage.setItem('xt_loops', JSON.stringify({ n: loops, t: Date.now() }));
        } catch (e) {}
        if (loops > 6) {
            giveUp('vueltas').then(function () { location.reload(); });
            return;
        }
        run(C.need).then(function (bad) {
            if (!bad) { location.reload(); return; }
            giveUp(bad).then(function () { location.reload(); });
        });
    } else if (C.bg && C.bg.length) {
        // lo vencido, cuando la página ya se ve
        var later = function () { run(C.bg); };
        if (document.readyState === 'complete') setTimeout(later, 1200);
        else window.addEventListener('load', function () { setTimeout(later, 1200); });
    }
})();
