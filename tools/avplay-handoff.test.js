// Traspaso miniatura ↔ pantalla grande con AVPlay (web/shims/w3cmedia.tsx): el mismo VideoPlayer cambia de superficie
// sin detener ni volver a abrir AVPlay, y uno viejo que se cierra después no toca el AVPlay de otro. Sin televisor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const file = path.join(__dirname, '..', 'web', 'shims', 'w3cmedia.tsx');
const calls = [];
// elementos de página mínimos: id, padre, estilo y rectángulo
function el(id, rect, parent) {
  const st = {};
  return {
    id, parentElement: parent || null, children: [],
    style: { setProperty: (k, v) => (st[k] = v), getPropertyValue: k => st[k] || '', get cssText() { return ''; }, set cssText(x) {}, get bg() { return st['background-color']; } },
    getBoundingClientRect: () => rect,
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
  };
}
const root = el('root', { left: 0, top: 0, width: 1920, height: 1080 });
const els = {
  mini: el('mini', { left: 1300, top: 120, width: 480, height: 270 }, el('live', { left: 0, top: 0, width: 1920, height: 1080 }, root)),
  full: el('full', { left: 0, top: 0, width: 1920, height: 1080 }, el('player', { left: 0, top: 0, width: 1920, height: 1080 }, root)),
};
globalThis.window = { innerWidth: 1920, innerHeight: 1080 };
globalThis.document = {
  hidden: false,
  getElementById: id => els[id] || null,
  addEventListener() {},
  removeEventListener() {},
  createElement: () => ({ style: { cssText: '' }, remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(c => c !== this); this.parentElement = null; } }),
};
globalThis.webapis = {
  avplay: {
    open: u => calls.push(['open', u]),
    close: () => calls.push(['close']),
    stop: () => calls.push(['stop']),
    play: () => calls.push(['play']),
    pause: () => calls.push(['pause']),
    seekTo: () => calls.push(['seek']),
    setListener() {},
    setStreamingProperty() {},
    setDisplayMethod() {},
    setDisplayRect: (x, y, w, h) => calls.push(['rect', x, y, w, h]),
    prepareAsync: ok => ok(),
    getDuration: () => 0,
    getTotalTrackInfo: () => [],
    getCurrentStreamInfo: () => [],
    setSilentSubtitle() {},
  },
};

function load() {
  const src = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    fileName: file,
  }).outputText;
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  const orig = Module._load;
  Module._load = function (req, parent, isMain) {
    if (req === 'react-native-web') return { View: () => null };
    if (req === '../../src/lib/http') return { UA: 'prueba' };
    return orig.call(this, req, parent, isMain);
  };
  try {
    m._compile(src, file);
  } finally {
    Module._load = orig;
  }
  return m.exports;
}

test('AVPlay: la pantalla grande toma el canal de la miniatura sin detener ni abrir AVPlay otra vez', async () => {
  const { VideoPlayer } = load();
  const v = new VideoPlayer();
  await v.initialize();
  v.setSurfaceHandle('mini');
  v.src = 'http://x/live/u/p/1.m3u8';
  v.play();
  assert.equal(v.paused, false);
  calls.length = 0;
  v.park();
  v.setSurfaceHandle('full');
  // la miniatura se desmonta después: ya no le quita la superficie
  v.clearSurfaceHandle('mini');
  assert.deepEqual(calls, [['rect', 0, 0, 1920, 1080]]);
  assert.equal(v.paused, false);
  assert.equal(els.full.style.bg, 'transparent');
  assert.equal(els.full.parentElement.style.bg, 'transparent');
  // y de vuelta a la miniatura
  calls.length = 0;
  v.park();
  v.setSurfaceHandle('mini');
  assert.deepEqual(calls, [['rect', 1300, 120, 480, 270]]);
  assert.equal(els.mini.style.bg, 'transparent');
  // el camino de la pantalla grande vuelve a su fondo
  assert.equal(els.full.style.bg, '');
});

test('AVPlay: un reproductor viejo que se cierra después no detiene, pausa ni tapa el del dueño', async () => {
  const { VideoPlayer } = load();
  const old = new VideoPlayer();
  await old.initialize();
  old.setSurfaceHandle('mini');
  old.src = 'http://x/live/u/p/1.m3u8';
  old.play();
  const cur = new VideoPlayer();
  await cur.initialize();
  cur.setSurfaceHandle('full');
  cur.src = 'http://x/live/u/p/2.m3u8';
  cur.play();
  calls.length = 0;
  old.pause();
  old.currentTime = 30;
  await old.deinitialize();
  assert.deepEqual(calls, []);
  assert.equal(cur.paused, false);
  assert.equal(els.full.style.bg, 'transparent');
  // el dueño sí cierra AVPlay
  await cur.deinitialize();
  assert.deepEqual(calls, [['stop'], ['close']]);
});
