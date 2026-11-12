'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';
import { CALL_CONSTANTS } from '@/lib/constants/sync.constants';
import {
  RealtimeCallSlotChange,
  RealtimeCallSlotRow,
  subscribeToRoomCallSlots,
} from '@/lib/supabase/roomRealtimeBus';
import { CallSignaling } from '@/core/call/CallSignaling';
import {
  PeerConnectionManager,
  PeerConnectionStatus,
} from '@/core/call/PeerConnectionManager';
import { AudioLevelMonitor } from '@/core/call/AudioLevelMonitor';
import {
  CallConnectionMode,
  CallError,
  CallErrorCode,
  CallIceConfig,
  CallParticipantSlot,
  CallParticipantState,
  CallSignalPayload,
  CallStatus,
} from '@/core/types/call.types';
import { ParticipantPresence, RoomMember } from '@/core/types/room.types';
import { UserIdentity } from '@/core/types/session.types';

interface UseCallOptions {
  roomId?: string;
  hostId?: string;
  canStartCall?: boolean;
  user: UserIdentity;
  presenceList: ParticipantPresence[];
  members: RoomMember[];
  isRoomReady: boolean;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

interface ProfileMeta {
  username: string;
  avatarUrl?: string;
}

function mapRowToSlot(row: RealtimeCallSlotRow): CallParticipantSlot {
  return {
    roomId: row.room_id,
    userId: row.user_id,
    callSessionId: row.call_session_id,
    joinedAt: row.joined_at,
    lastHeartbeatAt: row.last_heartbeat_at,
  };
}

function isSlotFresh(slot: CallParticipantSlot, nowMs: number = Date.now()): boolean {
  const hbMs = Date.parse(slot.lastHeartbeatAt);
  if (!Number.isFinite(hbMs)) return false;
  return nowMs - hbMs < CALL_CONSTANTS.CALL_SLOT_TTL_SECONDS * 1000;
}

function mapMediaError(err: unknown): CallError {
  if (err && typeof err === 'object' && 'name' in err) {
    const name = String((err as { name?: unknown }).name);
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      return {
        code: 'PERMISSION_DENIED',
        message: 'Microphone access was denied. Enable mic permissions in your browser settings and try again.',
      };
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return {
        code: 'DEVICE_NOT_FOUND',
        message: 'No microphone was found on this device.',
      };
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
      return {
        code: 'DEVICE_IN_USE',
        message: 'Your microphone is currently busy in another app or browser tab.',
      };
    }
  }

  return {
    code: 'DEVICE_IN_USE',
    message: err instanceof Error ? err.message : 'Unable to access your microphone.',
  };
}

function stopMediaStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.onended = null;
      track.stop();
    } catch {
      // Ignore already stopped tracks
    }
  }
}

