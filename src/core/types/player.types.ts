/**
 * Core video player adapter types and contracts.
 * Syncora's UI and SyncEngine interact solely through these interfaces,
 * isolating player implementation quirks (YouTube IFrame, HTML5, HLS).
 */

export type VideoSourceType = 'youtube' | 'url' | 'upload';

export interface PlaybackState {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  bufferedTime: number;
  isBuffering: boolean;
}

export type PlayerEventType =
  | 'PLAY'
  | 'PAUSE'
  | 'SEEKED'
  | 'BUFFERING'
  | 'READY'
  | 'ENDED'
  | 'ERROR'
  | 'RATE_CHANGE'
  | 'AUTOPLAY_MUTED'
  | 'AUTOPLAY_BLOCKED';

export type PlayerEventHandler = (state: PlaybackState) => void;

export interface IVideoPlayerAdapter {
  /**
   * Initializes the player within the provided DOM container element.
   */
  initialize(container: HTMLElement, initialUrl: string): Promise<void>;

  /**
   * Resumes or starts playback.
   */
  play(): Promise<void>;

  /**
   * Pauses playback.
   */
  pause(): Promise<void>;

  /**
   * Seeks player to timestamp in seconds.
   */
  seekTo(seconds: number): Promise<void>;

  /**
   * Adjusts playback rate (e.g. 0.95x, 1.0x, 1.05x) for smooth drift correction.
   */
  setPlaybackRate(rate: number): void;

  /**
   * Adjusts volume (0.0 to 1.0) or mutes if 0.
   */
  setVolume(volume: number): void;

  /**
   * Retrieves current instantaneous playback metrics.
   */
  getPlaybackState(): PlaybackState;

  /**
   * Returns the most recent provider-specific playback error code, if any.
   */
  getLastErrorCode?(): number | null;

  /**
   * Loads a new video URL into the active player.
   */
  loadVideo(videoUrl: string): Promise<void>;

  /**
   * Cleans up listeners, intervals, and embedded iframes/elements.
   */
  destroy(): void;

  /**
   * Event emitter registration.
   */
  on(event: PlayerEventType, handler: PlayerEventHandler): void;
  off(event: PlayerEventType, handler: PlayerEventHandler): void;
}

