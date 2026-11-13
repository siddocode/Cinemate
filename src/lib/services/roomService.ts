import { getSupabaseBrowserClient } from '../supabase/client';
import { isSupabaseConfigured } from '../supabase/config';
import {
  Room,
  RoomMember,
  RoomRole,
  RoomSessionResult,
  ChatMessage,
  UserRoomSummary,
} from '@/core/types/room.types';
import { UserIdentity } from '@/core/types/session.types';
import { VideoSourceType } from '@/core/types/player.types';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';
import { Database } from '../supabase/database.types';
import { bandwidthService } from './bandwidthService';
import {
  ChatPersistenceError,
  generateChatMessageId,
  isRetryableChatError,
} from '@/lib/utils/chat';

type RoomRow = Database['public']['Tables']['rooms']['Row'];

function mapRoomRowToRoom(data: RoomRow): Room {
  return {
    id: data.id,
    code: data.code,
    title: data.title,
    hostId: data.host_id,
    videoType: data.video_type,
    videoUrl: data.video_url,
    currentPosition: data.current_position,
    isPlaying: data.is_playing,
    lastSyncedAt: data.last_synced_at,
    isPrivate: data.is_private,
    allowGuestControl: data.allow_guest_control ?? false,
    allowGuestCall: data.allow_guest_call ?? false,
    kickedUserIds: data.kicked_user_ids ?? [],
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

// In-memory dev fallback storage for when Supabase is not yet configured
const devRooms = new Map<string, Room>();
const devMembers = new Map<string, RoomMember[]>();
const devMessages = new Map<string, ChatMessage[]>();

// Deduplicate concurrent room lookups/creations (e.g. React Strict Mode double-mount)
const inFlightCreates = new Map<string, Promise<{ room: Room | null; error?: string }>>();
const inFlightGetOrCreate = new Map<string, Promise<{ room: Room | null; error?: string }>>();
const inFlightSessions = new Map<string, Promise<RoomSessionResult>>();

type RawRpcMember = {
  id: string;
  room_id: string;
  user_id: string;
  username: string | null;
  role: string;
  joined_at: string;
  last_seen_at: string;
};

export function parseRoomSessionPayload(raw: unknown): RoomSessionResult {
  if (!raw || typeof raw !== 'object') {
    return { room: null, role: 'viewer', members: [], notFound: true };
  }

  const payload = raw as {
    room?: RoomRow | null;
    role?: string;
    members?: RawRpcMember[];
    created?: boolean;
  };

  if (!payload.room) {
    return { room: null, role: 'viewer', members: [], notFound: true };
  }

  const members: RoomMember[] = Array.isArray(payload.members)
    ? payload.members.map((m) => ({
        id: m.id,
        roomId: m.room_id,
        userId: m.user_id,
        username: m.username || 'Viewer',
        role: (m.role as RoomRole) || 'viewer',
        joinedAt: m.joined_at,
        lastSeenAt: m.last_seen_at,
      }))
    : [];

  return {
    room: mapRoomRowToRoom(payload.room),
    role: (payload.role as RoomRole) || 'viewer',
    members,
    created: Boolean(payload.created),
  };
}

function isMissingRpcError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === 'PGRST202' ||
    error.code === '42883' ||
    Boolean(error.message?.includes('Could not find the function'))
  );
}

function clearTrackedRoomUploads(roomId: string): void {
  const maybeFn = (
    bandwidthService as { markRoomUploadsDeleted?: (id: string) => void } | undefined
  )?.markRoomUploadsDeleted;
  if (typeof maybeFn === 'function') {
    maybeFn(roomId);
  }
}

