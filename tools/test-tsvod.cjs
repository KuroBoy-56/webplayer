// Lector de MPEG-TS de películas y series (src/player/tsvod.ts), con un MPEG-TS fabricado aquí (PAT, PMT, H.264 a 25
// cuadros por segundo con un cuadro clave por segundo y AAC en español) servido por pedazos como el servidor IPTV.
// Sin Vega ni red.
const { test: rawTest, after } = require('node:test');
const test = (name, fn) => rawTest(name, { timeout: 20000 }, fn);
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const originalLoad = Module._load;
const previousTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
}).outputText, filename);

// ---------- el archivo MPEG-TS ----------
const VPID = 0x100, APID = 0x101, PMTPID = 0x1000;
const cc = new Map();
function packets(pid, payload, start) {
  const out = [];
  let o = 0;
  let first = true;
  while (o < payload.length || first) {
    const room = 184;
    const n = Math.min(room, payload.length - o);
    const p = new Uint8Array(188).fill(0xff);
    const c = (cc.get(pid) || 0) & 15;
    cc.set(pid, c + 1);
    p[0] = 0x47;
    p[1] = ((first && start) ? 0x40 : 0) | (pid >> 8);
    p[2] = pid & 0xff;
    if (n < room) {
      // relleno con campo de adaptación
      const af = room - n - 1;
      p[3] = 0x30 | c;
      p[4] = af;
      if (af > 0) p[5] = 0x00;
      p.set(payload.subarray(o, o + n), 5 + af);
    } else {
      p[3] = 0x10 | c;
      p.set(payload.subarray(o, o + n), 4);
    }
    out.push(p);
    o += n;
    first = false;
  }
  return out;
}
function psi(pid, section) {
  const pay = new Uint8Array(184).fill(0xff);
  pay[0] = 0;
  pay.set(section, 1);
  const p = new Uint8Array(188);
  p[0] = 0x47; p[1] = 0x40 | (pid >> 8); p[2] = pid & 0xff; p[3] = 0x10;
  p.set(pay, 4);
  return p;
}
const PAT = psi(0, [0x00, 0xb0, 13, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe0 | (PMTPID >> 8), PMTPID & 0xff, 0, 0, 0, 0]);
function pmt(audioType = 0x0f) {
  const entries = [0x1b, 0xe0 | (VPID >> 8), VPID & 0xff, 0xf0, 0x00, audioType, 0xe0 | (APID >> 8), APID & 0xff, 0xf0, 0x06, 0x0a, 0x04, 0x73, 0x70, 0x61, 0x00];
  const len = 9 + entries.length + 4;
  return psi(PMTPID, [0x02, 0xb0, len, 0x00, 0x01, 0xc1, 0x00, 0x00, 0xe0 | (VPID >> 8), VPID & 0xff, 0xf0, 0x00, ...entries, 0, 0, 0, 0]);
}
function tsStamp(prefix, v) {
  return [(prefix << 4) | (((v / 1073741824) & 7) << 1) | 1, (v >> 22) & 0xff, (((v >> 15) & 0x7f) << 1) | 1, (v >> 7) & 0xff, ((v & 0x7f) << 1) | 1];
}
function pes(streamId, pts, data) {
  const head = [0, 0, 1, streamId, 0, 0, 0x80, 0x80, 5, ...tsStamp(2, pts)];
  const out = new Uint8Array(head.length + data.length);
  out.set(head, 0);
  out.set(data, head.length);
  return out;
}
const SPS = [0x67, 0x42, 0xc0, 0x1e, 0xda, 0x02, 0x80, 0xbf, 0xe5, 0x84, 0x00, 0x00, 0x03, 0x00, 0x04, 0x00, 0x00, 0x03, 0x00, 0xca, 0x3c, 0x58, 0xba, 0x80];
const PPS = [0x68, 0xce, 0x3c, 0x80];
const SC = [0, 0, 0, 1];
function videoFrame(key, n) {
  const body = new Uint8Array(2500).fill(0x55);
  body[0] = key ? 0x65 : 0x41;
  body[1] = 0x88;
  body[2] = n & 0xff;
  const parts = key ? [...SC, ...SPS, ...SC, ...PPS, ...SC] : [...SC];
  const out = new Uint8Array(parts.length + body.length);
  out.set(parts, 0);
  out.set(body, parts.length);
  return out;
}
function adts() {
  const pay = [0x21, 0x00, 0x49, 0x90, 0x02, 0x19, 0x00, 0x23, 0x80];
  const len = 7 + pay.length;
  return [0xff, 0xf1, 0x4c, 0x80 | (len >> 11), (len >> 3) & 0xff, ((len & 7) << 5) | 0x1f, 0xfc, ...pay];
}
// seconds de video; garbage: algo que no es MPEG-TS
function makeTs(seconds, audioType = 0x0f) {
  cc.clear();
  const pkts = [];
  const PTS0 = 900000; // 10 s
  let aNext = PTS0;
  const total = seconds * 25;
  for (let i = 0; i < total; i++) {
    if (i % 25 === 0) pkts.push(PAT, pmt(audioType));
    const pts = PTS0 + i * 3600;
    pkts.push(...packets(VPID, pes(0xe0, pts, videoFrame(i % 25 === 0, i)), true));
    while (aNext < pts + 3600) {
      pkts.push(...packets(APID, pes(0xc0, aNext, new Uint8Array(adts())), true));
      aNext += 1920;
    }
  }
  const out = new Uint8Array(pkts.length * 188);
  pkts.forEach((p, i) => out.set(p, i * 188));
  return out;
}

