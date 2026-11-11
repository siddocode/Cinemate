import { CALL_CONSTANTS } from '@/lib/constants/sync.constants';

interface TrackedAudioSource {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
  isSpeaking: boolean;
  lastSpokeAt: number;
  isMuted: boolean;
}

/**
 * Monitors live microphone and partner audio energy using a single shared AudioContext
 * with hold hysteresis so speaking rings pulse smoothly without flickering.
 */
export class AudioLevelMonitor {
  private audioCtx: AudioContext | null = null;
  private sources = new Map<string, TrackedAudioSource>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly onSpeakingChange: (key: string, isSpeaking: boolean) => void;
  private isDestroyed: boolean = false;

  constructor(onSpeakingChange: (key: string, isSpeaking: boolean) => void) {
    this.onSpeakingChange = onSpeakingChange;
  }

  public async resume(): Promise<void> {
    if (this.isDestroyed || !this.audioCtx) return;
    if (this.audioCtx.state === 'suspended') {
      try {
        await this.audioCtx.resume();
      } catch {
        // Requires user gesture on some browsers
      }
    }
  }

  public trackStream(key: string, stream: MediaStream, isMuted: boolean = false): void {
    if (this.isDestroyed || typeof window === 'undefined') return;
    if (stream.getAudioTracks().length === 0) return;

    this.untrackStream(key);

    const ctx = this.ensureAudioContext();
    if (!ctx) return;

    try {
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      source.connect(analyser);

      const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      this.sources.set(key, {
        stream,
        source,
        analyser,
        data,
        isSpeaking: false,
        lastSpokeAt: 0,
        isMuted,
      });

      void this.resume();
      this.ensurePolling();
    } catch {
      // Gracefully skip speaking indicator if browser AudioContext creation fails
    }
  }

  public setMuted(key: string, isMuted: boolean): void {
    const tracked = this.sources.get(key);
    if (!tracked) return;
    tracked.isMuted = isMuted;
    if (isMuted && tracked.isSpeaking) {
      tracked.isSpeaking = false;
      this.onSpeakingChange(key, false);
    }
  }

  public untrackStream(key: string): void {
    const existing = this.sources.get(key);
    if (!existing) return;

    this.sources.delete(key);
    try {
      existing.source.disconnect();
      existing.analyser.disconnect();
    } catch {
      // Ignore already disconnected Web Audio nodes
    }

    if (existing.isSpeaking) {
      this.onSpeakingChange(key, false);
    }

    if (this.sources.size === 0 && this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  public destroy(): void {
    if (this.isDestroyed) return;
    this.isDestroyed = true;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    for (const key of Array.from(this.sources.keys())) {
      this.untrackStream(key);
    }

    if (this.audioCtx) {
      const ctx = this.audioCtx;
      this.audioCtx = null;
      void ctx.close().catch(() => {});
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if (this.audioCtx) return this.audioCtx;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    try {
      this.audioCtx = new AudioCtx();
      return this.audioCtx;
    } catch {
      return null;
    }
  }

  private ensurePolling(): void {
    if (this.pollTimer || this.sources.size === 0) return;

    this.pollTimer = setInterval(() => {
      if (this.isDestroyed) return;
      const now = Date.now();

      for (const [key, tracked] of this.sources.entries()) {
        if (tracked.isMuted || tracked.stream.getAudioTracks().every((t) => !t.enabled)) {
          if (tracked.isSpeaking) {
            tracked.isSpeaking = false;
            this.onSpeakingChange(key, false);
          }
          continue;
        }

        tracked.analyser.getByteFrequencyData(tracked.data);
        let sum = 0;
        for (let i = 0; i < tracked.data.length; i++) {
          sum += tracked.data[i];
        }
        const avg = tracked.data.length > 0 ? sum / tracked.data.length : 0;

        if (avg >= CALL_CONSTANTS.SPEAKING_LEVEL_THRESHOLD) {
          tracked.lastSpokeAt = now;
          if (!tracked.isSpeaking) {
            tracked.isSpeaking = true;
            this.onSpeakingChange(key, true);
          }
        } else if (
          tracked.isSpeaking &&
          now - tracked.lastSpokeAt >= CALL_CONSTANTS.SPEAKING_HOLD_MS
        ) {
          tracked.isSpeaking = false;
          this.onSpeakingChange(key, false);
        }
      }
    }, 100);
  }
}

