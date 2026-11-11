'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { Room, RoomMember, RoomRole, DuoStatus, ParticipantPresence } from '@/core/types/room.types';
import { VideoSourceType } from '@/core/types/player.types';
import { useSession } from './useSession';
import { roomService } from '@/lib/services/roomService';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { SYNC_CONSTANTS } from '@/lib/constants/sync.constants';
import { Database } from '@/lib/supabase/database.types';

import { RealtimeChannel } from '@supabase/supabase-js';

type RoomRow = Database['public']['Tables']['rooms']['Row'];

interface RawPresence {
  userId?: string;
  username?: string;
  role?: RoomRole;
  clientState?: 'ready' | 'buffering' | 'playing' | 'paused' | 'idle';
  joinedAt?: number;
}

export function useRoom(roomCode: string) {
  const { user, isInitialized } = useSession();
  const [room, setRoom] = useState<Room | null>(null);
  const [role, setRole] = useState<RoomRole>('viewer');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [presenceList, setPresenceList] = useState<ParticipantPresence[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hostGraceSecondsLeft, setHostGraceSecondsLeft] = useState<number | null>(null);
  const [userJoinedAt] = useState<number>(() => Date.now());
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);

  const graceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Initial Room Load and Membership Join
  useEffect(() => {
    if (!isInitialized || !roomCode) return;

    let isMounted = true;

    async function initRoom() {
      setIsLoading(true);
      setError(null);

      try {
        let loadedRoom = await roomService.getRoomByCode(roomCode);

        // If room does not exist yet, create it with user as host
        if (!loadedRoom) {
          const createRes = await roomService.createRoom({
            code: roomCode,
            title: 'Our Watch Party',
            host: user,
          });
          if (createRes.room) {
            loadedRoom = createRes.room;
          } else {
            if (isMounted) setError(createRes.error || 'Failed to initialize room.');
            setIsLoading(false);
            return;
          }
        }

        if (!isMounted) return;
        setRoom(loadedRoom);

        // Join the room
        const joinRes = await roomService.joinRoom({
          roomId: loadedRoom.id,
          user,
        });

        if (!isMounted) return;
        setRole(joinRes.role);

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
  }, [roomCode, user, isInitialized]);

  // 2. Realtime Channel Subscription (Presence & DB Changes)
  useEffect(() => {
    if (!room || !isSupabaseConfigured()) return;

    const currentRoomId = room.id;
    const currentHostId = room.hostId;
    const supabase = getSupabaseBrowserClient();
    const channelName = `room:${currentRoomId}`;
    const channel = supabase.channel(channelName);

    // Track presence
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const active: ParticipantPresence[] = [];

        Object.values(state).forEach((presences) => {
          (presences as unknown as RawPresence[]).forEach((p) => {
            if (p.userId) {
              active.push({
                userId: p.userId,
                username: p.username || 'Guest',
                role: p.role || 'viewer',
                clientState: p.clientState || 'ready',
                joinedAt: p.joinedAt || userJoinedAt,
              });
            }
          });
        });

        setPresenceList(active);

        // Check if host is present in active presence
        const isHostOnline = active.some((p) => p.userId === currentHostId);
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
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setChannel(channel);
          await channel.track({
            userId: user.id,
            username: user.username,
            role,
            clientState: 'ready',
            joinedAt: userJoinedAt,
          });
        }
      });

    return () => {
      setChannel(null);
      if (graceTimerRef.current) {
        clearInterval(graceTimerRef.current);
      }
      supabase.removeChannel(channel);
    };
  }, [room, user.id, user.username, role, userJoinedAt]);

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

  // 4. Update Video Action (Host only)
  const updateVideo = useCallback(
    async (newVideoUrl: string, videoType: VideoSourceType = 'youtube') => {
      if (!room || !isHost) return;

      setRoom((prev) =>
        prev ? { ...prev, videoUrl: newVideoUrl, videoType } : null
      );
      await roomService.updateRoomPlayback(room.id, {
        currentPosition: 0,
        isPlaying: false,
        videoUrl: newVideoUrl,
        videoType,
      });
    },
    [room, isHost]
  );

  return {
    room,
    role,
    isHost,
    members,
    duoStatus,
    presenceList,
    isLoading,
    error,
    hostGraceSecondsLeft,
    updateVideo,
    channel,
  };
}