// ---------- el servidor, MSE y el reproductor de prueba ----------
let file = null;
let reqs = [];
let audioOk = true;
const VIDEO_ONLY_MIME = /^video\/mp4; codecs="avc1[^,"]*"$/;
class FakeSB {
  constructor(mime) { this.mime = mime; this.updating = false; this.appended = []; this.timestampOffset = 0; this.offsets = []; this.buffered = { length: 0, start: () => 0, end: () => 0 }; }
  appendBuffer(d) { this.appended.push(d); this.offsets.push(this.timestampOffset); }
  remove() {}
  abort() {}
}
class FakeMS {
  constructor() { this.readyState = 'closed'; this.sbs = []; FakeMS.last = this; }
  addEventListener(ev, fn) { if (ev === 'sourceopen') setTimeout(() => { this.readyState = 'open'; fn(); }, 1); }
  addSourceBuffer(mime) {
    if (!audioOk && /mp4a/.test(mime)) throw new Error('NotSupportedError');
    const sb = new FakeSB(mime);
    this.sbs.push(sb);
    return sb;
  }
  endOfStream() { this.readyState = 'ended'; }
  static isTypeSupported(m) { return audioOk || !/mp4a/.test(m); }
}
function video() {
  return { src: '', currentTime: 0, paused: true, played: 0, play() { this.paused = false; this.played++; return Promise.resolve(); }, pause() { this.paused = true; } };
}
Module._load = function (request, parent, isMain) {
  if (request === '@amazon-devices/react-native-w3cmedia') return { MediaSource: FakeMS, VideoPlayer: class {} };
  if (request === './rangeget') return {
    hostStats: () => ({ wait: 0, rate: 0 }), isSingle: () => false, lineLimit: () => 4, markSingle() {}, setLineMax() {},
    rangeGet: async (url, off, len, st) => {
      if (!file) return null;
      if (off < 0) { off = Math.max(0, file.length - len); }
      if (off >= file.length) { st.why = 'pedido 416'; return null; }
      reqs.push(off);
      st.size = file.length;
      st.reqs = (st.reqs || 0) + 1;
      st.lastData = Date.now();
      return file.slice(off, Math.min(file.length, off + len));
    },
  };
  return originalLoad.call(this, request, parent, isMain);
};
globalThis.URL.createObjectURL = () => 'blob:ms';
after(() => { Module._load = originalLoad; require.extensions['.ts'] = previousTs; });
const { TsVodMse, looksTs } = require('../src/player/tsvod.ts');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// muestras de video (pista 1) en lo entregado y el primer tiempo de video
function videoSamples(sb) {
  let n = 0;
  for (const d of sb.appended) {
    let p = 0;
    while (p + 8 <= d.length) {
      const size = (d[p] << 24 >>> 0) + (d[p + 1] << 16) + (d[p + 2] << 8) + d[p + 3];
      const type = String.fromCharCode(d[p + 4], d[p + 5], d[p + 6], d[p + 7]);
      if (type === 'moof') {
        // traf → tfhd (pista) y trun (cantidad)
        let q = p + 8;
        let track = 0;
        while (q + 8 <= p + size) {
          const s2 = (d[q] << 24 >>> 0) + (d[q + 1] << 16) + (d[q + 2] << 8) + d[q + 3];
          const t2 = String.fromCharCode(d[q + 4], d[q + 5], d[q + 6], d[q + 7]);
          if (t2 === 'traf') { q += 8; continue; }
          if (t2 === 'tfhd') track = (d[q + 12] << 24) + (d[q + 13] << 16) + (d[q + 14] << 8) + d[q + 15];
          if (t2 === 'trun' && track === 1) n += (d[q + 12] << 24) + (d[q + 13] << 16) + (d[q + 14] << 8) + d[q + 15];
          q += s2 || 8;
        }
      }
      p += size || 8;
    }
  }
  return n;
}
async function until(fn, ms = 4000) {
  for (let i = 0; i < ms / 10 && !fn(); i++) await sleep(10);
}

