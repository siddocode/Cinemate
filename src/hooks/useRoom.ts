'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Room, RoomMember, RoomRole, DuoStatus, ParticipantPresence } from '@/core/types/room.types';
import { VideoSourceType } from '@/core/types/player.types';
import { useSession } from './useSession';
import { roomService } from '@/lib/services/roomService';
import {
  getAuthenticatedAccessToken,
  getSupabaseBrowserClient,
} from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';
import { Database } from '@/lib/supabase/database.types';
import {
  emitRoomCallSlotChange,
  emitRoomChatInsert,
  RealtimeCallSlotRow,
  RealtimeChatMessageRow,
} from '@/lib/supabase/roomRealtimeBus';

import { RealtimeChannel } from '@supabase/supabase-js';

type RoomRow = Database['public']['Tables']['rooms']['Row'];

interface RawPresence {
  userId?: string;
  username?: string;
  role?: RoomRole;
  clientState?: 'ready' | 'buffering' | 'playing' | 'paused' | 'idle';
  joinedAt?: number;
}

export function useRoom(roomCode: string, initialTitle?: string) {
  const { user, isInitialized } = useSession();
  const [room, setRoom] = useState<Room | null>(null);
  const [role, setRole] = useState<RoomRole>('viewer');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [presenceList, setPresenceList] = useState<ParticipantPresence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [hostGraceSecondsLeft, setHostGraceSecondsLeft] = useState<number | null>(null);
  const [userJoinedAt] = useState<number>(() => Date.now());
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  const graceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const userRef = useRef(user);
  const initialTitleRef = useRef(initialTitle);
  const roleRef = useRef(role);
  const roomHostIdRef = useRef<string | undefined>(room?.hostId);
  const roomVideoRef = useRef<{ videoUrl: string; videoType: VideoSourceType }>({
    videoUrl: room?.videoUrl || '',
    videoType: room?.videoType || 'youtube',
  });

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    initialTitleRef.current = initialTitle;
  }, [initialTitle]);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    roomHostIdRef.current = room?.hostId;
    roomVideoRef.current = {
      videoUrl: room?.videoUrl || '',
      videoType: room?.videoType || 'youtube',
    };
  }, [room?.hostId, room?.videoUrl, room?.videoType]);

  // 1. Initial Room Load and Membership Join
  useEffect(() => {
    if (!isInitialized || !roomCode || !user.id) return;

    let isMounted = true;

    async function initRoom() {
      setIsLoading(true);
      setError(null);

      try {
        const currentUser = userRef.current;
        const resolvedTitle =
          initialTitleRef.current?.trim().slice(0, 100) || 'Our Watch Party';
        const roomRes = await roomService.getOrCreateRoom({
          code: roomCode,
          title: resolvedTitle,
          host: currentUser,
        });

        const loadedRoom = roomRes.room;
        if (!loadedRoom) {
          if (isMounted) setError(roomRes.error || 'Failed to initialize room.');
          setIsLoading(false);
          return;
        }

        // Join the room BEFORE setting room state so membership exists in DB prior to Realtime subscribe()
        const joinRes = await roomService.joinRoom({
          roomId: loadedRoom.id,
          user: currentUser,
          hostId: loadedRoom.hostId,
        });

        if (!isMounted) return;
        if (joinRes.error) {
          setError(joinRes.error);
          setIsLoading(false);
          return;
        }

        // Re-fetch latest room state once joined (captures any video_url update during initial load)
        const latestRoom = await roomService.getRoomByCode(roomCode);
        if (!isMounted) return;

        setRole(joinRes.role);
        setRoom(latestRoom || loadedRoom);

        // Fetch current room members
        const currentMembers = await roomService.getRoomMembers(loadedRoom.id);
        if (isMounted) setMembers(currentMembers);
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Error entering room');
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    initRoom();

    return () => {
      isMounted = false;
    };
  }, [roomCode, user.id, isInitialized]);

  // 2. Realtime Channel Subscription (Presence, Room Updates, & Chat Inserts)
  const roomId = room?.id;
  useEffect(() => {
    if (!roomId || !user.id || !isSupabaseConfigured()) return;

    const currentRoomId = roomId;
    const supabase = getSupabaseBrowserClient();
    const channelName = `room:${currentRoomId}`;
    // Private channel: Realtime Authorization (realtime.messages RLS) restricts
    // receive / send / presence on this topic to verified room members only.
    const roomChannel = supabase.channel(channelName, { config: { private: true } });
    let hadPartner = false;
    let isDisposed = false;

    // Attach ALL presence, broadcast, and postgres_changes listeners BEFORE calling subscribe()
    roomChannel
      .on('presence', { event: 'sync' }, () => {
        const state = roomChannel.presenceState();
        const activeMap = new Map<string, ParticipantPresence>();

        Object.values(state).forEach((presences) => {
          (presences as unknown as RawPresence[]).forEach((p) => {
            if (p.userId) {
              activeMap.set(p.userId, {
                userId: p.userId,
                username: p.username || 'Guest',
                role: p.role || 'viewer',
                clientState: p.clientState || 'ready',
                joinedAt: p.joinedAt || userJoinedAt,
              });
            }
          });
        });

        const active = Array.from(activeMap.values());
        setPresenceList(active);

        // When a partner newly connects, host broadcasts the current video metadata immediately
        const hasPartnerNow = active.some((p) => p.userId !== user.id);
        if (
          hasPartnerNow &&
          !hadPartner &&
          roomHostIdRef.current === user.id &&
          roomVideoRef.current.videoUrl
        ) {
          void roomChannel.send({
            type: 'broadcast',
            event: 'VIDEO_CHANGE',
            payload: {
              videoUrl: roomVideoRef.current.videoUrl,
              videoType: roomVideoRef.current.videoType,
              senderId: user.id,
              sentAt: Date.now(),
            },
          });
        }
        hadPartner = hasPartnerNow;

        // Check if host is present in active presence
        const isHostOnline = active.some((p) => p.userId === roomHostIdRef.current);
        if (!isHostOnline && active.length > 0) {
          // Host disconnected! Start grace period if not already running
          if (!graceTimerRef.current) {
            let timeLeft = SYNC_CONSTANTS.HOST_GRACE_PERIOD_MS / 1000;
            setHostGraceSecondsLeft(timeLeft);

            graceTimerRef.current = setInterval(() => {
              timeLeft -= 1;
              setHostGraceSecondsLeft(timeLeft);

              if (timeLeft <= 0) {
                if (graceTimerRef.current) clearInterval(graceTimerRef.current);
                graceTimerRef.current = null;
                setHostGraceSecondsLeft(null);

                // Auto failover: promote oldest active participant
                const sortedByJoin = [...active].sort((a, b) => a.joinedAt - b.joinedAt);
                const nextHost = sortedByJoin[0];
                if (nextHost) {
                  roomService.transferHost(currentRoomId, nextHost.userId);
                  setRoom((prev) => (prev ? { ...prev, hostId: nextHost.userId } : null));
                }
              }
            }, 1000);
          }
        } else {
          // Host is online; cancel any active grace period
          if (graceTimerRef.current) {
            clearInterval(graceTimerRef.current);
            graceTimerRef.current = null;
          }
          setHostGraceSecondsLeft(null);
        }
      })
      .on(
        'broadcast',
        { event: 'VIDEO_CHANGE' },
        (msg: {
          payload: {
            videoUrl: string;
            videoType: VideoSourceType;
            senderId: string;
          };
        }) => {
          const payload = msg?.payload;
          if (!payload || payload.senderId === user.id || !payload.videoUrl) return;
          setRoom((prev) =>
            prev
              ? {
                  ...prev,
                  videoUrl: payload.videoUrl,
                  videoType: payload.videoType || prev.videoType,
                  currentPosition: 0,
                  isPlaying: false,
                }
              : null
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${currentRoomId}`,
        },
        (payload) => {
          const updated = payload.new as RoomRow;
          setRoom((prev) =>
            prev
              ? {
                  ...prev,
                  title: updated.title,
                  videoUrl: updated.video_url,
                  videoType: updated.video_type,
                  hostId: updated.host_id,
                  currentPosition: updated.current_position,
                  isPlaying: updated.is_playing,
                  lastSyncedAt: updated.last_synced_at,
                }
              : null
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `room_id=eq.${currentRoomId}`,
        },
        (payload) => {
          emitRoomChatInsert(currentRoomId, payload.new as RealtimeChatMessageRow);
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'room_call_participants',
          filter: `room_id=eq.${currentRoomId}`,
        },
        (payload) => {
          emitRoomCallSlotChange(currentRoomId, {
            eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
            newRow: payload.new as RealtimeCallSlotRow | undefined,
            oldRow: payload.old as Partial<RealtimeCallSlotRow> | undefined,
          });
        }
      );

    const handleSubscribeStatus = async (status: string, err?: Error) => {
      if (isDisposed) return;
      if (status === 'SUBSCRIBED') {
        setRealtimeError(null);
        setChannel(roomChannel);
        await roomChannel.track({
          userId: user.id,
          username: userRef.current.username,
          role: roleRef.current,
          clientState: 'ready',
          joinedAt: userJoinedAt,
        });
      } else if (status === 'CHANNEL_ERROR') {
        const detail = err?.message || 'Realtime private channel authorization failed.';
        console.warn(
          `[Syncora] Realtime authorization failed for ${channelName}. Apply migrations 005 & 006 (or full_setup.sql) in Supabase SQL Editor and ensure you are a member of this room.`,
          detail
        );
        setRealtimeError(
          'Realtime channel authorization failed. Run migrations 005 & 006 (or updated full_setup.sql) in your Supabase SQL Editor, then refresh.'
        );
      }
    };

    // Ensure the current user JWT is attached to the Realtime socket BEFORE joining the
    // private channel so the authorization check runs against the signed-in identity.
    void (async () => {
      try {
        const token = await getAuthenticatedAccessToken(supabase);
        await supabase.realtime.setAuth(token ?? null);
      } catch (authErr) {
        console.warn('[Syncora] Failed to refresh Realtime auth token:', authErr);
      }
      if (isDisposed) return;
      roomChannel.subscribe((status, err) => {
        void handleSubscribeStatus(status, err);
      });
    })();

    return () => {
      isDisposed = true;
      setChannel(null);
      if (graceTimerRef.current) {
        clearInterval(graceTimerRef.current);
        graceTimerRef.current = null;
      }
      supabase.removeChannel(roomChannel);
    };
  }, [roomId, user.id, userJoinedAt]);

  // 2b. Re-track presence cleanly if username or role updates after channel subscription
  useEffect(() => {
    if (!channel || !user.id) return;
    channel.track({
      userId: user.id,
      username: user.username,
      role,
      clientState: 'ready',
      joinedAt: userJoinedAt,
    });
  }, [channel, user.id, user.username, role, userJoinedAt]);

  // 3. Compute Duo Status (You & Partner)
  const isHost = room?.hostId === user.id;

  // Partner is the other participant in the room
  const partnerPresence = presenceList.find((p) => p.userId !== user.id) || null;
  const isPartnerConnected = Boolean(partnerPresence);

  const duoStatus: DuoStatus = {
    you: {
      userId: user.id,
      username: user.username,
      role,
      clientState: 'ready',
      joinedAt: userJoinedAt,
    },
    partner: partnerPresence,
    isPartnerConnected,
  };

  // 4. Update Video Action (Host only) — updates DB AND broadcasts instantly to connected viewers
  const updateVideo = useCallback(
    async (newVideoUrl: string, videoType: VideoSourceType = 'youtube') => {
      if (!room || !isHost) return;

      setRoom((prev) =>
        prev
          ? { ...prev, videoUrl: newVideoUrl, videoType, currentPosition: 0, isPlaying: false }
          : null
      );

      if (channel) {
        void channel.send({
          type: 'broadcast',
          event: 'VIDEO_CHANGE',
          payload: {
            videoUrl: newVideoUrl,
            videoType,
            senderId: user.id,
            sentAt: Date.now(),
          },
        });
      }

      await roomService.updateRoomPlayback(room.id, {
        currentPosition: 0,
        isPlaying: false,
        videoUrl: newVideoUrl,
        videoType,
      });
    },
    [room, isHost, channel, user.id]
  );

  // 5. Persist playback snapshot to DB on host play/pause/seek
  const persistPlaybackSnapshot = useCallback(
    (position: number, isPlaying: boolean) => {
      if (!roomId || !isHost) return;
      void roomService.updateRoomPlayback(roomId, {
        currentPosition: position,
        isPlaying,
      });
    },
    [roomId, isHost]
  );

  // 6. Sync video URL if viewer detects mismatch from host SYNC_STATE
  const applyRemoteVideo = useCallback(
    (newVideoUrl: string, newVideoType?: VideoSourceType) => {
      setRoom((prev) =>
        prev
          ? {
              ...prev,
              videoUrl: newVideoUrl,
              videoType: newVideoType || prev.videoType,
            }
          : null
      );
    },
    []
  );

  const effectiveIsLoading = isInitialized && !user.id ? false : isLoading;
  const effectiveError =
    isInitialized && !user.id ? 'Please sign in to create or join a watch room.' : error;

  return {
    room,
    role,
    isHost,
    members,
    duoStatus,
    presenceList,
    isLoading: effectiveIsLoading,
    error: effectiveError,
    realtimeError,
    hostGraceSecondsLeft,
    updateVideo,
    persistPlaybackSnapshot,
    applyRemoteVideo,
    channel,
  };
}
