// Corre el lector de MP4 de la app (src/player/mp4mse.ts, con rangeget / readahead / prefetch reales) en Node contra el
// servidor XUI de prueba (xui.cjs). El reproductor de Vega se simula: MediaSource / SourceBuffer que leen los fragmentos
// entregados (tiempos del video) y un reproductor que avanza solo si tiene video bajado en el segundo actual.
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// VOD_ROOT: otra copia de la app (medir una versión anterior con el mismo simulador)
const ROOT = process.env.VOD_ROOT || path.join(__dirname, '..', '..');
const originalLoad = Module._load;
require.extensions['.ts'] = (module, filename) =>
  module._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      fileName: filename,
    }).outputText,
    filename,
  );

// ---- almacenamiento del equipo (en memoria) ----
const memory = {};
const asyncMem = new Map();
const storage = {
  read: (k, d = '') => (k in memory ? memory[k] : d),
  write: (k, v) => { memory[k] = v; },
  pref: (k, d) => ('pref_' + k in memory ? memory['pref_' + k] : d),
  readJson: k => memory[k] || null,
  writeJson: (k, v) => { memory[k] = v; },
  setPref: (k, v) => { memory['pref_' + k] = v; },
};
const AsyncStorage = {
  getItem: async k => (asyncMem.has(k) ? asyncMem.get(k) : null),
  setItem: async (k, v) => { asyncMem.set(k, v); },
  removeItem: async k => { asyncMem.delete(k); },
};
// índice compartido (VPS): apagado salvo que la prueba lo encienda
const sharedBox = { on: false, store: new Map() };

// ---- MediaSource / SourceBuffer de Vega (simulados) ----
const u32 = (b, o) => b.readUInt32BE(o);
function boxes(b, s, e) {
  const out = [];
  while (s + 8 <= e) {
    const n = u32(b, s);
    if (n < 8 || s + n > e) break;
    out.push({ t: b.toString('latin1', s + 4, s + 8), s: s + 8, e: s + n });
    s += n;
  }
  return out;
}
class SourceBuffer {
  constructor() {
    this.updating = false;
    this.ranges = []; // del video, en segundos
    this.scales = {};
    this.appends = 0;
    this.bytes = 0;
    this.l = {};
  }
  addEventListener(n, f) { (this.l[n] ||= []).push(f); }
  get buffered() {
    const r = this.ranges;
    return { length: r.length, start: i => r[i][0], end: i => r[i][1] };
  }
  appendBuffer(data) {
    if (this.updating) throw new Error('InvalidStateError: updating');
    this.updating = true;
    const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    this.appends++;
    this.bytes += b.length;
    setTimeout(() => {
      for (const x of boxes(b, 0, b.length)) {
        if (x.t === 'moov') {
          for (const tr of boxes(b, x.s, x.e).filter(y => y.t === 'trak')) {
            const k = boxes(b, tr.s, tr.e);
            const tk = k.find(y => y.t === 'tkhd');
            const md = k.find(y => y.t === 'mdia');
            const mh = boxes(b, md.s, md.e).find(y => y.t === 'mdhd');
            this.scales[u32(b, tk.s + 12)] = u32(b, mh.s + 12);
          }
        }
        if (x.t === 'moof') {
          const traf = boxes(b, x.s, x.e).find(y => y.t === 'traf');
          const k = boxes(b, traf.s, traf.e);
          const id = u32(b, k.find(y => y.t === 'tfhd').s + 4);
          const tf = k.find(y => y.t === 'tfdt');
          const base = u32(b, tf.s + 4) * 4294967296 + u32(b, tf.s + 8);
          const tr = k.find(y => y.t === 'trun');
          const n = u32(b, tr.s + 4);
          let dur = 0;
          for (let i = 0; i < n; i++) dur += u32(b, tr.s + 12 + i * 16);
          if (id !== 1) continue;
          const sc = this.scales[1] || 90000;
          this.add(base / sc, (base + dur) / sc);
        }
      }
      this.updating = false;
      for (const f of this.l.updateend || []) f();
    }, 3);
  }
  add(a, z) {
    const r = this.ranges.concat([[a, z]]).sort((p, q) => p[0] - q[0]);
    const out = [];
    for (const x of r) {
      const last = out[out.length - 1];
      if (last && x[0] <= last[1] + 0.05) last[1] = Math.max(last[1], x[1]);
      else out.push([x[0], x[1]]);
    }
    this.ranges = out;
  }
  remove(a, z) {
    this.updating = true;
    setTimeout(() => {
      const out = [];
      for (const [s, e] of this.ranges) {
        if (e <= a || s >= z) out.push([s, e]);
        else {
          if (s < a) out.push([s, a]);
          if (e > z) out.push([z, e]);
        }
      }
      this.ranges = out;
      this.updating = false;
    }, 2);
  }
  abort() { this.updating = false; }
}
class MediaSource {
  static isTypeSupported() { return true; }
  constructor() {
    this.readyState = 'closed';
    this.l = {};
    this.sbs = [];
    setTimeout(() => {
      this.readyState = 'open';
      for (const f of this.l.sourceopen || []) f();
    }, 30);
  }
  addEventListener(n, f) { (this.l[n] ||= []).push(f); }
  addSourceBuffer() { const sb = new SourceBuffer(); this.sbs.push(sb); current.sb = sb; return sb; }
  endOfStream() { this.readyState = 'ended'; }
}
const current = { sb: null };

