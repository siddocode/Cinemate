import { VideoSourceType } from './player.types';

export type RoomRole = 'host' | 'co-host' | 'viewer';

export interface Profile {
  id: string;
  username: string;
  avatarUrl?: string;
  isGuest: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Room {
  id: string;
  code: string;
  title: string;
  hostId: string;
  videoType: VideoSourceType;
  videoUrl: string;
  currentPosition: number;
  isPlaying: boolean;
  lastSyncedAt: string;
  isPrivate: boolean;
  passcodeHash?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RoomMember {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  role: RoomRole;
  joinedAt: string;
  lastSeenAt: string;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  type: 'chat' | 'system';
  createdAt: string;
}

export type ParticipantClientState = 'ready' | 'buffering' | 'playing' | 'paused' | 'idle';

export interface ParticipantPresence {
  userId: string;
  username: string;
  avatarUrl?: string;
  role: RoomRole;
  clientState: ParticipantClientState;
  joinedAt: number;
}

export interface DuoStatus {
  you: ParticipantPresence;
  partner: ParticipantPresence | null;
  isPartnerConnected: boolean;
}

