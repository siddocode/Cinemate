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
  user,
  presenceList,
  members,
  isRoomReady,
  audioRef,
}: UseCallOptions) {
  const [isJoining, setIsJoining] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isInCall, setIsInCall] = useState(false);
  const [peerStatus, setPeerStatus] = useState<PeerConnectionStatus>('connecting');
  const [isMuted, setIsMuted] = useState(false);
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [isPeerSpeaking, setIsPeerSpeaking] = useState(false);
  const [isPeerMuted, setIsPeerMuted] = useState(false);
  const [isAudioBlocked, setIsAudioBlocked] = useState(false);
  const [iceMode, setIceMode] = useState<'turn' | 'stun-only' | null>(null);
  const [connectionMode, setConnectionMode] = useState<CallConnectionMode>('unknown');
  const [error, setError] = useState<CallError | null>(null);
  const [callSlots, setCallSlots] = useState<CallParticipantSlot[]>([]);
  const [profileCache, setProfileCache] = useState<Record<string, ProfileMeta>>({});

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const signalingRef = useRef<CallSignaling | null>(null);
  const peerManagerRef = useRef<PeerConnectionManager | null>(null);
  const audioMonitorRef = useRef<AudioLevelMonitor | null>(null);

  const isInCallRef = useRef(false);
  const isJoiningRef = useRef(false);
  const isLeavingRef = useRef(false);
  const isMutedRef = useRef(false);
  const iceConfigRef = useRef<CallIceConfig | null>(null);
  const selfSessionIdRef = useRef<string | null>(null);
  const activePeerIdRef = useRef<string | null>(null);
  const activePeerSessionRef = useRef<string | null>(null);
  const peerSubscribedRef = useRef(false);
  const peerHelloReceivedRef = useRef(false);
  const echoedHelloForSessionRef = useRef<string | null>(null);
  const handleMicTrackEndedRef = useRef<() => Promise<void>>(async () => {});
  const scheduleTurnRefreshRef = useRef<(targetRoomId: string, config: CallIceConfig) => void>(
    () => {}
  );

  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const turnRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offerFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slotPruneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const roomIdRef = useRef(roomId);
  const userIdRef = useRef(user.id);
  useEffect(() => {
    roomIdRef.current = roomId;
    userIdRef.current = user.id;
  }, [roomId, user.id]);

  const clearTimers = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    if (turnRefreshTimerRef.current) {
      clearTimeout(turnRefreshTimerRef.current);
      turnRefreshTimerRef.current = null;
    }
    if (offerFallbackTimerRef.current) {
      clearTimeout(offerFallbackTimerRef.current);
      offerFallbackTimerRef.current = null;
    }
  }, []);

  const detachPeerConnection = useCallback(() => {
    if (offerFallbackTimerRef.current) {
      clearTimeout(offerFallbackTimerRef.current);
      offerFallbackTimerRef.current = null;
    }
    if (peerManagerRef.current) {
      peerManagerRef.current.destroy();
      peerManagerRef.current = null;
    }
    if (activePeerIdRef.current) {
      audioMonitorRef.current?.untrackStream(activePeerIdRef.current);
    }
    remoteStreamRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
    }
    activePeerIdRef.current = null;
    activePeerSessionRef.current = null;
    peerSubscribedRef.current = false;
    peerHelloReceivedRef.current = false;
    echoedHelloForSessionRef.current = null;
    setIsPeerSpeaking(false);
    setIsPeerMuted(false);
    setIsAudioBlocked(false);
    setConnectionMode('unknown');
    setPeerStatus('connecting');
  }, [audioRef]);

  const attachRemoteAudio = useCallback((stream: MediaStream) => {
    remoteStreamRef.current = stream;
    const audioEl = audioRef.current;
    if (!audioEl) return;

    audioEl.srcObject = stream;
    const playPromise = audioEl.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          setIsAudioBlocked(false);
        })
        .catch(() => {
          setIsAudioBlocked(true);
        });
    }
  }, [audioRef]);

  const unlockRemoteAudio = useCallback(async () => {
    await audioMonitorRef.current?.resume();
    const audioEl = audioRef.current;
    if (!audioEl) return;
    if (remoteStreamRef.current && audioEl.srcObject !== remoteStreamRef.current) {
      audioEl.srcObject = remoteStreamRef.current;
    }
    try {
      await audioEl.play();
      setIsAudioBlocked(false);
    } catch {
      setIsAudioBlocked(true);
    }
  }, [audioRef]);

  const cleanupCall = useCallback(
    async (options: { notifyServer?: boolean; nextError?: CallError | null } = {}) => {
      const targetRoomId = roomIdRef.current;
      const peerId = activePeerIdRef.current;
      const wasInCall = isInCallRef.current;

      isInCallRef.current = false;
      isJoiningRef.current = false;
      clearTimers();

      if (peerId && signalingRef.current) {
        await signalingRef.current.sendBye(peerId, 'left');
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
      await peerManagerRef.current?.replaceAudioTrack(newTrack);
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
            peerManagerRef.current?.updateIceServers(fresh.iceServers);
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

  // Connect or update the 1:1 PeerConnection whenever partner slot changes while we are in the call
  useEffect(() => {
    if (!isInCall || !roomId || !user.id) return;

    const partnerSlot =
      callSlots.find((s) => s.userId !== user.id && isSlotFresh(s)) ?? null;

    if (!partnerSlot) {
      if (activePeerIdRef.current) {
        detachPeerConnection();
        void signalingRef.current?.setPeer(null);
      }
      return;
    }

    const isAlreadyBoundToPartner =
      activePeerIdRef.current === partnerSlot.userId &&
      activePeerSessionRef.current === partnerSlot.callSessionId &&
      Boolean(peerManagerRef.current);

    if (isAlreadyBoundToPartner) {
      return;
    }

    const iceConfig = iceConfigRef.current;
    const signaling = signalingRef.current;
    const localStream = localStreamRef.current;
    if (!iceConfig || !signaling || !localStream) return;

    detachPeerConnection();
    activePeerIdRef.current = partnerSlot.userId;
    activePeerSessionRef.current = partnerSlot.callSessionId;

    const peerId = partnerSlot.userId;
    const peerSessionId = partnerSlot.callSessionId;
    const isImpolite = user.id > peerId;

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
          attachRemoteAudio(remoteStream);
        },
        onStatusChange: (pcStatus: PeerConnectionStatus) => {
          if (!isInCallRef.current || activePeerIdRef.current !== peerId) return;
          if (pcStatus === 'connected' && offerFallbackTimerRef.current) {
            clearTimeout(offerFallbackTimerRef.current);
            offerFallbackTimerRef.current = null;
          }
          setPeerStatus(pcStatus);
        },
        onConnectionModeChange: (mode) => {
          if (isInCallRef.current && activePeerIdRef.current === peerId) {
            setConnectionMode(mode);
          }
        },
        onError: (callErr) => {
          if (!isInCallRef.current) return;
          setError(callErr);
          if (callErr.code === 'CONNECTION_FAILED') {
            setPeerStatus('failed');
          }
        },
      },
    });

    peerManagerRef.current = pcMgr;
    pcMgr.setLocalStream(localStream);

    void signaling.setPeer(peerId, peerSessionId);

    // Fallback: if impolite peer hasn't heard partner's hello within 1.5s, initiate offer anyway
    if (isImpolite) {
      offerFallbackTimerRef.current = setTimeout(() => {
        offerFallbackTimerRef.current = null;
        if (
          isInCallRef.current &&
          activePeerIdRef.current === peerId &&
          !peerHelloReceivedRef.current &&
          peerManagerRef.current === pcMgr
        ) {
          void pcMgr.createAndSendOffer();
        }
      }, 1500);
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

      peerManagerRef.current?.triggerIceRestart();
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
      if (!isInCallRef.current || activePeerIdRef.current !== fromUserId) {
        return;
      }

      if (signal.event === 'bye') {
        detachPeerConnection();
        return;
      }

      if (signal.event === 'media-state') {
        const firstHello = !peerHelloReceivedRef.current;
        peerHelloReceivedRef.current = true;
        setIsPeerMuted(signal.mediaState.isMuted);
        audioMonitorRef.current?.setMuted(fromUserId, signal.mediaState.isMuted);

        const signaling = signalingRef.current;
        const pcMgr = peerManagerRef.current;

        // Echo our mute state once so the remote peer knows our inbox is subscribed
        if (firstHello && echoedHelloForSessionRef.current !== signal.callSessionId) {
          echoedHelloForSessionRef.current = signal.callSessionId;
          signaling?.sendMediaState(fromUserId, { isMuted: isMutedRef.current });
        }

        // Impolite peer initiates or resends its pending offer once peer inbox is proven live
        if (pcMgr && userIdRef.current > fromUserId) {
          const pendingOffer = pcMgr.getPendingOffer();
          if (pendingOffer) {
            signaling?.sendOffer(fromUserId, pendingOffer);
          } else if (firstHello) {
            void pcMgr.createAndSendOffer();
          }
        }
        return;
      }

      void peerManagerRef.current?.handleSignal(signal);
    },
    [detachPeerConnection]
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

    isJoiningRef.current = true;
    setIsJoining(true);
    setError(null);

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

      // 2. Atomically reserve 1 of the 2 server-side voice call slots
      const { data: slotRows, error: rpcError } = await supabase.rpc('join_room_call', {
        p_room_id: roomId,
      });

      if (rpcError || !Array.isArray(slotRows)) {
        stopMediaStream(micStream);
        const msg = rpcError?.message || 'Unable to join voice call.';
        const code: CallErrorCode = /full/i.test(msg)
          ? 'CALL_FULL'
          : /member/i.test(msg)
          ? 'NOT_ROOM_MEMBER'
          : 'SIGNALING_ERROR';
        setError({
          code,
          message: code === 'CALL_FULL' ? 'Voice call is full (2/2 participants active).' : msg,
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
      setPeerStatus('connecting');

      // 4. Initialize speaking monitor & anti-spoofing Realtime signaling outbox
      const monitor = new AudioLevelMonitor((key, speaking) => {
        if (key === 'local') {
          setIsLocalSpeaking(speaking);
        } else if (key === activePeerIdRef.current) {
          setIsPeerSpeaking(speaking);
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
          peerSubscribedRef.current = true;
          signaling.sendMediaState(peerId, { isMuted: isMutedRef.current });
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

    if (activePeerIdRef.current) {
      signalingRef.current?.sendMediaState(activePeerIdRef.current, { isMuted: nextMuted });
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const hasPartnerSlot = useMemo(
    () => callSlots.some((slot) => slot.userId !== user.id && isSlotFresh(slot)),
    [callSlots, user.id]
  );

  const status = useMemo<CallStatus>(() => {
    if (isInCall) {
      if (!hasPartnerSlot) return 'waiting';
      if (peerStatus === 'failed') return 'error';
      return peerStatus;
    }
    if (isJoining) return 'joining';
    if (error) return 'error';
    return 'idle';
  }, [isInCall, hasPartnerSlot, peerStatus, isJoining, error]);

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

        return {
          userId: slot.userId,
          username,
          avatarUrl: presenceMatch?.avatarUrl || cached?.avatarUrl,
          callSessionId: slot.callSessionId,
          isLocal,
          isMuted: isLocal ? isMuted : isPeerMuted,
          isSpeaking: isLocal ? isLocalSpeaking : isPeerSpeaking,
          connectionMode: isLocal
            ? iceMode === 'stun-only'
              ? 'stun-only'
              : connectionMode
            : connectionMode,
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
    isPeerMuted,
    isLocalSpeaking,
    isPeerSpeaking,
    iceMode,
    connectionMode,
  ]);

  const freshSlotCount = useMemo(
    () => callSlots.filter((slot) => isSlotFresh(slot)).length,
    [callSlots]
  );

  const isCallFull = !isInCall && freshSlotCount >= CALL_CONSTANTS.MAX_CALL_PARTICIPANTS;

  const incomingCaller = useMemo<CallParticipantState | null>(() => {
    if (isInCall || freshSlotCount !== 1) return null;
    return participants.find((p) => !p.isLocal) ?? null;
  }, [isInCall, freshSlotCount, participants]);

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
    participants,
    incomingCaller,
    joinCall,
    leaveCall,
    toggleMute,
    unlockRemoteAudio,
    clearError,
  };
}
