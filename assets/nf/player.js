/*
 * NFPlayer – reproductor estilo Netflix.
 * Prueba varias fuentes en orden (directo → proxy, mp4 → mkv → m3u8...) y usa
 * hls.js para HLS, mpegts.js para TS y el reproductor nativo para MP4/MKV/WEBM.
 */
(function () {
    'use strict';

    var ICONS = {
        play: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 4v16a1 1 0 0 0 1.5.86l13-8a1 1 0 0 0 0-1.72l-13-8A1 1 0 0 0 6 4z"/></svg>',
        pause: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
        back10: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/><text x="12" y="16.3" font-size="6.5" font-weight="700" text-anchor="middle" fill="currentColor" font-family="Arial">10</text></svg>',
        fwd10: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 5V1l5 5-5 5V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z"/><text x="12" y="16.3" font-size="6.5" font-weight="700" text-anchor="middle" fill="currentColor" font-family="Arial">10</text></svg>',
        vol: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
        mute: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9zm18.7 1.4-1.4-1.4L18 11.3 15.7 9l-1.4 1.4 2.3 2.3-2.3 2.3 1.4 1.4 2.3-2.3 2.3 2.3 1.4-1.4-2.3-2.3z"/></svg>',
        full: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 5h5v2H7v3H5zm9 0h5v5h-2V7h-3zM5 14h2v3h3v2H5zm12 3v-3h2v5h-5v-2z"/></svg>',
        exitfull: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M8 5h2v5H5V8h3zm6 0h2v3h3v2h-5zM5 14h5v5H8v-3H5zm9 0h5v2h-3v3h-2z"/></svg>',
        subs: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2zm2 5v2h4V9zm6 0v2h6V9zm-6 4v2h8v-2zm10 0v2h2v-2z"/></svg>',
        speed: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 4a9 9 0 0 0-7.8 13.5l1.7-1A7 7 0 1 1 19 13h2a9 9 0 0 0-9-9zm4.2 3.4-5 5a1.5 1.5 0 1 0 2.1 2.1l3.6-6.4z"/></svg>',
        next: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M5 5v14l10-7zm11 0h3v14h-3z"/></svg>',
        pip: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 5h18v14H3zm2 2v10h14V7zm6 4h7v5h-7z"/></svg>',
        back: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z"/></svg>',
        dots: '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 7a2 2 0 1 1 0-4 2 2 0 0 1 0 4z"/></svg>'
    };

    function fmt(s) {
        if (!isFinite(s) || s < 0) s = 0;
        s = Math.floor(s);
        var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (x < 10 ? '0' : '') + x;
    }
    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }
    function store(k, v) {
        try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    }

    function NFPlayer(root, opts) {
        if (!(this instanceof NFPlayer)) return new NFPlayer(root, opts);
        this.root = root;
        this.o = opts;
        this.idx = -1;
        this.hls = null;
        this.ts = null;
        this.resumed = false;
        this.live = !!opts.live;
        this.build();
        this.bind();
        this.next();
    }

    NFPlayer.prototype.build = function () {
        var o = this.o, r = this.root;
        r.classList.add('nfp');
        r.innerHTML = '';
        var v = this.v = el('video', 'nfp-video');
        v.setAttribute('playsinline', '');
        v.setAttribute('webkit-playsinline', '');
        v.setAttribute('preload', 'auto');
        v.setAttribute('controlslist', 'nodownload');
        v.disablePictureInPicture = false;
        r.appendChild(v);

        this.spin = r.appendChild(el('div', 'nfp-spin'));
        this.flash = r.appendChild(el('div', 'nfp-flash'));
        this.msg = r.appendChild(el('div', 'nfp-msg'));

        var top = r.appendChild(el('div', 'nfp-top'));
        if (o.backUrl) top.innerHTML = '<a class="nfp-ib nfp-back" href="' + o.backUrl + '" aria-label="Volver">' + ICONS.back + '</a>';
        var tt = el('div', 'nfp-title');
        tt.innerHTML = '<b></b><span></span>';
        tt.querySelector('b').textContent = o.title || '';
        tt.querySelector('span').textContent = o.subtitle || '';
        top.appendChild(tt);
        if (o.topRight) top.insertAdjacentHTML('beforeend', o.topRight);

        var mid = this.mid = r.appendChild(el('div', 'nfp-mid'));
        if (!this.live) mid.appendChild(this.mkBtn('back10', 'Retroceder 10 s', function () { this.seekBy(-10); }));
        this.midPlay = mid.appendChild(this.mkBtn('play', 'Reproducir', function () { this.toggle(); }));
        this.midPlay.classList.add('big');
        if (!this.live) mid.appendChild(this.mkBtn('fwd10', 'Adelantar 10 s', function () { this.seekBy(10); }));

        var bot = r.appendChild(el('div', 'nfp-bottom'));
        if (!this.live) {
            var bar = this.bar = bot.appendChild(el('div', 'nfp-bar'));
            bar.innerHTML = '<div class="nfp-rail"><i class="buf"></i><i class="cur"></i><span class="knob"></span></div><div class="nfp-tip"></div>';
            this.time = bot.appendChild(el('div', 'nfp-time'));
        } else {
            bot.appendChild(el('div', 'nfp-live', '<i></i>EN VIVO'));
        }
        var row = bot.appendChild(el('div', 'nfp-row'));
        this.bPlay = row.appendChild(this.mkBtn('play', 'Reproducir', function () { this.toggle(); }));
        if (!this.live) {
            row.appendChild(this.mkBtn('back10', 'Retroceder 10 s', function () { this.seekBy(-10); })).classList.add('d');
            row.appendChild(this.mkBtn('fwd10', 'Adelantar 10 s', function () { this.seekBy(10); })).classList.add('d');
        }
        var volWrap = row.appendChild(el('div', 'nfp-vol'));
        this.bVol = volWrap.appendChild(this.mkBtn('vol', 'Silenciar', function () { this.v.muted = !this.v.muted; }));
        this.volRange = volWrap.appendChild(el('input', 'nfp-range'));
        this.volRange.type = 'range'; this.volRange.min = 0; this.volRange.max = 1; this.volRange.step = 0.05;
        if (!this.live) this.timeRow = row.appendChild(el('div', 'nfp-time2'));
        var mt = row.appendChild(el('div', 'nfp-midtitle'));
        mt.textContent = (o.title || '') + (o.subtitle ? '  ·  ' + o.subtitle : '');
        if (o.nextUrl) this.bNext = row.appendChild(this.mkBtn('next', 'Siguiente episodio', function () { this.goNext(); }));
        this.bSubs = row.appendChild(this.mkBtn('subs', 'Audio y subtítulos', function (e) { this.menu('tracks', e); }));
        if (!this.live) row.appendChild(this.mkBtn('speed', 'Velocidad', function (e) { this.menu('speed', e); }));
        if (document.pictureInPictureEnabled) row.appendChild(this.mkBtn('pip', 'Imagen en imagen', function () { this.pip(); })).classList.add('d');
        if (o.extraMenu && o.extraMenu.length) row.appendChild(this.mkBtn('dots', 'Más opciones', function (e) { this.menu('extra', e); }));
        this.bFull = row.appendChild(this.mkBtn('full', 'Pantalla completa', function () { this.fullscreen(); }));

        this.pop = r.appendChild(el('div', 'nfp-pop'));
        this.endBox = r.appendChild(el('div', 'nfp-end'));

        var vol = parseFloat(store('nfp_vol'));
        v.volume = isFinite(vol) ? vol : 1;
        this.volRange.value = v.volume;
    };

    NFPlayer.prototype.mkBtn = function (icon, label, fn) {
        var b = el('button', 'nfp-ib', ICONS[icon]);
        b.type = 'button';
        b.setAttribute('aria-label', label);
        b.title = label;
        var self = this;
        b.addEventListener('click', function (e) { e.stopPropagation(); fn.call(self, e); self.wake(); });
        return b;
    };

    NFPlayer.prototype.setIcon = function (btn, icon) { if (btn) btn.innerHTML = ICONS[icon]; };

    NFPlayer.prototype.bind = function () {
        var self = this, v = this.v, r = this.root;
        v.addEventListener('play', function () { self.state(); });
        v.addEventListener('pause', function () { self.state(); self.emit('pause'); });
        v.addEventListener('waiting', function () { r.classList.add('buffering'); });
        v.addEventListener('stalled', function () { r.classList.add('buffering'); });
        v.addEventListener('playing', function () { r.classList.remove('buffering', 'needtap'); self.ok = true; clearTimeout(self.loadTimer); self.hideMsg(); self.watchAudio(); });
        v.addEventListener('canplay', function () { r.classList.remove('buffering'); });
        v.addEventListener('loadedmetadata', function () {
            self.ok = true;
            clearTimeout(self.loadTimer);
            if (!self.tc && !self.resumed && self.o.resume > 5 && isFinite(v.duration) && self.o.resume < v.duration - 10) {
                try { v.currentTime = self.o.resume; } catch (e) {}
                self.resumed = true;
                self.toastMsg('Continuando desde ' + fmt(self.o.resume));
            }
            self.applyAudioPref();
            self.updTime();
            if (!self.tc && !self.live) self.probe();
            if (self.tc) self.applySub();
        });
        v.addEventListener('timeupdate', function () { self.updTime(); self.emit('time'); });
        v.addEventListener('progress', function () { self.updBuf(); });
        v.addEventListener('volumechange', function () {
            self.setIcon(self.bVol, v.muted || v.volume === 0 ? 'mute' : 'vol');
            self.volRange.value = v.muted ? 0 : v.volume;
            store('nfp_vol', v.volume);
        });
        v.addEventListener('ended', function () { self.emit('ended'); self.onEnded(); });
        v.addEventListener('error', function () {
            if (self.hls || self.ts || !v.getAttribute('src')) return;
            if (self.tc) { self.tc = null; self.o.media = null; self.toastMsg('No se pudo convertir el audio de este contenido'); self.idx--; self.next(); return; }
            // el navegador no abre el archivo (MKV/AVI, audio Dolby, HEVC...): se intenta la conversión del servidor antes de cambiar de formato
            if (self.o.media && !self.live && !self._rescued) { self._rescued = true; self.rescueTc(); return; }
            self.fail('native ' + (v.error ? v.error.code : ''));
        });

        this.volRange.addEventListener('input', function () { v.volume = parseFloat(this.value); v.muted = v.volume === 0; });

        // barra de progreso
        if (this.bar) {
            var rail = this.bar.querySelector('.nfp-rail'), tip = this.bar.querySelector('.nfp-tip'), dragging = false;
            var pos = function (e) {
                var rc = rail.getBoundingClientRect();
                var x = (e.touches ? e.touches[0].clientX : e.clientX) - rc.left;
                return Math.max(0, Math.min(1, x / rc.width));
            };
            var preview = function (p) {
                self.bar.querySelector('.cur').style.width = (p * 100) + '%';
                self.bar.querySelector('.knob').style.left = (p * 100) + '%';
            };
            var down = function (e) { if (!isFinite(self.D())) return; dragging = true; self.root.classList.add('seeking'); preview(pos(e)); e.preventDefault(); };
            var move = function (e) {
                var p = pos(e);
                if (isFinite(self.D())) {
                    tip.textContent = fmt(p * self.D());
                    tip.style.left = (p * 100) + '%';
                }
                if (dragging) { preview(p); self.wake(); }
            };
            var up = function (e) {
                if (!dragging) return;
                dragging = false;
                self.root.classList.remove('seeking');
                var p = pos(e.changedTouches ? { clientX: e.changedTouches[0].clientX } : e);
                self.seekAbs(p * self.D());
            };
            this.bar.addEventListener('mousedown', down);
            this.bar.addEventListener('touchstart', down, { passive: false });
            this.bar.addEventListener('mousemove', move);
            document.addEventListener('mousemove', function (e) { if (dragging) move(e); });
            document.addEventListener('touchmove', function (e) { if (dragging) move(e); }, { passive: true });
            document.addEventListener('mouseup', up);
            document.addEventListener('touchend', up);
        }

        // ocultar controles
        var wake = function () { self.wake(); };
        r.addEventListener('mousemove', wake);
        r.addEventListener('touchstart', function (e) {
            if (e.target === v || e.target === r || e.target.classList.contains('nfp-mid')) {
                if (!r.classList.contains('idle') && !self.v.paused && e.touches.length === 1) {
                    // doble toque a los lados = ±10 s
                    var now = Date.now(), x = e.touches[0].clientX, w = r.clientWidth;
                    if (self.lastTap && now - self.lastTap < 300 && !self.live) {
                        self.seekBy(x < w / 2 ? -10 : 10);
                        self.lastTap = 0;
                        return;
                    }
                    self.lastTap = now;
                    clearTimeout(self.tapT);
                    self.tapT = setTimeout(function () { r.classList.add('idle'); }, 300);
                    return;
                }
            }
            self.wake();
        }, { passive: true });
        v.addEventListener('click', function () {
            if (window.matchMedia('(hover: hover)').matches) self.toggle();
        });
        v.addEventListener('dblclick', function () { self.fullscreen(); });
        r.addEventListener('click', function (e) { if (!e.target.closest('.nfp-pop') && !e.target.closest('.nfp-ib')) self.closePop(); });

        document.addEventListener('keydown', function (e) {
            if (self.dead) return;
            if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
            var k = e.key;
            if (k === ' ' || k === 'k' || k === 'K') { self.toggle(); e.preventDefault(); }
            else if ((k === 'ArrowRight' || k === 'l') && !self.live) { self.seekBy(10); e.preventDefault(); }
            else if ((k === 'ArrowLeft' || k === 'j') && !self.live) { self.seekBy(-10); e.preventDefault(); }
            else if (k === 'ArrowUp') { v.volume = Math.min(1, v.volume + 0.1); v.muted = false; e.preventDefault(); }
            else if (k === 'ArrowDown') { v.volume = Math.max(0, v.volume - 0.1); e.preventDefault(); }
            else if (k === 'f' || k === 'F') self.fullscreen();
            else if (k === 'm' || k === 'M') v.muted = !v.muted;
            else if ((k === 'n' || k === 'N') && self.o.nextUrl) self.goNext();
            else if (k === 'Escape') self.closePop();
            else return;
            self.wake();
        });
        document.addEventListener('fullscreenchange', function () { self.setIcon(self.bFull, document.fullscreenElement ? 'exitfull' : 'full'); });
        document.addEventListener('webkitfullscreenchange', function () { self.setIcon(self.bFull, document.webkitFullscreenElement ? 'exitfull' : 'full'); });
        this.wake();
    };

    NFPlayer.prototype.wake = function () {
        var r = this.root, self = this;
        r.classList.remove('idle');
        clearTimeout(this.idleT);
        this.idleT = setTimeout(function () {
            if (!self.v.paused && !self.pop.classList.contains('open')) r.classList.add('idle');
        }, 3200);
    };

    NFPlayer.prototype.state = function () {
        var p = this.v.paused;
        this.setIcon(this.bPlay, p ? 'play' : 'pause');
        this.setIcon(this.midPlay, p ? 'play' : 'pause');
        this.root.classList.toggle('paused', p);
        this.wake();
    };

    NFPlayer.prototype.toggle = function () {
        var v = this.v;
        if (v.paused) { var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } else v.pause();
        this.flash.innerHTML = v.paused ? ICONS.pause : ICONS.play;
        this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go');
    };

    /* tiempo virtual: en modo conversión el video empieza en "tc.off" segundos */
    NFPlayer.prototype.T = function () { return (this.tc ? this.tc.off : 0) + (this.v.currentTime || 0); };
    NFPlayer.prototype.D = function () { return this.tc ? this.tc.dur : this.v.duration; };
    NFPlayer.prototype.seekAbs = function (t) {
        if (this.tc) { this.startTc(Math.max(0, t), this.tc.a, this.tc.vt); return; }
        try { this.v.currentTime = t; } catch (e) {}
    };
    NFPlayer.prototype.seekBy = function (s) {
        var d = this.D();
        if (!isFinite(d)) return;
        this.seekAbs(Math.max(0, Math.min(d - 0.5, this.T() + s)));
        this.flash.innerHTML = s < 0 ? ICONS.back10 : ICONS.fwd10;
        this.flash.classList.remove('go'); void this.flash.offsetWidth; this.flash.classList.add('go');
    };

    NFPlayer.prototype.updTime = function () {
        if (!this.bar) return;
        var d = this.D(), c = this.T();
        if (!this.root.classList.contains('seeking') && isFinite(d) && d > 0) {
            var p = (c / d) * 100;
            this.bar.querySelector('.cur').style.width = p + '%';
            this.bar.querySelector('.knob').style.left = p + '%';
        }
        var left = isFinite(d) ? d - c : 0;
        this.time.textContent = isFinite(d) ? fmt(left) : '';
        if (this.timeRow) this.timeRow.textContent = fmt(c) + (isFinite(d) ? ' / ' + fmt(d) : '');
        if (this.o.nextUrl && isFinite(d) && d > 120 && left < 25 && left > 0 && !this.endShown) this.showNext(false);
    };

    NFPlayer.prototype.updBuf = function () {
        if (!this.bar) return;
        var v = this.v, d = this.D(), off = this.tc ? this.tc.off : 0;
        if (!isFinite(d) || !v.buffered.length) return;
        var end = 0;
        for (var i = 0; i < v.buffered.length; i++) if (v.buffered.start(i) <= v.currentTime + 1) end = Math.max(end, v.buffered.end(i));
        this.bar.querySelector('.buf').style.width = Math.min(100, (end + off) / d * 100) + '%';
    };

    NFPlayer.prototype.destroy = function () {
        this.dead = true;
        clearTimeout(this.idleT);
        clearTimeout(this.endT);
        this.cleanup();
    };

    /* ---------- fuentes ---------- */
    NFPlayer.prototype.cleanup = function () {
        if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
        if (this.ts) { try { this.ts.pause(); this.ts.unload(); this.ts.detachMediaElement(); this.ts.destroy(); } catch (e) {} this.ts = null; }
        clearTimeout(this.loadTimer);
        this.v.removeAttribute('src');
        try { this.v.load(); } catch (e) {}
    };

    NFPlayer.prototype.next = function () {
        var self = this, list = this.o.sources;
        this.tc = null;
        this.cleanup();
        this.ok = false;
        this.idx++;
        while (this.idx < list.length && !this.canEngine(list[this.idx].engine)) this.idx++;
        if (this.idx >= list.length) { this.showError(); return; }
        var s = list[this.idx];
        this.root.classList.add('buffering');
        var t = this.lastTime || 0;
        if (t > 5) { this.o.resume = t; this.resumed = false; }
        this.root.classList.remove('needtap');
        // las fuentes https directas se descartan rápido si el puerto no responde
        this.loadTimer = setTimeout(function () { if (!self.ok) self.fail('timeout'); }, s.quick ? 9000 : (s.engine === 'native' ? 25000 : 30000));
        try {
            if (s.engine === 'hls') this.playHls(s.url);
            else if (s.engine === 'mpegts') this.playTs(s.url);
            else this.playNative(s.url);
        } catch (e) { this.fail(e.message); }
    };

    NFPlayer.prototype.canEngine = function (eng) {
        if (eng === 'hls') return (window.Hls && Hls.isSupported()) || !!this.v.canPlayType('application/vnd.apple.mpegurl');
        if (eng === 'mpegts') return !!(window.mpegts && mpegts.isSupported());
        return true;
    };

    NFPlayer.prototype.autoplay = function () {
        var self = this, v = this.v, p = v.play();
        if (p && p.catch) p.catch(function (err) {
            if (!err || err.name !== 'NotAllowedError') return;
            // iPhone/Safari bloquean el sonido automático: se inicia en silencio (como Netflix) y se ofrece activar el audio
            v.muted = true;
            var p2 = v.play();
            var giveUp = function () {
                // ni en silencio: no es un fallo de la fuente, se espera a que el usuario toque reproducir
                clearTimeout(self.loadTimer);
                self.ok = true;
                self.state();
                self.root.classList.remove('buffering');
                self.root.classList.add('needtap');
            };
            if (p2 && p2.then) p2.then(function () { self.showUnmute(); }, giveUp); else giveUp();
        });
    };

    NFPlayer.prototype.showUnmute = function () {
        var self = this, b = this.root.querySelector('.nfp-unmute');
        if (!b) {
            b = document.createElement('button');
            b.type = 'button';
            b.className = 'nfp-unmute';
            b.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg><span>Activar sonido</span>';
            b.addEventListener('click', function (e) {
                e.stopPropagation();
                self.v.muted = false;
                if (self.v.volume === 0) self.v.volume = 1;
                b.remove();
            });
            this.root.appendChild(b);
        }
    };

    NFPlayer.prototype.playNative = function (url) {
        this.v.src = url;
        this.autoplay();
    };

    var APPLE = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
        (/Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/i.test(navigator.userAgent));

    NFPlayer.prototype.playHls = function (url) {
        var self = this;
        // En iPhone/Safari el HLS nativo es el más estable (igual que Netflix en Safari)
        if (APPLE && this.v.canPlayType('application/vnd.apple.mpegurl')) {
            this.v.src = url;
            this.autoplay();
            return;
        }
        if (window.Hls && Hls.isSupported()) {
            var hls = this.hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 60,
                maxBufferLength: this.live ? 30 : 60,
                maxMaxBufferLength: 120,
                liveSyncDurationCount: 4,
                liveMaxLatencyDurationCount: 12,
                startFragPrefetch: true,
                fragLoadingTimeOut: 30000,
                manifestLoadingTimeOut: 20000,
                levelLoadingTimeOut: 20000,
                fragLoadingMaxRetry: 6,
                manifestLoadingMaxRetry: 3,
                levelLoadingMaxRetry: 4
            });
            var fatalCount = 0;
            hls.on(Hls.Events.MANIFEST_PARSED, function () { self.autoplay(); });
            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, function () { self.applyAudioPref(); });
            hls.on(Hls.Events.ERROR, function (ev, data) {
                if (!data.fatal) return;
                if (self.ok && fatalCount < 2) {
                    fatalCount++;
                    if (data.type === Hls.ErrorTypes.NETWORK_ERROR) { hls.startLoad(); return; }
                    if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
                }
                self.fail('hls ' + data.details);
            });
            hls.loadSource(url);
            hls.attachMedia(this.v);
        } else {
            this.v.src = url;
            this.autoplay();
        }
    };

    NFPlayer.prototype.playTs = function (url) {
        var self = this;
        var p = this.ts = mpegts.createPlayer({ type: 'mpegts', isLive: this.live, url: url }, {
            enableWorker: true, lazyLoad: !this.live, liveBufferLatencyChasing: this.live, autoCleanupSourceBuffer: true
        });
        p.on(mpegts.Events.ERROR, function (type, detail) { self.fail('ts ' + type + ' ' + detail); });
        p.attachMediaElement(this.v);
        p.load();
        var pr = p.play();
        if (pr && pr.catch) pr.catch(function () {});
    };

    NFPlayer.prototype.fail = function (why) {
        if (this._failing) return;
        this._failing = true;
        if (window.console) console.warn('[NFPlayer] fuente ' + (this.idx + 1) + ' falló:', why);
        if (this.T() > 5) this.lastTime = this.T();
        var self = this;
        setTimeout(function () { self._failing = false; self.next(); }, 150);
    };

    NFPlayer.prototype.showError = function () {
        this.root.classList.remove('buffering');
        var o = this.o, h = '<h3>No se pudo reproducir este contenido</h3><p>El formato o el servidor no respondió en el navegador. Puedes reintentar o abrirlo en VLC.</p><div class="acts">';
        h += '<button type="button" class="nf-btn nf-btn-white" data-act="retry">Reintentar</button>';
        var vl = NFPlayer.vlc(o);
        if (vl) h += '<a class="nf-btn nf-btn-gray" href="' + NF_esc(vl.href) + '">' + vl.label + '</a>';
        if (vl && vl.get) h += '<a class="nf-btn nf-btn-gray" href="' + vl.get.href + '" target="_blank" rel="noopener">' + vl.get.label + '</a>';
        if (o.downloadUrl) h += '<a class="nf-btn nf-btn-gray" href="' + o.downloadUrl + '">Descargar</a>';
        if (o.diagUrl) h += '<a class="nf-btn nf-btn-gray" href="' + o.diagUrl + '">Diagnóstico</a>';
        h += '</div>';
        this.msg.innerHTML = h;
        this.msg.classList.add('show');
        var self = this;
        this.msg.querySelector('[data-act=retry]').addEventListener('click', function () { self.hideMsg(); self.idx = -1; self.next(); });
    };
    NFPlayer.prototype.hideMsg = function () { this.msg.classList.remove('show'); };

    NFPlayer.prototype.toastMsg = function (t) {
        var x = this.root.querySelector('.nfp-toast') || this.root.appendChild(el('div', 'nfp-toast'));
        x.textContent = t;
        x.classList.add('show');
        clearTimeout(x._h);
        x._h = setTimeout(function () { x.classList.remove('show'); }, 2500);
    };

    /* ---------- audio / subtítulos / velocidad ---------- */
    NFPlayer.prototype.audioList = function () {
        var out = [], self = this;
        if (this.hls && this.hls.audioTracks && this.hls.audioTracks.length) {
            this.hls.audioTracks.forEach(function (t, i) { out.push({ label: t.name || t.lang || ('Audio ' + (i + 1)), lang: t.lang || '', on: self.hls.audioTrack === i, set: function () { self.hls.audioTrack = i; } }); });
        } else if (this.info && this.info.audio && this.info.audio.length > 1 && this.o.media && !(this.v.audioTracks && this.v.audioTracks.length > 1)) {
            var cur = this.tc ? this.tc.a : 0;
            this.info.audio.forEach(function (t) {
                out.push({ label: t.label, lang: t.lang, on: cur === t.i, set: function () { if (cur !== t.i || !self.tc) self.startTc(self.T(), t.i, self.info.video && !videoOk(self.info.video)); } });
            });
        } else if (this.v.audioTracks && this.v.audioTracks.length) {
            var at = this.v.audioTracks;
            for (var i = 0; i < at.length; i++) (function (t, i) {
                out.push({ label: t.label || t.language || ('Audio ' + (i + 1)), lang: t.language || '', on: t.enabled, set: function () { for (var j = 0; j < at.length; j++) at[j].enabled = j === i; } });
            })(at[i], i);
        }
        return out;
    };

    NFPlayer.prototype.applyAudioPref = function () {
        var list = this.audioList();
        if (list.length < 2) return;
        var pref = store('nfp_audio');
        if (pref) {
            for (var i = 0; i < list.length; i++) if ((list[i].lang + '|' + list[i].label) === pref) { if (!list[i].on) list[i].set(); return; }
        } else if (this.o.defaultSecondAudio && !this.hls) {
            list[1].set(); // comportamiento anterior: segunda pista de audio por defecto
        }
    };

    NFPlayer.prototype.subList = function () {
        var out = [], self = this, v = this.v;
        if (this.hls && this.hls.subtitleTracks && this.hls.subtitleTracks.length) {
            this.hls.subtitleTracks.forEach(function (t, i) { out.push({ label: t.name || t.lang || ('Subtítulo ' + (i + 1)), on: self.hls.subtitleTrack === i, set: function () { self.hls.subtitleTrack = i; self.hls.subtitleDisplay = true; } }); });
            out.off = function () { self.hls.subtitleTrack = -1; };
        } else if (this.info && this.info.subs && this.info.subs.some(function (t) { return t.text; }) && this.o.media) {
            this.info.subs.forEach(function (t) {
                if (!t.text) return;
                out.push({ label: t.label, on: self.subSel === t.i, set: function () { self.loadSub(t.i); } });
            });
            out.off = function () { self.loadSub(-1); };
        } else if (v.textTracks && v.textTracks.length) {
            for (var i = 0; i < v.textTracks.length; i++) (function (t) {
                if (t.kind !== 'subtitles' && t.kind !== 'captions') return;
                out.push({ label: t.label || t.language || 'Subtítulo', on: t.mode === 'showing', set: function () { for (var j = 0; j < v.textTracks.length; j++) v.textTracks[j].mode = 'disabled'; t.mode = 'showing'; } });
            })(v.textTracks[i]);
            out.off = function () { for (var j = 0; j < v.textTracks.length; j++) v.textTracks[j].mode = 'disabled'; };
        }
        return out;
    };

    NFPlayer.prototype.menu = function (kind, ev) {
        var self = this, pop = this.pop;
        if (pop.classList.contains('open') && pop._kind === kind) { this.closePop(); return; }
        pop._kind = kind;
        var h = '';
        if (kind === 'tracks') {
            var a = this.audioList(), s = this.subList();
            h += '<div class="col"><h4>Audio</h4>';
            if (a.length) a.forEach(function (t, i) { h += '<button type="button" data-a="' + i + '" class="' + (t.on ? 'on' : '') + '">' + NF_esc(t.label) + '</button>'; });
            else h += '<span class="na">Audio predeterminado</span>';
            h += '</div><div class="col"><h4>Subtítulos</h4>';
            if (s.length) {
                var any = s.some(function (t) { return t.on; });
                h += '<button type="button" data-s="-1" class="' + (any ? '' : 'on') + '">Desactivados</button>';
                s.forEach(function (t, i) { h += '<button type="button" data-s="' + i + '" class="' + (t.on ? 'on' : '') + '">' + NF_esc(t.label) + '</button>'; });
            } else h += '<span class="na">No disponibles</span>';
            h += '</div>';
            pop.innerHTML = h;
            Array.prototype.forEach.call(pop.querySelectorAll('[data-a]'), function (b) {
                b.addEventListener('click', function () { var t = a[+b.getAttribute('data-a')]; t.set(); store('nfp_audio', t.lang + '|' + t.label); if (t.lang) store('nfp_audio_lang', t.lang); self.closePop(); self.toastMsg('Audio: ' + t.label); });
            });
            Array.prototype.forEach.call(pop.querySelectorAll('[data-s]'), function (b) {
                b.addEventListener('click', function () { var i = +b.getAttribute('data-s'); if (i < 0) s.off(); else s[i].set(); self.closePop(); });
            });
        } else if (kind === 'speed') {
            h = '<div class="col"><h4>Velocidad</h4>';
            [0.5, 0.75, 1, 1.25, 1.5, 2].forEach(function (r) { h += '<button type="button" data-r="' + r + '" class="' + (self.v.playbackRate === r ? 'on' : '') + '">' + (r === 1 ? 'Normal' : r + 'x') + '</button>'; });
            pop.innerHTML = h + '</div>';
            Array.prototype.forEach.call(pop.querySelectorAll('[data-r]'), function (b) {
                b.addEventListener('click', function () { self.v.playbackRate = parseFloat(b.getAttribute('data-r')); self.closePop(); });
            });
        } else if (kind === 'extra') {
            h = '<div class="col"><h4>Opciones</h4>';
            this.o.extraMenu.forEach(function (m) { h += '<a href="' + NF_esc(m.href) + '"' + (m.attrs || '') + '>' + NF_esc(m.label) + '</a>'; });
            var vl = NFPlayer.vlc(this.o);
            if (vl) h += '<a href="' + NF_esc(vl.href) + '">' + vl.label + '</a>';
            if (vl && vl.get) h += '<a href="' + vl.get.href + '" target="_blank" rel="noopener">' + vl.get.label + '</a>';
            pop.innerHTML = h + '</div>';
        }
        pop.classList.add('open');
        this.wake();
    };
    NFPlayer.prototype.closePop = function () { this.pop.classList.remove('open'); };

    NFPlayer.prototype.fullscreen = function () {
        var r = this.root, d = document;
        if (d.fullscreenElement || d.webkitFullscreenElement) {
            (d.exitFullscreen || d.webkitExitFullscreen).call(d);
        } else if (r.requestFullscreen) {
            r.requestFullscreen().then(function () {
                try { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(function () {}); } catch (e) {}
            }).catch(function () {});
        } else if (r.webkitRequestFullscreen) r.webkitRequestFullscreen();
        else if (this.v.webkitEnterFullscreen) this.v.webkitEnterFullscreen(); // iPhone
    };

    NFPlayer.prototype.pip = function () {
        if (document.pictureInPictureElement) document.exitPictureInPicture().catch(function () {});
        else if (this.v.requestPictureInPicture) this.v.requestPictureInPicture().catch(function () {});
    };

    /* ---------- siguiente episodio ---------- */
    NFPlayer.prototype.showNext = function (ended) {
        if (!this.o.nextUrl) return;
        this.endShown = true;
        var self = this, n = ended ? 6 : 0;
        this.endBox.innerHTML = '<button type="button" class="nf-btn nf-btn-white nfp-nextbtn">' + ICONS.next + '<span>Siguiente episodio</span></button>';
        this.endBox.classList.add('show');
        this.endBox.querySelector('button').addEventListener('click', function () { self.goNext(); });
        if (ended) {
            var lbl = this.endBox.querySelector('span');
            var tick = function () {
                lbl.textContent = 'Siguiente episodio en ' + n;
                if (n-- <= 0) self.goNext(); else self.endT = setTimeout(tick, 1000);
            };
            tick();
        }
    };
    NFPlayer.prototype.onEnded = function () { if (this.o.nextUrl) this.showNext(true); else this.state(); };
    NFPlayer.prototype.goNext = function () { if (this.o.nextUrl) { this.emit('beforeNext'); location.href = this.o.nextUrl; } };

    NFPlayer.prototype.timeInfo = function () { return { currentTime: this.T(), duration: this.D() }; };
    NFPlayer.prototype.emit = function (name) { var fn = this.o['on' + name.charAt(0).toUpperCase() + name.slice(1)]; if (fn) fn.call(this, this.timeInfo()); };

    /* ---------- motor multimedia del servidor (ffmpeg): pistas, subtítulos y audio Dolby ---------- */
    var AUDIO_OK = { aac: 1, mp3: 1, opus: 1, vorbis: 1, flac: 1, mp2: 1, alac: 1, pcm_s16le: 1 };
    var VIDEO_OK = { h264: 1, hevc: 1, vp9: 1, vp8: 1, av1: 1 };
    function canAudio(codec) {
        if (AUDIO_OK[codec]) return true;
        var v = document.createElement('video');
        if (codec === 'ac3') return !!(v.canPlayType('audio/mp4; codecs="ac-3"') || (window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported('audio/mp4; codecs="ac-3"')));
        if (codec === 'eac3') return !!(v.canPlayType('audio/mp4; codecs="ec-3"') || (window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported('audio/mp4; codecs="ec-3"')));
        return false; // dts, truehd...
    }

    NFPlayer.prototype.probe = function () {
        var self = this, m = this.o.media;
        if (!m || this._probing || this.info) return;
        this._probing = true;
        fetch(m.probe, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
            if (!j || !j.ok) return;
            self.info = j;
            var cur = self.info.audio[0];
            // audio que el navegador no decodifica (Dolby AC3/E-AC3, DTS, TrueHD): se convierte en el servidor
            if (cur && !canAudio(cur.codec) && !(self.hls)) {
                var want = self.prefAudioIndex();
                self.toastMsg('Convirtiendo audio ' + cur.codec.toUpperCase() + ' para este navegador');
                self.startTc(self.T(), want, j.video && !videoOk(j.video));
            } else if (self.info.audio.length > 1) {
                var w = self.prefAudioIndex();
                if (w > 0 && !(self.v.audioTracks && self.v.audioTracks.length > 1) && !self.hls) self.startTc(self.T(), w, false);
            }
        }).catch(function () {}).then(function () { self._probing = false; });
    };

    function videoOk(codec) {
        if (codec === 'hevc' || codec === 'h265') {
            var v = document.createElement('video');
            return !!(v.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') || (window.MediaSource && MediaSource.isTypeSupported && MediaSource.isTypeSupported('video/mp4; codecs="hvc1.1.6.L93.B0"')));
        }
        return !!VIDEO_OK[codec];
    }

    NFPlayer.prototype.rescueTc = function () {
        var self = this, m = this.o.media, t = this.lastTime || this.o.resume || 0;
        clearTimeout(this.loadTimer);
        this.root.classList.add('buffering');
        var go = function (j) {
            if (!j || !j.ok) { self.o.media = null; self.fail('sin conversión'); return; }
            self.info = j;
            self.toastMsg('Adaptando este contenido para el navegador');
            self.startTc(t, self.prefAudioIndex(), j.video && !videoOk(j.video));
        };
        if (this.info) { go(this.info); return; }
        fetch(m.probe, { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(go).catch(function () { go(null); });
    };

    NFPlayer.prototype.prefAudioIndex = function () {
        var list = (this.info && this.info.audio) || [], pref = store('nfp_audio_lang') || 'spa';
        for (var i = 0; i < list.length; i++) if (list[i].lang && pref.indexOf(list[i].lang) === 0) return i;
        if (this.o.defaultSecondAudio && list.length > 1 && !store('nfp_audio_lang')) return 1;
        return 0;
    };

    NFPlayer.prototype.startTc = function (t, a, vt) {
        var m = this.o.media, self = this, v = this.v;
        if (!m) return;
        var dur = (this.tc && this.tc.dur) || (this.info && this.info.dur) || (isFinite(v.duration) ? v.duration : 0);
        var wasPaused = v.paused && this.ok;
        if (this.hls) { try { this.hls.destroy(); } catch (e) {} this.hls = null; }
        if (this.ts) { try { this.ts.destroy(); } catch (e) {} this.ts = null; }
        clearTimeout(this.loadTimer);
        this.tc = { off: t, dur: dur, a: a || 0, vt: !!vt };
        this.root.classList.add('buffering');
        v.src = m.tc + '&t=' + Math.floor(t) + '&a=' + (a || 0) + (vt ? '&v=1' : '');
        if (!wasPaused) this.autoplay();
        // el video copiado arranca en el fotograma clave anterior: se ajusta el tiempo real
        if (t >= 1) {
            var tc = this.tc;
            fetch(m.tc.replace('do=tc', 'do=kf') + '&t=' + Math.floor(t) + (vt ? '&v=1' : ''), { credentials: 'same-origin' })
                .then(function (r) { return r.json(); })
                .then(function (j) { if (self.tc === tc && j && isFinite(j.k)) { tc.off = +j.k; self.applySub(); self.updTime && self.updTime(); } })
                .catch(function () {});
        }
        this.loadTimer = setTimeout(function () { if (v.readyState < 2 && self.tc) { self.tc = null; self.o.media = null; self.toastMsg('La conversión tardó demasiado'); self.idx--; self.next(); } }, 45000);
    };

    /* detecta video sin sonido (códec de audio no compatible) */
    NFPlayer.prototype.watchAudio = function () {
        var self = this, v = this.v;
        if (this.live || this.tc || this._aw) return;
        this._aw = setTimeout(function () {
            self._aw = null;
            if (v.paused || v.muted || self.tc || self.hls) return;
            var silent = (typeof v.webkitAudioDecodedByteCount === 'number' && v.webkitAudioDecodedByteCount === 0) ||
                (typeof v.mozHasAudio === 'boolean' && !v.mozHasAudio);
            if (!silent) return;
            if (self.o.media) {
                self.toastMsg('Activando audio compatible…');
                self.startTc(self.T(), self.info ? self.prefAudioIndex() : 0, self.info && self.info.video && !videoOk(self.info.video));
            } else {
                self.showNote('Este contenido tiene audio Dolby (AC3/E-AC3) o DTS, que este navegador no reproduce. Ábrelo en Safari o Microsoft Edge, o usa VLC.');
            }
        }, 4000);
    };

    NFPlayer.prototype.showNote = function (t) {
        var n = this.root.querySelector('.nfp-note');
        if (!n) { n = document.createElement('div'); n.className = 'nfp-note'; this.root.appendChild(n); }
        n.innerHTML = '<span>' + NF_esc(t) + '</span><button type="button" aria-label="Cerrar">×</button>';
        n.querySelector('button').onclick = function () { n.remove(); };
    };

    /* subtítulos internos (convertidos a WebVTT en el servidor) */
    NFPlayer.prototype.loadSub = function (i) {
        var self = this, m = this.o.media;
        this.subSel = i;
        if (i < 0) { this.clearSub(); return; }
        this.subCache = this.subCache || {};
        if (this.subCache[i]) { this.applySub(); return; }
        this.toastMsg('Cargando subtítulos…');
        fetch(m.sub + '&i=' + i, { credentials: 'same-origin' }).then(function (r) { if (!r.ok) throw 0; return r.text(); }).then(function (txt) {
            self.subCache[i] = parseVtt(txt);
            if (self.subSel === i) self.applySub();
        }).catch(function () { self.toastMsg('No se pudieron cargar los subtítulos'); });
    };
    NFPlayer.prototype.clearSub = function () {
        if (!this.subTrack) return;
        var t = this.subTrack;
        while (t.cues && t.cues.length) t.removeCue(t.cues[0]);
        t.mode = 'hidden';
    };
    NFPlayer.prototype.applySub = function () {
        if (this.subSel == null || this.subSel < 0 || !this.subCache || !this.subCache[this.subSel]) return;
        var v = this.v, off = this.tc ? this.tc.off : 0;
        if (!this.subTrack) {
            for (var j = 0; j < v.textTracks.length; j++) v.textTracks[j].mode = 'disabled';
            this.subTrack = v.addTextTrack('subtitles', 'Subtítulos', 'es');
        }
        this.clearSub();
        var t = this.subTrack;
        this.subCache[this.subSel].forEach(function (c) {
            if (c.e - off <= 0) return;
            try { t.addCue(new VTTCue(Math.max(0, c.s - off), c.e - off, c.t)); } catch (e) {}
        });
        t.mode = 'showing';
    };
    function parseVtt(txt) {
        var out = [], blocks = txt.replace(/\r/g, '').split(/\n\n+/);
        var ts = function (x) { var p = x.trim().split(':'), s = 0; for (var i = 0; i < p.length; i++) s = s * 60 + parseFloat(p[i].replace(',', '.')); return s; };
        blocks.forEach(function (b) {
            var lines = b.split('\n'), k = 0;
            while (k < lines.length && lines[k].indexOf('-->') < 0) k++;
            if (k >= lines.length) return;
            var tt = lines[k].split('-->');
            var text = lines.slice(k + 1).join('\n').replace(/<[^>]+>/g, '').trim();
            if (text) out.push({ s: ts(tt[0]), e: ts(tt[1].split(' ').filter(Boolean)[0]), t: text });
        });
        return out;
    }

    function NF_esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    /* VLC: en el celular abre la app; en la computadora descarga una lista .m3u que VLC abre al hacer clic */
    NFPlayer.vlc = function (o) {
        var raw = o.streamUrl || (o.vlcUrl ? o.vlcUrl.replace(/^vlc:\/\//, '') : '');
        if (!raw) return null;
        var ua = navigator.userAgent;
        if (/Android/i.test(ua)) {
            var m = raw.match(/^(https?):\/\/(.*)$/);
            return { label: 'Abrir en VLC', href: m ? 'intent://' + m[2] + '#Intent;scheme=' + m[1] + ';package=org.videolan.vlc;type=video/*;end' : 'vlc://' + raw };
        }
        if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
            return { label: 'Abrir en VLC', href: 'vlc-x-callback://x-callback-url/stream?url=' + encodeURIComponent(raw) };
        }
        if (!o.vlcPc) return null;
        var get = /Windows/i.test(ua) ? { label: 'Descargar VLC (Microsoft Store)', href: 'https://apps.microsoft.com/detail/9nblggh4vvnh' }
            : /Mac/i.test(ua) ? { label: 'Descargar VLC para Mac', href: 'https://www.videolan.org/vlc/download-macosx.html' }
            : { label: 'Descargar VLC', href: 'https://www.videolan.org/vlc/' };
        return { label: 'Abrir en VLC (descarga lista .m3u)', href: o.vlcPc, get: get };
    };

    window.NFPlayer = NFPlayer;
})();
