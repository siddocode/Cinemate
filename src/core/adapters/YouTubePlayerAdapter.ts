import {
  IVideoPlayerAdapter,
  PlaybackState,
  PlayerEventType,
  PlayerEventHandler,
} from '../types/player.types';
import { YTPlayer, YTPlayerState } from './youtube.types';
import { extractYouTubeId } from '@/lib/utils/youtube';

export class YouTubePlayerAdapter implements IVideoPlayerAdapter {
  private player: YTPlayer | null = null;
  private containerElement: HTMLElement | null = null;
  private eventHandlers: Map<PlayerEventType, Set<PlayerEventHandler>> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private isReady: boolean = false;
  private currentVideoId: string = '';

  /**
   * Loads the YouTube IFrame API script dynamically.
   */
  private static loadYouTubeScript(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof window === 'undefined') return resolve();

      // If YouTube API is already loaded
      if (window.YT && window.YT.Player) {
        return resolve();
      }

      // Check if the script tag is already in DOM
      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (existingScript) {
        const checkInterval = setInterval(() => {
          if (window.YT && window.YT.Player) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
        return;
      }

      const prevCallback = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (prevCallback) prevCallback();
        resolve();
      };

      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.body.appendChild(tag);
    });
  }

  async initialize(container: HTMLElement, initialVideoId: string): Promise<void> {
    this.containerElement = container;
    const cleanId = extractYouTubeId(initialVideoId) || initialVideoId;
    this.currentVideoId = cleanId;

    await YouTubePlayerAdapter.loadYouTubeScript();

    return new Promise((resolve, reject) => {
      try {
        // Create an inner mount div
        const mountDiv = document.createElement('div');
        mountDiv.id = `yt-player-${Date.now()}`;
        mountDiv.className = 'w-full h-full';
        container.innerHTML = '';
        container.appendChild(mountDiv);

        if (!window.YT || !window.YT.Player) {
          throw new Error('YouTube IFrame API failed to load.');
        }

        this.player = new window.YT.Player(mountDiv, {
          width: '100%',
          height: '100%',
          videoId: cleanId,
          playerVars: {
            autoplay: 0,
            controls: 0, // Custom Syncora controls overlay
            disablekb: 1,
            enablejsapi: 1,
            fs: 0,
            modestbranding: 1,
            playsinline: 1,
            rel: 0,
            origin: typeof window !== 'undefined' ? window.location.origin : '',
          },
          events: {
            onReady: () => {
              this.isReady = true;
              this.startStateTracking();
              this.emit('READY', this.getPlaybackState());
              resolve();
            },
            onStateChange: (event) => {
              this.handleStateChange(event.data);
            },
            onError: (err) => {
              console.warn('[Syncora] YouTube Player error:', err.data);
              this.emit('ERROR', this.getPlaybackState());
            },
            onPlaybackRateChange: () => {
              this.emit('RATE_CHANGE', this.getPlaybackState());
            },
          },
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  private handleStateChange(state: YTPlayerState) {
    const currentState = this.getPlaybackState();

    switch (state) {
      case YTPlayerState.PLAYING:
        this.emit('PLAY', currentState);
        break;
      case YTPlayerState.PAUSED:
        this.emit('PAUSE', currentState);
        break;
      case YTPlayerState.BUFFERING:
        this.emit('BUFFERING', currentState);
        break;
      case YTPlayerState.ENDED:
        this.emit('ENDED', currentState);
        break;
    }
  }

  private startStateTracking() {
    if (this.updateInterval) clearInterval(this.updateInterval);
    // Poll player metrics every 250ms for smooth progress bar and drift tracking
    this.updateInterval = setInterval(() => {
      if (this.isReady && this.player) {
        // We emit periodic time check if playing
        const state = this.getPlaybackState();
        if (state.isPlaying) {
          // Listeners can monitor continuous state
        }
      }
    }, 250);
  }

  async play(): Promise<void> {
    if (!this.player || !this.isReady) return;
    try {
      this.player.playVideo();
    } catch (err) {
      console.warn('[Syncora] playVideo error:', err);
    }
  }

  async pause(): Promise<void> {
    if (!this.player || !this.isReady) return;
    try {
      this.player.pauseVideo();
    } catch (err) {
      console.warn('[Syncora] pauseVideo error:', err);
    }
  }

  async seekTo(seconds: number): Promise<void> {
    if (!this.player || !this.isReady) return;
    try {
      this.player.seekTo(seconds, true);
      this.emit('SEEKED', this.getPlaybackState());
    } catch (err) {
      console.warn('[Syncora] seekTo error:', err);
    }
  }

  setPlaybackRate(rate: number): void {
    if (!this.player || !this.isReady) return;
    try {
      this.player.setPlaybackRate(rate);
    } catch (err) {
      console.warn('[Syncora] setPlaybackRate error:', err);
    }
  }

  setVolume(volume: number): void {
    if (!this.player || !this.isReady) return;
    try {
      const volInt = Math.max(0, Math.min(100, Math.round(volume * 100)));
      this.player.setVolume(volInt);
      if (volInt === 0) {
        this.player.mute();
      } else if (this.player.isMuted()) {
        this.player.unMute();
      }
    } catch (err) {
      console.warn('[Syncora] setVolume error:', err);
    }
  }

  getPlaybackState(): PlaybackState {
    if (!this.player || !this.isReady) {
      return {
        currentTime: 0,
        duration: 0,
        isPlaying: false,
        playbackRate: 1.0,
        bufferedTime: 0,
        isBuffering: false,
      };
    }

    try {
      const playerState = this.player.getPlayerState();
      const currentTime = this.player.getCurrentTime() || 0;
      const duration = this.player.getDuration() || 0;
      const loadedFraction = this.player.getVideoLoadedFraction() || 0;
      const playbackRate = this.player.getPlaybackRate() || 1.0;

      return {
        currentTime,
        duration,
        isPlaying: playerState === YTPlayerState.PLAYING,
        playbackRate,
        bufferedTime: loadedFraction * duration,
        isBuffering: playerState === YTPlayerState.BUFFERING,
      };
    } catch {
      return {
        currentTime: 0,
        duration: 0,
        isPlaying: false,
        playbackRate: 1.0,
        bufferedTime: 0,
        isBuffering: false,
      };
    }
  }

  async loadVideo(videoId: string): Promise<void> {
    if (!this.player || !this.isReady) return;
    const cleanId = extractYouTubeId(videoId) || videoId;
    this.currentVideoId = cleanId;
    try {
      this.player.loadVideoById(cleanId, 0);
    } catch (err) {
      console.warn('[Syncora] loadVideo error:', err);
    }
  }

  destroy(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.player) {
      try {
        this.player.destroy();
      } catch (err) {
        console.warn('[Syncora] Player destroy error:', err);
      }
      this.player = null;
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
