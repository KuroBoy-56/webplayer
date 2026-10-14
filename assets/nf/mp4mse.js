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
