import { IVideoPlayerAdapter, VideoSourceType } from '../types/player.types';
import { SyncAction, SyncStatePayload, DriftCorrection } from '../types/sync.types';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface SyncEngineConfig {
  adapter: IVideoPlayerAdapter;
  channel: RealtimeChannel | null;
  roomId: string;
  userId: string;
  isHost: boolean;
  canControl?: boolean;
  videoUrl?: string;
  videoType?: VideoSourceType;
  initialPlayback?: {
    position: number;
    isPlaying: boolean;
    lastSyncedAt: string;
  };
  onDriftUpdated?: (driftSeconds: number, isSynced: boolean) => void;
  onPersistSnapshot?: (position: number, isPlaying: boolean) => void;
  onVideoMismatch?: (videoUrl: string, videoType?: VideoSourceType) => void;
}

export class SyncEngine {
  private adapter: IVideoPlayerAdapter;
  private channel: RealtimeChannel | null;
  private roomId: string;
  private userId: string;
  private isHost: boolean;
  private canControl: boolean;
  private hostIsPlaying: boolean;
  private videoUrl?: string;
  private videoType?: VideoSourceType;

  private isRemoteSyncing: boolean = false;
  private isDestroyed: boolean = false;
  private hasReceivedRemoteSync: boolean = false;
  private lastLocalControlAt: number = 0;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private heartbeatTickCount: number = 0;
  private syncRetryTimers: NodeJS.Timeout[] = [];
  private nudgeResetTimer: NodeJS.Timeout | null = null;
  private onDriftUpdated?: (driftSeconds: number, isSynced: boolean) => void;
  private onPersistSnapshot?: (position: number, isPlaying: boolean) => void;
  private onVideoMismatch?: (videoUrl: string, videoType?: VideoSourceType) => void;

  constructor(config: SyncEngineConfig) {
    this.adapter = config.adapter;
    this.channel = config.channel;
    this.roomId = config.roomId;
    this.userId = config.userId;
    this.isHost = config.isHost;
    this.canControl = config.canControl ?? config.isHost;
    this.hostIsPlaying = Boolean(config.initialPlayback?.isPlaying);
    this.videoUrl = config.videoUrl;
    this.videoType = config.videoType;
    this.onDriftUpdated = config.onDriftUpdated;
    this.onPersistSnapshot = config.onPersistSnapshot;
    this.onVideoMismatch = config.onVideoMismatch;

    this.setupListeners();

    if (this.isHost) {
      // Broadcast current state immediately so any waiting viewers sync right away
      const state = this.adapter.getPlaybackState();
      this.broadcastState('HEARTBEAT', state.currentTime, state.isPlaying);
      this.startHostHeartbeat();
    } else {
      if (!this.hostIsPlaying) {
        // Enforce pause immediately so newly loaded player stays paused while host is paused
        void this.adapter.pause();
      }

      if (
        config.initialPlayback &&
        (config.initialPlayback.isPlaying || config.initialPlayback.position > 0.5)
      ) {
        const lastSyncedMs = Date.parse(config.initialPlayback.lastSyncedAt || '');
        const elapsedSec =
          config.initialPlayback.isPlaying && !Number.isNaN(lastSyncedMs)
            ? Math.max(0, Math.min(300, (Date.now() - lastSyncedMs) / 1000))
            : 0;
        const targetPos = config.initialPlayback.position + elapsedSec;
        void this.applyInitialSnapshot(targetPos, config.initialPlayback.isPlaying);
      }
      this.requestInitialSyncWithRetries();
    }
  }

  private async applyInitialSnapshot(position: number, isPlaying: boolean) {
    if (this.isDestroyed || this.hasReceivedRemoteSync) return;
    this.isRemoteSyncing = true;
    try {
      if (position > 0.5) {
        await this.adapter.seekTo(position);
      }
      if (isPlaying) {
        await this.adapter.play();
      } else {
        await this.adapter.pause();
      }
    } finally {
      setTimeout(() => {
        this.isRemoteSyncing = false;
      }, 300);
    }
  }

  private requestInitialSyncWithRetries() {
    this.clearSyncRetries();
    this.requestInitialSync();

    // Retry briefly in case host's player/channel finished initializing slightly after viewer
    [1000, 2500].forEach((delayMs) => {
      const timer = setTimeout(() => {
        if (!this.isDestroyed && !this.isHost && !this.hasReceivedRemoteSync) {
          this.requestInitialSync();
        }
      }, delayMs);
      this.syncRetryTimers.push(timer);
    });
  }

  private clearSyncRetries() {
    this.syncRetryTimers.forEach((t) => clearTimeout(t));
    this.syncRetryTimers = [];
  }

