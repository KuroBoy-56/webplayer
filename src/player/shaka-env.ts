// Adaptación W3C documentada por Amazon para React Native en Vega.
// Se instala al abrir el primer manifiesto, evitando trabajo al navegar el catálogo.
import * as media from '@amazon-devices/react-native-w3cmedia';
import { DOMParser } from '@xmldom/xmldom';

let installed = false;

export function installShakaEnvironment(video: media.VideoPlayer): void {
  const g = globalThis as any;
  g.gmedia = video;
  if (installed) return;
  installed = true;
  const w = g.window || g;
  g.window = w;
  const m = media as any;
  for (const [key, value] of Object.entries({
    MediaSource: m.MediaSource,
    SourceBuffer: m.SourceBufferImpl,
    HTMLMediaElement: m.HTMLMediaElement,
    HTMLVideoElement: m.HTMLVideoElement,
    TextTrackCue: m.TextTrackCue,
    VTTCue: m.VTTCue,
    TextTrack: m.TextTrackImpl,
    MediaError: m.MediaError,
    TextDecoder: m.TextDecoder,
    DOMParser,
  })) if (value) w[key] = g[key] = value;
  if (!g.navigator) g.navigator = {};
  g.navigator.userAgent = 'AFTCA001';
  g.navigator.requestMediaKeySystemAccess = m.requestMediaKeySystemAccess;
  g.navigator.mediaCapabilities = { decodingInfo: m.decodingInfo };
  g.Node = { TEXT_NODE: 3, CDATA_SECTION_NODE: 4 };
  g.Element = class { constructor(public tagName: string) {} };
  g.document = {
    createElement: () => g.gmedia,
    getElementsByTagName: () => [g.gmedia],
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  w.fetch = g.fetch;
  w.addEventListener = w.addEventListener || (() => {});
  w.removeEventListener = w.removeEventListener || (() => {});
  w.crypto = m.WebCrypto;
  // base-64 no contiene tipos; se carga junto con Shaka.
  const base64 = require('base-64');
  w.atob = g.atob = base64.decode;
  w.btoa = g.btoa = base64.encode;
  if (!m.HTMLMediaElement.prototype.getElementsByTagName) {
    m.HTMLMediaElement.prototype.getElementsByTagName = () => [];
  }
}
