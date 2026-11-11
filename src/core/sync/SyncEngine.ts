import { IVideoPlayerAdapter } from '../types/player.types';
import { SyncAction, SyncStatePayload, DriftCorrection } from '../types/sync.types';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';
import { RealtimeChannel } from '@supabase/supabase-js';

export interface SyncEngineConfig {
  adapter: IVideoPlayerAdapter;
  channel: RealtimeChannel | null;
  roomId: string;
  userId: string;
  isHost: boolean;
  onDriftUpdated?: (driftSeconds: number, isSynced: boolean) => void;
}

export class SyncEngine {
  private adapter: IVideoPlayerAdapter;
  private channel: RealtimeChannel | null;
  private roomId: string;
  private userId: string;
  private isHost: boolean;

  private isRemoteSyncing: boolean = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private nudgeResetTimer: NodeJS.Timeout | null = null;
  private onDriftUpdated?: (driftSeconds: number, isSynced: boolean) => void;

  constructor(config: SyncEngineConfig) {
    this.adapter = config.adapter;
    this.channel = config.channel;
    this.roomId = config.roomId;
    this.userId = config.userId;
    this.isHost = config.isHost;
    this.onDriftUpdated = config.onDriftUpdated;

    this.setupListeners();

    if (this.isHost) {
      this.startHostHeartbeat();
    } else {
      this.requestInitialSync();
    }
  }

  public updateRole(isHost: boolean) {
    this.isHost = isHost;
    if (this.isHost) {
      this.startHostHeartbeat();
    } else {
      this.stopHostHeartbeat();
    }
  }

  public updateChannel(channel: RealtimeChannel | null) {
    this.channel = channel;
    this.setupBroadcastSubscription();
  }

  private setupListeners() {
    this.adapter.on('PLAY', (state) => {
      if (this.isRemoteSyncing) return;
      if (this.isHost) {
        this.broadcastState('PLAY', state.currentTime, true);
      }
    });

    this.adapter.on('PAUSE', (state) => {
      if (this.isRemoteSyncing) return;
      if (this.isHost) {
        this.broadcastState('PAUSE', state.currentTime, false);
      }
    });

    this.adapter.on('SEEKED', (state) => {
      if (this.isRemoteSyncing) return;
      if (this.isHost) {
        this.broadcastState('SEEK', state.currentTime, state.isPlaying);
      }
    });

    this.setupBroadcastSubscription();
  }

  private setupBroadcastSubscription() {
    if (!this.channel) return;

    this.channel.on('broadcast', { event: 'SYNC_STATE' }, (payload: { payload: SyncStatePayload }) => {
      this.handleIncomingSync(payload.payload);
    });

    this.channel.on('broadcast', { event: 'REQUEST_SYNC' }, () => {
      if (this.isHost) {
        const state = this.adapter.getPlaybackState();
        this.broadcastState('HEARTBEAT', state.currentTime, state.isPlaying);
      }
    });
  }

  /**
   * Broadcasts playback state as Host to all viewers in the room.
   */
  public broadcastState(
    action: SyncAction,
    position?: number,
    isPlaying?: boolean,
    videoUrl?: string
  ) {
    if (!this.isHost || !this.channel) return;

    const state = this.adapter.getPlaybackState();
    const payload: SyncStatePayload = {
      version: 1,
      roomId: this.roomId,
      senderId: this.userId,
      action,
      position: position !== undefined ? position : state.currentTime,
      isPlaying: isPlaying !== undefined ? isPlaying : state.isPlaying,
      playbackRate: state.playbackRate,
      videoUrl,
      sentAt: Date.now(),
    };

    try {
      this.channel.send({
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
    if (this.isHost || !this.channel) return;

    try {
      this.channel.send({
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
    // Hosts ignore sync broadcasts from other users
    if (this.isHost) return;
    if (payload.roomId !== this.roomId) return;

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

      // 1. Play / Pause State Reconciliation
      if (payload.isPlaying && !localState.isPlaying) {
        await this.adapter.play();
      } else if (!payload.isPlaying && localState.isPlaying) {
        await this.adapter.pause();
      }

      // 2. Playback Position Correction
      if (payload.action === 'SEEK' || correction.action === 'HARD_SEEK') {
        await this.adapter.seekTo(authoritativePosition);
      } else if (correction.action === 'RATE_ADJUST' && payload.isPlaying) {
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
    this.heartbeatTimer = setInterval(() => {
      if (this.isHost) {
        const state = this.adapter.getPlaybackState();
        if (state.isPlaying) {
          this.broadcastState('HEARTBEAT', state.currentTime, true);
        }
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
    this.stopHostHeartbeat();
    if (this.nudgeResetTimer) {
      clearTimeout(this.nudgeResetTimer);
      this.nudgeResetTimer = null;
    }
  }
}

