// web/shims/w3cmedia.tsx con un AVPlay simulado: tvSelectTrack elige la pista n de su tipo (el orden del archivo que
// lee probe.ts) con su índice de AVPlay, y tvSubtitleOff apaga los subtítulos. Sin televisor ni red.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const file = path.join(__dirname, '..', 'web', 'shims', 'w3cmedia.tsx');
const calls = [];
globalThis.webapis = {
  avplay: {
    getTotalTrackInfo: () => [
      { type: 'VIDEO', index: 0 },
      { type: 'AUDIO', index: 1, extra_info: '{"language":"spa"}' },
      { type: 'AUDIO', index: 2, extra_info: '{"language":"eng"}' },
      { type: 'TEXT', index: 0, extra_info: '{"track_lang":"spa"}' },
      { type: 'TEXT', index: 1, extra_info: '{"track_lang":"eng"}' },
    ],
    setSelectTrack: (t, i) => calls.push(['select', t, i]),
    setSilentSubtitle: v => calls.push(['silent', v]),
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

test('AVPlay: anuncia que abre los archivos solo y sin MSE', () => {
  const { VideoPlayer } = load();
  const v = new VideoPlayer();
  assert.equal(v.nativeFiles, true);
  assert.equal(v.noMse, true);
  assert.equal(v.nativeHls, true);
});

test('AVPlay: el segundo audio del archivo es la pista 2 de AVPlay (también llamada suelta)', () => {
  const { VideoPlayer } = load();
  const sel = new VideoPlayer().tvSelectTrack;
  calls.length = 0;
  assert.equal(sel('audio', 1), true);
  assert.deepEqual(calls, [['select', 'AUDIO', 2]]);
  assert.equal(sel('audio', 5), false);
});

test('AVPlay: subtítulo n y apagado', () => {
  const { VideoPlayer } = load();
  const v = new VideoPlayer();
  calls.length = 0;
  assert.equal(v.tvSelectTrack('text', 1), true);
  assert.equal(v.tvSubtitleOff(), true);
  assert.deepEqual(calls, [['select', 'TEXT', 1], ['silent', false], ['silent', true]]);
});
