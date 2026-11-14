import {
  IVideoPlayerAdapter,
  PlaybackState,
  PlayerEventType,
  PlayerEventHandler,
} from '../types/player.types';
import { YTPlayer, YTPlayerState } from './youtube.types';
import { extractYouTubeId } from '@/lib/utils/youtube';

export class YouTubePlayerAdapter implements IVideoPlayerAdapter {
  private static apiLoadPromise: Promise<void> | null = null;
  private static instanceCounter = 0;

  private player: YTPlayer | null = null;
  private containerElement: HTMLElement | null = null;
  private eventHandlers: Map<PlayerEventType, Set<PlayerEventHandler>> = new Map();
  private updateInterval: NodeJS.Timeout | null = null;
  private autoplayCheckTimer: NodeJS.Timeout | null = null;
  private isReady: boolean = false;
  private isDestroyed: boolean = false;
  private wantPlaying: boolean = false;
  private pendingSeekTarget: number | null = null;
  private pendingSeekAt: number = 0;
  private currentVideoId: string = '';
  private lastErrorCode: number | null = null;

  /**
   * Loads the YouTube IFrame API script dynamically.
   */
  private static loadYouTubeScript(): Promise<void> {
    if (typeof window === 'undefined') return Promise.resolve();
    if (window.YT && window.YT.Player) return Promise.resolve();
    if (YouTubePlayerAdapter.apiLoadPromise) return YouTubePlayerAdapter.apiLoadPromise;

    YouTubePlayerAdapter.apiLoadPromise = new Promise((resolve) => {
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

    return YouTubePlayerAdapter.apiLoadPromise;
  }

  async initialize(container: HTMLElement, initialVideoId: string): Promise<void> {
    this.isDestroyed = false;
    this.lastErrorCode = null;
    this.containerElement = container;
    const cleanId = extractYouTubeId(initialVideoId) || initialVideoId;
    this.currentVideoId = cleanId;

    await YouTubePlayerAdapter.loadYouTubeScript();

    if (this.isDestroyed) {
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        // Create an inner mount div with unique ID (safe across Strict Mode double-mount)
        const mountDiv = document.createElement('div');
        YouTubePlayerAdapter.instanceCounter += 1;
        mountDiv.id = `yt-player-${Date.now()}-${YouTubePlayerAdapter.instanceCounter}`;
        mountDiv.className = 'w-full h-full';
        container.innerHTML = '';
        container.appendChild(mountDiv);

        if (!window.YT || !window.YT.Player) {
          throw new Error('YouTube IFrame API failed to load.');
        }

        const playerInstance = new window.YT.Player(mountDiv, {
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
            start: 0,
            origin: typeof window !== 'undefined' ? window.location.origin : '',
          },
          events: {
            onReady: () => {
              if (this.isDestroyed) {
                try {
                  playerInstance.destroy();
                } catch {
                  // ignore cleanup errors
                }
                resolve();
                return;
              }
              this.isReady = true;
              if (!this.wantPlaying) {
                try {
                  playerInstance.pauseVideo();
                  if ((playerInstance.getCurrentTime() || 0) > 0.5) {
                    this.pendingSeekTarget = 0;
                    this.pendingSeekAt = Date.now();
                    playerInstance.cueVideoById(cleanId, 0);
                  }
                } catch {
                  // ignore
                }
              }
              this.startStateTracking();
              this.emit('READY', this.getPlaybackState());
              resolve();
            },
            onStateChange: (event) => {
              if (this.isDestroyed) return;
              this.handleStateChange(event.data);
            },
            onError: (err) => {
              if (this.isDestroyed) return;
              console.warn('[Syncora] YouTube Player error:', err?.data ?? err);
              const rawCode = err && typeof err === 'object' && 'data' in err ? (err as { data: unknown }).data : err;
              this.lastErrorCode = typeof rawCode === 'number' ? rawCode : Number(rawCode) || null;
              this.emit('ERROR', this.getPlaybackState());
            },
            onPlaybackRateChange: () => {
              if (this.isDestroyed) return;
              this.emit('RATE_CHANGE', this.getPlaybackState());
            },
          },
        });
        this.player = playerInstance;
      } catch (err) {
        reject(err);
      }
    });
  }

  private clearAutoplayCheck() {
    if (this.autoplayCheckTimer) {
      clearTimeout(this.autoplayCheckTimer);
      this.autoplayCheckTimer = null;
    }
  }

  private scheduleAutoplayCheck(didMuteFallback = false) {
    this.clearAutoplayCheck();
    this.autoplayCheckTimer = setTimeout(() => {
      if (this.isDestroyed || !this.player || !this.isReady || !this.wantPlaying) {
        return;
      }

      try {
        const state = this.player.getPlayerState();
        if (state === YTPlayerState.PLAYING || state === YTPlayerState.BUFFERING) {
          return;
        }

        if (!didMuteFallback && !this.player.isMuted()) {
          // Browser blocked unmuted autoplay; fall back to muted autoplay so synced playback starts
          this.player.mute();
          this.player.playVideo();
          this.emit('AUTOPLAY_MUTED', this.getPlaybackState());
          this.scheduleAutoplayCheck(true);
        } else {
          // Even muted autoplay was blocked; require explicit user interaction
          this.emit('AUTOPLAY_BLOCKED', this.getPlaybackState());
        }
      } catch {
        // Ignore transient player access errors
      }
    }, 800);
  }

  private handleStateChange(state: YTPlayerState) {
    const currentState = this.getPlaybackState();

    switch (state) {
      case YTPlayerState.PLAYING:
        this.clearAutoplayCheck();
        this.emit('PLAY', currentState);
        break;
      case YTPlayerState.PAUSED:
        this.emit('PAUSE', currentState);
        break;
      case YTPlayerState.BUFFERING:
        this.emit('BUFFERING', currentState);
        break;
      case YTPlayerState.ENDED:
        this.wantPlaying = false;
        this.clearAutoplayCheck();
        this.emit('ENDED', currentState);
        break;
    }
  }

  private startStateTracking() {
    if (this.updateInterval) clearInterval(this.updateInterval);
    this.updateInterval = setInterval(() => {
      if (this.isReady && this.player) {
        const state = this.getPlaybackState();
        if (state.isPlaying) {
          // Listeners monitor continuous state
        }
      }
    }, 250);
  }

  async play(): Promise<void> {
    if (!this.player || !this.isReady || this.isDestroyed) return;
    this.wantPlaying = true;
    try {
      this.player.playVideo();
      this.scheduleAutoplayCheck(false);
    } catch (err) {
      console.warn('[Syncora] playVideo error:', err);
    }
  }

  async pause(): Promise<void> {
    if (!this.player || !this.isReady || this.isDestroyed) return;
    this.wantPlaying = false;
    this.clearAutoplayCheck();
    try {
      this.player.pauseVideo();
    } catch (err) {
      console.warn('[Syncora] pauseVideo error:', err);
    }
  }

  async seekTo(seconds: number): Promise<void> {
    if (!this.player || !this.isReady || this.isDestroyed) return;
    const clampedSeconds = Math.max(0, seconds);
    try {
      this.pendingSeekTarget = clampedSeconds;
      this.pendingSeekAt = Date.now();
      const playerState = this.player.getPlayerState();
      if (
        !this.wantPlaying &&
        (playerState === YTPlayerState.UNSTARTED || playerState === YTPlayerState.CUED)
      ) {
        this.player.cueVideoById(this.currentVideoId, clampedSeconds);
      } else {
        this.player.seekTo(clampedSeconds, true);
      }
      const snapshot = this.getPlaybackState();
      this.emit('SEEKED', { ...snapshot, currentTime: clampedSeconds });
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

  getLastErrorCode(): number | null {
    return this.lastErrorCode;
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
      const rawCurrentTime = this.player.getCurrentTime() || 0;
      let currentTime = rawCurrentTime;

      if (this.pendingSeekTarget !== null) {
        if (
          Date.now() - this.pendingSeekAt < 1500 &&
          Math.abs(rawCurrentTime - this.pendingSeekTarget) > 1.5
        ) {
          currentTime = this.pendingSeekTarget;
        } else {
          this.pendingSeekTarget = null;
        }
      }

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
      if (this.wantPlaying) {
        this.player.loadVideoById(cleanId, 0);
      } else {
        this.player.cueVideoById(cleanId, 0);
      }
    } catch (err) {
      console.warn('[Syncora] loadVideo error:', err);
    }
  }

  destroy(): void {
    this.isDestroyed = true;
    this.wantPlaying = false;
    this.clearAutoplayCheck();

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