  public updateRole(isHost: boolean) {
    this.isHost = isHost;
    if (this.isHost) {
      this.canControl = true;
      this.startHostHeartbeat();
    } else {
      this.stopHostHeartbeat();
    }
  }

  public updateCanControl(canControl: boolean) {
    this.canControl = canControl;
  }

  public updateChannel(channel: RealtimeChannel | null) {
    this.channel = channel;
    this.setupBroadcastSubscription();
  }

  private setupListeners() {
    this.adapter.on('PLAY', (state) => {
      if (this.isDestroyed || this.isRemoteSyncing) return;
      if (this.canControl) {
        this.lastLocalControlAt = Date.now();
        this.hostIsPlaying = true;
        this.broadcastState('PLAY', state.currentTime, true);
        this.onPersistSnapshot?.(state.currentTime, true);
      } else if (!this.hostIsPlaying) {
        // Viewer player started playing unexpectedly while host is paused: pause immediately!
        void this.adapter.pause();
      }
    });

    this.adapter.on('PAUSE', (state) => {
      if (this.isDestroyed || this.isRemoteSyncing) return;
      if (this.canControl) {
        this.lastLocalControlAt = Date.now();
        this.hostIsPlaying = false;
        this.broadcastState('PAUSE', state.currentTime, false);
        this.onPersistSnapshot?.(state.currentTime, false);
      }
    });

    this.adapter.on('SEEKED', (state) => {
      if (this.isDestroyed || this.isRemoteSyncing) return;
      if (this.canControl) {
        this.lastLocalControlAt = Date.now();
        this.broadcastState('SEEK', state.currentTime, state.isPlaying);
        this.onPersistSnapshot?.(state.currentTime, state.isPlaying);
      }
    });

    this.setupBroadcastSubscription();
  }

  private setupBroadcastSubscription() {
    if (!this.channel || this.isDestroyed) return;

    this.channel.on('broadcast', { event: 'SYNC_STATE' }, (payload: { payload: SyncStatePayload }) => {
      if (this.isDestroyed) return;
      this.handleIncomingSync(payload.payload);
    });

    this.channel.on('broadcast', { event: 'REQUEST_SYNC' }, () => {
      if (this.isDestroyed) return;
      if (this.isHost) {
        const state = this.adapter.getPlaybackState();
        this.broadcastState('HEARTBEAT', state.currentTime, state.isPlaying);
      }
    });
  }

  /**
   * Broadcasts playback state as Host/Controller to all members in the room.
   */
  public broadcastState(
    action: SyncAction,
    position?: number,
    isPlaying?: boolean,
    videoUrl?: string
  ) {
    if (!this.canControl || !this.channel || this.isDestroyed) return;

    const state = this.adapter.getPlaybackState();
    const payload: SyncStatePayload = {
      version: 1,
      roomId: this.roomId,
      senderId: this.userId,
      action,
      position: position !== undefined ? position : state.currentTime,
      isPlaying: isPlaying !== undefined ? isPlaying : state.isPlaying,
      playbackRate: state.playbackRate,
      videoUrl: videoUrl ?? this.videoUrl,
      videoType: this.videoType,
      sentAt: Date.now(),
    };

    try {
      void this.channel.send({
        type: 'broadcast',
        event: 'SYNC_STATE',
        payload,
      });
    } catch (err) {
      console.warn('[Syncora] Broadcast error:', err);
    }
  }

  /**
   * Request synchronization from Host (e.g. newcomer or tab refocus).
   */
  public requestInitialSync() {
    if (this.isHost || !this.channel || this.isDestroyed) return;

    try {
      void this.channel.send({
        type: 'broadcast',
        event: 'REQUEST_SYNC',
        payload: { userId: this.userId, requestedAt: Date.now() },
      });
    } catch (err) {
      console.warn('[Syncora] Request sync error:', err);
    }
  }

