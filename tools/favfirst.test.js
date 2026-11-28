// Cuenta › Deporte favorito y Eventos favoritos ordenan Deportes (favoritesFirst de src/data/liveTv.ts): primero los
// partidos en vivo de los eventos favoritos, después los del deporte favorito y luego todo lo demás. `npm test`
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
const store = {};
let profiles = true;
Module._load = function (request, parent, isMain) {
  if (request === '../api/panel') return { cloud: async () => null, lineKey: () => 'line' };
  if (request === '../lib/storage') return {
    read: k => store[k], write: (k, v) => { store[k] = v; },
    readJson: k => (store[k] ? JSON.parse(store[k]) : null), writeJson: (k, v) => { store[k] = JSON.stringify(v); },
  };
  if (request === '../lib/http') return { json: x => x };
  if (request === '../lib/tenant') return { brandName: () => 'MPX', features: () => ({ sports: true }) };
  if (request === '../lib/i18n') return { t: s => s };
  if (request === '../lib/util') return {
    str: v => (v === null || v === undefined ? '' : String(v)), int: v => parseInt(v, 10) || 0,
    nowSec: () => Math.floor(Date.now() / 1000), fold: s => String(s || '').toLowerCase(),
  };
  if (request === '../state') return { getState: () => ({ profile: profiles ? { id: 'p1', kids: false } : null }), profilesNeeded: () => profiles };
  if (request === './catalog') return {};
  if (request === './sports') return { evClock: () => '', evDay: () => 0, matchSports: () => null, panelToday: () => 0 };
  if (request === './sportsPanel') return { fetchSports: async () => null, loadFixtures: async () => null, localSports: () => null };
  return originalLoad.call(this, request, parent, isMain);
};
after(() => { Module._load = originalLoad; require.extensions['.ts'] = previousTs; });
const lt = require('../src/data/liveTv.ts');

const ev = (id, sp, li) => ({ id, sp, li });
const list = [ev('nba', 'Basketball', '4387'), ev('liga', 'Soccer', '4335'), ev('buli', 'Soccer', '4331'), ev('f1', 'Motorsport', '4370'), ev('mls', 'Soccer', '4346')];
const ids = l => l.map(x => x.id);

test('Todos: Bundesliga primero, después el resto del fútbol y luego lo demás (nada se quita)', () => {
  lt.setLiveSport('Soccer', 'Fútbol');
  lt.setLiveLeagues([{ id: '4331', n: 'Bundesliga', b: '', sp: 'Soccer' }]);
  assert.deepStrictEqual(ids(lt.favoritesFirst(list, x => x)), ['buli', 'liga', 'mls', 'nba', 'f1']);
});

test('chip Fútbol: los eventos favoritos primero y después los demás partidos', () => {
  lt.setLiveLeagues([{ id: '4331', n: 'Bundesliga', b: '', sp: 'Soccer' }, { id: '4346', n: 'MLS', b: '', sp: 'Soccer' }]);
  assert.deepStrictEqual(ids(lt.favoritesFirst(list.filter(e => e.sp === 'Soccer'), x => x)), ['buli', 'mls', 'liga']);
});

test('sin favoritos o sin perfiles: el orden de siempre', () => {
  lt.setLiveSport('', '');
  lt.setLiveLeagues([]);
  assert.deepStrictEqual(ids(lt.favoritesFirst(list, x => x)), ids(list));
  lt.setLiveSport('Soccer', 'Fútbol');
  profiles = false;
  assert.deepStrictEqual(ids(lt.favoritesFirst(list, x => x)), ids(list));
  profiles = true;
});
