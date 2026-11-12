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
  cleanupStaleChannel?: (topic: string) => Promise<void>;
}

export interface CallSignalingConfig {
  roomId: string;
  selfUserId: string;
  callSessionId: string;
  onSignal: (signal: CallSignalPayload, fromUserId: string) => void;
  onPeerSubscribed?: (peerUserId: string) => void;
  onRecover?: () => void;
  onError?: (message: string) => void;
  transport?: CallSignalingTransport;
}

const CALL_SIGNAL_EVENT = 'CALL_SIGNAL';
const MAX_PENDING_OUTBOUND = 32;
const TRANSIENT_ERROR_DEBOUNCE_MS = 2000;

function isTransientRealtimeError(message: string): boolean {
  return /socket closed|transport failure|connection lost|timed out|channel_error/i.test(
    message
  );
}

function formatSignalingErrorMessage(
  rawMessage: string | undefined,
  fallback: string
): string {
  if (!rawMessage) return fallback;
  if (/socket closed|transport failure|connection lost|timed out/i.test(rawMessage)) {
    return 'Voice signaling connection was interrupted. Reconnecting…';
  }
  return rawMessage;
}

function createDefaultTransport(): CallSignalingTransport {
  const supabase = getSupabaseBrowserClient();
  return {
    setAuth: async () => {
      const token = await getAuthenticatedAccessToken(supabase);
      await supabase.realtime.setAuth(token ?? null);
    },
    cleanupStaleChannel: async (topic: string) => {
      const realtimeTopic = `realtime:${topic}`;
      const stale = supabase
        .getChannels()
        .filter((ch) => ch.topic === realtimeTopic);
      await Promise.all(
        stale.map(async (ch) => {
          try {
            await supabase.removeChannel(ch);
          } catch {
            // Ignore errors while purging stale channel
          }
          const internal = ch as unknown as { teardown?: () => void };
          internal.teardown?.();
        })
      );
    },
    createPrivateChannel: (topic: string) =>
      supabase.channel(topic, {
        config: { private: true },
      }) as unknown as ICallRealtimeChannel,
    removeChannel: (channel: ICallRealtimeChannel) => {
      const rt = channel as unknown as Parameters<typeof supabase.removeChannel>[0] & {
        teardown?: () => void;
      };
      void supabase.removeChannel(rt).then((status) => {
        if (status !== 'ok') {
          rt.teardown?.();
        }
      });
    },
  };
}

interface PeerSubscription {
  channel: ICallRealtimeChannel | null;
  sessionId?: string;
  rateLimiter: SignalRateLimiter;
}

/**
 * Manages authenticated, anti-spoofing WebRTC mesh signaling over private
 * per-caller Supabase Realtime outbox channels (`call:<roomId>:<senderId>`).
 */
export class CallSignaling {
  private readonly roomId: string;
  private readonly selfUserId: string;
  private readonly callSessionId: string;
  private readonly onSignal: (signal: CallSignalPayload, fromUserId: string) => void;
  private readonly onPeerSubscribed?: (peerUserId: string) => void;
  private readonly onRecover?: () => void;
  private readonly onError?: (message: string) => void;
  private readonly transport: CallSignalingTransport;

  private outboxChannel: ICallRealtimeChannel | null = null;
  private outboxReady: boolean = false;
  private pendingOutbound: CallSignalPayload[] = [];
  private resolveOutboxConnect: (() => void) | null = null;
  private outboxErrorTimer: ReturnType<typeof setTimeout> | null = null;

  private peerSubscriptions = new Map<string, PeerSubscription>();
  private peerErrorTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private isDestroyed: boolean = false;

  constructor(config: CallSignalingConfig) {
    this.roomId = config.roomId;
    this.selfUserId = config.selfUserId;
    this.callSessionId = config.callSessionId;
    this.onSignal = config.onSignal;
    this.onPeerSubscribed = config.onPeerSubscribed;
    this.onRecover = config.onRecover;
    this.onError = config.onError;
    this.transport = config.transport ?? createDefaultTransport();
  }