  /**
   * Evaluates incoming host state and corrects playback drift.
   */
  private async handleIncomingSync(payload: SyncStatePayload) {
    if (this.isDestroyed) return;
    // Don't process self broadcasts
    if (payload.senderId === this.userId) return;
    if (payload.roomId !== this.roomId) return;

    // If current user is host and the broadcast is a routine heartbeat from someone else, ignore
    if (this.isHost && payload.action === 'HEARTBEAT') return;

    // Avoid having a routine host heartbeat revert a delegated controller's just-triggered action
    if (
      this.canControl &&
      !this.isHost &&
      payload.action === 'HEARTBEAT' &&
      Date.now() - this.lastLocalControlAt < 2000
    ) {
      return;
    }

    this.hasReceivedRemoteSync = true;
    this.hostIsPlaying = payload.isPlaying;
    this.clearSyncRetries();

    if (payload.videoUrl && this.videoUrl && payload.videoUrl !== this.videoUrl) {
      this.onVideoMismatch?.(payload.videoUrl, payload.videoType);
      return;
    }

    // Suppress loops
    this.isRemoteSyncing = true;

    try {
      const now = Date.now();
      const transitLatencyMs = Math.max(0, now - payload.sentAt);
      const projectedTransitSeconds = transitLatencyMs / 1000;

      // Calculate authoritative timestamp
      const authoritativePosition = payload.isPlaying
        ? payload.position + projectedTransitSeconds * payload.playbackRate
        : payload.position;

      const localState = this.adapter.getPlaybackState();
      const drift = localState.currentTime - authoritativePosition;

      // Classify drift
      const correction = this.classifyDrift(drift, authoritativePosition);

      if (this.onDriftUpdated) {
        this.onDriftUpdated(
          Math.abs(drift),
          correction.classification === 'IN_SYNC'
        );
      }

      // 1. Seek FIRST if needed so YouTube/HTML5 starts cleanly at the target timestamp
      const needsPausedSeek =
        !payload.isPlaying && Math.abs(drift) > SYNC_CONSTANTS.DEADBAND_SECONDS;
      if (payload.action === 'SEEK' || correction.action === 'HARD_SEEK' || needsPausedSeek) {
        await this.adapter.seekTo(authoritativePosition);
      }

      // 2. Play / Pause State Reconciliation
      if (payload.isPlaying) {
        if (!localState.isPlaying) {
          await this.adapter.play();
        }
      } else {
        // Authoritative state is PAUSED: always enforce pause!
        await this.adapter.pause();
      }

      // 3. Smooth Rate Nudge for Micro-drift
      if (correction.action === 'RATE_ADJUST' && payload.isPlaying) {
        this.applyRateNudge(correction.suggestedRate || 1.0);
      }
    } finally {
      // Release loop suppression after short cooldown
      setTimeout(() => {
        this.isRemoteSyncing = false;
      }, 300);
    }
  }

  /**
   * Tiered drift reconciliation formula.
   */
  private classifyDrift(driftSeconds: number, targetPosition: number): DriftCorrection {
    const absDrift = Math.abs(driftSeconds);

    // Stage 1: Deadband zone (< 0.5s)
    if (absDrift < SYNC_CONSTANTS.DEADBAND_SECONDS) {
      return {
        classification: 'IN_SYNC',
        driftSeconds,
        targetPosition,
        action: 'NONE',
      };
    }

    // Stage 2: Micro drift (0.5s <= drift <= 2.0s) -> Smooth rate nudge
    if (absDrift <= SYNC_CONSTANTS.MICRO_DRIFT_MAX_SECONDS) {
      const suggestedRate =
        driftSeconds < 0
          ? SYNC_CONSTANTS.NUDGE_RATE_BEHIND // Behind host -> speed up slightly (1.05x)
          : SYNC_CONSTANTS.NUDGE_RATE_AHEAD; // Ahead of host -> slow down slightly (0.95x)

      return {
        classification: 'MICRO_DRIFT',
        driftSeconds,
        targetPosition,
        action: 'RATE_ADJUST',
        suggestedRate,
      };
    }

    // Stage 3: Hard drift (> 2.0s) -> Hard seek
    return {
      classification: 'HARD_DRIFT',
      driftSeconds,
      targetPosition,
      action: 'HARD_SEEK',
    };
  }

  private applyRateNudge(rate: number) {
    this.adapter.setPlaybackRate(rate);

    if (this.nudgeResetTimer) clearTimeout(this.nudgeResetTimer);
    // Reset rate back to 1.0x after 2.5 seconds
    this.nudgeResetTimer = setTimeout(() => {
      this.adapter.setPlaybackRate(SYNC_CONSTANTS.NORMAL_PLAYBACK_RATE);
    }, 2500);
  }

  private startHostHeartbeat() {
    this.stopHostHeartbeat();
    this.heartbeatTickCount = 0;
    this.heartbeatTimer = setInterval(() => {
      if (this.isDestroyed || !this.isHost) return;
      this.heartbeatTickCount += 1;
      const state = this.adapter.getPlaybackState();
      // Broadcast every tick (2.5s) while playing, and every 2nd tick (5s) while paused so late joiners sync
      if (state.isPlaying || this.heartbeatTickCount % 2 === 0) {
        this.broadcastState('HEARTBEAT', state.currentTime, state.isPlaying);
      }
    }, SYNC_CONSTANTS.HEARTBEAT_INTERVAL_MS);
  }

  private stopHostHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  public destroy() {
    this.isDestroyed = true;
    this.clearSyncRetries();
    this.stopHostHeartbeat();
    if (this.nudgeResetTimer) {
      clearTimeout(this.nudgeResetTimer);
      this.nudgeResetTimer = null;
    }
  }
}