export function useCall({
  roomId,
  hostId,
  canStartCall = true,
  user,
  presenceList,
  members,
  isRoomReady,
  audioRef,
}: UseCallOptions) {
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [peerStatuses, setPeerStatuses] = useState<Record<string, PeerConnectionStatus>>({});
  const [peerMutedMap, setPeerMutedMap] = useState<Record<string, boolean>>({});
  const [peerSpeakingMap, setPeerSpeakingMap] = useState<Record<string, boolean>>({});
  const [peerConnectionModes, setPeerConnectionModes] = useState<
    Record<string, CallConnectionMode>
  >({});
  const [blockedAudioPeers, setBlockedAudioPeers] = useState<Record<string, boolean>>({});
  const [iceMode, setIceMode] = useState<'turn' | 'stun-only' | null>(null);
  const [error, setError] = useState<CallError | null>(null);
  const [callEndedNotice, setCallEndedNotice] = useState<string | null>(null);
  const [callSlots, setCallSlots] = useState<CallParticipantSlot[]>([]);
  const [profileCache, setProfileCache] = useState<Record<string, ProfileMeta>>({});

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Map<string, MediaStream>>(new Map());
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
  const signalingRef = useRef<CallSignaling | null>(null);
  const peerManagersRef = useRef<Map<string, PeerConnectionManager>>(new Map());
  const peerSessionsRef = useRef<Map<string, string>>(new Map());
  const audioMonitorRef = useRef<AudioLevelMonitor | null>(null);

  const isInCallRef = useRef(false);
  const isJoiningRef = useRef(false);
  const isLeavingRef = useRef(false);
  const isMutedRef = useRef(false);
  const iceConfigRef = useRef<CallIceConfig | null>(null);
  const selfSessionIdRef = useRef<string | null>(null);
  const peerHelloReceivedRef = useRef<Set<string>>(new Set());
  const echoedHelloRef = useRef<Map<string, string>>(new Map());
  const handleMicTrackEndedRef = useRef<() => Promise<void>>(async () => {});
  const scheduleTurnRefreshRef = useRef<(targetRoomId: string, config: CallIceConfig) => void>(
    () => {}
  );

  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerFallbackTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const slotPruneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const roomIdRef = useRef(roomId);
  const hostIdRef = useRef(hostId);
  const canStartCallRef = useRef(canStartCall);
  const userIdRef = useRef(user.id);
  useEffect(() => {
    roomIdRef.current = roomId;
    hostIdRef.current = hostId;
    canStartCallRef.current = canStartCall;
    userIdRef.current = user.id;
  }, [roomId, hostId, canStartCall, user.id]);

  const clearTimers = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (turnRefreshTimerRef.current) {
      clearTimeout(turnRefreshTimerRef.current);
      turnRefreshTimerRef.current = null;
    }
    for (const timer of offerFallbackTimersRef.current.values()) {
      clearTimeout(timer);
    }
    offerFallbackTimersRef.current.clear();
  }, []);

  const releasePeerAudioElement = useCallback(
    (peerId: string) => {
      const audioEl = remoteAudioElsRef.current.get(peerId);
      if (!audioEl) return;
      remoteAudioElsRef.current.delete(peerId);
      audioEl.srcObject = null;
      if (audioEl !== audioRef.current && audioEl.parentNode) {
        audioEl.parentNode.removeChild(audioEl);
      }
    },
    [audioRef]
  );

  const detachPeerConnection = useCallback(
    (peerId?: string) => {
      if (!peerId) {
        for (const id of Array.from(offerFallbackTimersRef.current.keys())) {
          const timer = offerFallbackTimersRef.current.get(id);
          if (timer) clearTimeout(timer);
        }
        offerFallbackTimersRef.current.clear();

        for (const [id, mgr] of peerManagersRef.current.entries()) {
          mgr.destroy();
          audioMonitorRef.current?.untrackStream(id);
        }
        peerManagersRef.current.clear();
        peerSessionsRef.current.clear();
        peerHelloReceivedRef.current.clear();
        echoedHelloRef.current.clear();
        remoteStreamsRef.current.clear();

        for (const id of Array.from(remoteAudioElsRef.current.keys())) {
          releasePeerAudioElement(id);
        }
        if (audioRef.current) {
          audioRef.current.srcObject = null;
        }

        setPeerStatuses({});
        setPeerMutedMap({});
        setPeerSpeakingMap({});
        setPeerConnectionModes({});
        setBlockedAudioPeers({});
        return;
      }

      const timer = offerFallbackTimersRef.current.get(peerId);
      if (timer) {
        clearTimeout(timer);
        offerFallbackTimersRef.current.delete(peerId);
      }

      const mgr = peerManagersRef.current.get(peerId);
      if (mgr) {
        mgr.destroy();
        peerManagersRef.current.delete(peerId);
      }

      audioMonitorRef.current?.untrackStream(peerId);
      remoteStreamsRef.current.delete(peerId);
      releasePeerAudioElement(peerId);
      peerSessionsRef.current.delete(peerId);
      peerHelloReceivedRef.current.delete(peerId);
      echoedHelloRef.current.delete(peerId);

      setPeerStatuses((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setPeerMutedMap((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setPeerSpeakingMap((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setPeerConnectionModes((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setBlockedAudioPeers((prev) => {
        if (!(peerId in prev)) return prev;
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
    },
    [audioRef, releasePeerAudioElement]
  );

  const getOrCreatePeerAudioElement = useCallback(
    (peerId: string): HTMLAudioElement | null => {
      const existing = remoteAudioElsRef.current.get(peerId);
      if (existing) return existing;

      const primary = audioRef.current;
      const primaryInUse = primary
        ? Array.from(remoteAudioElsRef.current.values()).includes(primary)
        : false;

      if (primary && !primaryInUse) {
        remoteAudioElsRef.current.set(peerId, primary);
        return primary;
      }

      if (typeof document === 'undefined') return null;
      const el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', '');
      el.className = 'hidden';
      el.setAttribute('aria-hidden', 'true');
      (primary?.parentElement ?? document.body).appendChild(el);
      remoteAudioElsRef.current.set(peerId, el);
      return el;
    },
    [audioRef]
  );

  const attachRemoteAudio = useCallback(
    (peerId: string, stream: MediaStream) => {
      remoteStreamsRef.current.set(peerId, stream);
      const audioEl = getOrCreatePeerAudioElement(peerId);
      if (!audioEl) return;

      audioEl.srcObject = stream;
      const playPromise = audioEl.play();
      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            setBlockedAudioPeers((prev) => {
              if (!prev[peerId]) return prev;
              const next = { ...prev };
              delete next[peerId];
              return next;
            });
          })
          .catch(() => {
            setBlockedAudioPeers((prev) => ({ ...prev, [peerId]: true }));
          });
      }
    },
    [getOrCreatePeerAudioElement]
  );

  const unlockRemoteAudio = useCallback(async () => {
    await audioMonitorRef.current?.resume();

    const nextBlocked: Record<string, boolean> = {};
    const entries = Array.from(remoteStreamsRef.current.entries());

    await Promise.all(
      entries.map(async ([peerId, stream]) => {
        const audioEl = getOrCreatePeerAudioElement(peerId);
        if (!audioEl) return;
        if (audioEl.srcObject !== stream) {
          audioEl.srcObject = stream;
        }
        try {
          await audioEl.play();
        } catch {
          nextBlocked[peerId] = true;
        }
      })
    );

    setBlockedAudioPeers(nextBlocked);
  }, [getOrCreatePeerAudioElement]);

  const cleanupCall = useCallback(
    async (
      options: {
        notifyServer?: boolean;
        nextError?: CallError | null;
        endedByHost?: boolean;
      } = {}
    ) => {
      const targetRoomId = roomIdRef.current;
      const wasInCall = isInCallRef.current;
      const isHostCaller = Boolean(
        hostIdRef.current && userIdRef.current && userIdRef.current === hostIdRef.current
      );
      const activePeerIds = Array.from(peerManagersRef.current.keys());

      isInCallRef.current = false;
      isJoiningRef.current = false;
      clearTimers();

      if (signalingRef.current && activePeerIds.length > 0) {
        const byeReason = isHostCaller ? 'host-ended' : 'left';
        await Promise.all(
          activePeerIds.map((peerId) => signalingRef.current!.sendBye(peerId, byeReason))
        );
      }

      detachPeerConnection();

      if (signalingRef.current) {
        signalingRef.current.destroy();
        signalingRef.current = null;
      }

      if (audioMonitorRef.current) {
        audioMonitorRef.current.destroy();
        audioMonitorRef.current = null;
      }

      stopMediaStream(localStreamRef.current);
      localStreamRef.current = null;
      iceConfigRef.current = null;
      selfSessionIdRef.current = null;
      isMutedRef.current = false;

      setIsJoining(false);
      setIsInCall(false);
      setIsMuted(false);
      setIsLocalSpeaking(false);
      setIceMode(null);
      if (options.endedByHost && !isHostCaller) {
        setCallEndedNotice('Host ended the voice call.');
      }
      if (options.nextError !== undefined) {
        setError(options.nextError);
      }

      if (options.notifyServer && wasInCall && targetRoomId && isSupabaseConfigured()) {
        try {
          const supabase = getSupabaseBrowserClient();
          await supabase.rpc('leave_room_call', { p_room_id: targetRoomId });
        } catch {
          // Slot expires automatically via 60s TTL if RPC fails
        }
      }
    },
    [clearTimers, detachPeerConnection]
  );

  // Attempt mic reacquisition if a Bluetooth headset or mic disconnects mid-call
  const handleMicTrackEnded = useCallback(async () => {
    if (!isInCallRef.current) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;

    try {
      const replacement = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      if (!isInCallRef.current) {
        stopMediaStream(replacement);
        return;
      }

      const newTrack = replacement.getAudioTracks()[0] || null;
      if (!newTrack) {
        stopMediaStream(replacement);
        return;
      }

      newTrack.enabled = !isMutedRef.current;
      newTrack.onended = () => {
        void handleMicTrackEndedRef.current();
      };

      const prevStream = localStreamRef.current;
      localStreamRef.current = replacement;
      await Promise.all(
        Array.from(peerManagersRef.current.values()).map((mgr) =>
          mgr.replaceAudioTrack(newTrack)
        )
      );
      audioMonitorRef.current?.trackStream('local', replacement, isMutedRef.current);
      stopMediaStream(prevStream);
    } catch (err) {
      await cleanupCall({
        notifyServer: true,
        nextError: mapMediaError(err),
      });
    }
  }, [cleanupCall]);

  useEffect(() => {
    handleMicTrackEndedRef.current = handleMicTrackEnded;
  }, [handleMicTrackEnded]);

  // Fetch initial call slots & subscribe to room_call_participants updates via roomRealtimeBus
  useEffect(() => {
    if (!roomId || !user.id || !isRoomReady || !isSupabaseConfigured()) {
      return;
    }

    let isActive = true;
    const supabase = getSupabaseBrowserClient();

    const loadInitialSlots = async () => {
      const cutoffIso = new Date(
        Date.now() - CALL_CONSTANTS.CALL_SLOT_TTL_SECONDS * 1000
      ).toISOString();
      const { data, error: fetchError } = await supabase
        .from('room_call_participants')
        .select('room_id, user_id, call_session_id, joined_at, last_heartbeat_at')
        .eq('room_id', roomId)
        .gte('last_heartbeat_at', cutoffIso);

      if (!isActive || fetchError || !data) return;
      setCallSlots(data.map((row) => mapRowToSlot(row as RealtimeCallSlotRow)));
    };

    void loadInitialSlots();

    const unsubscribe = subscribeToRoomCallSlots(
      roomId,
      (change: RealtimeCallSlotChange) => {
        if (!isActive) return;

        if (change.eventType === 'DELETE') {
          const removedUserId = change.oldRow?.user_id;
          if (!removedUserId) {
            void loadInitialSlots();
            return;
          }
          setCallSlots((prev) => prev.filter((s) => s.userId !== removedUserId));
          const isHostRemoved = Boolean(
            hostIdRef.current && removedUserId === hostIdRef.current
          );
          if (isHostRemoved && removedUserId !== user.id) {
            setCallSlots([]);
            if (isInCallRef.current) {
              void cleanupCall({
                notifyServer: false,
                nextError: null,
                endedByHost: true,
              });
            }
            return;
          }
          if (removedUserId === user.id && isInCallRef.current) {
            void cleanupCall({
              notifyServer: false,
              nextError: {
                code: 'SIGNALING_ERROR',
                message: 'Your voice call session ended.',
              },
            });
          }
          return;
        }

        if (!change.newRow) return;
        const incoming = mapRowToSlot(change.newRow);
        setCallEndedNotice(null);
        setCallSlots((prev) => {
          const filtered = prev.filter((s) => s.userId !== incoming.userId);
          return [...filtered, incoming].sort((a, b) =>
            a.joinedAt.localeCompare(b.joinedAt)
          );
        });
      }
    );

    // Periodically drop locally expired slots when a partner crashes silently
    slotPruneTimerRef.current = setInterval(() => {
      const now = Date.now();
      setCallSlots((prev) => {
        const fresh = prev.filter((slot) => isSlotFresh(slot, now));
        return fresh.length === prev.length ? prev : fresh;
      });
    }, 15_000);

    return () => {
      isActive = false;
      unsubscribe();
      setCallSlots([]);
      if (slotPruneTimerRef.current) {
        clearInterval(slotPruneTimerRef.current);
        slotPruneTimerRef.current = null;
      }
    };
  }, [roomId, user.id, isRoomReady, cleanupCall]);

  // Resolve display names for callers not yet present in presenceList or members
  useEffect(() => {
    if (!callSlots.length || !isSupabaseConfigured()) return;

    const missingIds = callSlots
      .map((s) => s.userId)
      .filter(
        (id) =>
          id !== user.id &&
          !presenceList.some((p) => p.userId === id) &&
          !members.some((m) => m.userId === id) &&
          !profileCache[id]
      );

    if (missingIds.length === 0) return;

    const supabase = getSupabaseBrowserClient();
    void supabase
      .from('profiles')
      .select('id, username, avatar_url')
      .in('id', missingIds)
      .then(({ data }) => {
        if (!data || data.length === 0) return;
        setProfileCache((prev) => {
          const next = { ...prev };
          for (const row of data) {
            next[row.id] = {
              username: row.username,
              avatarUrl: row.avatar_url ?? undefined,
            };
          }
          return next;
        });
      });
  }, [callSlots, user.id, presenceList, members, profileCache]);

  const fetchIceServers = useCallback(async (targetRoomId: string): Promise<CallIceConfig> => {
    const response = await fetch(`/api/rooms/${encodeURIComponent(targetRoomId)}/call/ice-servers`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      let message = 'Unable to retrieve voice connection servers.';
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // Ignore parse error
      }
      throw new Error(message);
    }

    return (await response.json()) as CallIceConfig;
  }, []);

  const scheduleTurnRefresh = useCallback(
    (targetRoomId: string, config: CallIceConfig) => {
      if (turnRefreshTimerRef.current) {
        clearTimeout(turnRefreshTimerRef.current);
        turnRefreshTimerRef.current = null;
      }

      if (config.mode !== 'turn' || config.ttlSeconds <= CALL_CONSTANTS.TURN_REFRESH_BUFFER_SECONDS) {
        return;
      }

      const refreshAfterMs = Math.max(
        60_000,
        (config.ttlSeconds - CALL_CONSTANTS.TURN_REFRESH_BUFFER_SECONDS) * 1000
      );

      turnRefreshTimerRef.current = setTimeout(() => {
        if (!isInCallRef.current) return;
        void fetchIceServers(targetRoomId)
          .then((fresh) => {
            if (!isInCallRef.current) return;
            iceConfigRef.current = fresh;
            setIceMode(fresh.mode);
            for (const mgr of peerManagersRef.current.values()) {
              mgr.updateIceServers(fresh.iceServers);
            }
            scheduleTurnRefreshRef.current(targetRoomId, fresh);
          })
          .catch(() => {
            // Existing credentials stay valid for buffer window
          });
      }, refreshAfterMs);
    },
    [fetchIceServers]
  );

  useEffect(() => {
    scheduleTurnRefreshRef.current = scheduleTurnRefresh;
  }, [scheduleTurnRefresh]);

  // Reconcile 4-way mesh PeerConnections whenever active call slots change
  useEffect(() => {
    if (!isInCall || !roomId || !user.id) return;

    const iceConfig = iceConfigRef.current;
    const signaling = signalingRef.current;
    const localStream = localStreamRef.current;
    if (!iceConfig || !signaling || !localStream) return;

    const remoteSlots = callSlots.filter(
      (s) => s.userId !== user.id && isSlotFresh(s)
    );
    const desiredMap = new Map(remoteSlots.map((s) => [s.userId, s]));

    // Tear down peers who left or rotated callSessionId
    for (const [existingPeerId, existingSessionId] of Array.from(
      peerSessionsRef.current.entries()
    )) {
      const nextSlot = desiredMap.get(existingPeerId);
      if (!nextSlot || nextSlot.callSessionId !== existingSessionId) {
        detachPeerConnection(existingPeerId);
      }
    }

    void signaling.syncPeers(
      remoteSlots.map((s) => ({
        userId: s.userId,
        callSessionId: s.callSessionId,
      }))
    );

    // Create PeerConnections for newly joined peers
    for (const slot of remoteSlots) {
      const peerId = slot.userId;
      const peerSessionId = slot.callSessionId;
      const isAlreadyBound =
        peerSessionsRef.current.get(peerId) === peerSessionId &&
        peerManagersRef.current.has(peerId);

      if (isAlreadyBound) continue;

      peerSessionsRef.current.set(peerId, peerSessionId);
      const isImpolite = user.id > peerId;

      setPeerStatuses((prev) => ({ ...prev, [peerId]: 'connecting' }));

      const pcMgr = new PeerConnectionManager({
        selfUserId: user.id,
        peerUserId: peerId,
        iceServers: iceConfig.iceServers,
        isStunOnlyFallback: iceConfig.mode === 'stun-only',
        deferInitialOffer: true,
        callbacks: {
          onOffer: (sdp) => signaling.sendOffer(peerId, sdp),
          onAnswer: (sdp) => signaling.sendAnswer(peerId, sdp),
          onIceCandidate: (candidate) => signaling.sendIceCandidate(peerId, candidate),
          onRemoteStream: (remoteStream) => {
            audioMonitorRef.current?.trackStream(peerId, remoteStream, false);
            attachRemoteAudio(peerId, remoteStream);
          },
          onStatusChange: (pcStatus: PeerConnectionStatus) => {
            if (!isInCallRef.current || peerManagersRef.current.get(peerId) !== pcMgr) {
              return;
            }
            if (pcStatus === 'connected') {
              const fallbackTimer = offerFallbackTimersRef.current.get(peerId);
              if (fallbackTimer) {
                clearTimeout(fallbackTimer);
                offerFallbackTimersRef.current.delete(peerId);
              }
              setError((prev) => (prev?.code === 'SIGNALING_ERROR' ? null : prev));
            }
            setPeerStatuses((prev) =>
              prev[peerId] === pcStatus ? prev : { ...prev, [peerId]: pcStatus }
            );
          },
          onConnectionModeChange: (mode) => {
            if (isInCallRef.current && peerManagersRef.current.get(peerId) === pcMgr) {
              setPeerConnectionModes((prev) =>
                prev[peerId] === mode ? prev : { ...prev, [peerId]: mode }
              );
            }
          },
          onError: (callErr) => {
            if (!isInCallRef.current) return;
            setError(callErr);
            if (callErr.code === 'CONNECTION_FAILED') {
              setPeerStatuses((prev) => ({ ...prev, [peerId]: 'failed' }));
            }
          },
        },
      });

      peerManagersRef.current.set(peerId, pcMgr);
      pcMgr.setLocalStream(localStream);

      // Fallback: if impolite peer hasn't heard partner's hello within 1.5s, initiate offer anyway
      if (isImpolite) {
        const timer = setTimeout(() => {
          offerFallbackTimersRef.current.delete(peerId);
          if (
            isInCallRef.current &&
            peerManagersRef.current.get(peerId) === pcMgr &&
            !peerHelloReceivedRef.current.has(peerId)
          ) {
            void pcMgr.createAndSendOffer();
          }
        }, 1500);
        offerFallbackTimersRef.current.set(peerId, timer);
      }
    }
  }, [isInCall, callSlots, roomId, user.id, detachPeerConnection, attachRemoteAudio]);

  // Handle network recovery, tab suspension recovery, device swaps, and pagehide/unmount cleanup
  useEffect(() => {
    const handleOnlineOrVisible = () => {
      if (!isInCallRef.current || !roomIdRef.current) return;
      if (document.visibilityState === 'hidden') return;

      void audioMonitorRef.current?.resume();

      if (isSupabaseConfigured()) {
        const supabase = getSupabaseBrowserClient();
        void supabase
          .rpc('heartbeat_room_call', { p_room_id: roomIdRef.current })
          .then(({ data }) => {
            if (data === false && isInCallRef.current) {
              void cleanupCall({
                notifyServer: false,
                nextError: {
                  code: 'SIGNALING_ERROR',
                  message: 'Your voice session expired while inactive. Please rejoin.',
                },
              });
            }
          });
      }

      for (const mgr of peerManagersRef.current.values()) {
        mgr.triggerIceRestart();
      }
    };

    const handlePageHide = () => {
      const targetRoomId = roomIdRef.current;
      if (!isInCallRef.current || !targetRoomId) return;
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(`/api/rooms/${encodeURIComponent(targetRoomId)}/call/leave`);
      }
      void cleanupCall({ notifyServer: false });
    };

    const handleDeviceChange = () => {
      if (!isInCallRef.current) return;
      const track = localStreamRef.current?.getAudioTracks()[0];
      if (!track || track.readyState === 'ended') {
        void handleMicTrackEnded();
      }
    };

    window.addEventListener('online', handleOnlineOrVisible);
    document.addEventListener('visibilitychange', handleOnlineOrVisible);
    window.addEventListener('pagehide', handlePageHide);
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);

    return () => {
      window.removeEventListener('online', handleOnlineOrVisible);
      document.removeEventListener('visibilitychange', handleOnlineOrVisible);
      window.removeEventListener('pagehide', handlePageHide);
      navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
    };
  }, [cleanupCall, handleMicTrackEnded]);

  // Unmount or room/user switch cleanup
  useEffect(() => {
    return () => {
      if (isInCallRef.current || isJoiningRef.current) {
        const targetRoomId = roomIdRef.current;
        if (targetRoomId && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon(`/api/rooms/${encodeURIComponent(targetRoomId)}/call/leave`);
        }
        void cleanupCall({ notifyServer: true });
      }
    };
  }, [roomId, user.id, cleanupCall]);

  const handleIncomingSignal = useCallback(
    (signal: CallSignalPayload, fromUserId: string) => {
      if (!isInCallRef.current || !peerSessionsRef.current.has(fromUserId)) {
        return;
      }

      if (signal.event === 'bye') {
        const hostEndedCall =
          signal.reason === 'host-ended' ||
          Boolean(hostIdRef.current && fromUserId === hostIdRef.current);
        if (hostEndedCall) {
          setCallSlots([]);
          void cleanupCall({
            notifyServer: false,
            nextError: null,
            endedByHost: true,
          });
          return;
        }
        detachPeerConnection(fromUserId);
        signalingRef.current?.removePeer(fromUserId);
        return;
      }

      if (signal.event === 'media-state') {
        const firstHello = !peerHelloReceivedRef.current.has(fromUserId);
        peerHelloReceivedRef.current.add(fromUserId);
        setPeerMutedMap((prev) =>
          prev[fromUserId] === signal.mediaState.isMuted
            ? prev
            : { ...prev, [fromUserId]: signal.mediaState.isMuted }
        );
        audioMonitorRef.current?.setMuted(fromUserId, signal.mediaState.isMuted);

        const signaling = signalingRef.current;
        const pcMgr = peerManagersRef.current.get(fromUserId);

        // Echo our mute state once so this remote peer knows our inbox is subscribed
        if (firstHello && echoedHelloRef.current.get(fromUserId) !== signal.callSessionId) {
          echoedHelloRef.current.set(fromUserId, signal.callSessionId);
          signaling?.sendMediaState(fromUserId, { isMuted: isMutedRef.current });
        }

        // Impolite peer initiates or resends its pending offer once when peer inbox is first proven live
        if (pcMgr && firstHello && userIdRef.current > fromUserId) {
          const pendingOffer = pcMgr.getPendingOffer();
          if (pendingOffer) {
            signaling?.sendOffer(fromUserId, pendingOffer);
          } else {
            void pcMgr.createAndSendOffer();
          }
        }
        return;
      }

      void peerManagersRef.current.get(fromUserId)?.handleSignal(signal);
    },
    [cleanupCall, detachPeerConnection]
  );

  const joinCall = useCallback(async () => {
    if (
      isJoiningRef.current ||
      isLeavingRef.current ||
      isInCallRef.current ||
      !roomId ||
      !user.id
    ) {
      return;
    }

    if (!isSupabaseConfigured()) {
      setError({
        code: 'SIGNALING_ERROR',
        message: 'Voice calling requires Supabase Auth and Realtime configuration.',
      });
      return;
    }

    if (
      typeof window === 'undefined' ||
      typeof RTCPeerConnection === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setError({
        code: 'UNSUPPORTED_BROWSER',
        message: 'Your browser does not support WebRTC voice calling.',
      });
      return;
    }

    const hasActiveCall = callSlots.some((slot) => isSlotFresh(slot));
    if (!hasActiveCall && !canStartCallRef.current) {
      setError({
        code: 'PERMISSION_DENIED',
        message:
          'Only the room host or permitted members can start a voice call. You can join once it begins.',
      });
      return;
    }

    isJoiningRef.current = true;
    setIsJoining(true);
    setError(null);
    setCallEndedNotice(null);

    let micStream: MediaStream | null = null;
    let joinedSlot = false;
    const supabase = getSupabaseBrowserClient();

    try {
      // 1. Acquire microphone FIRST so a denied prompt never reserves a room call slot
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
      } catch (mediaErr) {
        const mapped = mapMediaError(mediaErr);
        setError(mapped);
        setIsJoining(false);
        isJoiningRef.current = false;
        return;
      }

      if (!isJoiningRef.current) {
        stopMediaStream(micStream);
        setIsJoining(false);
        return;
      }

      // 2. Atomically reserve 1 of the server-side voice call slots (up to 4-way mesh)
      const { data: slotRows, error: rpcError } = await supabase.rpc('join_room_call', {
        p_room_id: roomId,
      });

      if (rpcError || !Array.isArray(slotRows)) {
        stopMediaStream(micStream);
        const msg = rpcError?.message || 'Unable to join voice call.';
        const code: CallErrorCode = /full/i.test(msg)
          ? 'CALL_FULL'
          : /start a voice call|CALL_START_NOT_ALLOWED/i.test(msg)
          ? 'PERMISSION_DENIED'
          : /member/i.test(msg)
          ? 'NOT_ROOM_MEMBER'
          : 'SIGNALING_ERROR';
        setError({
          code,
          message:
            code === 'CALL_FULL'
              ? `Voice call is full (${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS}/${CALL_CONSTANTS.MAX_CALL_PARTICIPANTS} participants active).`
              : msg,
        });
        setIsJoining(false);
        isJoiningRef.current = false;
        return;
      }

      joinedSlot = true;
      const mappedSlots = (slotRows as RealtimeCallSlotRow[]).map(mapRowToSlot);
      const selfSlot = mappedSlots.find((s) => s.userId === user.id);
      if (!selfSlot) {
        throw new Error('Call slot allocation returned without local session.');
      }

      // 3. Provision short-lived ICE/TURN servers (or STUN-only dev fallback)
      const iceConfig = await fetchIceServers(roomId);

      if (!isJoiningRef.current) {
        stopMediaStream(micStream);
        setIsJoining(false);
        await supabase.rpc('leave_room_call', { p_room_id: roomId });
        return;
      }

      const audioTrack = micStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = true;
        audioTrack.onended = () => {
          void handleMicTrackEndedRef.current();
        };
      }

      localStreamRef.current = micStream;
      iceConfigRef.current = iceConfig;
      selfSessionIdRef.current = selfSlot.callSessionId;
      isMutedRef.current = false;
      setIsMuted(false);
      setIceMode(iceConfig.mode);

      // 4. Initialize speaking monitor & anti-spoofing Realtime signaling outbox
      const monitor = new AudioLevelMonitor((key, speaking) => {
        if (key === 'local') {
          setIsLocalSpeaking(speaking);
        } else {
          setPeerSpeakingMap((prev) =>
            prev[key] === speaking ? prev : { ...prev, [key]: speaking }
          );
        }
      });
      monitor.trackStream('local', micStream, false);
      audioMonitorRef.current = monitor;

      const signaling = new CallSignaling({
        roomId,
        selfUserId: user.id,
        callSessionId: selfSlot.callSessionId,
        onSignal: handleIncomingSignal,
        onPeerSubscribed: (peerId) => {
          signaling.sendMediaState(peerId, { isMuted: isMutedRef.current });
        },
        onRecover: () => {
          if (!isInCallRef.current) return;
          setError((prev) => (prev?.code === 'SIGNALING_ERROR' ? null : prev));
        },
        onError: (msg) => {
          if (!isInCallRef.current) return;
          setError({ code: 'SIGNALING_ERROR', message: msg });
        },
      });
      signalingRef.current = signaling;

      await signaling.connectOutbox();

      isInCallRef.current = true;
      isJoiningRef.current = false;
      setIsJoining(false);
      setIsInCall(true);
      setCallSlots(mappedSlots);

      // 5. Start 20s slot lease heartbeat + TURN TTL refresh
      heartbeatTimerRef.current = setInterval(() => {
        if (!isInCallRef.current) return;
        void supabase
          .rpc('heartbeat_room_call', { p_room_id: roomId })
          .then(({ data }) => {
            if (data === false && isInCallRef.current) {
              void cleanupCall({
                notifyServer: false,
                nextError: {
                  code: 'SIGNALING_ERROR',
                  message: 'Your voice call slot expired. Please rejoin.',
                },
              });
            }
          });
      }, CALL_CONSTANTS.CALL_HEARTBEAT_INTERVAL_MS);

      scheduleTurnRefresh(roomId, iceConfig);
    } catch (err) {
      stopMediaStream(micStream);
      if (joinedSlot) {
        try {
          await supabase.rpc('leave_room_call', { p_room_id: roomId });
        } catch {
          // Ignore cleanup error
        }
      }
      await cleanupCall({
        notifyServer: false,
        nextError: {
          code: 'ICE_CONFIG_ERROR',
          message: err instanceof Error ? err.message : 'Unable to start voice call.',
        },
      });
    }
  }, [
    roomId,
    user.id,
    callSlots,
    fetchIceServers,
    handleIncomingSignal,
    cleanupCall,
    scheduleTurnRefresh,
  ]);

  const leaveCall = useCallback(async () => {
    if (isLeavingRef.current) return;
    isLeavingRef.current = true;
    setIsLeaving(true);
    try {
      await cleanupCall({ notifyServer: true, nextError: null });
    } finally {
      isLeavingRef.current = false;
      setIsLeaving(false);
    }
  }, [cleanupCall]);

  const toggleMute = useCallback(() => {
    if (!isInCallRef.current || isLeavingRef.current || !localStreamRef.current) return;
    const nextMuted = !isMutedRef.current;
    isMutedRef.current = nextMuted;
    setIsMuted(nextMuted);

    for (const track of localStreamRef.current.getAudioTracks()) {
      track.enabled = !nextMuted;
    }

    audioMonitorRef.current?.setMuted('local', nextMuted);
    if (nextMuted) {
      setIsLocalSpeaking(false);
    }

    for (const peerId of peerManagersRef.current.keys()) {
      signalingRef.current?.sendMediaState(peerId, { isMuted: nextMuted });
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const clearCallEndedNotice = useCallback(() => {
    setCallEndedNotice(null);
  }, []);

  const activeRemoteSlots = useMemo(
    () => callSlots.filter((slot) => slot.userId !== user.id && isSlotFresh(slot)),
    [callSlots, user.id]
  );

  const isPeerSpeaking = useMemo(
    () => Object.values(peerSpeakingMap).some(Boolean),
    [peerSpeakingMap]
  );

  const isAudioBlocked = useMemo(
    () => Object.values(blockedAudioPeers).some(Boolean),
    [blockedAudioPeers]
  );

  const connectionMode = useMemo<CallConnectionMode>(() => {
    const modes = activeRemoteSlots
      .map((slot) => peerConnectionModes[slot.userId])
      .filter((m): m is CallConnectionMode => Boolean(m && m !== 'unknown'));

    if (modes.includes('relayed')) return 'relayed';
    if (modes.includes('stun-only')) return 'stun-only';
    if (modes.includes('p2p')) return 'p2p';
    return 'unknown';
  }, [activeRemoteSlots, peerConnectionModes]);

  const status = useMemo<CallStatus>(() => {
    if (isInCall) {
      if (activeRemoteSlots.length === 0) return 'waiting';
      const statuses = activeRemoteSlots.map(
        (slot) => peerStatuses[slot.userId] ?? 'connecting'
      );
      if (statuses.includes('connected')) return 'connected';
      if (statuses.includes('reconnecting')) return 'reconnecting';
      if (statuses.every((s) => s === 'failed')) return 'error';
      return 'connecting';
    }
    if (isJoining) return 'joining';
    if (error) return 'error';
    return 'idle';
  }, [isInCall, activeRemoteSlots, peerStatuses, isJoining, error]);

  const participants = useMemo<CallParticipantState[]>(() => {
    return callSlots
      .filter((slot) => isSlotFresh(slot))
      .map((slot) => {
        const isLocal = slot.userId === user.id;
        const presenceMatch = presenceList.find((p) => p.userId === slot.userId);
        const memberMatch = members.find((m) => m.userId === slot.userId);
        const cached = profileCache[slot.userId];

        const username = isLocal
          ? user.username
          : presenceMatch?.username || memberMatch?.username || cached?.username || 'Watch Partner';

        const peerMode = peerConnectionModes[slot.userId] ?? 'unknown';

        return {
          userId: slot.userId,
          username,
          avatarUrl: presenceMatch?.avatarUrl || cached?.avatarUrl,
          callSessionId: slot.callSessionId,
          isLocal,
          isMuted: isLocal ? isMuted : Boolean(peerMutedMap[slot.userId]),
          isSpeaking: isLocal ? isLocalSpeaking : Boolean(peerSpeakingMap[slot.userId]),
          connectionMode: isLocal
            ? iceMode === 'stun-only'
              ? 'stun-only'
              : connectionMode
            : peerMode,
        };
      });
  }, [
    callSlots,
    user.id,
    user.username,
    presenceList,
    members,
    profileCache,
    isMuted,
    peerMutedMap,
    isLocalSpeaking,
    peerSpeakingMap,
    iceMode,
    connectionMode,
    peerConnectionModes,
  ]);

  const freshSlotCount = useMemo(
    () => callSlots.filter((slot) => isSlotFresh(slot)).length,
    [callSlots]
  );

  const isCallFull = !isInCall && freshSlotCount >= CALL_CONSTANTS.MAX_CALL_PARTICIPANTS;

  const activeCallers = useMemo<CallParticipantState[]>(() => {
    if (isInCall || freshSlotCount === 0 || isCallFull) return [];
    return participants.filter((p) => !p.isLocal);
  }, [isInCall, freshSlotCount, isCallFull, participants]);

  const incomingCaller = useMemo<CallParticipantState | null>(
    () => activeCallers[0] ?? null,
    [activeCallers]
  );

  return {
    status,
    isInCall,
    isLeaving,
    isCallFull,
    isMuted,
    isLocalSpeaking,
    isPeerSpeaking,
    isAudioBlocked,
    iceMode,
    connectionMode,
    error,
    callEndedNotice,
    participants,
    activeCallers,
    incomingCaller,
    joinCall,
    leaveCall,
    toggleMute,
    unlockRemoteAudio,
    clearError,
    clearCallEndedNotice,
  };
}
