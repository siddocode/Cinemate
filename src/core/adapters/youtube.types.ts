/**
 * YouTube IFrame Player API type definitions.
 */

export enum YTPlayerState {
  UNSTARTED = -1,
  ENDED = 0,
  PLAYING = 1,
  PAUSED = 2,
  BUFFERING = 3,
  CUED = 5,
}

export interface YTPlayerOptions {
  width?: string | number;
  height?: string | number;
  videoId?: string;
  playerVars?: {
    autoplay?: 0 | 1;
    controls?: 0 | 1;
    disablekb?: 0 | 1;
    enablejsapi?: 0 | 1;
    fs?: 0 | 1;
    iv_load_policy?: 1 | 3;
    modestbranding?: 0 | 1;
    origin?: string;
    playsinline?: 0 | 1;
    rel?: 0 | 1;
    start?: number;
  };
  events?: {
    onReady?: (event: YTPlayerEvent) => void;
    onStateChange?: (event: YTOnStateChangeEvent) => void;
    onError?: (event: YTOnErrorEvent) => void;
    onPlaybackRateChange?: (event: YTOnPlaybackRateChangeEvent) => void;
  };
}

export interface YTPlayerEvent {
  target: YTPlayer;
}

export interface YTOnStateChangeEvent {
  target: YTPlayer;
  data: YTPlayerState;
}

export interface YTOnPlaybackRateChangeEvent {
  target: YTPlayer;
  data: number;
}

export interface YTOnErrorEvent {
  target: YTPlayer;
  data: number;
}

export interface YTPlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  seekTo(seconds: number, allowSeekAhead?: boolean): void;
  setPlaybackRate(suggestedRate: number): void;
  getPlaybackRate(): number;
  getAvailablePlaybackRates(): number[];
  setVolume(volume: number): void;
  getVolume(): number;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getPlayerState(): YTPlayerState;
  getCurrentTime(): number;
  getDuration(): number;
  getVideoLoadedFraction(): number;
  loadVideoById(videoId: string, startSeconds?: number): void;
  cueVideoById(videoId: string, startSeconds?: number): void;
  destroy(): void;
  getIframe(): HTMLIFrameElement;
}

declare global {
  interface Window {
    YT?: {
      Player: new (element: HTMLElement | string, options: YTPlayerOptions) => YTPlayer;
      PlayerState: typeof YTPlayerState;
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}
