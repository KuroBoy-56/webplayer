// Campanita de la barra (solo con perfiles): bellFrom (src/data/liveTv.ts) da los partidos de HOY de los equipos
// favoritos y de los marcados: en vivo primero (con el marcador en vivo), después los que faltan por hora y al final
// los terminados (el último primero). Mañana y los de otros equipos quedan fuera. `npm test`
const { test, after } = require('node:test');
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const ts = require('typescript');
const originalLoad = Module._load;
const previousTs = require.extensions['.ts'];
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const str = v => (v === undefined || v === null ? '' : String(v));
const hm = s => { const d = new Date(s * 1000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
Module._load = function (request, parent, isMain) {
  if (request === '../api/panel') return { cloud: async () => ({}), lineKey: () => 'k' };
  if (request === '../lib/storage') return { read: () => '', write: () => {} };
  if (request === '../lib/http') return { json: () => null };
  if (request === '../lib/tenant') return { brandName: () => 'X', features: () => ({}) };
  if (request === '../lib/util') return {
    str, int: v => Math.trunc(Number(v) || 0), nowSec: () => 0,
    fold: s => str(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(),
  };
  if (request === '../lib/i18n') return { t: (s, a = {}) => s.replace(/\{(\w+)\}/g, (_, k) => str(a[k])) };
  if (request === '../state') return { getState: () => ({}), profilesNeeded: () => false };
  if (request === './catalog') return {};
  if (request === './sports') return {
    evDay: (e, s) => Math.floor((s + (e?.o || 0)) / 86400),
    panelToday: (ag, now) => Math.floor((now + (ag?.tzo || 0)) / 86400),
    evClock: (e, s) => hm(s + (e?.o || 0)),
    matchSports: () => [],
  };
  if (request === './sportsPanel') return { fetchSports: async () => null, localSports: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => {
  Module._load = originalLoad;
  if (previousTs) require.extensions['.ts'] = previousTs; else delete require.extensions['.ts'];
});
const { bellFrom } = require('../src/data/liveTv.ts');

const now = 20000 * 86400 + 15 * 3600; // 15:00 del día 20000
const ag = {
  sports: { Soccer: { minutes: 110 } },
  events: [
    { id: '1', s: now - 600, h: 'Real Madrid', a: 'Barcelona', sp: 'Soccer' },
    { id: '2', s: now + 5 * 3600, h: 'Arsenal', a: 'Chelsea', hn: 'Arsenal FC', sp: 'Soccer' },
    { id: '3', s: now - 9000, h: 'Boca', a: 'River', sp: 'Soccer', st: 'FT', hs: 2, as: 1 },
    { id: '4', s: now + 86400, h: 'Real Madrid', a: 'Getafe', sp: 'Soccer' },
    { id: '5', s: now + 100, h: 'X', a: 'Y', sp: 'Soccer' },
    { id: '6', s: now + 3600, h: 'P', a: 'Q', sp: 'Soccer' },
  ],
};
const fav = { teams: ['Réal Madrid', 'boca', 'Chelsea'], events: { 6: { t: 'P vs Q', s: 0 } } };

test('en vivo, después los de hoy por hora y al final los terminados', () => {
  const out = bellFrom(fav, ag, [{ id: '1', hs: 1, as: 0, st: '1H' }], now);
  assert.deepStrictEqual(out.map(m => m.text), [
    '¡En vivo! Real Madrid 1-0 Barcelona',
    'Hoy 16:00: P vs Q',
    'Hoy 20:00: Arsenal FC vs Chelsea',
    'Final: Boca 2-1 River',
  ]);
});

test('sin equipos ni marcados no hay avisos', () => {
  assert.deepStrictEqual(bellFrom({ teams: [], events: {} }, ag, [], now), []);
  assert.deepStrictEqual(bellFrom(null, ag, [], now), []);
});