  /**
   * Opens the authenticated sender outbox channel (`call:<roomId>:<selfUserId>`).
   */
  public async connectOutbox(): Promise<void> {
    if (this.isDestroyed || this.outboxChannel) return;

    const maxAttempts = 2;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (this.isDestroyed || this.outboxChannel) return;

      const topic = `call:${this.roomId}:${this.selfUserId}`;
      try {
        await this.transport.cleanupStaleChannel?.(topic);
      } catch {
        // Best-effort stale channel cleanup
      }

      try {
        await this.transport.setAuth();
      } catch {
        // Proceed to subscribe; Realtime authorization will surface CHANNEL_ERROR if JWT invalid
      }

      if (this.isDestroyed || this.outboxChannel) return;

      const channel = this.transport.createPrivateChannel(topic);
      this.outboxChannel = channel;

      try {
        await new Promise<void>((resolve, reject) => {
          let settled = false;
          const finishResolve = () => {
            if (settled) return;
            settled = true;
            this.resolveOutboxConnect = null;
            resolve();
          };
          const finishReject = (message: string, transient: boolean) => {
            if (settled) return;
            settled = true;
            this.resolveOutboxConnect = null;
            const err = new Error(message) as Error & { transient?: boolean };
            err.transient = transient;
            reject(err);
          };

          this.resolveOutboxConnect = finishResolve;

          channel.subscribe((status, err) => {
            if (this.isDestroyed || this.outboxChannel !== channel) {
              finishResolve();
              return;
            }

            if (status === 'SUBSCRIBED') {
              this.clearOutboxErrorTimer();
              this.outboxReady = true;
              this.flushPendingOutbound();
              if (settled) {
                this.onRecover?.();
              }
              finishResolve();
            } else if (status === 'CLOSED') {
              this.outboxReady = false;
              if (!settled) {
                finishReject('Voice signaling channel closed before subscribing.', true);
              }
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              this.outboxReady = false;
              const rawMsg = err?.message || '';
              const transient =
                status === 'TIMED_OUT' || isTransientRealtimeError(rawMsg);
              const friendly = formatSignalingErrorMessage(
                rawMsg,
                'Unable to authorize voice signaling channel.'
              );

              if (!settled) {
                finishReject(friendly, transient);
                return;
              }

              if (transient) {
                if (!this.outboxErrorTimer) {
                  this.outboxErrorTimer = setTimeout(() => {
                    this.outboxErrorTimer = null;
                    if (!this.isDestroyed && this.outboxChannel === channel && !this.outboxReady) {
                      this.onError?.(friendly);
                    }
                  }, TRANSIENT_ERROR_DEBOUNCE_MS);
                }
              } else {
                this.clearOutboxErrorTimer();
                this.onError?.(friendly);
              }
            }
          });
        });
        return;
      } catch (err) {
        this.clearOutboxErrorTimer();
        if (this.outboxChannel === channel) {
          this.outboxChannel = null;
          this.transport.removeChannel(channel);
        }
        const transient = Boolean(
          err && typeof err === 'object' && 'transient' in err && (err as { transient?: boolean }).transient
        );
        if (attempt < maxAttempts && transient && !this.isDestroyed) {
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        const message =
          err instanceof Error ? err.message : 'Unable to authorize voice signaling channel.';
        this.onError?.(message);
        throw err;
      }
    }
  }

  /**
   * Subscribes to a single partner's authenticated outbox (`call:<roomId>:<peerUserId>`),
   * tearing down other peer channels (1:1 compatibility wrapper around `syncPeers`).
   */
  public async setPeer(
    peerUserId: string | null,
    peerSessionId?: string
  ): Promise<void> {
    if (this.isDestroyed) return;

    if (!peerUserId) {
      this.clearAllPeerChannels();
      return;
    }

    await this.syncPeers([{ userId: peerUserId, callSessionId: peerSessionId }]);
  }

  /**
   * Synchronizes active mesh peer inbox subscriptions to match the given peer list.
   */
  public async syncPeers(
    peers: Array<{ userId: string; callSessionId?: string }>
  ): Promise<void> {
    if (this.isDestroyed) return;

    const desired = new Map<string, string | undefined>();
    for (const peer of peers) {
      if (peer.userId && peer.userId !== this.selfUserId) {
        desired.set(peer.userId, peer.callSessionId);
      }
    }

    for (const existingPeerId of Array.from(this.peerSubscriptions.keys())) {
      if (!desired.has(existingPeerId)) {
        this.removePeer(existingPeerId);
      }
    }

    await Promise.all(
      Array.from(desired.entries()).map(([peerId, sessionId]) =>
        this.addPeer(peerId, sessionId)
      )
    );
  }

