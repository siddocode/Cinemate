import type HlsType from 'hls.js';
import {
  IVideoPlayerAdapter,
  PlaybackState,
  PlayerEventType,
  PlayerEventHandler,
} from '../types/player.types';

const HLS_SOURCE_PATTERN = /\.m3u8(?:[?#]|$)/i;

export class HTML5VideoAdapter implements IVideoPlayerAdapter {
  private videoElement: HTMLVideoElement | null = null;
  private containerElement: HTMLElement | null = null;
  private eventHandlers: Map<PlayerEventType, Set<PlayerEventHandler>> = new Map();
  private boundListeners: Map<string, EventListener> = new Map();
  private isReady: boolean = false;
  private corsFallbackApplied: boolean = false;
  private hlsInstance: HlsType | null = null;

  async initialize(container: HTMLElement, initialUrl: string): Promise<void> {
    this.containerElement = container;
    this.corsFallbackApplied = false;
    container.innerHTML = '';

    const video = document.createElement('video');
    video.className = 'w-full h-full object-contain bg-black';
    video.playsInline = true;
    video.setAttribute('webkit-playsinline', 'true');
    video.autoplay = false;
    video.crossOrigin = 'anonymous';
    // Bandwidth optimization: 'metadata' prevents browsers from downloading the entire video
    // before playback begins. Range requests fetch only chunks as needed during active playback.
    video.preload = 'metadata';

    this.videoElement = video;
    container.appendChild(video);

    const ready = new Promise<void>((resolve) => {
      const handleCanPlay = () => {
        this.isReady = true;
        this.emit('READY', this.getPlaybackState());
        resolve();
      };

      this.bindEvents(video);

      video.addEventListener('canplay', handleCanPlay, { once: true });
      video.addEventListener('loadedmetadata', handleCanPlay, { once: true });

      // In case metadata is already cached
      if (video.readyState >= 2) {
        handleCanPlay();
      }
    });

    if (initialUrl) {
      void this.loadSource(initialUrl);
    }

    return ready;
  }

  private detachHls() {
    if (this.hlsInstance) {
      try {
        this.hlsInstance.destroy();
      } catch {
        // Ignore teardown races when the player is already gone.
      }
      this.hlsInstance = null;
    }
  }

  private async attachHls(url: string): Promise<boolean> {
    const video = this.videoElement;
    if (!video) return false;

    try {
      const { default: Hls } = await import('hls.js');

      // Safari/iOS can play HLS natively; skip the extra library there.
      if (!Hls.isSupported()) return false;

      const hls = new Hls({ enableWorker: true });
      this.hlsInstance = hls;

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        console.warn('[Syncora] HLS fatal error:', data.type, data.details);
        this.emit('ERROR', this.getPlaybackState());
      });

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls.loadSource(url);
      });
      hls.attachMedia(video);
      return true;
    } catch (err) {
      console.warn('[Syncora] hls.js unavailable, trying native HLS:', err);
      this.detachHls();
      return false;
    }
  }

  private async loadSource(url: string) {
    const video = this.videoElement;
    if (!video) return;

    this.detachHls();
    this.corsFallbackApplied = false;

    if (HLS_SOURCE_PATTERN.test(url)) {
      const attached = await this.attachHls(url);
      if (attached) return;
    }

    video.src = url;
    video.load();
  }

  private bindEvents(video: HTMLVideoElement) {
    const onPlay = () => this.emit('PLAY', this.getPlaybackState());
    const onPause = () => this.emit('PAUSE', this.getPlaybackState());
    const onSeeked = () => this.emit('SEEKED', this.getPlaybackState());
    const onWaiting = () => this.emit('BUFFERING', this.getPlaybackState());
    const onPlaying = () => this.emit('PLAY', this.getPlaybackState());
    const onEnded = () => this.emit('ENDED', this.getPlaybackState());
    const onRateChange = () => this.emit('RATE_CHANGE', this.getPlaybackState());
    const onError = () => {
      const video = this.videoElement;
      if (!video) return;

      // Some CDNs (Twitter/X, certain object stores) serve media without CORS
      // headers. crossOrigin='anonymous' then blocks playback even though the
      // file itself is fine, so retry once without the CORS requirement.
      if (!this.hlsInstance && !this.corsFallbackApplied && video.crossOrigin) {
        this.corsFallbackApplied = true;
        const src = video.currentSrc || video.src;
        if (src) {
          const resumeAt = video.currentTime;
          video.removeAttribute('crossorigin');
          video.crossOrigin = null;
          video.src = src;
          video.load();
          if (resumeAt > 0) {
            try {
              video.currentTime = resumeAt;
            } catch {
              // Ignore; playback resumes from the start.
            }
          }
          return;
        }
      }

      this.emit('ERROR', this.getPlaybackState());
    };

    this.addListener(video, 'play', onPlay);
    this.addListener(video, 'pause', onPause);
    this.addListener(video, 'seeked', onSeeked);
    this.addListener(video, 'waiting', onWaiting);
    this.addListener(video, 'playing', onPlaying);
    this.addListener(video, 'ended', onEnded);
    this.addListener(video, 'ratechange', onRateChange);
    this.addListener(video, 'error', onError);
  }

  private addListener(video: HTMLVideoElement, event: string, listener: EventListener) {
    video.addEventListener(event, listener);
    this.boundListeners.set(event, listener);
  }

  async play(): Promise<void> {
    if (!this.videoElement) return;
    try {
      await this.videoElement.play();
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        try {
          this.videoElement.muted = true;
          await this.videoElement.play();
          this.emit('AUTOPLAY_MUTED', this.getPlaybackState());
          return;
        } catch {
          this.emit('AUTOPLAY_BLOCKED', this.getPlaybackState());
          return;
        }
      }
      console.warn('[Syncora] HTML5 play error:', err);
    }
  }

  async pause(): Promise<void> {
    if (!this.videoElement) return;
    try {
      this.videoElement.pause();
    } catch (err) {
      console.warn('[Syncora] HTML5 pause error:', err);
    }
  }

  async seekTo(seconds: number): Promise<void> {
    if (!this.videoElement) return;
    try {
      this.videoElement.currentTime = seconds;
      this.emit('SEEKED', this.getPlaybackState());
    } catch (err) {
      console.warn('[Syncora] HTML5 seekTo error:', err);
    }
  }

  setPlaybackRate(rate: number): void {
    if (!this.videoElement) return;
    try {
      this.videoElement.playbackRate = rate;
    } catch (err) {
      console.warn('[Syncora] HTML5 setPlaybackRate error:', err);
    }
  }

  setVolume(volume: number): void {
    if (!this.videoElement) return;
    try {
      this.videoElement.volume = Math.max(0, Math.min(1, volume));
      this.videoElement.muted = volume === 0;
    } catch (err) {
      console.warn('[Syncora] HTML5 setVolume error:', err);
    }
  }

  getLastErrorCode(): number | null {
    return this.videoElement?.error?.code ?? null;
  }

  getPlaybackState(): PlaybackState {
    if (!this.videoElement) {
      return {
        currentTime: 0,
        duration: 0,
        isPlaying: false,
        playbackRate: 1.0,
        bufferedTime: 0,
        isBuffering: false,
      };
    }

    const video = this.videoElement;
    let bufferedTime = 0;
    if (video.buffered.length > 0) {
      bufferedTime = video.buffered.end(video.buffered.length - 1);
    }

    return {
      currentTime: video.currentTime || 0,
      duration: video.duration || 0,
      isPlaying: !video.paused && !video.ended,
      playbackRate: video.playbackRate || 1.0,
      bufferedTime,
      isBuffering: video.readyState < 3 && !video.paused,
    };
  }

  async loadVideo(videoUrl: string): Promise<void> {
    if (!this.videoElement) return;
    this.isReady = false;

    const ready = new Promise<void>((resolve) => {
      const onLoaded = () => {
        this.isReady = true;
        this.emit('READY', this.getPlaybackState());
        resolve();
      };
      this.videoElement?.addEventListener('canplay', onLoaded, { once: true });
    });

    await this.loadSource(videoUrl);
    return ready;
  }

  destroy(): void {
    this.detachHls();

    if (this.videoElement) {
      this.boundListeners.forEach((listener, event) => {
        this.videoElement?.removeEventListener(event, listener);
      });
      this.boundListeners.clear();
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement.load();
      this.videoElement = null;
    }

    if (this.containerElement) {
      this.containerElement.innerHTML = '';
      this.containerElement = null;
    }

    this.eventHandlers.clear();
    this.isReady = false;
    this.corsFallbackApplied = false;
  }

  on(event: PlayerEventType, handler: PlayerEventHandler): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off(event: PlayerEventType, handler: PlayerEventHandler): void {
    if (this.eventHandlers.has(event)) {
      this.eventHandlers.get(event)!.delete(handler);
    }
  }

  private emit(event: PlayerEventType, state: PlaybackState) {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => handler(state));
    }
  }
}

