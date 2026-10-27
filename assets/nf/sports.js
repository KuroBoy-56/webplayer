/* Deportes › Tablas, Selecciones y Equipos (igual que Roku, Vega, Android, Windows e iPhone).
 * Tablas: región, división y liga de las tablas del panel; al tocar un equipo se abre su ficha («Entendido» /
 * «Más detalles»). Equipos: los partidos de los próximos 21 días de un equipo (también en español, con los alias del
 * panel) o de un país, y los últimos 5 buscados. Selecciones: todas, cada competición y «Selección femenina».
 * Todo sale del panel por el hosting (sportsschedule.php?ajax=…); si el panel todavía lo está armando se vuelve a
 * preguntar cada 20–25 s. */
(function () {
    'use strict';
    var tr = window.NF_T || function (s, p) { if (p) for (var k in p) s = s.split('{' + k + '}').join(p[k]); return s; };
    var REGIONS = ['intl', 'nat', 'eu', 'am', 'world'];
    var REGION_LABEL = { '': tr('Todas'), intl: tr('Copas'), nat: tr('Selecciones'), eu: tr('Europa'), am: tr('América'), world: tr('Resto del mundo') };
    var WOMEN = 10;
    var COLS = [['P', tr('PJ')], ['W', tr('G')], ['D', tr('E')], ['L', tr('P')], ['GF', tr('GF')], ['GA', tr('GC')], ['GD', tr('DG')], ['PTS', tr('PTS')]];
    var ZONES = [['p', tr('Clasificación')], ['s', tr('Otra copa o ascenso')], ['o', tr('Repechaje')], ['r', tr('Descenso')]];
    var RECENT = 'sports_team_recent';

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
    }
    function $(s, c) { return (c || document).querySelector(s); }
    // sin acentos ni signos, como el panel ("Alemania" = "alemania", "St. Louis" = "st louis")
    function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
    function tiny(u) { u = String(u || ''); return u.indexOf('thesportsdb.com/') > -1 && !/\/tiny$/.test(u) ? u + '/tiny' : u; }
    function regionOf(l) {
        if (['latam', 'na', 'sa', 'us', 'am'].indexOf(l.rg) > -1) return 'am';
        return l.rg === 'intl' || l.rg === 'nat' || l.rg === 'eu' ? l.rg : 'world';
    }
    function divisionOf(l) { return +l.w === 1 ? WOMEN : Math.max(1, +l.d || 1); }
    function get(q) {
        return fetch('sportsschedule.php?ajax=' + q, { credentials: 'same-origin', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
            .then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
    }
    function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
    function empty(text, spin) { return '<div class="sp-empty"><b>' + (spin ? '<span class="sp-wait"></span>' : '') + esc(text) + '</b></div>'; }

    window.NFSports = function (ctx) {
        var tabsBox = $('#spTabs');
        if (!tabsBox) return;
        var x = ctx.extra || {};
        var tabs = [['agenda', tr('Agenda')]];
        if (x.tables) tabs.push(['tables', tr('Tablas')]);
        if (x.nat) tabs.push(['nations', tr('Selecciones')]);
        if (x.fixtures) tabs.push(['teams', tr('Equipos')]);
        if (tabs.length < 2) return;
        var minutes = function (sp) { return ((ctx.meta || {})[sp] || {}).d || 120; };
        var alias = ctx.alias || {};
        var panes = { agenda: $('#spAgenda'), tables: $('#spTables'), fx: $('#spFx') };
        var cur = '';

        tabsBox.hidden = false;
        tabsBox.innerHTML = tabs.map(function (t) { return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="false">' + esc(t[1]) + '</button>'; }).join('');
        tabsBox.addEventListener('click', function (ev) { var b = ev.target.closest('[data-tab]'); if (b) show(b.getAttribute('data-tab'), true); });

        function show(t, push) {
            if (!tabs.some(function (x) { return x[0] === t; })) t = 'agenda';
            cur = t;
            [].forEach.call(tabsBox.querySelectorAll('[data-tab]'), function (b) { var on = b.getAttribute('data-tab') === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
            panes.agenda.hidden = t !== 'agenda';
            panes.tables.hidden = t !== 'tables';
            panes.fx.hidden = t !== 'teams' && t !== 'nations';
            if (push) try { history.replaceState(null, '', t === 'agenda' ? location.pathname + location.search : '#' + t); } catch (e) {}
            if (t === 'tables') tables.load();
            if (t === 'teams' || t === 'nations') fx.load();
        }

        /* ---------------- Tablas ---------------- */
        var tables = {
            started: false, leagues: [], loading: true, partial: false, failed: false, region: '', division: 1, leagueId: '',
            load: function () {
                if (this.started) { this.render(); return; }
                this.started = true;
                this.render();
                var self = this, tries = 0;
                (function ask() {
                    get('tables').then(function (r) {
                        if (r && r.on === false) { self.leagues = []; self.failed = false; self.partial = false; self.loading = false; self.render(); return; }
                        if (r && r.leagues && r.leagues.length) self.leagues = r.leagues;
                        self.partial = !!(r && r.partial);
                        self.failed = !r || !r.ok;
                        self.loading = false;
                        self.render();
                        // todavía armándose en el panel: lo que hay, y otra vez cada 20 s (hasta 4 min)
                        if (self.partial && ++tries < 12) wait(20000).then(ask);
                    });
                })();
            },
            regions: function () {
                var all = this.leagues;
                var found = REGIONS.filter(function (k) { return all.some(function (l) { return regionOf(l) === k; }); });
                return found.length > 1 ? [''].concat(found) : [''];
            },
            divisions: function () {
                var out = [];
                for (var d = 1; d <= WOMEN; d++) if (this.leagues.some(function (l) { return divisionOf(l) === d; })) out.push(d);
                return out;
            },
            list: function () {
                var self = this, divs = this.divisions();
                var div = divs.length < 2 ? 0 : (divs.indexOf(this.division) > -1 ? this.division : divs[0]);
                return this.leagues.filter(function (l) { return (!self.region || regionOf(l) === self.region) && (!div || divisionOf(l) === div); });
            },
            render: function () {
                var box = panes.tables, self = this;
                if (!this.leagues.length) {
                    box.innerHTML = empty(this.loading ? tr('Cargando las tablas…') : this.partial ? tr('Preparando las tablas… aparecen en unos segundos.')
                        : this.failed ? tr('No se pudieron cargar las tablas. Inténtalo más tarde.') : tr('No hay tablas para mostrar.'), this.loading || this.partial);
                    return;
                }
                var h = '', regs = this.regions(), divs = this.divisions(), list = this.list();
                if (regs.length > 1) h += '<div class="sp-xchips" data-k="region">' + regs.map(function (r) { return chip(r, REGION_LABEL[r] || r, self.region === r); }).join('') + '</div>';
                if (divs.length > 1) {
                    var d0 = divs.indexOf(this.division) > -1 ? this.division : divs[0];
                    h += '<div class="sp-xchips" data-k="division">' + divs.map(function (d) { return chip(String(d), d === WOMEN ? tr('Liga femenina') : tr('{n}.ª División', { n: d }), d0 === d); }).join('') + '</div>';
                }
                var lg = list.filter(function (l) { return l.id === self.leagueId; })[0] || list[0] || null;
                h += '<div class="sp-xchips" data-k="league">' + list.map(function (l) { return chip(l.id, l.n, lg && lg.id === l.id); }).join('') + '</div>';
                if (lg) {
                    h += '<div class="st-title">' + (lg.b ? '<img src="' + esc(tiny(lg.b)) + '" alt="" onerror="this.remove()">' : '') + '<h2>' + esc(lg.n + (lg.s ? ' · ' + lg.s : '')) + '</h2></div>';
                    var used = {};
                    (lg.g || []).forEach(function (g) {
                        if ((lg.g || []).length > 1 || g.n) h += '<h3 class="st-group">' + esc(g.n) + '</h3>';
                        h += '<div class="st-wrap"><table class="st-table"><thead><tr><th class="rk">#</th><th class="tm"></th>' +
                            COLS.map(function (c) { return '<th class="n c-' + c[0] + '">' + esc(c[1]) + '</th>'; }).join('') + '<th class="fm"></th></tr></thead><tbody>';
                        (g.r || []).forEach(function (r, i) {
                            used[r.z] = 1;
                            var cells = { P: r.p, W: r.w, D: r.d, L: r.l, GF: r.gf, GA: r.ga, GD: r.gd, PTS: r.pts };
                            var form = String(r.f || '').split('').filter(function (f) { return 'WDL'.indexOf(f) > -1; });
                            h += '<tr' + (r.id ? ' class="link" tabindex="0" data-team="' + esc(r.id) + '" data-n="' + esc(r.t) + '" data-b="' + esc(r.b || '') + '"' : '') + '>' +
                                '<td class="rk"><i class="st-z z-' + esc(r.z || '') + '"></i>' + esc(r.r) + '</td>' +
                                '<td class="tm">' + (r.b ? '<img src="' + esc(tiny(r.b)) + '" alt="" loading="lazy" onerror="this.remove()">' : '') + '<span>' + esc(r.t) + '</span></td>' +
                                COLS.map(function (c) { return '<td class="n c-' + c[0] + '">' + esc(cells[c[0]] == null ? '' : cells[c[0]]) + '</td>'; }).join('') +
                                '<td class="fm">' + form.map(function (f) { return '<i class="st-f f-' + f + '"></i>'; }).join('') + '</td></tr>';
                        });
                        h += '</tbody></table></div>';
                    });
                    var zs = ZONES.filter(function (z) { return used[z[0]]; });
                    if (zs.length) h += '<div class="st-legend">' + zs.map(function (z) { return '<span><i class="st-z z-' + z[0] + '"></i>' + esc(z[1]) + '</span>'; }).join('') + '</div>';
                }
                box.innerHTML = h;
            }
        };
        function chip(k, label, on) { return '<button type="button" class="nf-chip' + (on ? ' active' : '') + '" data-v="' + esc(k) + '">' + esc(label) + '</button>'; }

        panes.tables.addEventListener('click', function (ev) {
            var c = ev.target.closest('.sp-xchips .nf-chip');
            if (c) {
                var k = c.parentNode.getAttribute('data-k'), v = c.getAttribute('data-v');
                if (k === 'region') { tables.region = v; tables.leagueId = ''; }
                else if (k === 'division') { tables.division = +v; tables.leagueId = ''; }
                else tables.leagueId = v;
                tables.render();
                return;
            }
            var row = ev.target.closest('tr[data-team]');
            if (row) team.open(row);
        });
        panes.tables.addEventListener('keydown', function (ev) {
            var row = ev.target.closest && ev.target.closest('tr[data-team]');
            if (row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); team.open(row); }
        });

        /* ---------------- Ficha del equipo ---------------- */
        var shade = document.createElement('div');
        shade.className = 'st-shade';
        shade.hidden = true;
        document.body.appendChild(shade);
        var team = {
            row: null, back: null,
            open: function (row) {
                this.row = row; this.back = row;
                this.draw({ n: row.getAttribute('data-n'), b: row.getAttribute('data-b') }, null, false, false);
                var self = this, id = row.getAttribute('data-team');
                get('team&id=' + encodeURIComponent(id)).then(function (t) { if (self.row === row) self.draw({ n: row.getAttribute('data-n'), b: row.getAttribute('data-b') }, t && t.ok ? t : null, true, false); });
            },
            draw: function (base, t, done, full) {
                var place = t ? [t.loc, t.c].filter(Boolean).join(', ') : '';
                var b = '';
                if (!t) b = '<p class="mute">' + (done ? esc(tr('No hay información de este equipo')) : '<span class="sp-wait"></span>' + esc(tr('Cargando las tablas…'))) + '</p>';
                else {
                    if (t.y) b += '<p>' + esc(tr('Fundado en {year}', { year: t.y + (place ? ' · ' + place : '') })) + '</p>';
                    else if (place) b += '<p>' + esc(place) + '</p>';
                    if (t.st) b += '<p>' + esc(tr('Estadio: {name}', { name: t.st + (t.cap > 0 ? ' (' + t.cap + ')' : '') })) + '</p>';
                    if (t.lg) b += '<p>' + esc(tr('Liga: {name}', { name: t.lg })) + '</p>';
                    var hon = t.hon || [], total = hon.reduce(function (s, x) { return s + (+x.n || 0); }, 0);
                    if (total > 0) {
                        if (full) b += '<p><b>' + esc(tr('Títulos ({n}):', { n: total })) + '</b></p>' + hon.map(function (x) { return '<p class="mute">• ' + esc(x.t) + ' ×' + esc(x.n) + '</p>'; }).join('');
                        else b += '<p class="mute">' + esc(tr('Títulos ({n}): {list}', { n: total, list: hon.slice(0, 5).map(function (x) { return x.t + ' ×' + x.n; }).join(' · ') })) + '</p>';
                    }
                    if (t.d) b += '<p class="mute desc' + (full ? ' full' : '') + '">' + esc(t.d) + '</p>';
                }
                var logo = (t && t.b) || base.b;
                shade.innerHTML = '<div class="st-card" role="dialog" aria-modal="true" aria-labelledby="stCardT"><div class="st-card-head">' + (logo ? '<img src="' + esc(tiny(logo)) + '" alt="" onerror="this.remove()">' : '') +
                    '<h2 id="stCardT">' + esc((t && t.n) || base.n) + '</h2></div><div class="st-card-body">' + b + '</div><div class="st-card-foot">' +
                    (t && !full ? '<button type="button" class="ghost" data-act="more">' + esc(tr('Más detalles')) + '</button>' : '') +
                    '<button type="button" class="primary" data-act="ok">' + esc(tr('Entendido')) + '</button></div></div>';
                shade.hidden = false;
                this.t = t; this.base = base;
                var ok = shade.querySelector('[data-act=ok]');
                if (ok) ok.focus();
            },
            close: function () { shade.hidden = true; this.row = null; if (this.back) try { this.back.focus(); } catch (e) {} }
        };
        shade.addEventListener('click', function (ev) {
            if (ev.target === shade || ev.target.closest('[data-act=ok]')) { team.close(); return; }
            if (ev.target.closest('[data-act=more]')) team.draw(team.base, team.t, true, true);
        });
        document.addEventListener('keydown', function (ev) { if (!shade.hidden && ev.key === 'Escape') team.close(); });

        /* ---------------- Equipos y Selecciones ---------------- */
        var fx = {
            started: false, data: null, loading: false, failed: false, query: '', comp: '',
            recents: (function () { try { var l = JSON.parse(localStorage.getItem(RECENT) || '[]'); return Array.isArray(l) ? l.filter(function (s) { return typeof s === 'string' && s.trim(); }).slice(0, 5) : []; } catch (e) { return []; } })(),
            load: function () {
                this.render();
                if (this.started) return;
                this.started = true;
                this.loading = true;
                this.render();
                var self = this, tries = 0;
                (function ask() {
                    get('fixtures').then(function (r) {
                        if (r && r.events && (r.events.length || !self.data)) {
                            r.events.forEach(function (e) { ctx.prep(e); e.fx = 1; });
                            r.events.sort(function (a, b) { return a.t - b.t; });
                            self.data = r;
                        }
                        self.failed = !r || !r.ok;
                        self.loading = false;
                        self.render();
                        if (r && r.partial && ++tries < 12) wait(25000).then(ask);
                    });
                })();
            },
            remember: function (q) {
                this.recents = [q].concat(this.recents.filter(function (x) { return x.toLowerCase() !== q.toLowerCase(); })).slice(0, 5);
                try { localStorage.setItem(RECENT, JSON.stringify(this.recents)); } catch (e) {}
            },
            ended: function (e, now) { return now >= e.t.getTime() + minutes(e.sp) * 60000; },
            teamText: function (name) { var n = norm(name); if (!n) return ''; var a = alias[n]; return a && a !== n ? n + ' ' + a : n; },
            /* por equipo (cada palabra en el local o el visitante, también en español) o por país (su selección y los
               partidos de las ligas de ese país); solo los que no terminaron, hasta 80 */
            teams: function () {
                var d = this.data, q = norm(this.query), words = q.split(' ').filter(Boolean), self = this, now = Date.now();
                if (!d || !words.length) return [];
                var country = {};
                Object.keys(d.leagues || {}).forEach(function (id) { var c = self.teamText((d.leagues[id] || {}).c); if (c && (' ' + c + ' ').indexOf(' ' + q + ' ') > -1) country[id] = 1; });
                var out = [];
                for (var i = 0; i < d.events.length && out.length < 80; i++) {
                    var e = d.events[i];
                    var tm = !e.h && !e.a ? [norm(e.ev)] : [self.teamText(e.h), self.teamText(e.a)];
                    var hit = (e.l && country[e.l]) || tm.some(function (t) { return t && words.every(function (w) { return t.indexOf(w) > -1; }); });
                    if (hit && !self.ended(e, now)) out.push(e);
                }
                return out;
            },
            /* selecciones ("nat") por empezar o en vivo, en vivo primero; chips: competiciones masculinas y al final
               «Selección femenina» (todas las femeninas juntas) */
            nations: function (comp) {
                var d = this.data, live = [], next = [], chips = [], have = {}, women = false, now = Date.now(), self = this;
                if (!d) return { events: [], chips: [], women: false };
                d.events.forEach(function (e) {
                    var info = e.l ? (d.leagues || {})[e.l] : null;
                    if (!info || info.rg !== 'nat' || self.ended(e, now)) return;
                    if (+info.w === 1) women = true;
                    else if (!have[e.l]) { have[e.l] = 1; chips.push([e.l, info.n]); }
                    if (!comp || comp === e.l || (comp === 'w' && +info.w === 1)) {
                        if (e.t.getTime() <= now) live.push(e); else if (next.length < 150) next.push(e);
                    }
                });
                return { events: live.concat(next), chips: chips, women: women };
            },
            render: function () {
                if (cur !== 'teams' && cur !== 'nations') return;
                var box = panes.fx, h = '<div class="sp-xbar">', self = this, list = [];
                if (cur === 'teams') {
                    h += '<div class="sp-search"><input type="search" id="spTeamQ" enterkeyhint="search" placeholder="' + esc(tr('Buscar equipo o país')) + '" aria-label="' + esc(tr('Buscar equipo o país')) + '" value="' + esc(this.query) + '"></div>';
                    h += '<div class="sp-xchips" data-k="recent">' + this.recents.map(function (r) { return chip(r, '🔎 ' + r, self.query === r); }).join('') + '</div>';
                    list = this.teams();
                } else {
                    var all = this.nations('');
                    var chips = [['', tr('Todas')]].concat(all.chips, all.women ? [['w', tr('Selección femenina')]] : []);
                    if (this.comp && !chips.some(function (c) { return c[0] === self.comp; })) this.comp = '';
                    h += '<div class="sp-xchips" data-k="comp">' + chips.map(function (c) { return chip(c[0], c[1], self.comp === c[0]); }).join('') + '</div>';
                    list = this.nations(this.comp).events;
                }
                h += '</div><div id="spFxList">';
                if (this.loading && !this.data) h += empty(tr('Cargando los partidos…'), true);
                else if (list.length) h += '<div class="sp-grid">' + list.map(function (e) { return ctx.card(e); }).join('') + '</div>';
                else if (!this.data) h += empty(tr('No se pudieron cargar los partidos.'));
                else if (cur === 'nations') h += empty(tr('No hay partidos de selecciones en los próximos días.'));
                else if (!this.query) h += empty(tr('Escribe el nombre de un equipo o un país para ver sus próximos partidos.'));
                else h += empty(tr('No hay partidos de «{name}» en los próximos días.', { name: this.query }));
                box.innerHTML = h + '</div>';
                var qi = $('#spTeamQ', box);
                if (qi && this._focus) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
                this._focus = false;
            },
            list: function () {
                // solo la lista (al escribir no se redibuja la caja de búsqueda)
                var l = cur === 'teams' ? this.teams() : this.nations(this.comp).events, box = $('#spFxList', panes.fx);
                if (!box) { this.render(); return; }
                box.innerHTML = l.length ? '<div class="sp-grid">' + l.map(function (e) { return ctx.card(e); }).join('') + '</div>'
                    : (this.query ? empty(tr('No hay partidos de «{name}» en los próximos días.', { name: this.query })) : empty(tr('Escribe el nombre de un equipo o un país para ver sus próximos partidos.')));
            }
        };
        var qt = 0;
        panes.fx.addEventListener('input', function (ev) {
            if (ev.target.id !== 'spTeamQ') return;
            clearTimeout(qt);
            var v = ev.target.value.trim();
            qt = setTimeout(function () { fx.query = v; fx.list(); }, 300);
        });
        panes.fx.addEventListener('keydown', function (ev) {
            if (ev.target.id !== 'spTeamQ' || ev.key !== 'Enter') return;
            clearTimeout(qt);
            var v = ev.target.value.trim();
            fx.query = v;
            if (v) fx.remember(v);
            fx._focus = true;
            fx.render();
        });
        panes.fx.addEventListener('click', function (ev) {
            var c = ev.target.closest('.sp-xchips .nf-chip');
            if (!c) return;
            var k = c.parentNode.getAttribute('data-k'), v = c.getAttribute('data-v');
            if (k === 'recent') { fx.query = v; fx.remember(v); }
            else fx.comp = v;
            fx.render();
        });
        setInterval(function () { if (cur === 'teams' || cur === 'nations') fx.list(); }, 60000);

        var start = (location.hash || '').replace('#', '');
        show(start, false);
    };
})();