Module._load = function (request, parent, isMain) {
  if (request === '@amazon-devices/react-native-w3cmedia') return { MediaSource, VideoPlayer: class {} };
  if (request === '@react-native-async-storage/async-storage') return { __esModule: true, default: AsyncStorage };
  if (/lib\/storage$/.test(request)) return storage;
  if (/lib\/i18n$/.test(request) || request === './i18n') return { t: k => k };
  if (/lib\/http$/.test(request)) return { UA: 'sim', http: async () => ({ code: 0, body: '', ok: false }) };
  if (/\/sharedindex$/.test(request))
    return {
      sharedIndex: async (url, kind) => {
        if (!sharedBox.on) return null;
        await new Promise(r => setTimeout(r, 300)); // la VPS contesta rápido
        const s = sharedBox.store.get(url.replace(/^https?:\/\//, ''));
        return s && s.kind === kind ? s : null;
      },
      shareIndex: async (url, kind, size, make) => {
        if (!sharedBox.on) return;
        const text = await make();
        sharedBox.store.set(url.replace(/^https?:\/\//, ''), { kind, size, text });
      },
      sharedKnown: () => false,
      sharedStale: () => {},
      bridgeAsk: async () => {},
    };
  return originalLoad.call(this, request, parent, isMain);
};

const mp4 = require(path.join(ROOT, 'src/player/mp4mse.ts'));
const rangeget = require(path.join(ROOT, 'src/player/rangeget.ts'));
const prefetch = require(path.join(ROOT, 'src/player/prefetch.ts'));

// reproductor simulado: avanza 1 s por segundo si tiene video bajado en el segundo actual
function makeVideo() {
  const v = {
    src: '',
    currentTime: 0,
    paused: true,
    error: null,
    plays: 0,
    play() { this.paused = false; this.plays++; return Promise.resolve(); },
    pause() { this.paused = true; },
  };
  return v;
}

// abre url desde at como lo hace Player (pedido adelantado + Mp4Mse) y mide: primera imagen, cortes, pedidos
// actions: [{ at: segundos después de la primera imagen, run: (lector, reproductor) => … }] (cambiar de idioma, saltar)
async function openOnce(url, { at = 0, lineMax = 1, watch = 30, log = null, actions = [] } = {}) {
  rangeget.setLineMax(lineMax);
  const v = makeVideo();
  const t0 = Date.now();
  // lo que pide Player mientras se inicia el reproductor (Player.tsx): la cabecera del MP4 si no se sabe dónde está el índice
  if (!mp4.mp4Spot(url) && !mp4.mp4Known(url)) prefetch.prefetchRange(url, 0, at <= 5 && rangeget.isSingle(url) ? mp4.MP4_HEAD : 65536);
  const m = mp4.Mp4Mse.open(v, url, -1, null, '');
  let err = null;
  m.onError = () => { err = m.why || 'error'; };
  const startP = m.start(at).then(e => { if (e) err = e; });
  let first = -1;
  let stalled = 0;
  let lastT = -1;
  const tick = 50;
  for (;;) {
    await new Promise(r => setTimeout(r, tick));
    const sb = current.sb;
    const now = Date.now();
    if (err) break;
    if (sb && !v.paused) {
      const t = v.currentTime;
      const r = sb.ranges.find(x => t >= x[0] - 0.05 && t < x[1] - 0.04);
      if (r) {
        if (first < 0) first = now;
        v.currentTime = t + tick / 1000;
      } else if (first >= 0) {
        stalled += tick;
        if (log) log.push(((now - t0) / 1000).toFixed(2) + ' detenido en ' + t.toFixed(2) + ' bajado=' + JSON.stringify(sb.ranges.map(x => x.map(y => +y.toFixed(2)))));
      }
      lastT = t;
    }
    for (const a of actions) if (!a.done && first >= 0 && now - first >= a.at * 1000) { a.done = true; a.stalledBefore = stalled; a.result = a.run(m, v); }
    if (first >= 0 && now - first >= watch * 1000) break;
    if (now - t0 > 180000) { err = err || 'sin imagen en 180 s'; break; }
  }
  await startP.catch(() => {});
  const diag = m.diag();
  m.destroy();
  return { first: first < 0 ? null : (first - t0) / 1000, stalled: stalled / 1000, err, diag, pos: v.currentTime };
}

module.exports = { openOnce, sharedBox, memory, asyncMem, mp4, rangeget, prefetch, current };
