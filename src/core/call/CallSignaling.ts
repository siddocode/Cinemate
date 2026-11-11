import {
  getAuthenticatedAccessToken,
  getSupabaseBrowserClient,
} from '@/lib/supabase/client';
import {
  CallIceCandidateData,
  CallMediaStateData,
  CallSessionDescription,
  CallSignalEventType,
  CallSignalPayload,
  ICallRealtimeChannel,
} from '@/core/types/call.types';
import {
  SignalRateLimiter,
  validateCallSignalEnvelope,
} from './callSignalValidation';

export interface CallSignalingTransport {
  setAuth: () => Promise<void>;
  createPrivateChannel: (topic: string) => ICallRealtimeChannel;
  removeChannel: (channel: ICallRealtimeChannel) => void;
}

export interface CallSignalingConfig {
  roomId: string;
  selfUserId: string;
  callSessionId: string;
  onSignal: (signal: CallSignalPayload, fromUserId: string) => void;
  onPeerSubscribed?: (peerUserId: string) => void;
  onError?: (message: string) => void;
  transport?: CallSignalingTransport;
}

const CALL_SIGNAL_EVENT = 'CALL_SIGNAL';
const MAX_PENDING_OUTBOUND = 32;

function createDefaultTransport(): CallSignalingTransport {
  const supabase = getSupabaseBrowserClient();
  return {
    setAuth: async () => {
      const token = await getAuthenticatedAccessToken(supabase);
      await supabase.realtime.setAuth(token ?? null);
    },
    createPrivateChannel: (topic: string) =>
      supabase.channel(topic, {
        config: { private: true },
      }) as unknown as ICallRealtimeChannel,
    removeChannel: (channel: ICallRealtimeChannel) => {
      void supabase.removeChannel(
        channel as unknown as Parameters<typeof supabase.removeChannel>[0]
      );
    },
  };
}

/**
 * Manages authenticated, anti-spoofing 1:1 WebRTC signaling over private
 * per-caller Supabase Realtime outbox channels (`call:<roomId>:<senderId>`).
 */
export class CallSignaling {
  private readonly roomId: string;
  private readonly selfUserId: string;
  private readonly callSessionId: string;
  private readonly onSignal: (signal: CallSignalPayload, fromUserId: string) => void;
  private readonly onPeerSubscribed?: (peerUserId: string) => void;
  private readonly onError?: (message: string) => void;
  private readonly transport: CallSignalingTransport;

  private outboxChannel: ICallRealtimeChannel | null = null;
  private outboxReady: boolean = false;
  private pendingOutbound: CallSignalPayload[] = [];
  private resolveOutboxConnect: (() => void) | null = null;

  private peerUserId: string | null = null;
  private peerSessionId: string | undefined;
  private peerChannel: ICallRealtimeChannel | null = null;
  private peerRateLimiter = new SignalRateLimiter();

  private isDestroyed: boolean = false;

  constructor(config: CallSignalingConfig) {
    this.roomId = config.roomId;
    this.selfUserId = config.selfUserId;
    this.callSessionId = config.callSessionId;
    this.onSignal = config.onSignal;
    this.onPeerSubscribed = config.onPeerSubscribed;
    this.onError = config.onError;
    this.transport = config.transport ?? createDefaultTransport();
  }