export const roomService = {
  /**
   * Creates a local in-memory watch room fallback.
   */
  createDevRoom(params: {
    code: string;
    title: string;
    host: UserIdentity;
    videoUrl?: string;
    videoType?: VideoSourceType;
  }): { room: Room } {
    const videoUrl = params.videoUrl || '';
    const videoType = params.videoType || 'youtube';

    const mockRoom: Room = {
      id: crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}`,
      code: params.code.toUpperCase(),
      title: params.title,
      hostId: params.host.id,
      videoType,
      videoUrl,
      currentPosition: 0,
      isPlaying: false,
      lastSyncedAt: new Date().toISOString(),
      isPrivate: true,
      allowGuestControl: false,
      allowGuestCall: false,
      kickedUserIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    devRooms.set(mockRoom.code, mockRoom);

    const hostMember: RoomMember = {
      id: crypto.randomUUID ? crypto.randomUUID() : `member-${Date.now()}`,
      roomId: mockRoom.id,
      userId: params.host.id,
      username: params.host.username,
      role: 'host',
      joinedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    devMembers.set(mockRoom.id, [hostMember]);

    return { room: mockRoom };
  },

  /**
   * Joins a local in-memory watch room fallback.
   */
  joinDevRoom(params: {
    roomId: string;
    user: UserIdentity;
  }): { member: RoomMember | null; role: RoomRole; error?: string } {
    const members = devMembers.get(params.roomId) || [];
    const existing = members.find((m) => m.userId === params.user.id);
    if (existing) {
      return { member: existing, role: existing.role };
    }

    if (members.length >= SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS) {
      return {
        member: null,
        role: 'viewer',
        error: `Room has reached maximum capacity (${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}/${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}).`,
      };
    }

    const role: RoomRole = members.length === 0 ? 'host' : 'viewer';
    const newMember: RoomMember = {
      id: crypto.randomUUID ? crypto.randomUUID() : `member-${Date.now()}`,
      roomId: params.roomId,
      userId: params.user.id,
      username: params.user.username,
      role,
      joinedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    members.push(newMember);
    devMembers.set(params.roomId, members);
    return { member: newMember, role };
  },

  /**
   * Atomically creates (or recovers) a room with initial video metadata, joins the host,
   * and returns room details + participants in a single database RPC round-trip.
   */
  async createRoomSession(params: {
    code: string;
    title: string;
    host: UserIdentity;
    videoUrl?: string;
    videoType?: VideoSourceType;
  }): Promise<RoomSessionResult> {
    const normalizedCode = params.code.trim().toUpperCase();
    const videoUrl = params.videoUrl || '';
    const videoType = params.videoType || 'youtube';

    if (!params.host.id) {
      return {
        room: null,
        role: 'viewer',
        members: [],
        error: 'You must be signed in to create a room.',
      };
    }

    if (!isSupabaseConfigured()) {
      const existingDev = devRooms.get(normalizedCode);
      const room = existingDev || this.createDevRoom({ ...params, code: normalizedCode }).room;
      if (existingDev && !existingDev.videoUrl && videoUrl && existingDev.hostId === params.host.id) {
        existingDev.videoUrl = videoUrl;
        existingDev.videoType = videoType;
      }
      const joinRes = this.joinDevRoom({ roomId: room.id, user: params.host });
      return {
        room,
        role: joinRes.role,
        members: devMembers.get(room.id) || [],
        created: !existingDev,
        error: joinRes.error,
      };
    }

    const dedupeKey = `create:${normalizedCode}:${params.host.id}`;
    const existingPromise = inFlightSessions.get(dedupeKey);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async (): Promise<RoomSessionResult> => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc('create_room_session', {
          p_code: normalizedCode,
          p_title: params.title,
          p_video_url: videoUrl,
          p_video_type: videoType,
          p_username: params.host.username,
          p_is_guest: params.host.isGuest,
        });

        if (error) {
          if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
            const devRes = this.createDevRoom({ ...params, code: normalizedCode });
            return {
              room: devRes.room,
              role: 'host',
              members: devMembers.get(devRes.room.id) || [],
              created: true,
            };
          }

          if (isMissingRpcError(error)) {
            // Backwards-compatible fallback if migration 011 has not been applied yet
            const roomRes = await this.getOrCreateRoom({ ...params, code: normalizedCode });
            if (!roomRes.room) {
              return { room: null, role: 'viewer', members: [], error: roomRes.error };
            }
            const joinRes = await this.joinRoom({
              roomId: roomRes.room.id,
              user: params.host,
              hostId: roomRes.room.hostId,
            });
            if (joinRes.error) {
              return { room: null, role: 'viewer', members: [], error: joinRes.error };
            }
            const members = await this.getRoomMembers(roomRes.room.id);
            return { room: roomRes.room, role: joinRes.role, members };
          }

          return {
            room: null,
            role: 'viewer',
            members: [],
            error: error.message || 'Failed to create room.',
          };
        }

        return parseRoomSessionPayload(data);
      } catch (err: unknown) {
        return {
          room: null,
          role: 'viewer',
          members: [],
          error: err instanceof Error ? err.message : 'Unknown error creating room',
        };
      }
    })().finally(() => {
      inFlightSessions.delete(dedupeKey);
    });

    inFlightSessions.set(dedupeKey, promise);
    return promise;
  },

  /**
   * Atomically looks up a room by code, enforces capacity & kicked restrictions,
   * joins the participant, and returns room details + members in one RPC round-trip.
   */
  async joinRoomSession(params: {
    code: string;
    user: UserIdentity;
  }): Promise<RoomSessionResult> {
    const normalizedCode = params.code.trim().toUpperCase();

    if (!params.user.id) {
      return {
        room: null,
        role: 'viewer',
        members: [],
        error: 'You must be signed in to join a room.',
      };
    }

    if (!isSupabaseConfigured()) {
      const devRoom = devRooms.get(normalizedCode);
      if (!devRoom) {
        return { room: null, role: 'viewer', members: [], notFound: true };
      }
      const joinRes = this.joinDevRoom({ roomId: devRoom.id, user: params.user });
      if (joinRes.error) {
        return { room: null, role: 'viewer', members: [], error: joinRes.error };
      }
      return {
        room: devRoom,
        role: joinRes.role,
        members: devMembers.get(devRoom.id) || [],
      };
    }

    const dedupeKey = `join:${normalizedCode}:${params.user.id}`;
    const existingPromise = inFlightSessions.get(dedupeKey);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async (): Promise<RoomSessionResult> => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error } = await supabase.rpc('join_room_session', {
          p_code: normalizedCode,
          p_username: params.user.username,
          p_is_guest: params.user.isGuest,
        });

        if (error) {
          if (error.code === 'PGRST205' || error.message?.includes('schema cache')) {
            const devRoom = devRooms.get(normalizedCode);
            if (!devRoom) {
              return { room: null, role: 'viewer', members: [], notFound: true };
            }
            const joinRes = this.joinDevRoom({ roomId: devRoom.id, user: params.user });
            return {
              room: joinRes.error ? null : devRoom,
              role: joinRes.role,
              members: devMembers.get(devRoom.id) || [],
              error: joinRes.error,
            };
          }

          if (isMissingRpcError(error)) {
            // Backwards-compatible fallback if migration 011 has not been applied yet
            const loadedRoom = await this.getRoomByCode(normalizedCode);
            if (!loadedRoom) {
              return { room: null, role: 'viewer', members: [], notFound: true };
            }
            const joinRes = await this.joinRoom({
              roomId: loadedRoom.id,
              user: params.user,
              hostId: loadedRoom.hostId,
            });
            if (joinRes.error) {
              return { room: null, role: 'viewer', members: [], error: joinRes.error };
            }
            const members = await this.getRoomMembers(loadedRoom.id);
            return { room: loadedRoom, role: joinRes.role, members };
          }

          return {
            room: null,
            role: 'viewer',
            members: [],
            error: error.message || 'Failed to join room.',
          };
        }

        return parseRoomSessionPayload(data);
      } catch (err: unknown) {
        return {
          room: null,
          role: 'viewer',
          members: [],
          error: err instanceof Error ? err.message : 'Error entering room',
        };
      }
    })().finally(() => {
      inFlightSessions.delete(dedupeKey);
    });

    inFlightSessions.set(dedupeKey, promise);
    return promise;
  },

  /**
   * Atomically retrieves an existing room by code or creates it if missing.
   * Deduplicates concurrent calls for the same room code (e.g. React Strict Mode).
   */
  async getOrCreateRoom(params: {
    code: string;
    title: string;
    host: UserIdentity;
    videoUrl?: string;
    videoType?: VideoSourceType;
  }): Promise<{ room: Room | null; error?: string }> {
    const normalizedCode = params.code.trim().toUpperCase();
    const existingPromise = inFlightGetOrCreate.get(normalizedCode);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async () => {
      const existing = await this.getRoomByCode(normalizedCode);
      if (existing) {
        return { room: existing };
      }
      return this.createRoom({ ...params, code: normalizedCode });
    })().finally(() => {
      inFlightGetOrCreate.delete(normalizedCode);
    });

    inFlightGetOrCreate.set(normalizedCode, promise);
    return promise;
  },

  /**
   * Creates a new watch room.
   */
  async createRoom(params: {
    code: string;
    title: string;
    host: UserIdentity;
    videoUrl?: string;
    videoType?: VideoSourceType;
  }): Promise<{ room: Room | null; error?: string }> {
    const normalizedCode = params.code.trim().toUpperCase();
    const videoUrl = params.videoUrl || '';
    const videoType = params.videoType || 'youtube';

    if (!isSupabaseConfigured()) {
      const existingDev = devRooms.get(normalizedCode);
      if (existingDev) return { room: existingDev };
      return this.createDevRoom({ ...params, code: normalizedCode });
    }

    if (!params.host.id) {
      return { room: null, error: 'You must be signed in to create a room.' };
    }

    const existingPromise = inFlightCreates.get(normalizedCode);
    if (existingPromise) {
      return existingPromise;
    }

    const promise = (async (): Promise<{ room: Room | null; error?: string }> => {
      try {
        const supabase = getSupabaseBrowserClient();

        const { data: roomData, error: roomError } = await supabase
          .from('rooms')
          .insert({
            code: normalizedCode,
            title: params.title,
            host_id: params.host.id,
            video_type: videoType,
            video_url: videoUrl,
            current_position: 0,
            is_playing: false,
            is_private: true,
          })
          .select()
          .single();

        if (roomError || !roomData) {
          if (roomError?.code === 'PGRST205' || roomError?.message?.includes('schema cache')) {
            console.warn(
              '[Syncora] Database tables pending migration in Supabase. Run supabase/full_setup.sql in your Supabase SQL Editor. Using local fallback.'
            );
            return this.createDevRoom({ ...params, code: normalizedCode });
          }

          // Handle concurrent creation or pre-existing room with same code (PostgreSQL 23505)
          if (roomError?.code === '23505') {
            const existingRoom = await this.getRoomByCode(normalizedCode);
            if (existingRoom) {
              return { room: existingRoom };
            }
            return {
              room: null,
              error: 'A room with this code already exists. Please create a new room or ask the host for access.',
            };
          }

          return { room: null, error: roomError?.message || 'Failed to create room.' };
        }

        // Add host as the first member
        const { error: memberError } = await supabase.from('room_members').upsert(
          {
            room_id: roomData.id,
            user_id: params.host.id,
            role: 'host',
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'room_id,user_id' }
        );

        if (memberError) {
          console.warn('[Syncora] Warning adding host to room_members:', memberError.message);
        }

        const formattedRoom = mapRoomRowToRoom(roomData);

        return { room: formattedRoom };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error creating room';
        return { room: null, error: msg };
      }
    })().finally(() => {
      inFlightCreates.delete(normalizedCode);
    });

    inFlightCreates.set(normalizedCode, promise);
    return promise;
  },

  /**
   * Retrieves room information by its code (e.g. "SYNC-8492").
   */
  async getRoomByCode(code: string): Promise<Room | null> {
    const normalized = code.trim().toUpperCase();

    if (!isSupabaseConfigured()) {
      return devRooms.get(normalized) || null;
    }

    try {
      const supabase = getSupabaseBrowserClient();

      // Attempt safe RPC lookup (accessible to un-joined participants without table scanning)
      const { data: rpcRows, error: rpcError } = await supabase
        .rpc('lookup_room_by_code', { p_code: normalized });

      let data = Array.isArray(rpcRows)
        ? (rpcRows.length > 0 ? rpcRows[0] : null)
        : (rpcRows ?? null);

      // Fallback to direct table query only if the RPC failed / is not deployed yet
      if (rpcError) {
        const { data: directData, error: directError } = await supabase
          .from('rooms')
          .select('*')
          .eq('code', normalized)
          .maybeSingle();

        if (directError?.code === 'PGRST205' || directError?.message?.includes('schema cache')) {
          return devRooms.get(normalized) || null;
        }
        data = directData;
      }

      if (!data) return null;

      return mapRoomRowToRoom(data);
    } catch (err) {
      console.warn('[Syncora] Failed to fetch room by code:', err);
      return null;
    }
  },

  /**
   * Joins a room as a participant or detects existing host status.
   */
  async joinRoom(params: {
    roomId: string;
    user: UserIdentity;
    hostId?: string;
  }): Promise<{ member: RoomMember | null; role: RoomRole; error?: string }> {
    if (!isSupabaseConfigured()) {
      const members = devMembers.get(params.roomId) || [];
      const existing = members.find((m) => m.userId === params.user.id);
      if (existing) {
        return { member: existing, role: existing.role };
      }

      // Check if user was previously kicked in dev mode (allowed to rejoin as view-only only)
      let isPreviouslyKickedDev = false;
      for (const room of devRooms.values()) {
        if (room.id === params.roomId && room.kickedUserIds?.includes(params.user.id)) {
          isPreviouslyKickedDev = true;
          break;
        }
      }

      // Enforce participant limit to prevent viral egress spikes
      if (members.length >= SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS) {
        return {
          member: null,
          role: 'viewer',
          error: `Room has reached its maximum capacity (${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}/${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}).`,
        };
      }

      // If no members, first is host, otherwise viewer (never co-host if previously kicked)
      const role: RoomRole =
        members.length === 0 && !isPreviouslyKickedDev ? 'host' : 'viewer';
      const newMember: RoomMember = {
        id: crypto.randomUUID ? crypto.randomUUID() : `member-${Date.now()}`,
        roomId: params.roomId,
        userId: params.user.id,
        username: params.user.username,
        role,
        joinedAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      };
      members.push(newMember);
      devMembers.set(params.roomId, members);
      return { member: newMember, role };
    }

    try {
      const supabase = getSupabaseBrowserClient();

      // Check if user was previously kicked from this room (rejoin allowed as view-only, never Co-Host/control)
      const { data: roomCheck } = await supabase
        .from('rooms')
        .select('host_id, kicked_user_ids')
        .eq('id', params.roomId)
        .maybeSingle();

      const isPreviouslyKicked = Boolean(
        roomCheck?.kicked_user_ids && roomCheck.kicked_user_ids.includes(params.user.id)
      );

      // Check current participant count and existing membership
      const { count: memberCount } = await supabase
        .from('room_members')
        .select('id', { count: 'exact', head: true })
        .eq('room_id', params.roomId);

      const { data: existingMember } = await supabase
        .from('room_members')
        .select('id, role, joined_at, last_seen_at')
        .eq('room_id', params.roomId)
        .eq('user_id', params.user.id)
        .maybeSingle();

      if (!existingMember && (memberCount || 0) >= SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS) {
        return {
          member: null,
          role: 'viewer',
          error: `Room has reached its maximum capacity (${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}/${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS}). Watch rooms are capped at ${SYNC_CONSTANTS.MAX_ROOM_PARTICIPANTS} participants to protect bandwidth.`,
        };
      }

      // Determine host status using known hostId if provided, otherwise query safely
      let isHost = params.hostId ? params.hostId === params.user.id : false;
      if (!params.hostId) {
        const { data: roomData } = await supabase
          .from('rooms')
          .select('host_id')
          .eq('id', params.roomId)
          .maybeSingle();
        isHost = roomData?.host_id === params.user.id;
      }

      // Preserve existing role (e.g. 'co-host') on rejoin/refresh, unless previously kicked (locked to viewer)
      const existingRole = existingMember?.role as RoomRole | undefined;
      const role: RoomRole = isHost
        ? 'host'
        : isPreviouslyKicked
        ? 'viewer'
        : existingRole || 'viewer';
      const nowIso = new Date().toISOString();

      let memberData:
        | { id: string; room_id: string; user_id: string; role: string; joined_at: string; last_seen_at: string }
        | null = null;
      let error: { code?: string; message: string } | null = null;

      if (existingMember) {
        const res = await supabase
          .from('room_members')
          .update({ last_seen_at: nowIso })
          .eq('room_id', params.roomId)
          .eq('user_id', params.user.id)
          .select()
          .single();
        memberData = res.data;
        error = res.error;
      } else {
        const res = await supabase
          .from('room_members')
          .insert({
            room_id: params.roomId,
            user_id: params.user.id,
            role,
            last_seen_at: nowIso,
          })
          .select()
          .single();
        memberData = res.data;
        error = res.error;
      }

      if (error || !memberData) {
        if (error?.code === 'PGRST205' || error?.message?.includes('schema cache')) {
          return this.joinDevRoom(params);
        }
        return { member: null, role: 'viewer', error: error?.message };
      }

      const formattedMember: RoomMember = {
        id: memberData.id,
        roomId: memberData.room_id,
        userId: memberData.user_id,
        username: params.user.username,
        role: memberData.role as RoomRole,
        joinedAt: memberData.joined_at,
        lastSeenAt: memberData.last_seen_at,
      };

      return { member: formattedMember, role: formattedMember.role };
    } catch (err: unknown) {
      console.warn('[Syncora] Join room fallback:', err);
      return this.joinDevRoom(params);
    }
  },

  /**
   * Fetches active members of a room.
   */
  async getRoomMembers(roomId: string): Promise<RoomMember[]> {
    if (!isSupabaseConfigured()) {
      return devMembers.get(roomId) || [];
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from('room_members')
        .select('*, profiles(username)')
        .eq('room_id', roomId);

      if (error || !data) {
        if (error?.code === 'PGRST205' || error?.message?.includes('schema cache')) {
          return devMembers.get(roomId) || [];
        }
        return [];
      }

      type MemberWithProfile = {
        id: string;
        room_id: string;
        user_id: string;
        role: string;
        joined_at: string;
        last_seen_at: string;
        profiles: { username: string } | null;
      };

      return (data as unknown as MemberWithProfile[]).map((item) => ({
        id: item.id,
        roomId: item.room_id,
        userId: item.user_id,
        username: item.profiles?.username || 'Viewer',
        role: item.role as RoomRole,
        joinedAt: item.joined_at,
        lastSeenAt: item.last_seen_at,
      }));
    } catch (err) {
      console.warn('[Syncora] Failed to fetch room members:', err);
      return [];
    }
  },

  /**
   * Updates room video or playback snapshot (Host authority).
   */
  async updateRoomPlayback(
    roomId: string,
    data: {
      currentPosition: number;
      isPlaying: boolean;
      videoUrl?: string;
      videoType?: VideoSourceType;
    }
  ): Promise<void> {
    if (!isSupabaseConfigured()) {
      for (const room of devRooms.values()) {
        if (room.id === roomId) {
          room.currentPosition = data.currentPosition;
          room.isPlaying = data.isPlaying;
          if (data.videoUrl) room.videoUrl = data.videoUrl;
          if (data.videoType) room.videoType = data.videoType;
          room.lastSyncedAt = new Date().toISOString();
        }
      }
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('rooms')
        .update({
          current_position: data.currentPosition,
          is_playing: data.isPlaying,
          ...(data.videoUrl !== undefined ? { video_url: data.videoUrl } : {}),
          ...(data.videoType !== undefined ? { video_type: data.videoType } : {}),
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', roomId);

      if (error) {
        console.warn('[Syncora] Failed to update room playback in DB:', error.message);
      }
    } catch (err) {
      console.warn('[Syncora] Failed to update room playback in DB:', err);
    }
  },

  /**
   * Reassigns host to another member (Host migration / failover).
   */
  async transferHost(roomId: string, newHostId: string): Promise<void> {
    if (!isSupabaseConfigured()) {
      for (const room of devRooms.values()) {
        if (room.id === roomId) {
          room.hostId = newHostId;
        }
      }
      return;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      await supabase.from('rooms').update({ host_id: newHostId }).eq('id', roomId);
      await supabase
        .from('room_members')
        .update({ role: 'host' })
        .eq('room_id', roomId)
        .eq('user_id', newHostId);
    } catch (err) {
      console.warn('[Syncora] Failed to transfer host:', err);
    }
  },

  /**
   * Fetches chat history for a room, optionally only messages sent since the
   * viewer joined so newly arriving participants never see prior conversation.
   */
  async getChatMessages(roomId: string, sinceCreatedAt?: string): Promise<ChatMessage[]> {
    if (!isSupabaseConfigured()) {
      const localMessages = devMessages.get(roomId) || [];
      return sinceCreatedAt
        ? localMessages.filter((msg) => msg.createdAt >= sinceCreatedAt)
        : localMessages;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const baseQuery = supabase
        .from('chat_messages')
        .select('*, profiles(username)')
        .eq('room_id', roomId);
      const filteredQuery = sinceCreatedAt
        ? baseQuery.gte('created_at', sinceCreatedAt)
        : baseQuery;
      const { data, error } = await filteredQuery
        .order('created_at', { ascending: true })
        .limit(100);

      if (error || !data) {
        if (error?.code === 'PGRST205' || error?.message?.includes('schema cache')) {
          return devMessages.get(roomId) || [];
        }
        return [];
      }

      type MessageWithProfile = {
        id: string;
        room_id: string;
        user_id: string;
        content: string;
        type: 'chat' | 'system';
        created_at: string;
        profiles: { username: string } | null;
      };

      return (data as unknown as MessageWithProfile[]).map((msg) => ({
        id: msg.id,
        roomId: msg.room_id,
        userId: msg.user_id,
        username: msg.profiles?.username || 'Guest',
        content: msg.content,
        type: msg.type,
        createdAt: msg.created_at,
      }));
    } catch (err) {
      console.warn('[Syncora] Failed to fetch chat messages:', err);
      return [];
    }
  },

  /**
   * Sends a new chat message to the room (persists to PostgreSQL with client-generated UUID).
   */
  async sendChatMessage(params: {
    id?: string;
    roomId: string;
    userId: string;
    username: string;
    content: string;
    type?: 'chat' | 'system';
    createdAt?: string;
  }): Promise<ChatMessage | null> {
    const messageType = params.type || 'chat';
    const messageId = params.id || generateChatMessageId();
    const now = params.createdAt || new Date().toISOString();

    if (!isSupabaseConfigured()) {
      const newMsg: ChatMessage = {
        id: messageId,
        roomId: params.roomId,
        userId: params.userId,
        username: params.username,
        content: params.content,
        type: messageType,
        createdAt: now,
        status: 'sent',
      };

      const existing = devMessages.get(params.roomId) || [];
      if (!existing.some((m) => m.id === messageId)) {
        existing.push(newMsg);
        devMessages.set(params.roomId, existing);
      }
      return newMsg;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          id: messageId,
          room_id: params.roomId,
          user_id: params.userId,
          content: params.content,
          type: messageType,
        })
        .select('id, room_id, user_id, content, type, created_at')
        .single();

      if (error || !data) {
        if (error?.code === 'PGRST205' || error?.message?.includes('schema cache')) {
          const newMsg: ChatMessage = {
            id: messageId,
            roomId: params.roomId,
            userId: params.userId,
            username: params.username,
            content: params.content,
            type: messageType,
            createdAt: now,
            status: 'sent',
          };
          const existing = devMessages.get(params.roomId) || [];
          if (!existing.some((m) => m.id === messageId)) {
            existing.push(newMsg);
            devMessages.set(params.roomId, existing);
          }
          return newMsg;
        }

        // Idempotent retry recovery: row with same client UUID was already committed
        if (error?.code === '23505') {
          return {
            id: messageId,
            roomId: params.roomId,
            userId: params.userId,
            username: params.username,
            content: params.content,
            type: messageType,
            createdAt: now,
            status: 'sent',
          };
        }

        const retryable = isRetryableChatError(error);
        throw new ChatPersistenceError(
          error?.message || 'Failed to save message.',
          retryable,
          error?.code
        );
      }

      return {
        id: data.id,
        roomId: data.room_id,
        userId: data.user_id,
        username: params.username,
        content: data.content,
        type: data.type,
        createdAt: data.created_at,
        status: 'sent',
      };
    } catch (err) {
      if (err instanceof ChatPersistenceError) {
        throw err;
      }
      const message = err instanceof Error ? err.message : 'Failed to save message.';
      throw new ChatPersistenceError(message, true);
    }
  },

  /**
   * Lists recent rooms hosted by the user, ordered by latest activity.
   */
  async getUserRooms(userId: string): Promise<UserRoomSummary[]> {
    if (!userId) return [];

    if (!isSupabaseConfigured()) {
      const summaries: UserRoomSummary[] = [];
      for (const room of devRooms.values()) {
        if (room.hostId === userId) {
          const members = devMembers.get(room.id) || [];
          const membership = members.find((m) => m.userId === userId);
          summaries.push({
            ...room,
            userRole: 'host',
            joinedAt: membership?.joinedAt || room.createdAt,
          });
        }
      }
      return summaries.sort(
        (a, b) => new Date(b.lastSyncedAt).getTime() - new Date(a.lastSyncedAt).getTime()
      );
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data: hostedRows } = await supabase
        .from('rooms')
        .select('*')
        .eq('host_id', userId)
        .order('last_synced_at', { ascending: false })
        .limit(9);

      if (!Array.isArray(hostedRows)) {
        return [];
      }

      return hostedRows
        .filter((row) => row.host_id === userId)
        .map((row) => {
          const mapped = mapRoomRowToRoom(row);
          return {
            ...mapped,
            userRole: 'host' as RoomRole,
            joinedAt: mapped.createdAt,
          };
        })
        .sort((a, b) => new Date(b.lastSyncedAt).getTime() - new Date(a.lastSyncedAt).getTime())
        .slice(0, 9);
    } catch (err) {
      console.warn('[Syncora] Failed to fetch hosted rooms:', err);
      return [];
    }
  },

  /**
   * Deletes a hosted room (including any uploaded room videos in Storage, metrics, members, and chat)
   * or removes the viewer's membership from a joined room.
   */
  async leaveOrDeleteRoom(
    roomId: string,
    userId: string,
    isHost: boolean
  ): Promise<boolean> {
    if (!roomId || !userId) return false;

    if (!isSupabaseConfigured()) {
      if (isHost) {
        for (const [code, r] of devRooms.entries()) {
          if (r.id === roomId) {
            devRooms.delete(code);
            devMembers.delete(roomId);
            devMessages.delete(roomId);
            break;
          }
        }
        clearTrackedRoomUploads(roomId);
      } else {
        const members = devMembers.get(roomId) || [];
        devMembers.set(
          roomId,
          members.filter((m) => m.userId !== userId)
        );
      }
      return true;
    }

    try {
      if (isHost) {
        // Prefer server route so Storage objects, storage_usage_metrics, and room cascade cleanly
        if (typeof window !== 'undefined') {
          try {
            const res = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
              method: 'DELETE',
            });
            if (res.ok || res.status === 404) {
              clearTrackedRoomUploads(roomId);
              return true;
            }
          } catch {
            // Fall through to direct client cleanup
          }
        }

        const supabase = getSupabaseBrowserClient();

        // Remove any Storage files while the room row (and host RLS check) still exists
        const { data: storageFiles } = await supabase.storage
          .from('videos')
          .list(roomId, { limit: 100 });

        if (Array.isArray(storageFiles) && storageFiles.length > 0) {
          const paths = storageFiles
            .filter((f) => f.name && f.id !== null)
            .map((f) => `${roomId}/${f.name}`);
          if (paths.length > 0) {
            await supabase.storage.from('videos').remove(paths);
          }
        }

        const { error } = await supabase
          .from('rooms')
          .delete()
          .eq('id', roomId)
          .eq('host_id', userId);
        if (!error) {
          clearTrackedRoomUploads(roomId);
        }
        return !error;
      }

      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('room_members')
        .delete()
        .eq('room_id', roomId)
        .eq('user_id', userId);
      return !error;
    } catch (err) {
      console.warn('[Syncora] Failed to leave or delete room:', err);
      return false;
    }
  },

  /**
   * Promotes or demotes a participant's role (Host-only).
   */
  async updateMemberRole(
    roomId: string,
    targetUserId: string,
    newRole: 'co-host' | 'viewer'
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) {
      if (newRole === 'co-host') {
        for (const room of devRooms.values()) {
          if (room.id === roomId && room.kickedUserIds?.includes(targetUserId)) {
            return {
              success: false,
              error:
                'Previously kicked members are restricted to view-only access and cannot be promoted to Co-Host.',
            };
          }
        }
      }
      const members = devMembers.get(roomId) || [];
      const m = members.find((x) => x.userId === targetUserId);
      if (m) m.role = newRole;
      return { success: true };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      if (newRole === 'co-host') {
        const { data: roomData } = await supabase
          .from('rooms')
          .select('kicked_user_ids')
          .eq('id', roomId)
          .maybeSingle();
        if (roomData?.kicked_user_ids?.includes(targetUserId)) {
          return {
            success: false,
            error:
              'Previously kicked members are restricted to view-only access and cannot be promoted to Co-Host.',
          };
        }
      }

      const { error } = await supabase
        .from('room_members')
        .update({ role: newRole })
        .eq('room_id', roomId)
        .eq('user_id', targetUserId);

      if (error) {
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update member role.',
      };
    }
  },

  /**
   * Kicks/removes a member from the room and adds them to kicked_user_ids (Host-only).
   */
  async kickMember(
    roomId: string,
    targetUserId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) {
      const members = devMembers.get(roomId) || [];
      devMembers.set(
        roomId,
        members.filter((m) => m.userId !== targetUserId)
      );
      for (const room of devRooms.values()) {
        if (room.id === roomId) {
          room.kickedUserIds = [...(room.kickedUserIds || []), targetUserId];
        }
      }
      return { success: true };
    }

    try {
      const supabase = getSupabaseBrowserClient();

      // 1. Remove member row from room_members (triggers cascade on voice call slot if present)
      const { error: deleteError } = await supabase
        .from('room_members')
        .delete()
        .eq('room_id', roomId)
        .eq('user_id', targetUserId);

      if (deleteError) {
        return { success: false, error: deleteError.message };
      }

      // 2. Add targetUserId to kicked_user_ids on rooms table to prevent immediate re-entry
      const { data: roomData, error: fetchKickError } = await supabase
        .from('rooms')
        .select('kicked_user_ids')
        .eq('id', roomId)
        .maybeSingle();

      if (fetchKickError) {
        if (fetchKickError.code === 'PGRST204' || fetchKickError.message?.includes('kicked_user_ids')) {
          return {
            success: true,
            error:
              'Participant removed, but migration 007_room_permissions_and_kick.sql must be run in Supabase SQL Editor to block rejoins.',
          };
        }
        return { success: false, error: fetchKickError.message };
      }

      const currentKicked = roomData?.kicked_user_ids || [];
      if (!currentKicked.includes(targetUserId)) {
        const { error: kickUpdateError } = await supabase
          .from('rooms')
          .update({
            kicked_user_ids: [...currentKicked, targetUserId],
          })
          .eq('id', roomId);

        if (kickUpdateError) {
          return { success: false, error: kickUpdateError.message };
        }
      }

      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to remove member.',
      };
    }
  },

  /**
   * Toggles whether non-host participants can control playback (Host-only).
   */
  async setGuestControl(
    roomId: string,
    allowGuestControl: boolean
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) {
      for (const room of devRooms.values()) {
        if (room.id === roomId) {
          room.allowGuestControl = allowGuestControl;
        }
      }
      return { success: true };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('rooms')
        .update({ allow_guest_control: allowGuestControl })
        .eq('id', roomId);

      if (error) {
        if (error.code === 'PGRST204' || error.message?.includes('allow_guest_control')) {
          return {
            success: false,
            error:
              "Database is missing migration 007 ('allow_guest_control'). Run supabase/migrations/007_room_permissions_and_kick.sql in Supabase SQL Editor and retry.",
          };
        }
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update playback permissions.',
      };
    }
  },

  /**
   * Toggles whether non-host participants can start a new voice call (Host-only).
   */
  async setGuestCall(
    roomId: string,
    allowGuestCall: boolean
  ): Promise<{ success: boolean; error?: string }> {
    if (!isSupabaseConfigured()) {
      for (const room of devRooms.values()) {
        if (room.id === roomId) {
          room.allowGuestCall = allowGuestCall;
        }
      }
      return { success: true };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { error } = await supabase
        .from('rooms')
        .update({ allow_guest_call: allowGuestCall })
        .eq('id', roomId);

      if (error) {
        if (error.code === 'PGRST204' || error.message?.includes('allow_guest_call')) {
          return {
            success: false,
            error:
              "Database is missing migration 010 ('allow_guest_call'). Run supabase/migrations/010_voice_call_initiation_permissions.sql in Supabase SQL Editor and retry.",
          };
        }
        return { success: false, error: error.message };
      }
      return { success: true };
    } catch (err: unknown) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to update voice call permissions.',
      };
    }
  },
};
