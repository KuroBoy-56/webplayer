// MP4 de prueba como los de los servidores IPTV: ftyp, mdat (el video, generado al vuelo) y el índice (moov) al final,
// con una pista de video H.264 y varias de audio AAC intercaladas cada 2 s. Solo las cajas que leen los lectores de la
// app (mp4mse.ts): tamaños, posiciones, tiempos, cuadros clave y desfases de los cuadros B.
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = n => [(n >>> 8) & 255, n & 255];
const tag = s => [...s].map(c => c.charCodeAt(0));
const zeros = n => new Array(n).fill(0);

function box(type, ...parts) {
  let size = 8;
  for (const p of parts) size += p.length;
  const out = Buffer.alloc(size);
  out.writeUInt32BE(size, 0);
  out.write(type, 4, 'latin1');
  let o = 8;
  for (const p of parts) {
    Buffer.from(p).copy(out, o);
    o += p.length;
  }
  return out;
}
const full = (type, v, ...parts) => box(type, [v, 0, 0, 0], ...parts);

function u32arr(list) {
  const b = Buffer.alloc(list.length * 4);
  for (let i = 0; i < list.length; i++) b.writeUInt32BE(list[i] >>> 0, i * 4);
  return b;
}

// opts: secs (duración), audios (cantidad de idiomas), vkbps / akbps (ritmo de video y de cada audio), langs
// subs: pistas de subtítulos tx3g (una frase cada 2 s, intercalada después de los audios)
// fat: tiempos muestra por muestra (stts con una fila por muestra), como algunos convertidores: índices de 10-16 MB
function makeMp4({ secs = 2700, audios = 2, vkbps = 1000, akbps = 128, langs = ['spa', 'eng', 'por', 'fra', 'ita', 'deu'], subs = 0, fat = false } = {}) {
  const FPS = 24;
  const SLICE = 2; // segundos por trozo intercalado
  const vframes = secs * FPS;
  const vsize = Math.round((vkbps * 1000) / 8 / FPS);
  const aPerSec = 48000 / 1024;
  const aframes = Math.floor(secs * aPerSec);
  const asize = Math.round((akbps * 1000) / 8 / aPerSec);
  // tamaños con algo de variación (los cuadros clave más grandes)
  const vs = new Array(vframes);
  for (let i = 0; i < vframes; i++) vs[i] = i % (FPS * SLICE) === 0 ? vsize * 4 : Math.max(200, vsize - Math.round((vsize * 3) / (FPS * SLICE)) + ((i * 37) % 97));
  const as = new Array(aframes);
  for (let i = 0; i < aframes; i++) as[i] = asize + ((i * 13) % 17) - 8;
  // trozos: cada SLICE s, el video y después cada audio
  const slices = Math.ceil(secs / SLICE);
  const ftyp = box('ftyp', tag('isom'), [0, 0, 2, 0], tag('isom'), tag('iso2'), tag('avc1'), tag('mp41'));
  let pos = ftyp.length + 8; // después de la cabecera del mdat
  const vco = [];
  const vper = [];
  const aco = Array.from({ length: audios }, () => []);
  const aper = Array.from({ length: audios }, () => []);
  // subtítulos: una muestra por trozo («línea N» en el trozo N)
  const subText = (k, n) => Buffer.from((k ? 'line ' : 'línea ') + n, 'utf8');
  const subSample = (k, n) => { const t = subText(k, n); return Buffer.concat([Buffer.from([t.length >> 8, t.length & 255]), t]); };
  const sco = Array.from({ length: subs }, () => []);
  const ssz = Array.from({ length: subs }, () => []);
  const subBytes = new Map();
  let vi = 0;
  const ai = new Array(audios).fill(0);
  for (let s = 0; s < slices; s++) {
    const vEnd = Math.min(vframes, (s + 1) * SLICE * FPS);
    vco.push(pos);
    vper.push(vEnd - vi);
    for (; vi < vEnd; vi++) pos += vs[vi];
    const aEnd = Math.min(aframes, Math.floor((s + 1) * SLICE * aPerSec));
    for (let k = 0; k < audios; k++) {
      aco[k].push(pos);
      aper[k].push(aEnd - ai[k]);
      for (; ai[k] < aEnd; ai[k]++) pos += as[ai[k]];
    }
    for (let k = 0; k < subs; k++) {
      const b = subSample(k, s);
      sco[k].push(pos);
      ssz[k].push(b.length);
      subBytes.set(pos, b);
      pos += b.length;
    }
  }
  const mdatLen = pos - ftyp.length;
  const stsc = per => {
    const rows = [];
    let last = -1;
    for (let c = 0; c < per.length; c++) if (per[c] !== last) { rows.push(c + 1, per[c], 1); last = per[c]; }
    return full('stsc', 0, u32(rows.length / 3), u32arr(rows));
  };
  const stsz = sizes => full('stsz', 0, u32(0), u32(sizes.length), u32arr(sizes));
  const co = offs => (offs[offs.length - 1] > 0xffffffff ? full('co64', 0, u32(offs.length), Buffer.concat(offs.map(o => Buffer.from([...u32(Math.floor(o / 4294967296)), ...u32(o >>> 0)])))) : full('stco', 0, u32(offs.length), u32arr(offs)));
  const mdhd = (scale, dur, lang) => {
    const l = lang ? ((lang.charCodeAt(0) - 96) << 10) | ((lang.charCodeAt(1) - 96) << 5) | (lang.charCodeAt(2) - 96) : 0x55c4;
    return full('mdhd', 0, zeros(8), u32(scale), u32(dur), u16(l), [0, 0]);
  };
  const hdlr = t => full('hdlr', 0, zeros(4), tag(t), zeros(12), [0]);
  const tkhd = (id, enabled) => box('tkhd', [0, 0, 0, enabled ? 3 : 2], zeros(8), u32(id), zeros(4), zeros(4), zeros(60));
  // video: 12800 por segundo, cuadros B (ctts) en todas las muestras
  const VS = 12800;
  const vd = VS / FPS;
  const sps = [0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9, 0x40, 0x50, 0x05, 0xbb, 0x01, 0x10];
  const pps = [0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0];
  const avcC = box('avcC', [1, 0x64, 0x00, 0x1f, 0xff, 0xe1], u16(sps.length), sps, [1], u16(pps.length), pps);
  const avc1 = box('avc1', zeros(6), [0, 1], zeros(16), u16(1280), u16(720), [0, 0x48, 0, 0, 0, 0x48, 0, 0], zeros(4), [0, 1], zeros(32), [0, 0x18, 0xff, 0xff], avcC);
  const ctts = [];
  for (let i = 0; i < vframes; i++) ctts.push(1, (i % 3 === 0 ? 2 : i % 3 === 1 ? 0 : 1) * vd);
  const keys = [];
  for (let i = 0; i < vframes; i += FPS * SLICE) keys.push(i + 1);
  const vstbl = box('stbl', full('stsd', 0, u32(1), avc1), full('stts', 0, u32(1), u32(vframes), u32(vd)), full('ctts', 0, u32(vframes), u32arr(ctts)), full('stss', 0, u32(keys.length), u32arr(keys)), stsc(vper), stsz(vs), co(vco));
  const minf = (head, stbl) => box('minf', head, box('dinf', full('dref', 0, u32(1), full('url ', 0))), stbl);
  const vtrak = box('trak', tkhd(1, true), box('mdia', mdhd(VS, vframes * vd, 'und'), hdlr('vide'), minf(full('vmhd', 0, zeros(8)), vstbl)));
  const atraks = [];
  for (let k = 0; k < audios; k++) {
    const esds = full('esds', 0, [0x03, 0x19, 0, k + 2, 0, 0x04, 0x11, 0x40, 0x15, ...zeros(11), 0x05, 0x02, 0x11, 0x90, 0x06, 0x01, 0x02]);
    const mp4a = box('mp4a', zeros(6), [0, 1], zeros(8), [0, 2, 0, 16], zeros(4), u16(48000), [0, 0], esds);
    const astts = fat ? full('stts', 0, u32(aframes), u32arr(Array.from({ length: aframes * 2 }, (_, j) => (j % 2 ? 1024 : 1)))) : full('stts', 0, u32(1), u32(aframes), u32(1024));
    const astbl = box('stbl', full('stsd', 0, u32(1), mp4a), astts, stsc(aper[k]), stsz(as), co(aco[k]));
    atraks.push(box('trak', tkhd(k + 2, k === 0), box('mdia', mdhd(48000, aframes * 1024, langs[k % langs.length]), hdlr('soun'), minf(full('smhd', 0, zeros(4)), astbl))));
  }
  const straks = [];
  for (let k = 0; k < subs; k++) {
    const tx3g = box('tx3g', zeros(6), [0, 1], zeros(4), zeros(1), zeros(1), zeros(4), zeros(8), zeros(12));
    const sstbl = box('stbl', full('stsd', 0, u32(1), tx3g), full('stts', 0, u32(1), u32(slices), u32(2000)), full('stsc', 0, u32(1), u32arr([1, 1, 1])), stsz(ssz[k]), co(sco[k]));
    straks.push(box('trak', tkhd(audios + 2 + k, false), box('mdia', mdhd(1000, slices * 2000, langs[k % langs.length]), hdlr('sbtl'), minf(full('nmhd', 0), sstbl))));
  }
  const mvhd = full('mvhd', 0, zeros(8), u32(1000), u32(secs * 1000), zeros(80));
  const moov = box('moov', mvhd, vtrak, ...atraks, ...straks);
  const mdatHead = Buffer.from([...u32(mdatLen), ...tag('mdat')]);
  const size = ftyp.length + mdatLen + moov.length;
  const moovOff = ftyp.length + mdatLen;
  // bytes del archivo [a, b)
  const read = (a, b) => {
    const out = Buffer.alloc(b - a);
    for (let i = a; i < b; ) {
      if (i < ftyp.length) {
        const n = Math.min(b, ftyp.length) - i;
        ftyp.copy(out, i - a, i, i + n);
        i += n;
      } else if (i < ftyp.length + 8) {
        const n = Math.min(b, ftyp.length + 8) - i;
        mdatHead.copy(out, i - a, i - ftyp.length, i - ftyp.length + n);
        i += n;
      } else if (i < moovOff) {
        const n = Math.min(b, moovOff) - i;
        for (let j = 0; j < n; j++) out[i - a + j] = ((i + j) * 31 + ((i + j) >> 9)) & 255;
        // los subtítulos sí con su texto
        if (subBytes.size) for (const [o, sb] of subBytes) if (o + sb.length > i && o < i + n) for (let j = 0; j < sb.length; j++) if (o + j >= i && o + j < i + n) out[o + j - a] = sb[j];
        i += n;
      } else {
        const n = b - i;
        moov.copy(out, i - a, i - moovOff, i - moovOff + n);
        i += n;
      }
    }
    return out;
  };
  return { size, moovOff, moovLen: moov.length, read, secs, vco, vs };
}

module.exports = { makeMp4 };