test('reconoce MPEG-TS (sincronía 0x47 cada 188 bytes) y no otra cosa', () => {
  assert.equal(looksTs(makeTs(2)), true);
  assert.equal(looksTs(new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])), false);
});

test('desde el principio: video y audio, sin perder cuadros entre un pedazo y otro', async () => {
  file = makeTs(60);
  reqs = [];
  audioOk = true;
  const v = video();
  const m = new TsVodMse(v, 'http://srv.test/series/u/p/1.mp4');
  let tracks = 0;
  m.onTracks = () => tracks++;
  const err = await m.start(0);
  assert.equal(err, '');
  assert.deepEqual(m.tracks.map(t => t.lang + '/' + t.codec), ['spa/aac']);
  assert.equal(m.noAudio, false);
  const sb = FakeMS.last.sbs[0];
  assert.match(sb.mime, /avc1.*mp4a/);
  await until(() => FakeMS.last.readyState === 'ended');
  // el último cuadro queda en espera del siguiente (no hay): todos menos ese
  assert.ok(videoSamples(sb) >= 1498, 'cuadros entregados: ' + videoSamples(sb));
  assert.ok(Math.abs(sb.offsets[0]) < 0.05, 'empieza en 0');
  assert.equal(tracks, 1);
  assert.equal(v.played, 1);
  assert.match(m.diag(), /duracion=60s/);
  m.destroy();
});

test('Continuar viendo: salta al segundo guardado con la línea de tiempo del archivo', async () => {
  file = makeTs(120);
  reqs = [];
  audioOk = true;
  const v = video();
  const m = new TsVodMse(v, 'http://srv.test/series/u/p/2.mp4');
  const err = await m.start(70);
  assert.equal(err, '');
  const sb = FakeMS.last.sbs[0];
  const off = sb.offsets[0];
  assert.ok(off > 55 && off <= 70.5, 'empieza cerca del segundo 70: ' + off);
  assert.equal(v.currentTime, 70, 'al segundo guardado');
  // no se bajó todo desde el principio
  assert.ok(reqs.some(o => o > file.length * 0.4 && o < file.length * 0.7), 'pedidos: ' + reqs.join(','));
  m.destroy();
});

test('audio que el equipo no acepta: solo el video, sin sonido (no queda en negro)', async () => {
  file = makeTs(20);
  audioOk = false;
  const v = video();
  const m = new TsVodMse(v, 'http://srv.test/series/u/p/3.mp4');
  const err = await m.start(0);
  assert.equal(err, '');
  assert.equal(m.noAudio, true);
  assert.match(FakeMS.last.sbs[0].mime, VIDEO_ONLY_MIME);
  await until(() => FakeMS.last.readyState === 'ended');
  assert.ok(videoSamples(FakeMS.last.sbs[0]) >= 498);
  m.destroy();
  audioOk = true;
});

test('E-AC-3 (que el conversor no da): solo el video desde el principio', async () => {
  file = makeTs(10, 0x87);
  const v = video();
  const m = new TsVodMse(v, 'http://srv.test/series/u/p/4.mp4');
  assert.equal(await m.start(0), '');
  assert.equal(m.noAudio, true);
  assert.deepEqual(m.tracks.map(t => t.codec), ['ec-3']);
  assert.match(FakeMS.last.sbs[0].mime, VIDEO_ONLY_MIME);
  m.destroy();
});

test('un archivo que no es MPEG-TS: lo dice (sin colgarse)', async () => {
  file = new Uint8Array(4 * 1048576).fill(7);
  const m = new TsVodMse(video(), 'http://srv.test/series/u/p/5.mp4');
  assert.equal(await m.start(0), 'no es MPEG-TS');
  m.destroy();
});
