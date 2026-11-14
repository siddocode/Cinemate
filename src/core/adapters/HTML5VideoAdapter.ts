import {
  IVideoPlayerAdapter,
  PlaybackState,
  PlayerEventType,
  PlayerEventHandler,
} from '../types/player.types';

export class HTML5VideoAdapter implements IVideoPlayerAdapter {
  private videoElement: HTMLVideoElement | null = null;
  private containerElement: HTMLElement | null = null;
  private eventHandlers: Map<PlayerEventType, Set<PlayerEventHandler>> = new Map();
  private boundListeners: Map<string, EventListener> = new Map();
  private isReady: boolean = false;

  async initialize(container: HTMLElement, initialUrl: string): Promise<void> {
    this.containerElement = container;
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

    if (initialUrl) {
      video.src = initialUrl;
    }

    this.videoElement = video;
    container.appendChild(video);

    return new Promise((resolve) => {
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
  }

  private bindEvents(video: HTMLVideoElement) {
    const onPlay = () => this.emit('PLAY', this.getPlaybackState());
    const onPause = () => this.emit('PAUSE', this.getPlaybackState());
    const onSeeked = () => this.emit('SEEKED', this.getPlaybackState());
    const onWaiting = () => this.emit('BUFFERING', this.getPlaybackState());
    const onPlaying = () => this.emit('PLAY', this.getPlaybackState());
    const onEnded = () => this.emit('ENDED', this.getPlaybackState());
    const onRateChange = () => this.emit('RATE_CHANGE', this.getPlaybackState());
    const onError = () => this.emit('ERROR', this.getPlaybackState());

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
    this.videoElement.src = videoUrl;
    this.videoElement.load();
    this.isReady = false;

    return new Promise((resolve) => {
      const onLoaded = () => {
        this.isReady = true;
        this.emit('READY', this.getPlaybackState());
        resolve();
      };
      this.videoElement?.addEventListener('canplay', onLoaded, { once: true });
    });
  }

  destroy(): void {
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

