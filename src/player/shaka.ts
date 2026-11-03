// Shaka 4.16.13 con los parches de Amazon para Vega (no el paquete de navegador).
import { VideoPlayer } from '@amazon-devices/react-native-w3cmedia';
import { langName, numbered } from '../lib/lang';
import { t } from '../lib/i18n';
import { UA } from '../lib/http';
import { installShakaEnvironment } from './shaka-env';

export type ShakaTrack = { id: string; label: string; lang: string; codec: string; active: boolean };

// AudioTrack de Shaka 4.16 no expone id. La identidad debe sobrevivir cambios de
// calidad/orden sin confundir dos idiomas ni dos audios del mismo idioma.
function audioId(track: any): string {
  return JSON.stringify([track.language || '', track.label || '', track.codecs || '',
    track.roles || [], track.channelsCount || 0, !!track.spatialAudio, track.audioSamplingRate || 0]);
}

export class ShakaPlayback {
  private player: any = null;
  private alive = true;
  private loaded = false;
  private changed = () => this.onTracks();
  private failed = (event: any) => {
    if (this.alive && this.loaded && event?.detail?.severity === 2) this.onError();
  };
  onTracks: () => void = () => {};
  onError: () => void = () => {};

  constructor(private video: VideoPlayer) {}

  async start(url: string, at: number, language: string, live = false): Promise<void> {
    installShakaEnvironment(this.video);
    // require diferido: el catálogo y los archivos en modo URI no cargan Shaka.
    const module = require('./vendor/shaka-player.compiled');
    const shaka = module.default || module;
    shaka.polyfill.installAll();
    // El build release elimina la API de registro de depuración.
    shaka.log?.setLevel(shaka.log.Level.ERROR);
    for (const scheme of ['http', 'https']) {
      shaka.net.NetworkingEngine.unregisterScheme(scheme);
      shaka.net.NetworkingEngine.registerScheme(scheme, shaka.net.HttpFetchPlugin.parse,
        shaka.net.NetworkingEngine.PluginPriority.APPLICATION, true);
    }
    const p = new shaka.Player();
    this.player = p;
    for (const event of ['trackschanged', 'variantchanged', 'adaptation', 'textchanged', 'texttrackvisibility']) p.addEventListener(event, this.changed);
    p.addEventListener('error', this.failed);
    p.configure({
      preferredAudioLanguage: language,
      abr: { enabled: true },
      streaming: {
        bufferingGoal: live ? 12 : 18,
        // empieza con 1 s bajado (antes 2 en películas y series): arranca antes, como Android (ExoPlayer)
        rebufferingGoal: 1,
        bufferBehind: live ? 6 : 10,
        ignoreTextStreamFailures: true,
        retryParameters: { maxAttempts: 2, timeout: 12000 },
      },
      manifest: {
        retryParameters: { maxAttempts: 2, timeout: 12000 },
        hls: { sequenceMode: true, disableClosedCaptionsDetection: true },
        dash: { disableXlinkProcessing: true },
      },
    });
    p.getNetworkingEngine()?.registerRequestFilter((_type: number, request: any) => {
      request.headers['User-Agent'] = UA;
    });
    await p.attach(this.video);
    if (!this.alive) return;
    await p.load(url, at > 0 ? at : undefined);
    if (!this.alive) return;
    this.loaded = true;
    this.onTracks();
    await this.video.play();
  }

  audioTracks(): ShakaTrack[] {
    return numbered((this.player?.getAudioTracks() || []).map((track: any, i: number) => ({
      id: audioId(track),
      label: langName(track.language, track.label) || t('Audio {n}', { n: i + 1 }),
      lang: track.language || '', codec: track.codecs || '', active: !!track.active,
    })));
  }

  selectAudio(id: string): boolean {
    const track = this.player?.getAudioTracks().find((tr: any) => audioId(tr) === id);
    if (!track) return false;
    // Shaka conserva ABR, tiempo y estado de pausa, y limpia el audio anterior.
    this.player.selectAudioTrack(track, 0);
    this.onTracks();
    return true;
  }

  textTracks(): ShakaTrack[] {
    const visible = this.player?.isTextTrackVisible();
    return numbered((this.player?.getTextTracks() || []).map((track: any, i: number) => ({
      id: String(track.id),
      label: langName(track.language, track.label) || t('Subtítulos {n}', { n: i + 1 }),
      lang: track.language || '', codec: '', active: !!visible && !!track.active,
    })));
  }

  selectText(id: string | null): void {
    const p = this.player;
    if (!p) return;
    if (id !== null) {
      const track = p.getTextTracks().find((tr: any) => String(tr.id) === id);
      if (!track) return;
      p.selectTextTrack(track);
    }
    p.setTextTrackVisibility(id !== null);
    this.onTracks();
  }

  async destroy(): Promise<void> {
    this.alive = false;
    this.loaded = false;
    const p = this.player;
    this.player = null;
    if (p) {
      for (const event of ['trackschanged', 'variantchanged', 'adaptation', 'textchanged', 'texttrackvisibility']) p.removeEventListener(event, this.changed);
      p.removeEventListener('error', this.failed);
      await p.destroy();
    }
    if ((globalThis as any).gmedia === this.video) (globalThis as any).gmedia = null;
  }
}