  /**
   * Opens the authenticated sender outbox channel (`call:<roomId>:<selfUserId>`).
   */
  public async connectOutbox(): Promise<void> {
    if (this.isDestroyed || this.outboxChannel) return;

    try {
      await this.transport.setAuth();
    } catch {
      // Proceed to subscribe; Realtime authorization will surface CHANNEL_ERROR if JWT invalid
    }

    if (this.isDestroyed || this.outboxChannel) return;

    const topic = `call:${this.roomId}:${this.selfUserId}`;
    const channel = this.transport.createPrivateChannel(topic);
    this.outboxChannel = channel;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finishResolve = () => {
        if (settled) return;
        settled = true;
        this.resolveOutboxConnect = null;
        resolve();
      };
      const finishReject = (message: string) => {
        if (settled) return;
        settled = true;
        this.resolveOutboxConnect = null;
        reject(new Error(message));
      };

      this.resolveOutboxConnect = finishResolve;

      channel.subscribe((status, err) => {
        if (this.isDestroyed || this.outboxChannel !== channel) {
          finishResolve();
          return;
        }

        if (status === 'SUBSCRIBED') {
          this.outboxReady = true;
          this.flushPendingOutbound();
          finishResolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const message = err?.message || 'Unable to authorize voice signaling channel.';
          this.onError?.(message);
          finishReject(message);
        }
      });
    });
  }

  /**
   * Subscribes to the active partner's authenticated outbox (`call:<roomId>:<peerUserId>`).
   * Tears down any previous partner channel if the partner changes.
   */
  public async setPeer(
    peerUserId: string | null,
    peerSessionId?: string
  ): Promise<void> {
    if (this.isDestroyed) return;

    if (!peerUserId) {
      this.clearPeerChannel();
      this.peerUserId = null;
      this.peerSessionId = undefined;
      return;
    }

    if (peerUserId === this.selfUserId) {
      return;
    }

    const isSamePeer =
      this.peerUserId === peerUserId && this.peerSessionId === peerSessionId;
    if (isSamePeer && this.peerChannel) {
      return;
    }

    this.clearPeerChannel();
    this.peerUserId = peerUserId;
    this.peerSessionId = peerSessionId;
    this.peerRateLimiter.reset();

    try {
      await this.transport.setAuth();
    } catch {
      // Handled by subscribe status callback
    }

    if (this.isDestroyed || this.peerUserId !== peerUserId) return;

    const topic = `call:${this.roomId}:${peerUserId}`;
    const channel = this.transport.createPrivateChannel(topic);
    this.peerChannel = channel;

    channel
      .on('broadcast', { event: CALL_SIGNAL_EVENT }, (msg) => {
        if (this.isDestroyed || this.peerChannel !== channel) return;
        if (this.peerUserId !== peerUserId) return;

        if (!this.peerRateLimiter.allow()) {
          return;
        }

        const validation = validateCallSignalEnvelope(msg?.payload, {
          roomId: this.roomId,
          selfUserId: this.selfUserId,
          expectedPeerUserId: peerUserId,
          expectedPeerSessionId: this.peerSessionId,
        });

        if (!validation.valid) {
          return;
        }

        this.onSignal(validation.payload, peerUserId);
      })
      .subscribe((status, err) => {
        if (this.isDestroyed || this.peerChannel !== channel) return;
        if (status === 'SUBSCRIBED') {
          this.onPeerSubscribed?.(peerUserId);
        } else if (status === 'CHANNEL_ERROR') {
          this.onError?.(err?.message || 'Partner signaling authorization failed.');
        }
      });
  }

  public sendOffer(targetUserId: string, sdp: CallSessionDescription): void {
    this.sendEnvelope({
      ...this.createBaseEnvelope('offer', targetUserId),
      event: 'offer',
      sdp,
    });
  }

  public sendAnswer(targetUserId: string, sdp: CallSessionDescription): void {
    this.sendEnvelope({
      ...this.createBaseEnvelope('answer', targetUserId),
      event: 'answer',
      sdp,
    });
  }

  public sendIceCandidate(targetUserId: string, candidate: CallIceCandidateData): void {
    this.sendEnvelope({
      ...this.createBaseEnvelope('ice', targetUserId),
      event: 'ice',
      candidate,
    });
  }

  public sendMediaState(targetUserId: string, mediaState: CallMediaStateData): void {
    this.sendEnvelope({
      ...this.createBaseEnvelope('media-state', targetUserId),
      event: 'media-state',
      mediaState,
    });
  }

  public async sendBye(targetUserId: string, reason?: string): Promise<void> {
    if (this.isDestroyed || !this.outboxChannel || !this.outboxReady) {
      return;
    }

    const payload: CallSignalPayload = {
      ...this.createBaseEnvelope('bye', targetUserId),
      event: 'bye',
      ...(reason ? { reason: reason.slice(0, 64) } : {}),
    };

    try {
      await this.outboxChannel.send({
        type: 'broadcast',
        event: CALL_SIGNAL_EVENT,
        payload,
      });
    } catch {
      // Best-effort goodbye signal
    }
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.pendingOutbound = [];
    this.outboxReady = false;
    this.resolveOutboxConnect?.();
    this.resolveOutboxConnect = null;

    this.clearPeerChannel();
    this.peerUserId = null;
    this.peerSessionId = undefined;

    if (this.outboxChannel) {
      const ch = this.outboxChannel;
      this.outboxChannel = null;
      this.transport.removeChannel(ch);
    }
  }

  private createBaseEnvelope(
    event: CallSignalEventType,
    targetUserId: string
  ) {
    return {
      version: 1 as const,
      roomId: this.roomId,
      targetUserId,
      callSessionId: this.callSessionId,
      sentAt: Date.now(),
      event,
    };
  }

  private sendEnvelope(payload: CallSignalPayload): void {
    if (this.isDestroyed) return;

    if (!this.outboxChannel || !this.outboxReady) {
      if (this.pendingOutbound.length < MAX_PENDING_OUTBOUND) {
        this.pendingOutbound.push(payload);
      }
      return;
    }

    void this.outboxChannel
      .send({
        type: 'broadcast',
        event: CALL_SIGNAL_EVENT,
        payload,
      })
      .catch(() => {
        // Channel may have closed mid-teardown
      });
  }

  private flushPendingOutbound(): void {
    if (this.isDestroyed || !this.outboxChannel || !this.outboxReady) return;
    const queued = this.pendingOutbound;
    this.pendingOutbound = [];
    for (const payload of queued) {
      void this.outboxChannel
        .send({
          type: 'broadcast',
          event: CALL_SIGNAL_EVENT,
          payload,
        })
        .catch(() => {});
    }
  }

  private clearPeerChannel(): void {
    if (!this.peerChannel) return;
    const ch = this.peerChannel;
    this.peerChannel = null;
    this.transport.removeChannel(ch);
  }
}
