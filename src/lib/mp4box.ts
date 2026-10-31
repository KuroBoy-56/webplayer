// Cajas MP4 fragmentado (fMP4) para el lector de canales (tsmux.ts): el inicio (ftyp + moov con el video H.264 y el
// audio AAC) y cada fragmento (moof + mdat) con la duración exacta de cada muestra, así lo entregado queda de corrido.
// Pista 1 = video (90 kHz), pista 2 = audio (frecuencia del audio).

export type VideoCfg = { sps: Uint8Array; pps: Uint8Array; width: number; height: number };
export type AudioCfg = { config: Uint8Array; channels: number; rate: number };
export type Sample = { size: number; duration: number; cts: number; key: boolean };

export const VIDEO_ID = 1;
export const AUDIO_ID = 2;

const tag = (s: string) => [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const zeros = (n: number) => new Array<number>(n).fill(0);
const MATRIX = [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0, 0, 0];

function box(type: string, ...parts: (Uint8Array | number[])[]): Uint8Array {
  let size = 8;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  out.set(u32(size), 0);
  out.set(tag(type), 4);
  let o = 8;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const p of parts) size += p.length;
  const out = new Uint8Array(size);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const hex2 = (n: number) => (n < 16 ? '0' : '') + n.toString(16);

// códecs para MediaSource.isTypeSupported / addSourceBuffer
export function mp4Mime(v: VideoCfg | null, a: AudioCfg | null): string {
  const c: string[] = [];
  if (v) c.push('avc1.' + hex2(v.sps[1]) + hex2(v.sps[2]) + hex2(v.sps[3]));
  if (a) c.push('mp4a.40.' + (a.config[0] >> 3));
  return (v ? 'video' : 'audio') + '/mp4; codecs="' + c.join(',') + '"';
}

function tkhd(id: number, v: VideoCfg | null): Uint8Array {
  return box('tkhd', [0, 0, 0, 7, ...zeros(8), ...u32(id), ...zeros(4), ...zeros(4), ...zeros(8), 0, 0, 0, 0, v ? 0 : 1, 0, 0, 0, ...MATRIX,
    ...u16(v ? v.width : 0), 0, 0, ...u16(v ? v.height : 0), 0, 0]);
}

function stbl(entry: Uint8Array): Uint8Array {
  const empty = [0, 0, 0, 0, 0, 0, 0, 0];
  return box('stbl', box('stsd', [0, 0, 0, 0, 0, 0, 0, 1], entry), box('stts', empty), box('stsc', empty), box('stsz', [...empty, 0, 0, 0, 0]), box('stco', empty));
}

function trak(id: number, scale: number, v: VideoCfg | null, entry: Uint8Array): Uint8Array {
  const handler = v ? 'vide' : 'soun';
  const name = v ? 'VideoHandler' : 'SoundHandler';
  const hdlr = box('hdlr', [...zeros(8), ...tag(handler), ...zeros(12), ...Array.from(name, ch => ch.charCodeAt(0)), 0]);
  const mdhd = box('mdhd', [...zeros(12), ...u32(scale), ...zeros(4), 0x55, 0xc4, 0, 0]);
  const head = v ? box('vmhd', [0, 0, 0, 1, ...zeros(8)]) : box('smhd', zeros(8));
  const dinf = box('dinf', box('dref', [0, 0, 0, 0, 0, 0, 0, 1], box('url ', [0, 0, 0, 1])));
  return box('trak', tkhd(id, v), box('mdia', mdhd, hdlr, box('minf', head, dinf, stbl(entry))));
}

function avc1(v: VideoCfg): Uint8Array {
  const avcc = box('avcC', [1, v.sps[1], v.sps[2], v.sps[3], 0xff, 0xe1, ...u16(v.sps.length)], v.sps, [1, ...u16(v.pps.length)], v.pps);
  return box('avc1', [...zeros(6), 0, 1, ...zeros(16), ...u16(v.width), ...u16(v.height), 0, 0x48, 0, 0, 0, 0x48, 0, 0, ...zeros(4), 0, 1, ...zeros(32), 0, 0x18, 0xff, 0xff], avcc);
}

function mp4a(a: AudioCfg): Uint8Array {
  const n = a.config.length;
  const esds = box('esds', [0, 0, 0, 0, 0x03, 0x17 + n, 0, 1, 0, 0x04, 0x0f + n, 0x40, 0x15, ...zeros(11), 0x05, n], a.config, [0x06, 0x01, 0x02]);
  return box('mp4a', [...zeros(6), 0, 1, ...zeros(8), 0, a.channels, 0, 16, ...zeros(4), ...u16(a.rate), 0, 0], esds);
}

const trex = (id: number) => box('trex', [0, 0, 0, 0, ...u32(id), 0, 0, 0, 1, ...zeros(8), 0, 1, 0, 1]);

// ftyp + moov con las pistas que tenga el canal. aEntry: la descripción del audio tal cual del archivo (Dolby ec-3 /
// ac-3 de un MP4, mp4mse.ts); sin ella, la de AAC armada con a
export function initSegment(v: VideoCfg | null, a: AudioCfg | null, aEntry?: Uint8Array): Uint8Array {
  const ftyp = box('ftyp', [...tag('isom'), 0, 0, 0, 1, ...tag('isom'), ...tag('avc1'), ...tag('mp41')]);
  const mvhd = box('mvhd', [...zeros(12), ...u32(1000), ...zeros(4), 0, 1, 0, 0, 1, 0, ...zeros(10), ...MATRIX, ...zeros(24), 0xff, 0xff, 0xff, 0xff]);
  const traks: Uint8Array[] = [];
  const trexs: Uint8Array[] = [];
  if (v) {
    traks.push(trak(VIDEO_ID, 90000, v, avc1(v)));
    trexs.push(trex(VIDEO_ID));
  }
  if (a) {
    traks.push(trak(AUDIO_ID, a.rate, null, aEntry || mp4a(a)));
    trexs.push(trex(AUDIO_ID));
  }
  return concat([ftyp, box('moov', mvhd, ...traks, box('mvex', ...trexs))]);
}

// moof + mdat de una pista: base = tiempo de decodificación de la primera muestra (en la escala de la pista)
export function fragment(seq: number, id: number, base: number, samples: Sample[], data: Uint8Array): Uint8Array {
  const hi = Math.floor(base / 4294967296);
  const lo = base - hi * 4294967296;
  const build = (offset: number) => {
    const rows: number[] = [0, 0, 0x0f, 0x01, ...u32(samples.length), ...u32(offset)];
    for (const s of samples) {
      rows.push(...u32(s.duration), ...u32(s.size));
      // clave: no depende de otras; el resto: depende y no es punto de entrada
      rows.push(...(s.key ? [0x02, 0x00, 0, 0] : [0x01, 0x01, 0, 0]), ...u32(s.cts));
    }
    return box('moof', box('mfhd', [0, 0, 0, 0, ...u32(seq)]), box('traf', box('tfhd', [0, 0, 0, 0, ...u32(id)]), box('tfdt', [1, 0, 0, 0, ...u32(hi), ...u32(lo)]), box('trun', rows)));
  };
  const moof = build(build(0).length + 8);
  return concat([moof, box('mdat', data)]);
}
