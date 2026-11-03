// src/player/shaka.ts en el televisor: Shaka Player (con los parches de Amazon para Vega) no va en Samsung. AVPlay
// abre HLS / DASH solo (src/player/playback.ts no usa Shaka con nativeFiles). tools/build-tizen.js pone este archivo
// en lugar del de Vega; si algo lo usa, falla enseguida y el
// reproductor sigue con sus otros pasos.
export type ShakaTrack = { id: string; label: string; lang: string; codec: string; active: boolean };

export class ShakaPlayback {
  onTracks: () => void = () => {};
  onError: () => void = () => {};
  constructor(_video: unknown) {}
  async start(_url: string, _at: number, _language: string, _live = false): Promise<void> {
    throw new Error('Shaka no está en la app de Samsung');
  }
  audioTracks(): ShakaTrack[] {
    return [];
  }
  selectAudio(_id: string): boolean {
    return false;
  }
  textTracks(): ShakaTrack[] {
    return [];
  }
  selectText(_id: string | null): void {}
  async destroy(): Promise<void> {}
}
