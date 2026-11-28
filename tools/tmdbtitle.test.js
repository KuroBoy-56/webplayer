// Título para TMDB (src/lib/tmdbTitle.ts): los mismos casos que el panel, Roku y Android (title_clean_vectors.json). `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../src/lib/tmdbTitle.ts'), 'utf8');
const out = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2015 } }).outputText;
const m = { exports: {} };
new Function('module', 'exports', out)(m, m.exports);
const { tmdbTitle, tmdbFirstPart } = m.exports;

test('limpia los títulos igual que el panel, Roku y Android', () => {
  for (const [input, q, y] of JSON.parse(fs.readFileSync(path.join(__dirname, 'title_clean_vectors.json'), 'utf8'))) {
    assert.deepStrictEqual(tmdbTitle(input), { q, y }, input);
  }
});

test('la primera parte de «Título - Subtítulo»', () => {
  assert.strictEqual(tmdbFirstPart('Mission: Impossible - Dead Reckoning'), 'Mission: Impossible');
  assert.strictEqual(tmdbFirstPart('Avatar'), '');
});