  /**
   * Subscribes to a peer's authenticated outbox (`call:<roomId>:<peerUserId>`).
   */
  public async addPeer(
    peerUserId: string,
    peerSessionId?: string
  ): Promise<void> {
    if (this.isDestroyed || !peerUserId || peerUserId === this.selfUserId) return;

    const existing = this.peerSubscriptions.get(peerUserId);
    if (existing && existing.sessionId === peerSessionId && existing.channel) {
      return;
    }

    this.removePeer(peerUserId);

    const entry: PeerSubscription = {
      channel: null,
      sessionId: peerSessionId,
      rateLimiter: new SignalRateLimiter(),
    };
    this.peerSubscriptions.set(peerUserId, entry);

    const topic = `call:${this.roomId}:${peerUserId}`;
    try {
      await this.transport.cleanupStaleChannel?.(topic);
    } catch {
      // Best-effort stale channel cleanup
    }

    try {
      await this.transport.setAuth();
    } catch {
      // Handled by subscribe status callback
    }

    if (this.isDestroyed || this.peerSubscriptions.get(peerUserId) !== entry) {
      return;
    }

    const channel = this.transport.createPrivateChannel(topic);
    entry.channel = channel;

    channel
      .on('broadcast', { event: CALL_SIGNAL_EVENT }, (msg) => {
        const current = this.peerSubscriptions.get(peerUserId);
        if (this.isDestroyed || current !== entry || current.channel !== channel) {
          return;
        }

        if (!entry.rateLimiter.allow()) {
          return;
        }

        const validation = validateCallSignalEnvelope(msg?.payload, {
          roomId: this.roomId,
          selfUserId: this.selfUserId,
          expectedPeerUserId: peerUserId,
          expectedPeerSessionId: entry.sessionId,
        });

        if (!validation.valid) {
          return;
        }

        this.onSignal(validation.payload, peerUserId);
      })
      .subscribe((status, err) => {
        const current = this.peerSubscriptions.get(peerUserId);
        if (this.isDestroyed || current !== entry || current.channel !== channel) {
          return;
        }
        if (status === 'SUBSCRIBED') {
          this.clearPeerErrorTimer(peerUserId);
          this.onRecover?.();
          this.onPeerSubscribed?.(peerUserId);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const rawMsg = err?.message || '';
          const transient = status === 'TIMED_OUT' || isTransientRealtimeError(rawMsg);
          const friendly = formatSignalingErrorMessage(
            rawMsg,
            'Partner signaling authorization failed.'
          );
          if (transient) {
            if (!this.peerErrorTimers.has(peerUserId)) {
              const timer = setTimeout(() => {
                this.peerErrorTimers.delete(peerUserId);
                const latest = this.peerSubscriptions.get(peerUserId);
                if (!this.isDestroyed && latest === entry && latest.channel === channel) {
                  this.onError?.(friendly);
                }
              }, TRANSIENT_ERROR_DEBOUNCE_MS);
              this.peerErrorTimers.set(peerUserId, timer);
            }
          } else {
            this.clearPeerErrorTimer(peerUserId);
            this.onError?.(friendly);
          }
        }
      });
  }

  /**
   * Unsubscribes from a single peer's signaling outbox channel.
   */
  public removePeer(peerUserId: string): void {
    this.clearPeerErrorTimer(peerUserId);
    const entry = this.peerSubscriptions.get(peerUserId);
    if (!entry) return;
    this.peerSubscriptions.delete(peerUserId);
    if (entry.channel) {
      this.transport.removeChannel(entry.channel);
    }
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
    this.clearOutboxErrorTimer();
    this.pendingOutbound = [];
    this.outboxReady = false;
    this.resolveOutboxConnect?.();
    this.resolveOutboxConnect = null;

    this.clearAllPeerChannels();

    if (this.outboxChannel) {
      const ch = this.outboxChannel;
      this.outboxChannel = null;
      this.transport.removeChannel(ch);
    }
  }

  private clearOutboxErrorTimer(): void {
    if (this.outboxErrorTimer) {
      clearTimeout(this.outboxErrorTimer);
      this.outboxErrorTimer = null;
    }
  }

  private clearPeerErrorTimer(peerUserId: string): void {
    const timer = this.peerErrorTimers.get(peerUserId);
    if (timer) {
      clearTimeout(timer);
      this.peerErrorTimers.delete(peerUserId);
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

  private clearAllPeerChannels(): void {
    for (const peerId of Array.from(this.peerSubscriptions.keys())) {
      this.removePeer(peerId);
    }
  }
}
