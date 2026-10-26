// Página de error de XUI.one en «Debug Mode» (src/lib/xui.ts) y listas HLS de los canales (src/lib/hlslist.ts). `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const esbuild = require('esbuild');
const path = require('path');

const root = path.join(__dirname, '..');
function load(file) {
  const code = esbuild.buildSync({
    stdin: { contents: "export * from './" + file + "';", resolveDir: root, loader: 'ts' },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    write: false,
  }).outputFiles[0].text;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  return m.exports;
}
const { xuiError } = load('src/lib/xui');
const { parseList, resolveUrl } = load('src/lib/hlslist');

const page =
  '<html><head><title>XUI.one - Debug Mode</title><style>.notfound h2{text-transform:uppercase}</style></head>' +
  '<body><div id="notfound"><div class="notfound"><div class="notfound-404"><h1>XUI.ONE</h1></div>' +
  '<h2>INVALID_STREAM_ID</h2><p>Stream ID doesn\'t exist.</p></div></div></body></html>';

test('XUI: código y texto de la página de error', () => {
  assert.deepStrictEqual(xuiError(page), { code: 'INVALID_STREAM_ID', text: "Stream ID doesn't exist." });
  assert.strictEqual(xuiError('<html><body><h1>Welcome to nginx!</h1></body></html>'), null);
});

test('HLS: direcciones relativas a la lista, a la raíz del servidor o completas', () => {
  assert.strictEqual(resolveUrl('http://h.com:8080/live/u/p/1.m3u8?t=1', 'seg-5.ts'), 'http://h.com:8080/live/u/p/seg-5.ts');
  assert.strictEqual(resolveUrl('http://lb2.x:8080/live/u/p/1.m3u8?token=a', '/hls/tok/1_5.ts'), 'http://lb2.x:8080/hls/tok/1_5.ts');
  assert.strictEqual(resolveUrl('https://h.com/a/b.m3u8', '//cdn.x/5.ts'), 'https://cdn.x/5.ts');
});

test('HLS: lista maestra elige la de más calidad; lista en vivo con su número de segmento', () => {
  const master = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\nhigh/index.m3u8\n';
  assert.strictEqual(parseList(master, 'http://h/x/m.m3u8').master, 'http://h/x/high/index.m3u8');
  const live = '#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-MEDIA-SEQUENCE:120\n#EXTINF:10,\n/hls/a/120.ts\n#EXTINF:10,\n/hls/a/121.ts\n';
  const p = parseList(live, 'http://h:80/live/u/p/1.m3u8');
  assert.strictEqual(p.master, '');
  assert.deepStrictEqual(p.segs.map(x => x.seq), [120, 121]);
  assert.strictEqual(p.segs[0].url, 'http://h:80/hls/a/120.ts');
  assert.strictEqual(p.target, 10);
  assert.strictEqual(p.ended, false);
});
