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
  allowGuestControl?: boolean;
  allowGuestCall?: boolean;
  kickedUserIds?: string[];
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

export type ChatMessageStatus = 'sending' | 'sent' | 'failed';

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  content: string;
  type: 'chat' | 'system';
  createdAt: string;
  status?: ChatMessageStatus;
  errorMessage?: string;
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

export interface UserRoomSummary extends Room {
  userRole: RoomRole;
  joinedAt: string;
}

export interface RoomSessionResult {
  room: Room | null;
  role: RoomRole;
  members: RoomMember[];
  notFound?: boolean;
  created?: boolean;
  error?: string;
}

export interface InitialChatHistory {
  roomId: string;
  messages: ChatMessage[];
  isLoading: boolean;
  loaded: boolean;
}


