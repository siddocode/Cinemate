'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Room, RoomMember, RoomRole, DuoStatus, ParticipantPresence } from '@/core/types/room.types';
import { VideoSourceType } from '@/core/types/player.types';
import { useSession } from './useSession';
import { roomService } from '@/lib/services/roomService';
import { storageService } from '@/lib/services/storageService';
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

export function useRoom(roomCode: string, initialTitle?: string, allowCreate = false) {
  const { user, isInitialized } = useSession();
  const [room, setRoom] = useState<Room | null>(null);
  const [role, setRole] = useState<RoomRole>('viewer');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [presenceList, setPresenceList] = useState<ParticipantPresence[]>([]);
  const [isKicked, setIsKicked] = useState(false);
  const [kickedMessage, setKickedMessage] = useState<string | null>(null);
  const [isRoomClosed, setIsRoomClosed] = useState(false);
  const [roomClosedMessage, setRoomClosedMessage] = useState<string | null>(null);
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
        let loadedRoom: Room | null = null;
        let loadError: string | undefined;

        if (allowCreate) {
          const roomRes = await roomService.getOrCreateRoom({
            code: roomCode,
            title: resolvedTitle,
            host: currentUser,
          });
          loadedRoom = roomRes.room;
          loadError = roomRes.error;
        } else {
          loadedRoom = await roomService.getRoomByCode(roomCode);
          if (!loadedRoom) {
            if (isMounted) {
              setIsRoomClosed(true);
              setRoomClosedMessage(
                'This screening room was closed by the host or no longer exists.'
              );
              setIsLoading(false);
            }
            return;
          }
        }

        if (!loadedRoom) {
          if (isMounted) setError(loadError || 'Failed to initialize room.');
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
  }, [roomCode, user.id, isInitialized, allowCreate]);

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

        // Check if host is present in active presence.
        // If host leaves and does not reconnect within grace window, close the room instead of transferring authority.
        const isHostSelf = roomHostIdRef.current === user.id;
        const isHostOnline = active.some((p) => p.userId === roomHostIdRef.current);
        if (!isHostSelf && !isHostOnline && active.length > 0 && roomHostIdRef.current) {
          // Host disconnected! Start countdown before closing the room for remaining viewers
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
                void roomChannel.untrack();
                setIsRoomClosed(true);
                setRoomClosedMessage('This screening room has been closed because the host left.');
              }
            }, 1000);
          }
        } else {
          // Host is online; cancel any active close countdown
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
        'broadcast',
        { event: 'KICK_MEMBER' },
        (msg: { payload: { kickedUserId: string; reason?: string } }) => {
          const payload = msg?.payload;
          if (!payload) return;
          if (payload.kickedUserId === user.id) {
            void roomChannel.untrack();
            setIsKicked(true);
            setKickedMessage(payload.reason || 'You have been removed from this room by the host.');
          } else {
            setMembers((prev) => prev.filter((m) => m.userId !== payload.kickedUserId));
            setPresenceList((prev) => prev.filter((p) => p.userId !== payload.kickedUserId));
          }
        }
      )
      .on(
        'broadcast',
        { event: 'ROLE_CHANGE' },
        (msg: { payload: { userId: string; newRole: RoomRole } }) => {
          const payload = msg?.payload;
          if (!payload) return;
          if (payload.userId === user.id) {
            setRole(payload.newRole);
          }
          setMembers((prev) =>
            prev.map((m) => (m.userId === payload.userId ? { ...m, role: payload.newRole } : m))
          );
          setPresenceList((prev) =>
            prev.map((p) => (p.userId === payload.userId ? { ...p, role: payload.newRole } : p))
          );
        }
      )
      .on(
        'broadcast',
        { event: 'ROOM_SETTINGS_CHANGE' },
        (msg: { payload: { allowGuestControl: boolean } }) => {
          const payload = msg?.payload;
          if (!payload) return;
          setRoom((prev) =>
            prev
              ? {
                  ...prev,
                  allowGuestControl: payload.allowGuestControl,
                }
              : null
          );
        }
      )
      .on(
        'broadcast',
        { event: 'ROOM_CLOSED' },
        (msg: { payload?: { reason?: string } }) => {
          void roomChannel.untrack();
          setIsRoomClosed(true);
          setRoomClosedMessage(
            msg?.payload?.reason || 'The host has left and closed this screening room.'
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'rooms',
          filter: `id=eq.${currentRoomId}`,
        },
        () => {
          void roomChannel.untrack();
          setIsRoomClosed(true);
          setRoomClosedMessage('The host has left and closed this screening room.');
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
                  allowGuestControl: updated.allow_guest_control ?? prev.allowGuestControl,
                  kickedUserIds: updated.kicked_user_ids ?? prev.kickedUserIds,
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
          table: 'room_members',
          filter: `room_id=eq.${currentRoomId}`,
        },
        (payload) => {
          const newRow = payload.new as { user_id?: string; role?: RoomRole } | undefined;
          const oldRow = payload.old as { user_id?: string } | undefined;

          if (payload.eventType === 'INSERT' && newRow?.user_id) {
            void roomService.getRoomMembers(currentRoomId).then((refreshed) => {
              if (!isDisposed && refreshed.length > 0) {
                setMembers(refreshed);
              }
            });
          } else if (payload.eventType === 'UPDATE' && newRow?.user_id && newRow.role) {
            if (newRow.user_id === user.id) {
              setRole(newRow.role);
            }
            setMembers((prev) =>
              prev.map((m) => (m.userId === newRow.user_id ? { ...m, role: newRow.role! } : m))
            );
            setPresenceList((prev) =>
              prev.map((p) => (p.userId === newRow.user_id ? { ...p, role: newRow.role! } : p))
            );
          } else if (payload.eventType === 'DELETE' && oldRow?.user_id) {
            if (oldRow.user_id === user.id) {
              void roomChannel.untrack();
              setIsKicked(true);
              setKickedMessage('You have been removed from this room by the host.');
            } else {
              setMembers((prev) => prev.filter((m) => m.userId !== oldRow.user_id));
              setPresenceList((prev) => prev.filter((p) => p.userId !== oldRow.user_id));
            }
          }
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

    let errorDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    const handleSubscribeStatus = async (status: string, err?: Error) => {
      if (isDisposed) return;
      if (status === 'SUBSCRIBED') {
        if (errorDebounceTimer) {
          clearTimeout(errorDebounceTimer);
          errorDebounceTimer = null;
        }
        setRealtimeError(null);
        setChannel(roomChannel);
        await roomChannel.track({
          userId: user.id,
          username: userRef.current.username,
          role: roleRef.current,
          clientState: 'ready',
          joinedAt: userJoinedAt,
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        const detail = err?.message || 'Realtime private channel authorization failed.';
        const isTransientTransport =
          status === 'TIMED_OUT' ||
          /socket closed|transport failure|connection lost|timed out/i.test(detail);

        if (isTransientTransport) {
          void getAuthenticatedAccessToken(supabase)
            .then((token) => supabase.realtime.setAuth(token ?? null))
            .catch(() => {});

          if (!errorDebounceTimer) {
            errorDebounceTimer = setTimeout(() => {
              errorDebounceTimer = null;
              if (!isDisposed) {
                setRealtimeError('Live room sync connection interrupted. Reconnecting…');
              }
            }, 2500);
          }
          return;
        }

        if (errorDebounceTimer) {
          clearTimeout(errorDebounceTimer);
          errorDebounceTimer = null;
        }
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
      if (errorDebounceTimer) {
        clearTimeout(errorDebounceTimer);
        errorDebounceTimer = null;
      }
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

  // 3. Compute Duo Status & Control Authority
  // Previously kicked participants can rejoin as view-only, but NEVER hold Co-Host or Shared Controls
  const isHost = room?.hostId === user.id || role === 'host';
  const isRestrictedViewer =
    !isHost && Boolean(room?.kickedUserIds?.includes(user.id));
  const isCoHost = !isRestrictedViewer && role === 'co-host';
  const canControl =
    isHost || (!isRestrictedViewer && (isCoHost || Boolean(room?.allowGuestControl)));

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

  // 4. Update Video Action (Host, Co-Host or permitted controllers) — updates DB AND broadcasts instantly to connected viewers
  const updateVideo = useCallback(
    async (newVideoUrl: string, videoType: VideoSourceType = 'youtube') => {
      if (!room || !canControl) return;

      // Clean up previous uploaded video file from storage & metrics to avoid unneeded Supabase load
      if (room.videoType === 'upload' && room.videoUrl && room.videoUrl !== newVideoUrl) {
        const newMatch = videoType === 'upload' ? newVideoUrl.match(/videos\/([^?#]+)/) : null;
        const excludePath = newMatch?.[1] ? decodeURIComponent(newMatch[1]) : undefined;
        void storageService.cleanupRoomVideos(room.id, excludePath).catch((err) => {
          console.warn('[Syncora] Non-blocking storage cleanup notice:', err);
        });
      }

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
    [room, canControl, channel, user.id]
  );

  // 5. Persist playback snapshot to DB on controller play/pause/seek
  const persistPlaybackSnapshot = useCallback(
    (position: number, isPlaying: boolean) => {
      if (!roomId || !canControl) return;
      void roomService.updateRoomPlayback(roomId, {
        currentPosition: position,
        isPlaying,
      });
    },
    [roomId, canControl]
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

  // 7. Kick a participant from the room (Host-only)
  const kickMember = useCallback(
    async (targetUserId: string) => {
      if (!roomId || !isHost) return;
      const res = await roomService.kickMember(roomId, targetUserId);
      if (res.success) {
        setRoom((prev) =>
          prev
            ? {
                ...prev,
                kickedUserIds: prev.kickedUserIds?.includes(targetUserId)
                  ? prev.kickedUserIds
                  : [...(prev.kickedUserIds || []), targetUserId],
              }
            : null
        );
        setMembers((prev) => prev.filter((m) => m.userId !== targetUserId));
        setPresenceList((prev) => prev.filter((p) => p.userId !== targetUserId));
        if (channel) {
          void channel.send({
            type: 'broadcast',
            event: 'KICK_MEMBER',
            payload: {
              kickedUserId: targetUserId,
              reason: 'You have been removed from this room by the host.',
              sentAt: Date.now(),
            },
          });
        }
      }
      return res;
    },
    [roomId, isHost, channel]
  );

  // 8. Promote / demote member role (Host-only)
  const updateMemberRole = useCallback(
    async (targetUserId: string, newRole: 'co-host' | 'viewer') => {
      if (!roomId || !isHost) return;
      const res = await roomService.updateMemberRole(roomId, targetUserId, newRole);
      if (res.success) {
        setMembers((prev) =>
          prev.map((m) => (m.userId === targetUserId ? { ...m, role: newRole } : m))
        );
        setPresenceList((prev) =>
          prev.map((p) => (p.userId === targetUserId ? { ...p, role: newRole } : p))
        );
        if (channel) {
          void channel.send({
            type: 'broadcast',
            event: 'ROLE_CHANGE',
            payload: {
              userId: targetUserId,
              newRole,
              sentAt: Date.now(),
            },
          });
        }
      }
      return res;
    },
    [roomId, isHost, channel]
  );

  // 9. Toggle whether all members have playback controls (Host-only)
  const toggleGuestControl = useCallback(
    async (allowGuestControl: boolean) => {
      if (!roomId || !isHost) return;
      const res = await roomService.setGuestControl(roomId, allowGuestControl);
      if (res.success) {
        setRoom((prev) => (prev ? { ...prev, allowGuestControl } : null));
        if (channel) {
          void channel.send({
            type: 'broadcast',
            event: 'ROOM_SETTINGS_CHANGE',
            payload: {
              allowGuestControl,
              sentAt: Date.now(),
            },
          });
        }
      }
      return res;
    },
    [roomId, isHost, channel]
  );

  // 10. Close & delete room when Host explicitly leaves (cleans up Storage & kicks active session to closed state)
  const closeRoom = useCallback(async () => {
    if (!roomId || !isHost) return;
    if (channel) {
      try {
        await channel.send({
          type: 'broadcast',
          event: 'ROOM_CLOSED',
          payload: {
            reason: 'The host has left and closed this screening room.',
            sentAt: Date.now(),
          },
        });
      } catch (err) {
        console.warn('[Syncora] Non-blocking ROOM_CLOSED broadcast notice:', err);
      }
    }

    await roomService.leaveOrDeleteRoom(roomId, user.id, true);
  }, [roomId, isHost, channel, user.id]);

  const effectiveIsLoading = isInitialized && !user.id ? false : isLoading;
  const effectiveError =
    isInitialized && !user.id ? 'Please sign in to create or join a watch room.' : error;

  return {
    room,
    role,
    isHost,
    isCoHost,
    canControl,
    members,
    duoStatus,
    presenceList,
    isKicked,
    kickedMessage,
    isRoomClosed,
    roomClosedMessage,
    isLoading: effectiveIsLoading,
    error: effectiveError,
    realtimeError,
    hostGraceSecondsLeft,
    updateVideo,
    persistPlaybackSnapshot,
    applyRemoteVideo,
    kickMember,
    updateMemberRole,
    toggleGuestControl,
    closeRoom,
    channel,
  };
}
