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
  // (los mismos que tools/build-webos.js: probe.ts lee también el índice compartido, que usa el cliente del panel)
  alias: {
    'react-native': path.join(root, 'web/shims/react-native.tsx'),
    '@amazon-devices/react-native-w3cmedia': path.join(root, 'web/shims/w3cmedia.tsx'),
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

// el índice compartido (VPS / VDS) trae el moov que va al final: los idiomas salen de ahí, sin pedir el final del archivo
test('mp4: con el índice compartido los idiomas salen sin pedir el final del archivo; de otro tamaño no se usa', { skip: !ffmpeg && 'sin ffmpeg' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  const file = sample(dir, 'mp4');
  const data = fs.readFileSync(file);
  // el moov (al final) sin su cabecera, como lo guardan Roku, Vega y Android
  let off = 0, body = null;
  while (off + 8 <= data.length) {
    const size = data.readUInt32BE(off), type = data.toString('latin1', off + 4, off + 8);
    if (type === 'moov') { body = data.subarray(off + 8, off + size); break; }
    off += size;
  }
  assert.ok(body && off > data.length / 2, 'moov al final');
  const fake = { size: data.length };
  const shared = (await esbuild.build({
    stdin: { contents: "export { probeTracks } from './src/lib/probe';", resolveDir: root, loader: 'ts' },
    bundle: true, format: 'cjs', platform: 'node', write: false,
    plugins: [{ name: 'vidx', setup(b) {
      b.onResolve({ filter: /sharedindex$/ }, () => ({ path: 'vidx', namespace: 'vidx' }));
      b.onLoad({ filter: /.*/, namespace: 'vidx' }, () => ({ loader: 'js', contents:
        "export const sharedIndex = () => Promise.resolve(globalThis.__vidx);" +
        "export const fromB64 = s => new Uint8Array(Buffer.from(s, 'base64'));" }));
    } }],
  })).outputFiles[0].text;
  const m2 = { exports: {} };
  new Function('module', 'exports', 'require', shared)(m2, m2.exports, require);
  const s = await serve(file);
  try {
    globalThis.__vidx = { kind: 'm', size: fake.size, text: body.toString('base64') };
    const p = await m2.exports.probeTracks(s.url + '.mp4');
    assert.strictEqual(p.ok, true);
    assert.deepStrictEqual(p.audio.map(a => a.lang), ['spa', 'eng']);
    assert.strictEqual(p.subs.length, 1);
    assert.strictEqual(s.requests, 1, `solo el principio del archivo: ${s.requests} pedidos`);
    // índice de otro archivo (otro tamaño): se lee del servidor como siempre
    globalThis.__vidx = { kind: 'm', size: fake.size + 1, text: body.toString('base64') };
    const before = s.requests;
    const q = await m2.exports.probeTracks(s.url + '.mp4?otro');
    assert.deepStrictEqual(q.audio.map(a => a.lang), ['spa', 'eng']);
    assert.ok(s.requests > before + 1, 'leyó el final del servidor');
  } finally {
    delete globalThis.__vidx;
    s.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
