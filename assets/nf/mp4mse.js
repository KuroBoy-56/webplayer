/*
 * NFMp4 – reproduce un MP4 directo del servidor IPTV con MediaSource, con UNA sola pista de audio.
 *
 * El navegador manda: lee el archivo por rangos (directo del servidor IPTV, nunca pasa por el hosting),
 * separa las pistas con mp4box.js y le entrega al video solo la imagen y el idioma elegido.
 * Así no hay doble audio en iPhone (el reproductor nativo ya no decide) y en Chrome/Firefox/Edge
 * se puede cambiar el idioma de un MP4 con varias pistas, cosa que su reproductor nativo no permite.
 * Los subtítulos de texto del MP4 (tx3g) se muestran como subtítulos del navegador.
 */
(function () {
    'use strict';

    var MS = window.ManagedMediaSource || window.MediaSource || window.WebKitMediaSource;
    var LIB = 'assets/vendor/mp4box.min.js?v=1';
    // nombres de idioma en el idioma de la app (includes/i18n.php)
    var tr = window.NF_T || function (s) { return s; };
    var L = { es: tr('Español'), en: tr('Inglés'), pt: tr('Portugués'), fr: tr('Francés'), de: tr('Alemán'), it: tr('Italiano'), ja: tr('Japonés'),
        ko: tr('Coreano'), zh: tr('Chino'), ru: tr('Ruso'), ar: tr('Árabe'), hi: tr('Hindi'), tr: tr('Turco'), pl: tr('Polaco'), nl: tr('Neerlandés'), ca: tr('Catalán') };
    var NAMES = {
        spa: L.es, es: L.es, eng: L.en, en: L.en, por: L.pt, pt: L.pt, fre: L.fr, fra: L.fr, fr: L.fr, ger: L.de, deu: L.de, de: L.de, ita: L.it, it: L.it,
        jpn: L.ja, ja: L.ja, kor: L.ko, ko: L.ko, chi: L.zh, zho: L.zh, zh: L.zh, rus: L.ru, ru: L.ru, ara: L.ar, ar: L.ar, hin: L.hi, hi: L.hi,
        tur: L.tr, tr: L.tr, pol: L.pl, pl: L.pl, dut: L.nl, nld: L.nl, nl: L.nl, cat: L.ca, ca: L.ca
    };
    var GENERIC = /^(sound|video|text|subtitle)?\s*(handler|media handler)?$|^(isomedia|gpac|apple|core media|l-smash|mainconcept|bento4)/i;

    var libP = null;
    function loadLib() {
        if (window.MP4Box) return Promise.resolve();
        if (libP) return libP;
        libP = new Promise(function (ok, ko) {
            var s = document.createElement('script');
            s.src = LIB;
            s.async = true;
            s.onload = function () { window.MP4Box ? ok() : ko(new Error('mp4box')); };
            s.onerror = function () { libP = null; ko(new Error('mp4box no cargó')); };
            document.head.appendChild(s);
        });
        return libP;
    }

    /* ---------- índice compartido (api/vidx.php del panel; el mismo que leen y dejan Roku, Vega y Android) ----------
       Con el moov al final del archivo, leerlo del servidor IPTV son 3-10 MB de a 1 MB (15-35 s en servidores lentos).
       Si otro equipo ya lo dejó en la VPS / VDS de la línea, llega de ahí; si no lo tiene, se le deja el que se lea. */
    var VX = {};
    var KMAX = 12 * 1048576; // contenido del moov (16 MB en base64, el tope de la VPS / VDS)
    function within(p, ms) {
        return Promise.race([p.catch(function () { return null; }), new Promise(function (ok) { setTimeout(function () { ok(null); }, ms); })]);
    }
    function getJson(u, ms) {
        return within(fetch(u, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) { return r.json(); }), ms);
    }
    function vidxGet(link) {
        if (VX[link]) return VX[link];
        var x = VX[link] = { up: '', missing: false, sent: false };
        x.p = getJson(link, 4000).then(function (j) {
            if (!j || j.ok !== true || !j.head || !j.url) return null;
            x.up = j.url;
            return getJson(j.head, 3000).then(function (h) {
                if (!h) return null;
                if (h.ok !== true) { x.missing = h.ok === false; return null; } // {"ok": false}: no lo tiene
                if (h.kind !== 'm' || !(h.len > 0) || h.len > KMAX / 3 * 4 + 4) return null;
                return within(fetch(j.url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }).then(function (r) { return r.ok ? r.text() : null; }), 25000).then(function (t) {
                    var nl = t ? t.indexOf('\n') : -1, m = nl > 0 && nl < 80 ? /^VIDX1 m (\d+) (\d+)$/.exec(t.slice(0, nl)) : null;
                    if (!m || +m[1] !== h.size || +m[2] !== t.length - nl - 1) return null;
                    var bin = atob(t.slice(nl + 1)), u8 = new Uint8Array(bin.length);
                    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                    return u8.length >= 16 ? { size: +m[1], body: u8 } : null;
                });
            });
        }).catch(function () { return null; });
        return x;
    }
    /* la caja moov entera (cabecera de 8 bytes + contenido) */
    function moovBox(body) {
        var n = body.length + 8, u = new Uint8Array(n);
        u[0] = n >>> 24 & 255; u[1] = n >>> 16 & 255; u[2] = n >>> 8 & 255; u[3] = n & 255;
        u[4] = 109; u[5] = 111; u[6] = 111; u[7] = 118;
        u.set(body, 8);
        return u.buffer;
    }
    function b64(u8) {
        var s = '', CH = 0x8000;
        for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
        return btoa(s);
    }
    /* el moov leído del servidor IPTV, a la VPS / VDS: solo si dijo que no lo tenía, una vez, de a partes y después de
       que el video ya empezó */
    function vidxShare(x, size, body) {
        if (!x || x.sent || !x.missing || !x.up || !(size > 0)) return;
        x.sent = true;
        setTimeout(function () {
            var text = b64(body), PART = 1536000, n = Math.ceil(text.length / PART), i = 0;
            if (n > 12) return;
            var send = function () {
                // text/plain: sin consulta previa del navegador (la VPS / VDS lee el JSON igual)
                fetch(x.up, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, credentials: 'omit', referrerPolicy: 'no-referrer',
                    body: JSON.stringify({ kind: 'm', size: size, len: text.length, i: i, n: n, part: text.slice(i * PART, (i + 1) * PART) }) })
                    .then(function (r) { return r.json(); }).then(function (j) {
                        // no lo aceptó, o ya lo tiene (otro equipo lo dejó mientras tanto)
                        if (!j || j.ok !== true || j.have || j.saved || ++i >= n) return;
                        setTimeout(send, 400);
                    }).catch(function () {});
            };
            send();
        }, 8000);
    }

    /* MSE compara el códec en minúsculas para Opus/FLAC (mp4box los nombra como su caja: "Opus", "fLaC") */
    function codec(c) { c = String(c || ''); return /^(opus|flac)$/i.test(c) ? c.toLowerCase() : c; }

    function typeOk(mime) { try { return !!(MS && MS.isTypeSupported(mime)); } catch (e) { return false; } }

    function label(t, i, kind) {
        var lang = String(t.language || '').toLowerCase();
        var n = String(t.name || '').trim();
        var base = NAMES[lang] || (lang && lang !== 'und' ? lang.toUpperCase() : '');
        if (n && !GENERIC.test(n) && n.toLowerCase() !== lang) base = base ? base + ' · ' + n : n;
        if (!base) base = kind === 'sub' ? tr('Subtítulo {n}', { n: i + 1 }) : tr('Audio {n}', { n: i + 1 });
        if (kind !== 'sub' && t.audio && t.audio.channel_count > 2) base += ' ' + (t.audio.channel_count >= 6 ? '5.1' : t.audio.channel_count + 'ch');
        return base;
    }

    /**
     * opts: start (segundos), pick(list) -> índice de la pista de audio, onInfo(engine) -> false para no usarlo,
     *       onError(motivo), onFatal(motivo)
     */
    function NFMp4(video, url, opts) {
        this.v = video;
        this.url = this.src = url;
        this.o = opts || {};
        this.audio = [];
        this.subs = [];
        this.audioId = null;
        this.gen = 0;
        this._h = {};
        // el índice compartido se pide ya, mientras se lee el principio del archivo
        this.vx = this.o.vidx && window.fetch ? vidxGet(this.o.vidx) : null;
        this.start(this.o.start || 0, null);
    }

    NFMp4.supported = function () {
        return !!(MS && window.fetch && window.Promise && window.AbortController && window.ArrayBuffer);
    };
    NFMp4.load = loadLib;

    var P = NFMp4.prototype;

    P.start = function (t, audioId) {
        var self = this, g = ++this.gen;
        this.t0 = t || 0;
        this.wantAudio = audioId;
        this.pos = 0;
        this.size = 0;
        this.busy = false;
        this.ready = false;
        this.flushed = false;
        this.fails = 0;
        this.vxUsed = false;
        this.km = null;
        loadLib().then(function () {
            if (g !== self.gen || self.dead) return;
            self.file = window.MP4Box.createFile();
            self.file.onError = function (m, msg) { self.err('mp4box ' + msg); };
            self.file.onReady = function (info) { if (g === self.gen) self.onReady(info); };
            self.file.onSegment = function (id, user, buf, next) {
                if (g !== self.gen) return;
                user.q.push(buf);
                self.pump(user);
                try { self.file.releaseUsedSamples(id, next); } catch (e) {}
            };
            self.file.onSamples = function (id, sub, samples) { if (g === self.gen) self.onSubs(id, sub, samples); };
            self.tick();
        }, function (e) { self.err(e.message); });
    };

    P.err = function (why) {
        if (this.dead) return;
        if (this.o.onError) this.o.onError(why);
    };

    /* ---------- descarga por rangos ---------- */
    P.rate = function () {
        // bytes por segundo del archivo (para decidir cuánto adelantar sin llenar la memoria del navegador)
        return this.size && this.dur ? this.size / this.dur : 1500000;
    };
    P.ahead = function () {
        var v = this.v, b = v.buffered, t = v.currentTime;
        for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) >= t) return b.end(i) - t;
        return 0;
    };
    P.maxAhead = function () {
        // ~90 MB por delante como máximo (4K ~25-30 s, 1080p ~2-3 min), y nunca menos de 20 s
        return Math.max(20, Math.min(150, 90e6 / this.rate()));
    };
    P.chunk = function () {
        if (!this.ready) return 1 << 20;
        return Math.max(1 << 20, Math.min(8 << 20, Math.round(this.rate() * 4)));
    };

    P.tick = function () {
        var self = this;
        clearTimeout(this._tk);
        this._tk = null;
        if (this.dead || this.busy || !this.file) return;
        if (this.size && this.pos >= this.size) {
            if (!this.flushed) { this.flushed = true; try { this.file.flush(); } catch (e) {} }
            this.maybeEnd();
            return;
        }
        if (this.ready && !this.attached) return; // se espera a que el video abra el MediaSource
        if (this.ready && this.ahead() > this.maxAhead()) { this._tk = setTimeout(function () { self.tick(); }, 1000); return; }
        // la lectura saltó a los últimos MB (moov al final): el índice compartido, si llega en 8 s como mucho
        if (!this.ready && this.vx && !this.vxUsed && this.size && this.pos > 0 && this.pos >= this.size - 8 - KMAX) {
            this.vxUsed = true;
            this.busy = true;
            var g0 = this.gen, at = this.pos;
            within(this.vx.p, 8000).then(function (x) {
                if (g0 !== self.gen || self.dead) return;
                self.busy = false;
                if (x && x.size === self.size && at === self.pos && at === x.size - 8 - x.body.length) {
                    self.shared = true;
                    try { self.file.appendBuffer(window.MP4Box.MP4BoxBuffer.fromArrayBuffer(moovBox(x.body), at), true); } catch (e) {}
                    if (g0 !== self.gen || self.dead) return; // (el reproductor ya pasó al nativo con lo que leyó)
                    // no sirvió: el reproductor prueba otra forma (como cualquier índice que no se pudo leer)
                    if (!self.ready) { self.err('índice compartido'); return; }
                    self.pos = self.size;
                }
                self.tick();
            });
            return;
        }
        var g = this.gen, sq = this.seq = (this.seq || 0) + 1, st = this.pos, en = st + this.chunk() - 1;
        if (this.size) en = Math.min(en, this.size - 1);
        var ctl = this.ctl = new AbortController();
        this.busy = true;
        fetch(this.src, {
            headers: { Range: 'bytes=' + st + '-' + en },
            signal: ctl.signal, mode: 'cors', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'
        }).then(function (r) {
            if (r.status !== 206) {
                // el servidor no acepta rangos: no se puede navegar el archivo, se usa el reproductor nativo
                try { ctl.abort(); } catch (e) {}
                throw new Error(r.status === 200 ? 'sin rangos' : 'http ' + r.status);
            }
            var cr = r.headers.get('Content-Range') || '', m = cr.match(/\/(\d+)\s*$/);
            if (m) self.size = +m[1];
            // muchos servidores IPTV redirigen a un enlace temporal: se sigue usando ese enlace
            if (r.url && r.url !== self.src && r.redirected) self.src = r.url;
            return r.arrayBuffer();
        }).then(function (ab) {
            if (g !== self.gen || sq !== self.seq || self.dead) return;
            self.busy = false;
            self.fails = 0;
            if (!ab.byteLength) { self.size = self.size || st; self.tick(); return; }
            // la VPS / VDS no tenía el índice: se guarda una copia del moov que se está leyendo para dejárselo
            if (!self.ready && self.vx && self.vx.missing && !self.vx.sent) self.keepMoov(st, ab);
            var buf = window.MP4Box.MP4BoxBuffer.fromArrayBuffer(ab, st);
            var next = self.file.appendBuffer(buf, self.size && st + ab.byteLength >= self.size);
            self.pos = (typeof next === 'number' && next > st) ? next : st + ab.byteLength;
            if (!self.ready && st === 0 && ab.byteLength < 4096 && !self.size) { self.err('archivo vacío'); return; }
            self.tick();
        }).catch(function (e) {
            if (g !== self.gen || sq !== self.seq || self.dead) return;
            self.busy = false;
            if (e && e.name === 'AbortError') return;
            // antes de empezar no se insiste: CORS bloqueado, sin rangos, etc. → el reproductor prueba otra forma
            if (!self.ready) { self.err(e && e.message || 'red'); return; }
            if (++self.fails > 6) { self.src = self.url; if (self.o.onFatal) self.o.onFatal('red'); return; }
            if (self.fails === 3) self.src = self.url; // el enlace temporal pudo vencer
            self._tk = setTimeout(function () { self.tick(); }, Math.min(8000, 600 * self.fails * self.fails));
        });
    };

    /* copia del moov leído del servidor (desde la primera lectura después del salto, de corrido) */
    P.keepMoov = function (st, ab) {
        var k = this.km;
        if (!k) {
            if (st === 0 || ab.byteLength < 8) return; // (moov al principio: no hace falta)
            var h = new Uint8Array(ab, 0, 8);
            if (h[4] !== 109 || h[5] !== 111 || h[6] !== 111 || h[7] !== 118) return;
            var n = h[0] * 16777216 + (h[1] << 16) + (h[2] << 8) + h[3];
            if (n < 16 || n - 8 > KMAX) { this.km = { dead: true }; return; }
            k = this.km = { at: st, n: n, body: new Uint8Array(n - 8), got: 0 };
        }
        if (k.dead || k.done) return;
        var from = Math.max(st, k.at + 8), to = Math.min(st + ab.byteLength, k.at + k.n);
        if (from !== k.at + 8 + k.got) { k.dead = true; return; }
        if (to > from) { k.body.set(new Uint8Array(ab, from - st, to - from), k.got); k.got += to - from; }
        if (k.got === k.n - 8) { k.done = true; vidxShare(this.vx, this.size, k.body); }
    };

    /* ---------- pistas ---------- */
    P.onReady = function (info) {
        var self = this, v = this.v;
        if (info.isFragmented && !info.duration) { this.err('mp4 fragmentado'); return; }
        var vt = info.videoTracks && info.videoTracks[0];
        if (!vt) { this.err('sin video'); return; }
        this.vmime = 'video/mp4; codecs="' + codec(vt.codec) + '"';
        this.videoOk = typeOk(this.vmime);
        this.dur = info.duration / info.timescale;
        this.audio = (info.audioTracks || []).map(function (t, i) {
            var mime = 'audio/mp4; codecs="' + codec(t.codec) + '"';
            return { id: t.id, i: i, codec: t.codec, lang: String(t.language || '').toLowerCase(), label: label(t, i), mime: mime, ok: typeOk(mime) };
        });
        this.subs = (info.subtitleTracks || []).concat(info.otherTracks || []).filter(function (t) { return /^tx3g|^text|^wvtt/i.test(t.codec); }).map(function (t, i) {
            return { id: t.id, lang: String(t.language || '').toLowerCase(), label: label(t, i, 'sub'), codec: t.codec, ts: t.timescale };
        });
        var usable = this.audio.filter(function (a) { return a.ok; });
        if (!this.ready && this.o.onInfo && this.o.onInfo(this) === false) return; // el reproductor decide usar el nativo
        if (!this.videoOk) { this.err('códec de video ' + vt.codec); return; }
        if (this.audio.length && !usable.length) { this.err('códec de audio ' + this.audio[0].codec); return; }
        var a = null;
        if (this.wantAudio != null) a = usable.filter(function (x) { return x.id === self.wantAudio; })[0];
        if (!a && usable.length) {
            var k = this.o.pick ? this.o.pick(usable) : 0;
            a = usable[k] || usable[0];
        }
        this.audioId = a ? a.id : null;
        this.ready = true;
        this.attached = false;

        var ms = this.ms = new MS(), g = this.gen;
        if (window.ManagedMediaSource && ms instanceof window.ManagedMediaSource) v.disableRemotePlayback = true;
        this.objUrl = URL.createObjectURL(ms);
        ms.addEventListener('sourceopen', function () {
            if (g !== self.gen || self.dead) return;
            try { ms.duration = self.dur; } catch (e) {}
            self.vs = self.addSb(self.vmime, 'v');
            self.as = a ? self.addSb(a.mime, 'a') : null;
            if (!self.vs || (a && !self.as)) { self.err('MediaSource'); return; }
            var f = self.file;
            f.setSegmentOptions(vt.id, self.vs, { nbSamples: 100 });
            if (a) f.setSegmentOptions(a.id, self.as, { nbSamples: 100 });
            self.subs.forEach(function (s) { if (/^tx3g/i.test(s.codec)) { s.tt = self.textTrack(s); f.setExtractionOptions(s.id, s, { nbSamples: 20 }); } });
            var init = f.initializeSegmentation('per-track');
            init.forEach(function (it) { it.user.q.unshift(it.buffer); });
            f.start();
            // se pide el archivo desde el punto de inicio (si el índice estaba al final, el video aún no se descargó)
            var sk = f.seek(self.t0 > 0.5 ? self.t0 : 0, true);
            self.pos = sk.offset;
            self.flushed = false;
            self.attached = true;
            self.pump(self.vs);
            if (self.as) self.pump(self.as);
            self.tick();
        }, { once: true });
        this.bindVideo();
        v.src = this.objUrl;
        if (this.t0 > 0.5) {
            var go = function () { v.removeEventListener('loadedmetadata', go); try { v.currentTime = self.t0; } catch (e) {} };
            v.addEventListener('loadedmetadata', go);
        }
        if (this.o.onTracks) this.o.onTracks(this);
    };

    P.addSb = function (mime, kind) {
        var self = this, sb;
        try { sb = this.ms.addSourceBuffer(mime); } catch (e) { return null; }
        var u = { sb: sb, q: [], kind: kind };
        sb.addEventListener('updateend', function () { self.trim(u); self.pump(u); self.maybeEnd(); });
        sb.addEventListener('error', function () { self.err('sourcebuffer'); });
        return u;
    };

    P.pump = function (u) {
        if (!u || !u.sb || u.sb.updating || !u.q.length || this.dead || !this.ms || this.ms.readyState !== 'open') return;
        var buf = u.q.shift(), self = this;
        try {
            u.sb.appendBuffer(buf);
        } catch (e) {
            if (e && e.name === 'QuotaExceededError') {
                // memoria del navegador llena: se borra lo ya visto y se reintenta
                u.q.unshift(buf);
                var t = this.v.currentTime;
                if (u.sb.buffered.length && u.sb.buffered.start(0) < t - 4) { try { u.sb.remove(0, t - 3); } catch (x) {} }
                else setTimeout(function () { self.pump(u); }, 1500);
                return;
            }
            this.err('append ' + (e && e.name));
        }
    };

    /* borra lo que quedó muy atrás para no llenar la memoria (importante en celulares y 4K) */
    P.trim = function (u) {
        var b = u.sb.buffered, t = this.v.currentTime;
        if (!b.length || u.sb.updating) return;
        var keep = Math.max(10, Math.min(60, 30e6 / this.rate()));
        if (b.start(0) < t - keep - 10) { try { u.sb.remove(0, t - keep); } catch (e) {} }
    };

    P.maybeEnd = function () {
        var ms = this.ms;
        if (!ms || ms.readyState !== 'open' || !this.flushed || !(this.size && this.pos >= this.size)) return;
        var us = [this.vs, this.as].filter(Boolean);
        for (var i = 0; i < us.length; i++) if (us[i].q.length || us[i].sb.updating) return;
        try { ms.endOfStream(); } catch (e) {}
    };

    function inBuf(b, t) {
        for (var i = 0; i < b.length; i++) if (b.start(i) <= t + 0.3 && b.end(i) > t + 0.3) return true;
        return false;
    }

    /* adelantar/retroceder fuera de lo descargado: se pide el archivo desde ese punto */
    P.jump = function (t) {
        if (!this.ready || !this.file || this.dead) return;
        if (inBuf(this.v.buffered, t)) return;
        if (this.ctl) { try { this.ctl.abort(); } catch (e) {} }
        this.seq++;
        this.busy = false;
        [this.vs, this.as].forEach(function (u) { if (u) u.q.length = 0; });
        var sk = this.file.seek(t, true);
        this.pos = sk.offset;
        this.flushed = false;
        if (this.ms && this.ms.readyState === 'ended') { try { this.vs.sb.abort(); } catch (e) {} }
        this.tick();
    };

    P.bindVideo = function () {
        var self = this, v = this.v;
        this.unbindVideo();
        this._h = {
            seeking: function () { self.jump(v.currentTime); },
            waiting: function () { if (!inBuf(v.buffered, v.currentTime)) self.jump(v.currentTime); else self.tick(); },
            timeupdate: function () { if (!self.busy && !self._tk) self.tick(); }
        };
        for (var k in this._h) v.addEventListener(k, this._h[k]);
    };
    P.unbindVideo = function () {
        for (var k in this._h) this.v.removeEventListener(k, this._h[k]);
        this._h = {};
    };

    /* ---------- subtítulos de texto del MP4 ---------- */
    P.textTrack = function (s) {
        var v = this.v, reg = v._nfSubs = v._nfSubs || {}, key = s.id + '|' + s.lang + '|' + s.label;
        if (!reg[key]) { reg[key] = v.addTextTrack('subtitles', s.label, s.lang); reg[key].mode = 'disabled'; reg[key]._seen = {}; }
        return reg[key];
    };
    P.onSubs = function (id, s, samples) {
        var dec = this._dec = this._dec || (window.TextDecoder ? new TextDecoder('utf-8') : null), last = 0;
        samples.forEach(function (x) {
            last = x.number;
            if (!x.data || x.data.length < 3 || !s.tt || s.tt._seen[x.cts]) return;
            var len = (x.data[0] << 8) | x.data[1];
            if (!len) return;
            var raw = x.data.subarray(2, 2 + len), txt = dec ? dec.decode(raw) : String.fromCharCode.apply(null, raw);
            s.tt._seen[x.cts] = 1;
            try { s.tt.addCue(new (window.VTTCue || window.TextTrackCue)(x.cts / x.timescale, (x.cts + x.duration) / x.timescale, txt)); } catch (e) {}
        });
        try { this.file.releaseUsedSamples(id, last + 1); } catch (e) {}
    };

    /* ---------- cambiar de idioma: se rearma solo el flujo desde el mismo punto ---------- */
    P.setAudio = function (id) {
        if (id === this.audioId) return;
        var t = this.v.currentTime || this.t0, playing = !this.v.paused;
        this.teardown();
        this.start(t, id);
        if (playing) {
            var v = this.v, go = function () { v.removeEventListener('loadedmetadata', go); var p = v.play(); if (p && p.catch) p.catch(function () {}); };
            v.addEventListener('loadedmetadata', go);
        }
    };

    P.teardown = function () {
        this.gen++;
        clearTimeout(this._tk);
        this._tk = null;
        if (this.ctl) { try { this.ctl.abort(); } catch (e) {} }
        this.unbindVideo();
        if (this.file) { try { this.file.stop(); } catch (e) {} this.file = null; }
        if (this.v.textTracks) for (var i = 0; i < this.v.textTracks.length; i++) { var tt = this.v.textTracks[i]; if (tt._seen) { tt._wasMode = tt.mode; } }
        this.vs = this.as = null;
        if (this.objUrl) { try { URL.revokeObjectURL(this.objUrl); } catch (e) {} this.objUrl = null; }
        this.ms = null;
    };

    P.destroy = function () {
        this.dead = true;
        this.teardown();
        var v = this.v;
        if (v._nfSubs) for (var k in v._nfSubs) v._nfSubs[k].mode = 'disabled';
    };

    window.NFMp4 = NFMp4;
})();
