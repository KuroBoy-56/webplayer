// Pistas de la cabecera del archivo (src/lib/probe.ts): pocos pedidos al servidor y una sola lectura por video. `npm test`
const { test } = require('node:test');
const assert = require('node:assert');
const esbuild = require('esbuild');
const { execFileSync } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const code = esbuild.buildSync({
  stdin: { contents: "export { probeTracks } from './src/lib/probe';", resolveDir: root, loader: 'ts' },
  bundle: true,
  format: 'cjs',
  platform: 'node',
  write: false,
  alias: {
    '@react-native-async-storage/async-storage': path.join(root, 'web/shims/async-storage.ts'),
    '@amazon-devices/react-native-kepler': path.join(root, 'web/shims/kepler.ts'),
  },
}).outputFiles[0].text;
const m = { exports: {} };
new Function('module', 'exports', 'require', code)(m, m.exports, require);
const { probeTracks } = m.exports;

let ffmpeg = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { ffmpeg = false; }

// 10 min de video (el índice moov de un MP4 pasa de 256 KB, como en una película) con audio en español e inglés y un subtítulo; el MP4 con el índice moov al final
function sample(dir, ext) {
  const f = path.join(dir, 'v.' + ext);
  const srt = path.join(dir, 's.srt');
  fs.writeFileSync(srt, '1\n00:00:01,000 --> 00:00:03,000\nHola\n');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=25:duration=600', '-f', 'lavfi', '-i', 'sine=f=440:d=600',
    '-f', 'lavfi', '-i', 'sine=f=660:d=600', '-i', srt, '-map', '0', '-map', '1', '-map', '2', '-map', '3', '-c:v', 'libx264', '-b:v', '20k', '-preset', 'ultrafast',
    '-c:a', 'aac', '-c:s', ext === 'mp4' ? 'mov_text' : 'srt', '-metadata:s:a:0', 'language=spa', '-metadata:s:a:1', 'language=eng',
    '-metadata:s:s:0', 'language=spa', f]);
  return f;
}

// servidor con Range (como un servidor IPTV) que cuenta los pedidos
function serve(file) {
  const data = fs.readFileSync(file);
  const s = { requests: 0, size: data.length };
  s.server = http.createServer((req, res) => {
    s.requests++;
    const m = /bytes=(\d+)-(\d+)/.exec(req.headers.range || '');
    const a = m ? +m[1] : 0;
    const b = m ? Math.min(+m[2], data.length - 1) : data.length - 1;
    res.writeHead(m ? 206 : 200, { 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Content-Length': b - a + 1 });
    res.end(data.subarray(a, b + 1));
  });
  return new Promise(ok => s.server.listen(0, '127.0.0.1', () => { s.url = `http://127.0.0.1:${s.server.address().port}/v`; ok(s); }));
}

for (const ext of ['mkv', 'mp4']) {
  test(`${ext}: los dos audios y el subtítulo con 1 o 2 pedidos, y la segunda vez sin pedir nada`, { skip: !ffmpeg && 'sin ffmpeg' }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
    const s = await serve(sample(dir, ext));
    try {
      assert.ok(s.size > 4 * 524288, 'el archivo es más grande que el primer pedido');
      const p = await probeTracks(s.url + '.' + ext);
      assert.strictEqual(p.ok, true);
      assert.deepStrictEqual(p.audio.map(a => a.lang), ['spa', 'eng']);
      assert.strictEqual(p.subs.length, 1);
      assert.ok(s.requests <= 2, `pedidos: ${s.requests}`);
      const before = s.requests;
      await probeTracks(s.url + '.' + ext);
      assert.strictEqual(s.requests, before, 'el mismo video no se vuelve a leer');
    } finally {
      s.server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
