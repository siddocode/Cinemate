import { getSupabaseBrowserClient } from '../supabase/client';
import { isSupabaseConfigured } from '../supabase/config';
import { Room, RoomMember, RoomRole, ChatMessage } from '@/core/types/room.types';
import { UserIdentity } from '@/core/types/session.types';
import { VideoSourceType } from '@/core/types/player.types';

// In-memory dev fallback storage for when Supabase is not yet configured
const devRooms = new Map<string, Room>();
const devMembers = new Map<string, RoomMember[]>();
const devMessages = new Map<string, ChatMessage[]>();

export const roomService = {
  /**
   * Ensures the user's profile exists in database.
   */
  async ensureProfile(user: UserIdentity): Promise<void> {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseBrowserClient();

    await supabase.from('profiles').upsert(
      {
        id: user.id,
        username: user.username,
        is_guest: user.isGuest,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );
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
    const videoUrl = params.videoUrl || '';
    const videoType = params.videoType || 'youtube';

    if (!isSupabaseConfigured()) {
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
    }

    try {
      await this.ensureProfile(params.host);
      const supabase = getSupabaseBrowserClient();

      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .insert({
          code: params.code.toUpperCase(),
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
        return { room: null, error: roomError?.message || 'Failed to create room.' };
      }

      // Add host as the first member
      await supabase.from('room_members').insert({
        room_id: roomData.id,
        user_id: params.host.id,
        role: 'host',
      });

      const formattedRoom: Room = {
        id: roomData.id,
        code: roomData.code,
        title: roomData.title,
        hostId: roomData.host_id,
        videoType: roomData.video_type,
        videoUrl: roomData.video_url,
        currentPosition: roomData.current_position,
        isPlaying: roomData.is_playing,
        lastSyncedAt: roomData.last_synced_at,
        isPrivate: roomData.is_private,
        createdAt: roomData.created_at,
        updatedAt: roomData.updated_at,
      };

      return { room: formattedRoom };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error creating room';
      return { room: null, error: msg };
    }
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
      const { data, error } = await supabase
        .from('rooms')
        .select('*')
        .eq('code', normalized)
        .maybeSingle();

      if (error || !data) return null;

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
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
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
  }): Promise<{ member: RoomMember | null; role: RoomRole; error?: string }> {
    if (!isSupabaseConfigured()) {
      const members = devMembers.get(params.roomId) || [];
      const existing = members.find((m) => m.userId === params.user.id);
      if (existing) {
        return { member: existing, role: existing.role };
      }

      // If no members, first is host, otherwise viewer
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
    }

    try {
      await this.ensureProfile(params.user);
      const supabase = getSupabaseBrowserClient();

      // Check if user is host of the room
      const { data: roomData } = await supabase
        .from('rooms')
        .select('host_id')
        .eq('id', params.roomId)
        .single();

      const isHost = roomData?.host_id === params.user.id;
      const role: RoomRole = isHost ? 'host' : 'viewer';

      // Upsert membership
      const { data: memberData, error } = await supabase
        .from('room_members')
        .upsert(
          {
            room_id: params.roomId,
            user_id: params.user.id,
            role,
            last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'room_id,user_id' }
        )
        .select()
        .single();

      if (error || !memberData) {
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
      const msg = err instanceof Error ? err.message : 'Unknown join error';
      return { member: null, role: 'viewer', error: msg };
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

      if (error || !data) return [];

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
      await supabase
        .from('rooms')
        .update({
          current_position: data.currentPosition,
          is_playing: data.isPlaying,
          ...(data.videoUrl ? { video_url: data.videoUrl } : {}),
          ...(data.videoType ? { video_type: data.videoType } : {}),
          last_synced_at: new Date().toISOString(),
        })
        .eq('id', roomId);
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
   * Fetches chat history for a room.
   */
  async getChatMessages(roomId: string): Promise<ChatMessage[]> {
    if (!isSupabaseConfigured()) {
      return devMessages.get(roomId) || [];
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from('chat_messages')
        .select('*, profiles(username)')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(100);

      if (error || !data) return [];

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
   * Sends a new chat message to the room.
   */
  async sendChatMessage(params: {
    roomId: string;
    userId: string;
    username: string;
    content: string;
    type?: 'chat' | 'system';
  }): Promise<ChatMessage | null> {
    const messageType = params.type || 'chat';
    const now = new Date().toISOString();

    if (!isSupabaseConfigured()) {
      const newMsg: ChatMessage = {
        id: crypto.randomUUID ? crypto.randomUUID() : `msg-${Date.now()}`,
        roomId: params.roomId,
        userId: params.userId,
        username: params.username,
        content: params.content,
        type: messageType,
        createdAt: now,
      };

      const existing = devMessages.get(params.roomId) || [];
      existing.push(newMsg);
      devMessages.set(params.roomId, existing);
      return newMsg;
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase
        .from('chat_messages')
        .insert({
          room_id: params.roomId,
          user_id: params.userId,
          content: params.content,
          type: messageType,
        })
        .select('*, profiles(username)')
        .single();

      if (error || !data) {
        console.warn('[Syncora] Send chat message error:', error);
        return null;
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

      const msg = data as unknown as MessageWithProfile;
      return {
        id: msg.id,
        roomId: msg.room_id,
        userId: msg.user_id,
        username: msg.profiles?.username || params.username,
        content: msg.content,
        type: msg.type,
        createdAt: msg.created_at,
      };
    } catch (err) {
      console.warn('[Syncora] Error sending message:', err);
      return null;
    }
  },
};
