import { CALL_CONSTANTS } from '@/lib/constants/sync.constants';
import {
  CallConnectionMode,
  CallError,
  CallIceCandidateData,
  CallSessionDescription,
  CallSignalPayload,
} from '@/core/types/call.types';

export type PeerConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface PeerConnectionCallbacks {
  onOffer: (sdp: CallSessionDescription) => void;
  onAnswer: (sdp: CallSessionDescription) => void;
  onIceCandidate: (candidate: CallIceCandidateData) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onStatusChange: (status: PeerConnectionStatus) => void;
  onConnectionModeChange?: (mode: CallConnectionMode) => void;
  onError?: (error: CallError) => void;
}

export interface PeerConnectionManagerConfig {
  selfUserId: string;
  peerUserId: string;
  iceServers: RTCIceServer[];
  isStunOnlyFallback?: boolean;
  deferInitialOffer?: boolean;
  callbacks: PeerConnectionCallbacks;
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
}

const ICE_RESTART_BACKOFF_MS = [0, 1500, 3000, 6000] as const;

/**
 * Manages a single 1:1 audio-only RTCPeerConnection using WebRTC Perfect Negotiation,
 * early ICE candidate buffering, automatic ICE restarts, and complete teardown.
 */
export class PeerConnectionManager {
  private readonly polite: boolean;
  private readonly callbacks: PeerConnectionCallbacks;
  private readonly isStunOnlyFallback: boolean;
  private readonly deferInitialOffer: boolean;
  private pc: RTCPeerConnection;

  private audioSender: RTCRtpSender | null = null;
  private remoteStream: MediaStream | null = null;

  private makingOffer: boolean = false;
  private ignoreOffer: boolean = false;
  private isSettingRemoteAnswerPending: boolean = false;
  private isHandlingOffer: boolean = false;
  private hasNegotiatedOnce: boolean = false;
  private pendingNegotiation: boolean = false;
  private pendingIceCandidates: RTCIceCandidateInit[] = [];
  private lastRemoteOfferSdp: string | null = null;
  private lastLocalAnswerSdp: string | null = null;
  private signalingChain: Promise<void> = Promise.resolve();

  private restartAttempts: number = 0;
  private disconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed: boolean = false;

  constructor(config: PeerConnectionManagerConfig) {
    if (config.selfUserId === config.peerUserId) {
      throw new Error('PeerConnectionManager cannot target local user.');
    }

    // Deterministic tie-breaker: lexicographically smaller user ID acts as polite peer
    this.polite = config.selfUserId < config.peerUserId;
    this.callbacks = config.callbacks;
    this.isStunOnlyFallback = Boolean(config.isStunOnlyFallback);
    this.deferInitialOffer = Boolean(config.deferInitialOffer);

    const factory =
      config.createPeerConnection ??
      ((rtcConfig: RTCConfiguration) => new RTCPeerConnection(rtcConfig));

    this.pc = factory({
      iceServers: config.iceServers,
      iceCandidatePoolSize: 2,
    });

    this.bindPeerEvents();
  }

  public isPolite(): boolean {
    return this.polite;
  }

  /**
   * Attaches the local microphone audio track to the peer connection.
   * Rejects video tracks defensively.
   */
  public setLocalStream(stream: MediaStream): void {
    if (this.isDestroyed) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;

    if (this.audioSender) {
      void this.audioSender.replaceTrack(audioTrack).catch(() => {});
      return;
    }

    this.audioSender = this.pc.addTrack(audioTrack, stream);
  }

