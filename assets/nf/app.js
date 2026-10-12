/* WebPlayer – interfaz estilo Netflix (sin dependencias) */
(function () {
    'use strict';
    var NF = window.NF = window.NF || {};
    var NOIMG = 'assets/nf/noposter.svg';
    var d = document;

    function $(s, c) { return (c || d).querySelector(s); }
    function $$(s, c) { return Array.prototype.slice.call((c || d).querySelectorAll(s)); }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    NF.esc = esc;

    NF.imgErr = function (img) {
        img.onerror = null;
        img.src = NOIMG;
        img.classList.add('ok');
        var card = img.closest && img.closest('.nf-card');
        if (card) card.classList.add('noimg');
    };

    NF.api = function (params) {
        var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
        return fetch('api.php?' + q, { credentials: 'same-origin', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (r) {
                if (r.status === 401) { location.href = 'login'; throw new Error('auth'); }
                return r.json();
            });
    };

    NF.card = function (c, progress) {
        var pk = c.t && c.id ? ' data-pk="' + esc(c.t + '|' + c.id) + '" data-tm="' + esc(c.tm || '') + '" data-y="' + esc(c.y || '') + '"' : '';
        var h = '<a class="nf-card' + (progress != null ? ' has-pb' : '') + '" href="' + esc(c.u) + '" title="' + esc(c.n) + '"' + pk + '>' +
            '<img src="' + esc(c.i || NOIMG) + '" alt="" loading="lazy" decoding="async" onload="this.classList.add(\'ok\')" onerror="NF.imgErr(this)">';
        if (c.r && parseFloat(c.r) > 0) h += '<span class="rt">★ ' + esc(c.r) + '</span>';
        h += '<span class="nm">' + esc(c.n) + '</span>';
        if (progress != null) h += '<span class="pb"><i style="width:' + Math.max(2, Math.min(100, progress)) + '%"></i></span>';
        return h + '</a>';
    };

    /* ---------------- Carátulas TMDB en alta calidad ---------------- */
    NF.posters = function (root) {
        var cards = $$('.nf-card[data-pk]:not([data-pd])', root || d);
        if (!cards.length) return;
        var map = {};
        cards.forEach(function (a) { a.setAttribute('data-pd', '1'); (map[a.getAttribute('data-pk')] = map[a.getAttribute('data-pk')] || []).push(a); });
        var keys = Object.keys(map);
        for (var i = 0; i < keys.length; i += 40) (function (chunk) {
            var items = chunk.map(function (k) {
                var a = map[k][0];
                return { k: k, t: k.split('|')[0], tm: a.getAttribute('data-tm') || '', y: a.getAttribute('data-y') || '', n: a.getAttribute('title') || '' };
            });
            fetch('api.php?action=posters', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }, body: JSON.stringify({ items: items }) })
                .then(function (r) { return r.ok ? r.json() : { p: {} }; })
                .then(function (res) {
                    var p = res.p || {};
                    Object.keys(p).forEach(function (k) {
                        var im = new Image();
                        im.onload = function () {
                            (map[k] || []).forEach(function (a) { var img = a.querySelector('img'); if (img) { img.src = p[k]; img.classList.add('ok'); } });
                        };
                        im.src = p[k];
                    });
                })
                .catch(function () {});
        })(keys.slice(i, i + 40));
    };

    /* Top 10: el número 10 se mide con la fuente real del equipo para que el 0 nunca quede debajo de la carátula */
    NF.fitTop = function (slider) {
        var fit = function () {
            slider.querySelectorAll('.nf-topitem.ten').forEach(function (it) {
                var num = it.querySelector('.num');
                if (!num) return;
                it.style.paddingLeft = '';
                var need = Math.ceil(num.getBoundingClientRect().width) + 4;
                var have = parseFloat(getComputedStyle(it).paddingLeft) || 0;
                if (need > have) it.style.paddingLeft = need + 'px';
            });
        };
        fit();
        if (d.fonts && d.fonts.ready) d.fonts.ready.then(fit);
        if (!slider._fitBound) { slider._fitBound = 1; window.addEventListener('resize', function () { clearTimeout(slider._fitT); slider._fitT = setTimeout(fit, 150); }); }
    };

    NF.toast = function (msg) {
        var t = $('#nfToast');
        if (!t) { t = d.createElement('div'); t.id = 'nfToast'; t.className = 'nf-toast'; d.body.appendChild(t); }
        t.textContent = msg;
        t.classList.add('show');
        clearTimeout(t._h);
        t._h = setTimeout(function () { t.classList.remove('show'); }, 2200);
    };

    /* ---------------- Favoritos (Mi lista) ---------------- */
    NF.fav = function (btn, data) {
        // DEMO: Mi lista no se guarda
        if (NF.demo) { NF.toast('No disponible en la DEMO'); return; }
        var on = btn.classList.contains('on');
        var fd = new FormData();
        fd.append('id', data.id);
        fd.append('type', data.type);
        fd.append('action', on ? 'remove' : 'add');
        if (data.title) fd.append('title', data.title);
        if (data.poster) fd.append('poster_url', data.poster);
        btn.classList.toggle('on', !on);
        var lbl = btn.querySelector('.lbl');
        if (lbl) lbl.textContent = on ? 'Mi lista' : 'En mi lista';
        var ic = btn.querySelector('.ic');
        if (ic) ic.innerHTML = on ? NF.svg.plus : NF.svg.check;
        NF.toast(on ? 'Quitado de Mi lista' : 'Agregado a Mi lista');
        fetch('save_favorite.php', { method: 'POST', body: fd, credentials: 'same-origin' }).catch(function () {});
    };
    NF.svg = {
        plus: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/></svg>',
        check: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/></svg>',
        play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 4v16a1 1 0 0 0 1.5.86l13-8a1 1 0 0 0 0-1.72l-13-8A1 1 0 0 0 6 4z"/></svg>'
    };

    /* ---------------- Filas horizontales ---------------- */
    function setupRow(row) {
        var slider = $('.nf-slider', row);
        if (!slider || slider._nf) return;
        slider._nf = true;
        var l = $('.nf-arrow.l', row), r = $('.nf-arrow.r', row);
        function upd() {
            if (!l || !r) return;
            l.hidden = slider.scrollLeft < 10;
            r.hidden = slider.scrollLeft + slider.clientWidth >= slider.scrollWidth - 10;
        }
        function go(dir) { slider.scrollBy({ left: dir * slider.clientWidth * 0.9, behavior: 'smooth' }); }
        if (l) l.addEventListener('click', function () { go(-1); });
        if (r) r.addEventListener('click', function () { go(1); });
        slider.addEventListener('scroll', function () { requestAnimationFrame(upd); }, { passive: true });
        slider._upd = upd;
        upd();
    }

    function loadRow(slider) {
        if (slider._loaded) return;
        slider._loaded = true;
        var src = slider.getAttribute('data-src');
        fetch(src, { credentials: 'same-origin', headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var items = (data && data.items) || [];
                if (!items.length) {
                    var row = slider.closest('.nf-row');
                    if (row) row.remove();
                    return;
                }
                if (slider.getAttribute('data-variant') === 'top') {
                    slider.innerHTML = items.map(function (c, i) { return '<div class="nf-topitem' + (i === 9 ? ' ten' : '') + '"><span class="num">' + (i + 1) + '</span>' + NF.card(c) + '</div>'; }).join('');
                    NF.fitTop(slider);
                } else {
                    slider.innerHTML = items.map(function (c) { return NF.card(c); }).join('');
                }
                if (slider._upd) slider._upd();
                NF.posters(slider);
            })
            .catch(function () {
                var row = slider.closest('.nf-row');
                if (row) row.remove();
            });
    }

    NF.initRows = function (root) {
        $$('.nf-row', root).forEach(setupRow);
        var lazy = $$('.nf-slider[data-src]', root);
        if (!lazy.length) return;
        if (!('IntersectionObserver' in window)) { lazy.forEach(loadRow); return; }
        var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) {
                if (en.isIntersecting) { io.unobserve(en.target); loadRow(en.target); }
            });
        }, { rootMargin: '700px 0px' });
        lazy.forEach(function (s) { io.observe(s); });
    };

    /* ---------------- Rejilla infinita ---------------- */
    NF.grid = function (opts) {
        var box = opts.el, status = opts.status, page = 1, busy = false, done = false, total = 0;
        function params() { var p = opts.params(); p.page = page; return p; }
        function more() {
            if (busy || done) return;
            busy = true;
            if (status) status.textContent = 'Cargando...';
            NF.api(params()).then(function (res) {
                total = res.total || 0;
                if (opts.onTotal) opts.onTotal(total);
                var html = (res.items || []).map(function (c) { return NF.card(c); }).join('');
                if (page === 1) box.innerHTML = html; else box.insertAdjacentHTML('beforeend', html);
                NF.posters(box);
                done = !res.more;
                page++;
                busy = false;
                if (status) status.textContent = (page === 2 && !total) ? '' : (done ? '' : '');
                if (page === 2 && !total) {
                    box.innerHTML = '<div class="nf-empty" style="grid-column:1/-1"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M10 2a8 8 0 0 1 6.32 12.9l5.39 5.39-1.42 1.42-5.39-5.39A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg>No encontramos títulos con estos filtros.</div>';
                }
                check();
            }).catch(function () { busy = false; if (status) status.textContent = 'No se pudo cargar. Desliza para reintentar.'; });
        }
        function check() {
            if (done || busy) return;
            var rect = box.getBoundingClientRect();
            if (rect.bottom - window.innerHeight < 900) more();
        }
        window.addEventListener('scroll', function () { requestAnimationFrame(check); }, { passive: true });
        return {
            reset: function () {
                page = 1; done = false;
                box.innerHTML = new Array(19).join('<div class="nf-skel" style="width:auto"></div>');
                more();
            }
        };
    };

    /* ---------------- Hero rotativo ---------------- */
    NF.hero = function (root, items) {
        if (!root || !items || !items.length) return;
        var bgs = $$('.nf-hero-bg', root), idx = 0, cur = 0, timer;
        var dots = $('.nf-hero-dots', root);
        function fill(it) {
            $$('[data-h=title]', root).forEach(function (e) { e.textContent = it.title; });
            $$('[data-h=desc]', root).forEach(function (e) { e.textContent = it.description || ''; });
            $$('[data-h=meta]', root).forEach(function (e) {
                var m = [];
                if (it.rating) m.push('<span class="nf-match">' + Math.min(99, Math.round(parseFloat(it.rating) * 10)) + '% para ti</span>');
                if (it.year) m.push('<span>' + esc(it.year) + '</span>');
                m.push('<span class="nf-badge">HD</span>');
                if (it.genre) m.push('<span>' + esc(it.genre) + '</span>');
                e.innerHTML = m.join('');
            });
            $$('[data-h=play]', root).forEach(function (e) { e.href = it.play_link; });
            $$('[data-h=info]', root).forEach(function (e) { e.href = it.info_link || it.play_link; });
            $$('[data-h=kicker]', root).forEach(function (e) { e.innerHTML = '<span class="n">N</span>' + esc(it.kind || 'Destacado'); });
            var p = $('.nf-hero-poster', root);
            if (p) p.style.backgroundImage = "url('" + (it.poster || it.background_image) + "')";
        }
        function show(i) {
            var it = items[i];
            var next = bgs[(cur + 1) % bgs.length];
            var img = new Image();
            img.onload = img.onerror = function () {
                next.style.backgroundImage = "url('" + it.background_image + "')";
                bgs.forEach(function (b) { b.classList.remove('on'); });
                next.classList.add('on');
                cur = (cur + 1) % bgs.length;
                fill(it);
                if (dots) $$('button', dots).forEach(function (b, j) { b.classList.toggle('on', j === i); });
            };
            img.src = it.background_image;
            idx = i;
        }
        if (dots) {
            dots.innerHTML = items.map(function (_, i) { return '<button type="button" aria-label="Destacado ' + (i + 1) + '"></button>'; }).join('');
            $$('button', dots).forEach(function (b, i) { b.addEventListener('click', function () { show(i); restart(); }); });
        }
        function restart() { clearInterval(timer); if (items.length > 1) timer = setInterval(function () { if (!d.hidden) show((idx + 1) % items.length); }, 8000); }
        show(0);
        restart();
    };

    /* ---------------- Cabecera, búsqueda, menú ---------------- */
    function initHeader() {
        var header = $('#nfHeader'), pills = $('#nfPills');
        var lastY = 0;
        function onScroll() {
            var y = window.scrollY || 0;
            if (header) header.classList.toggle('solid', y > 30 || d.body.classList.contains('nf-solid'));
            if (pills) {
                pills.classList.toggle('solid', y > 30);
                pills.classList.toggle('hide', y > lastY && y > 120);
            }
            lastY = y;
        }
        window.addEventListener('scroll', function () { requestAnimationFrame(onScroll); }, { passive: true });
        onScroll();

        var prof = $('#nfProfile'), pbtn = $('#nfProfileBtn');
        if (pbtn) pbtn.addEventListener('click', function (e) { e.stopPropagation(); prof.classList.toggle('open'); });
        d.addEventListener('click', function (e) {
            if (prof && !prof.contains(e.target)) prof.classList.remove('open');
            var s = $('#nfSearch');
            if (s && !s.contains(e.target)) { $('#nfSuggest').classList.remove('show'); if (!$('#nfSearchInput').value) s.classList.remove('open'); }
        });

        var search = $('#nfSearch'), sbtn = $('#nfSearchBtn'), input = $('#nfSearchInput'), sug = $('#nfSuggest');
        if (search && input) {
            if (input.value) search.classList.add('open');
            sbtn.addEventListener('click', function () {
                if (search.classList.contains('open') && input.value.trim()) { $('#search-form').submit(); return; }
                search.classList.toggle('open');
                if (search.classList.contains('open')) input.focus();
            });
            var t, lastQ = '';
            input.addEventListener('input', function () {
                clearTimeout(t);
                var q = input.value.trim();
                if (q.length < 2) { sug.classList.remove('show'); return; }
                t = setTimeout(function () {
                    lastQ = q;
                    sug.innerHTML = '<div class="empty">Buscando...</div>';
                    sug.classList.add('show');
                    NF.api({ action: 'search', q: q }).then(function (res) {
                        if (q !== lastQ) return;
                        var h = '';
                        if (res.movies && res.movies.length) h += '<h4>Películas</h4><div class="grid">' + res.movies.map(function (c) { return NF.card(c); }).join('') + '</div>';
                        if (res.series && res.series.length) h += '<h4>Series</h4><div class="grid">' + res.series.map(function (c) { return NF.card(c); }).join('') + '</div>';
                        if (res.live && res.live.length) h += '<h4>TV en vivo</h4><div class="grid">' + res.live.map(function (c) { return NF.card(c); }).join('') + '</div>';
                        if (!h) h = '<div class="empty">Sin resultados para "' + esc(q) + '"</div>';
                        else h += '<a class="more" href="browse.php?q=' + encodeURIComponent(q) + '">Ver todos los resultados</a>';
                        sug.innerHTML = h;
                    }).catch(function () { sug.classList.remove('show'); });
                }, 280);
            });
            input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { sug.classList.remove('show'); search.classList.remove('open'); input.blur(); } });
        }

        // Reloj (se conserva la preferencia 12h/24h)
        var clock = $('#clockDisplay'), date = $('#dateDisplay'), box = $('#nfClock');
        if (clock) {
            var tz = d.body.getAttribute('data-tz') || undefined;
            var is24 = false;
            try { is24 = localStorage.getItem('clockFormat24') === 'true'; } catch (e) {}
            var tick = function () {
                var now = new Date();
                try {
                    clock.textContent = now.toLocaleTimeString('es-ES', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: !is24 });
                    date.textContent = now.toLocaleDateString('es-ES', { timeZone: tz, weekday: 'short', day: '2-digit', month: 'short' });
                } catch (e) {
                    clock.textContent = now.toLocaleTimeString();
                }
            };
            box.addEventListener('click', function () { is24 = !is24; try { localStorage.setItem('clockFormat24', is24); } catch (e) {} tick(); });
            tick();
            setInterval(tick, 15000);
        }
    }

    /* ---------------- Navegación instantánea (precarga) ---------------- */
    function initPrefetch() {
        var done = {}, timer;
        var ok = function (a) {
            if (!a || !a.href || a.target === '_blank' || a.hasAttribute('data-noprefetch')) return false;
            if (a.origin !== location.origin) return false;
            if (/logout|video_player|proxy|download|save_|api\.php|vlc:/i.test(a.href)) return false;
            if (a.href === location.href) return false;
            return true;
        };
        function pf(a) {
            if (done[a.href]) return;
            done[a.href] = 1;
            var l = d.createElement('link');
            l.rel = 'prefetch';
            l.href = a.href;
            d.head.appendChild(l);
        }
        d.addEventListener('mouseover', function (e) {
            var a = e.target.closest && e.target.closest('a');
            if (!ok(a)) return;
            clearTimeout(timer);
            timer = setTimeout(function () { pf(a); }, 90);
        }, { passive: true });
        d.addEventListener('touchstart', function (e) {
            var a = e.target.closest && e.target.closest('a');
            if (ok(a)) pf(a);
        }, { passive: true });

        // barra de progreso al navegar
        var bar = $('#nf-loadbar');
        d.addEventListener('click', function (e) {
            var a = e.target.closest && e.target.closest('a');
            if (!a || !a.href || a.target === '_blank' || e.ctrlKey || e.metaKey || a.origin !== location.origin || a.getAttribute('href').charAt(0) === '#') return;
            if (/download_file|vlc:/i.test(a.href)) return;
            if (bar) bar.classList.add('on');
        });
        window.addEventListener('pageshow', function () { if (bar) bar.classList.remove('on'); });
    }

    /* ---------------- Protección básica del código ---------------- */
    function initProtect() {
        d.addEventListener('contextmenu', function (e) {
            if (!e.target.closest('input, textarea')) e.preventDefault();
        });
        d.addEventListener('keydown', function (e) {
            var k = (e.key || '').toLowerCase();
            if (k === 'f12' ||
                ((e.ctrlKey || e.metaKey) && e.shiftKey && (k === 'i' || k === 'j' || k === 'c')) ||
                ((e.ctrlKey || e.metaKey) && (k === 'u' || k === 's'))) {
                e.preventDefault();
            }
        });
        d.addEventListener('dragstart', function (e) { if (e.target.tagName === 'IMG') e.preventDefault(); });
    }

    function boot() {
        initHeader();
        NF.initRows(d);
        NF.posters(d);
        initPrefetch();
        initProtect();
    }
    if (d.readyState === 'loading') d.addEventListener('DOMContentLoaded', boot); else boot();
})();
