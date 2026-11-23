// Iconos de LG contra el color del mosaico (QA de LG Seller Lounge: «App icon background color and tile color do not
// match», QA2026111927245). El fondo de icon.png (80x80), largeIcon.png (130x130) y el de Seller Lounge (400x400) tiene
// que ser exactamente iconColor de webos/appinfo.json. Los genera tools/lg-icons/make-lg-icons.py.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const root = path.join(__dirname, '..');
const info = JSON.parse(fs.readFileSync(path.join(root, 'webos', 'appinfo.json'), 'utf8'));

// PNG de 8 bits RGB / RGBA sin entrelazar (lo que escribe el generador): { w, h, ch, px, chunks }
function readPng(file) {
  const buf = fs.readFileSync(file);
  assert.strictEqual(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', file + ': no es PNG');
  const chunks = [];
  const idat = [];
  let w = 0, h = 0, depth = 0, type = 0, interlace = 0;
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i);
    const name = buf.toString('latin1', i + 4, i + 8);
    const data = buf.subarray(i + 8, i + 8 + len);
    chunks.push(name);
    if (name === 'IHDR') [w, h, depth, type, interlace] = [data.readUInt32BE(0), data.readUInt32BE(4), data[8], data[9], data[12]];
    if (name === 'IDAT') idat.push(data);
    i += 12 + len;
  }
  assert.ok(depth === 8 && (type === 2 || type === 6) && interlace === 0, file + ': se espera RGB/RGBA de 8 bits');
  const ch = type === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const cur = raw[y * (stride + 1) + 1 + x];
      const a = x >= ch ? px[y * stride + x - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= ch && y > 0 ? px[(y - 1) * stride + x - ch] : 0;
      const p = a + b - c;
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      assert.ok(pred !== undefined, file + ': filtro PNG desconocido ' + f);
      px[y * stride + x] = (cur + pred) & 255;
    }
  }
  return { w, h, ch, px, chunks };
}

const tile = /^#([0-9a-f]{6})$/i.exec(info.iconColor || '');
const icons = [
  ['icon', path.join(root, 'webos', info.icon), 80],
  ['largeIcon', path.join(root, 'webos', info.largeIcon), 130],
  ['Seller Lounge', path.join(root, 'webos', 'store', 'appIcon-400.png'), 400],
];

test('appinfo.json: id, versión x.y.z, iconos y color del mosaico', () => {
  assert.strictEqual(info.id, 'com.mpxplayer.app');
  assert.match(info.version, /^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/);
  assert.strictEqual(info.version, require('../package.json').version);
  assert.ok(tile, 'iconColor debe ser #RRGGBB: ' + info.iconColor);
  assert.ok(info.icon && info.largeIcon);
});

for (const [name, file, size] of icons) {
  test(name + ': ' + size + 'x' + size + ', opaco, sin perfil de color y con el fondo igual a iconColor', () => {
    const { w, h, ch, px, chunks } = readPng(file);
    assert.deepStrictEqual([w, h], [size, size]);
    for (const c of ['gAMA', 'iCCP', 'cHRM', 'sRGB', 'tRNS']) assert.ok(!chunks.includes(c), name + ' trae ' + c);
    const want = [0, 2, 4].map(i => parseInt(tile[1].slice(i, i + 2), 16));
    const frame = Math.round(size * 0.1);
    let bad = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * ch;
        if (ch === 4) assert.strictEqual(px[o + 3], 255, name + ': píxel transparente en ' + x + ',' + y);
        const edge = x < frame || y < frame || x >= w - frame || y >= h - frame;
        if (edge && (px[o] !== want[0] || px[o + 1] !== want[1] || px[o + 2] !== want[2])) bad++;
      }
    }
    assert.strictEqual(bad, 0, name + ': ' + bad + ' píxeles del borde no son ' + info.iconColor);
  });
}