  /**
   * Swaps the active microphone track seamlessly (e.g. device change) without rebuilding the PC.
   */
  public async replaceAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    if (this.isDestroyed || !this.audioSender) return;
    await this.audioSender.replaceTrack(track);
  }

  /**
   * Updates ICE servers dynamically when short-lived TURN credentials are refreshed.
   */
  public updateIceServers(iceServers: RTCIceServer[]): void {
    if (this.isDestroyed) return;
    if (typeof this.pc.setConfiguration === 'function') {
      this.pc.setConfiguration({
        iceServers,
        iceCandidatePoolSize: 2,
      });
    }
  }

  private enqueueSignaling(task: () => Promise<void>): Promise<void> {
    const run = this.signalingChain.then(
      () => (this.isDestroyed ? undefined : task()),
      () => (this.isDestroyed ? undefined : task())
    );
    this.signalingChain = run.catch(() => {});
    return run;
  }

  /**
   * Explicitly initiates negotiation (used when starting or restarting ICE).
   */
  public async createAndSendOffer(options?: RTCOfferOptions): Promise<void> {
    if (this.isDestroyed) return;

    await this.enqueueSignaling(async () => {
      if (this.isDestroyed || this.pc.signalingState === 'closed') return;

      if (this.makingOffer || this.pc.signalingState !== 'stable') {
        this.pendingNegotiation = true;
        return;
      }

      this.makingOffer = true;
      try {
        const offer = await this.pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: false,
          ...options,
        });

        if (this.isDestroyed || this.pc.signalingState !== 'stable') {
          return;
        }

        await this.pc.setLocalDescription(offer);
        this.hasNegotiatedOnce = true;
        const localSdp = this.pc.localDescription?.sdp || offer.sdp;
        if (localSdp) {
          this.callbacks.onOffer({ type: 'offer', sdp: localSdp });
        }
      } catch {
        if (!this.isDestroyed) {
          this.callbacks.onError?.({
            code: 'SIGNALING_ERROR',
            message: 'Failed to create voice call offer.',
          });
        }
      } finally {
        this.makingOffer = false;
      }
    });
  }

  /**
   * Handles validated incoming offer, answer, or ICE candidate using Perfect Negotiation.
   */
  public async handleSignal(signal: CallSignalPayload): Promise<void> {
    if (this.isDestroyed) return;

    if (signal.event === 'offer') {
      await this.enqueueSignaling(() => this.handleIncomingOffer(signal.sdp.sdp));
      return;
    }

    if (signal.event === 'answer') {
      await this.enqueueSignaling(() => this.handleIncomingAnswer(signal.sdp.sdp));
      return;
    }

    if (signal.event === 'ice') {
      await this.handleIncomingIce(signal.candidate);
    }
  }

  public getPendingOffer(): CallSessionDescription | null {
    if (
      this.isDestroyed ||
      this.pc.signalingState !== 'have-local-offer' ||
      !this.pc.localDescription?.sdp
    ) {
      return null;
    }
    return {
      type: 'offer',
      sdp: this.pc.localDescription.sdp,
    };
  }

  /**
   * Triggers an immediate ICE restart (e.g. after network recovery or tab wakeup).
   */
  public triggerIceRestart(): void {
    if (this.isDestroyed) return;
    const state = this.pc.iceConnectionState;
    if (state === 'connected' || state === 'completed') return;
    this.scheduleIceRestart(true);
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    this.clearTimers();
    this.pendingIceCandidates = [];
    this.pendingNegotiation = false;
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.isSettingRemoteAnswerPending = false;
    this.isHandlingOffer = false;
    this.lastRemoteOfferSdp = null;
    this.lastLocalAnswerSdp = null;

    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onconnectionstatechange = null;
    this.pc.onsignalingstatechange = null;

    if (typeof this.pc.getTransceivers === 'function') {
      for (const transceiver of this.pc.getTransceivers()) {
        try {
          transceiver.stop();
        } catch {
          // Ignore already stopped transceivers
        }
      }
    }

    try {
      this.pc.close();
    } catch {
      // Ignore close errors
    }

    this.audioSender = null;
    this.remoteStream = null;
  }

  private bindPeerEvents(): void {
    this.pc.onnegotiationneeded = () => {
      if (this.deferInitialOffer && (!this.hasNegotiatedOnce || this.isHandlingOffer)) {
        return;
      }
      void this.createAndSendOffer();
    };

    this.pc.onsignalingstatechange = () => {
      if (this.isDestroyed) return;
      if (this.pc.signalingState === 'stable' && this.pendingNegotiation) {
        this.pendingNegotiation = false;
        void this.createAndSendOffer();
      }
    };

    this.pc.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (this.isDestroyed) return;
      if (!event.candidate) {
        this.callbacks.onIceCandidate({
          candidate: '',
          sdpMid: null,
          sdpMLineIndex: null,
        });
        return;
      }

      this.callbacks.onIceCandidate({
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid,
        sdpMLineIndex: event.candidate.sdpMLineIndex,
        usernameFragment: event.candidate.usernameFragment ?? null,
      });
    };

    this.pc.ontrack = (event: RTCTrackEvent) => {
      if (this.isDestroyed || event.track.kind !== 'audio') return;

      const stream =
        event.streams && event.streams[0]
          ? event.streams[0]
          : this.ensureFallbackRemoteStream(event.track);

      this.remoteStream = stream;
      this.callbacks.onRemoteStream(stream);
    };

    this.pc.oniceconnectionstatechange = () => {
      this.handleIceStateTransition();
    };

    this.pc.onconnectionstatechange = () => {
      this.handleConnectionStateTransition();
    };
  }

  private ensureFallbackRemoteStream(track: MediaStreamTrack): MediaStream {
    if (this.remoteStream) {
      if (!this.remoteStream.getTracks().includes(track)) {
        this.remoteStream.addTrack(track);
      }
      return this.remoteStream;
    }
    return new MediaStream([track]);
  }

  private async handleIncomingOffer(sdp: string): Promise<void> {
    if (this.isDestroyed || this.pc.signalingState === 'closed') return;

    // Idempotent handling when a partner retransmits an offer we already answered in stable state
    if (
      this.pc.signalingState === 'stable' &&
      this.lastRemoteOfferSdp === sdp &&
      this.lastLocalAnswerSdp
    ) {
      this.callbacks.onAnswer({ type: 'answer', sdp: this.lastLocalAnswerSdp });
      return;
    }

    const readyForOffer =
      !this.makingOffer &&
      (this.pc.signalingState === 'stable' || this.isSettingRemoteAnswerPending);
    const offerCollision = !readyForOffer;

    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) {
      return;
    }

    this.isHandlingOffer = true;
    try {
      if (offerCollision && this.polite && this.pc.signalingState === 'have-local-offer') {
        try {
          await this.pc.setLocalDescription({ type: 'rollback' });
        } catch {
          // Fall through to implicit rollback on setRemoteDescription
        }
      } else if (this.pc.signalingState === 'have-remote-offer') {
        try {
          await this.pc.setRemoteDescription({ type: 'rollback' });
        } catch {
          // Proceed and let setRemoteDescription attempt replacement
        }
      }

      await this.pc.setRemoteDescription({ type: 'offer', sdp });
      await this.flushPendingIceCandidates();

      const answer = await this.pc.createAnswer();
      if (this.isDestroyed) return;

      await this.pc.setLocalDescription(answer);
      const localSdp = this.pc.localDescription?.sdp || answer.sdp;
      this.hasNegotiatedOnce = true;
      this.lastRemoteOfferSdp = sdp;
      if (localSdp) {
        this.lastLocalAnswerSdp = localSdp;
        this.callbacks.onAnswer({ type: 'answer', sdp: localSdp });
      }
    } catch (err) {
      if (this.pc.signalingState === 'have-remote-offer') {
        try {
          await this.pc.setRemoteDescription({ type: 'rollback' });
        } catch {
          // Ignore rollback failure during error cleanup
        }
      }
      if (!this.isDestroyed) {
        console.warn('[PeerConnectionManager] Failed to process partner voice offer:', err);
        this.callbacks.onError?.({
          code: 'SIGNALING_ERROR',
          message: 'Failed to process partner voice offer.',
        });
      }
    } finally {
      this.isHandlingOffer = false;
    }
  }

  private async handleIncomingAnswer(sdp: string): Promise<void> {
    if (this.pc.signalingState !== 'have-local-offer') {
      return;
    }

    this.isSettingRemoteAnswerPending = true;
    try {
      await this.pc.setRemoteDescription({ type: 'answer', sdp });
      await this.flushPendingIceCandidates();
    } catch {
      if (!this.isDestroyed) {
        this.callbacks.onError?.({
          code: 'SIGNALING_ERROR',
          message: 'Failed to apply partner voice answer.',
        });
      }
    } finally {
      this.isSettingRemoteAnswerPending = false;
    }
  }

  private async handleIncomingIce(candidate: CallIceCandidateData): Promise<void> {
    if (!this.pc.remoteDescription) {
      if (this.pendingIceCandidates.length < 100) {
        this.pendingIceCandidates.push(candidate);
      }
      return;
    }

    try {
      await this.pc.addIceCandidate(candidate);
    } catch {
      // Ignore stray candidates during offer collision rollback
    }
  }

  private async flushPendingIceCandidates(): Promise<void> {
    if (this.isDestroyed || !this.pc.remoteDescription) return;
    const queued = this.pendingIceCandidates;
    this.pendingIceCandidates = [];
    for (const candidate of queued) {
      try {
        await this.pc.addIceCandidate(candidate);
      } catch {
        // Ignore stale candidates from prior ICE generation
      }
    }
  }

  private handleIceStateTransition(): void {
    if (this.isDestroyed) return;
    const state = this.pc.iceConnectionState;

    if (state === 'connected' || state === 'completed') {
      this.clearTimers();
      this.restartAttempts = 0;
      this.callbacks.onStatusChange('connected');
      void this.probeConnectionMode();
      return;
    }

    if (state === 'checking') {
      this.callbacks.onStatusChange(this.restartAttempts > 0 ? 'reconnecting' : 'connecting');
      return;
    }

    if (state === 'disconnected') {
      this.callbacks.onStatusChange('reconnecting');
      if (!this.disconnectGraceTimer) {
        this.disconnectGraceTimer = setTimeout(() => {
          this.disconnectGraceTimer = null;
          if (!this.isDestroyed && this.pc.iceConnectionState === 'disconnected') {
            this.scheduleIceRestart(false);
          }
        }, CALL_CONSTANTS.ICE_DISCONNECT_GRACE_MS);
      }
      return;
    }

    if (state === 'failed') {
      this.callbacks.onStatusChange('reconnecting');
      this.scheduleIceRestart(false);
    }
  }

  private handleConnectionStateTransition(): void {
    if (this.isDestroyed) return;
    const state = this.pc.connectionState;
    if (state === 'connected') {
      this.clearTimers();
      this.restartAttempts = 0;
      this.callbacks.onStatusChange('connected');
      void this.probeConnectionMode();
    } else if (state === 'failed') {
      this.callbacks.onStatusChange('reconnecting');
      this.scheduleIceRestart(false);
    }
  }

  private scheduleIceRestart(immediate: boolean): void {
    if (this.isDestroyed || this.restartTimer) return;

    if (this.restartAttempts >= ICE_RESTART_BACKOFF_MS.length) {
      this.callbacks.onStatusChange('failed');
      this.callbacks.onError?.({
        code: 'CONNECTION_FAILED',
        message: 'Could not maintain voice connection. Check your network and try rejoining.',
      });
      return;
    }

    const delayMs = immediate ? 0 : ICE_RESTART_BACKOFF_MS[this.restartAttempts];
    this.restartAttempts += 1;

    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.isDestroyed) return;

      if (typeof this.pc.restartIce === 'function') {
        try {
          this.pc.restartIce();
        } catch {
          // Fallback to explicit iceRestart offer below
        }
      }

      void this.createAndSendOffer({ iceRestart: true });
    }, delayMs);
  }

  private async probeConnectionMode(): Promise<void> {
    if (this.isDestroyed || typeof this.pc.getStats !== 'function') return;

    try {
      const stats = await this.pc.getStats();
      if (this.isDestroyed) return;

      let selectedLocalId: string | null = null;
      let selectedRemoteId: string | null = null;
      const candidateTypes = new Map<string, string>();

      stats.forEach((report) => {
        if (report.type === 'transport') {
          const pairId = (report as { selectedCandidatePairId?: string }).selectedCandidatePairId;
          if (pairId) {
            const pair = stats.get(pairId) as
              | { localCandidateId?: string; remoteCandidateId?: string }
              | undefined;
            if (pair) {
              selectedLocalId = pair.localCandidateId ?? null;
              selectedRemoteId = pair.remoteCandidateId ?? null;
            }
          }
        } else if (report.type === 'candidate-pair') {
          const pair = report as {
            state?: string;
            nominated?: boolean;
            selected?: boolean;
            localCandidateId?: string;
            remoteCandidateId?: string;
          };
          if (!selectedLocalId && pair.state === 'succeeded' && (pair.nominated || pair.selected)) {
            selectedLocalId = pair.localCandidateId ?? null;
            selectedRemoteId = pair.remoteCandidateId ?? null;
          }
        } else if (report.type === 'local-candidate' || report.type === 'remote-candidate') {
          const cand = report as { id: string; candidateType?: string };
          if (cand.candidateType) {
            candidateTypes.set(cand.id, cand.candidateType);
          }
        }
      });

      const localType = selectedLocalId ? candidateTypes.get(selectedLocalId) : undefined;
      const remoteType = selectedRemoteId ? candidateTypes.get(selectedRemoteId) : undefined;

      if (localType === 'relay' || remoteType === 'relay') {
        this.callbacks.onConnectionModeChange?.('relayed');
      } else if (localType || remoteType) {
        this.callbacks.onConnectionModeChange?.(
          this.isStunOnlyFallback ? 'stun-only' : 'p2p'
        );
      }
    } catch {
      // Non-fatal stats inspection
    }
  }

  private clearTimers(): void {
    if (this.disconnectGraceTimer) {
      clearTimeout(this.disconnectGraceTimer);
      this.disconnectGraceTimer = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }
}

