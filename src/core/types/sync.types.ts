/**
 * Synchronization engine data structures and payloads.
 */

export type SyncAction =
  | 'PLAY'
  | 'PAUSE'
  | 'SEEK'
  | 'HEARTBEAT'
  | 'LOAD_VIDEO'
  | 'REQUEST_SYNC';

export interface SyncStatePayload {
  version: number;
  roomId: string;
  senderId: string;
  action: SyncAction;
  position: number;       // Playback position in seconds
  isPlaying: boolean;
  playbackRate: number;
  videoUrl?: string;
  sentAt: number;         // Timestamp in epoch milliseconds
}

export type DriftClassification = 'IN_SYNC' | 'MICRO_DRIFT' | 'HARD_DRIFT';

export interface DriftCorrection {
  classification: DriftClassification;
  driftSeconds: number;
  targetPosition: number;
  action: 'NONE' | 'RATE_ADJUST' | 'HARD_SEEK';
  suggestedRate?: number;
}

