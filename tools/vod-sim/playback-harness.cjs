// El reproductor de películas y series completo (src/player/playback.ts: reproductor de Amazon primero, después el
// lector de la app) contra el servidor XUI de prueba (xui.cjs). El reproductor de Vega se simula con su comportamiento
// en Vega OS anterior a 2.0 (y el simulador de Vega con el sistema 1.x): una dirección http en modo directo da error 4
// al instante. Mide cuándo empieza a verse y si se rinde.
const Module = require('node:module');
const path = require('node:path');
const H = require('./harness.cjs'); // instala TypeScript, MediaSource / SourceBuffer y los mocks del lector

const ROOT = process.env.VOD_ROOT || path.join(__dirname, '..', '..');
const prevLoad = Module._load;
const noTracks = { ok: false, container: '', audio: [], subs: [] };
Module._load = function (request, parent, isMain) {
  if (request === './livehls') return { LiveHls: class { static supported() { return true; } }, disableMp4: () => {} };
  if (request === '../api/media')
    return {
      engineDenied: () => '', knownNow: () => null, knownTracks: async () => noTracks, shareTracks: () => {},
      fileTracks: async () => noTracks, mediaEngine: async () => ({ ok: false, error: 'sin motor' }), subCheck: async () => null,
      subText: async () => '', hlsLink: async () => null,
    };
  if (request === '../lib/osversion') return { osVersion: () => '', osBefore2: () => false };
  if (request === '../lib/probe') return { stopProbe: () => {} };
  if (request === './hls') return { PanelHls: class { static supported() { return true; } } };
  if (request === '../api/report') return { reportError: () => {} };
  if (request === './shaka') return { ShakaPlayback: class {} };
  if (request === 'react-native') return { Platform: { constants: {} }, AppState: { currentState: 'active' } };
  return prevLoad.call(this, request, parent, isMain);
};
const { Playback } = require(path.join(ROOT, 'src/player/playback.ts'));

// reproductor de Vega: modo directo con http → error 4 al instante (nativeHttp 'reject'); MSE como en harness.cjs
function makePlayer(nativeHttp) {
  const l = {};
  const v = {
    _src: '', currentTime: 0, paused: true, error: null, muted: false, readyState: 0, duration: NaN, buffered: { length: 0 },
    audioTracks: [], textTracks: [],
    addEventListener(n, f) { (l[n] ||= []).push(f); },
    removeEventListener() {},
    emit(n) { for (const f of l[n] || []) f(); },
    get src() { return this._src; },
    set src(u) {
      this._src = u;
      this.error = null;
      if (/^http:/i.test(u) && nativeHttp === 'reject') setTimeout(() => { if (this._src === u) { this.error = { code: 4, message: 'set_src_uri failed' }; this.emit('error'); } }, 20);
    },
    setSrcWithCustomHeaders(u) { this.src = u; },
    removeAttribute() { this._src = ''; },
    load() {},
    play() { this.paused = false; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
  return v;
}

async function openVod(url, { at = 0, lineMax = 1, watch = 20, nativeHttp = 'reject', limit = 150 } = {}) {
  H.rangeget.setLineMax(lineMax);
  const v = makePlayer(nativeHttp);
  const ev = { started: null, playing: null, failed: null, toasts: [], fatal: null };
  const t0 = Date.now();
  const hooks = {
    toast: m => ev.toasts.push(m), status: () => {}, changed: () => {}, subText: () => {},
    fatal: m => { ev.fatal = m; },
    vodStarting: () => {}, vodPlaying: () => { if (ev.playing === null) ev.playing = (Date.now() - t0) / 1000; },
    vodFailed: () => { ev.failed = (Date.now() - t0) / 1000; },
  };
  const c = new Playback(v, hooks);
  v.addEventListener('error', () => c.vodError());
  c.load(url, at, false);
  let first = -1;
  let stalled = 0;
  const tick = 50;
  for (;;) {
    await new Promise(r => setTimeout(r, tick));
    const now = Date.now();
    if (ev.failed !== null || ev.fatal) break;
    const ranges = H.current?.sb?.ranges || [];
    if (!v.paused && ranges.length) {
      const t = v.currentTime;
      const r = ranges.find(x => t >= x[0] - 0.05 && t < x[1] - 0.04);
      if (r) {
        if (first < 0) { first = now; c.onPlaying(); }
        v.currentTime = t + tick / 1000;
        c.onTime();
      } else if (first >= 0) stalled += tick;
    }
    if (first >= 0 && now - first >= watch * 1000) break;
    if (now - t0 > limit * 1000) break;
  }
  const mode = c.vodMode();
  await c.destroy();
  return { first: first < 0 ? null : (first - t0) / 1000, playing: ev.playing, failed: ev.failed, fatal: ev.fatal, stalled: stalled / 1000, mode, toasts: ev.toasts };
}

module.exports = { openVod, H };
