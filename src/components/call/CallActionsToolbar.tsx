'use client';

import React, { useState, useEffect } from 'react';
import {
  Mic,
  MicOff,
  Video,
  ScreenShare,
  Users,
  PhoneOff,
  PhoneCall,
  Loader2,
} from 'lucide-react';
import { CallParticipantState, CallStatus } from '@/core/types/call.types';
import { cn } from '@/lib/utils/cn';

export interface CallActionsToolbarProps {
  isHost?: boolean;
  status: CallStatus;
  isInCall: boolean;
  isLeaving?: boolean;
  isCallFull: boolean;
  canStartCall?: boolean;
  isMuted: boolean;
  isLocalSpeaking: boolean;
  isPeerSpeaking: boolean;
  incomingCaller: CallParticipantState | null;
  participants: CallParticipantState[];
  callJoinNotice?: { username: string; timestamp: number } | null;
  canControl?: boolean;
  onJoinCall: () => void;
  onLeaveCall: () => Promise<void> | void;
  onToggleMute: () => void;
  onOpenParticipants?: () => void;
  onChangeVideo?: () => void;
  className?: string;
}

export const CallActionsToolbar: React.FC<CallActionsToolbarProps> = ({
  isHost = false,
  status,
  isInCall,
  isLeaving = false,
  isCallFull,
  canStartCall = true,
  isMuted,
  isLocalSpeaking,
  isPeerSpeaking,
  incomingCaller,
  participants,
  callJoinNotice,
  canControl = false,
  onJoinCall,
  onLeaveCall,
  onToggleMute,
  onOpenParticipants,
  onChangeVideo,
  className,
}) => {
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auto-clear toast after 3 seconds
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  const isJoining = status === 'joining';
  const isBusy = isJoining || isLeaving;
  const isSpeaking = isLocalSpeaking || isPeerSpeaking;

  const handleCameraClick = () => {
    setToastMessage('Audio-only mesh active. Video camera is disabled to save bandwidth and prevent movie lag.');
  };

  const handleScreenShareClick = () => {
    if (canControl && onChangeVideo) {
      onChangeVideo();
    } else {
      setToastMessage(
        canControl
          ? 'Screen & video streams can be loaded via the Media source tab.'
          : 'Screen sharing and video selection are controlled by the room host.'
      );
    }
  };

  return (
    <div className={cn('relative w-full flex flex-col items-center justify-center py-1 px-2', className)}>
      {/* Temporary Call Notice inside the call interface */}
      {callJoinNotice && (
        <div className="mb-1 px-2.5 py-0.5 rounded-full bg-[#133528]/95 border border-[#7AD3A8]/40 shadow-md text-[11px] text-[#7AD3A8] flex items-center gap-1.5 animate-cinemaFadeUp">
          <PhoneCall className="w-3 h-3 text-[#7AD3A8] animate-pulse" />
          <span>
            <strong className="font-semibold text-[#F7F4EC]">{callJoinNotice.username}</strong> joined the voice call
          </span>
        </div>
      )}

      {/* Floating brief feedback toast */}
      {toastMessage && (
        <div className="absolute -top-7 z-30 px-2.5 py-0.5 rounded-full bg-[#102B23]/95 border border-[#E8DDC5]/20 text-[10px] text-[#E8DDC5] shadow-lg text-center truncate max-w-[90%] animate-cinemaFadeUp">
          {toastMessage}
        </div>
      )}

      {/* Dedicated Responsive Toolbar Row (Compact & Space-Optimized for Chat) */}
      <div className="w-full max-w-xs flex items-center justify-center gap-2.5 sm:gap-3">
        {/* 1. Microphone Toggle / Join */}
        <button
          type="button"
          onClick={isInCall ? onToggleMute : onJoinCall}
          disabled={isBusy || (!isInCall && canStartCall === false)}
          className={cn(
            'w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:pointer-events-none active:scale-95 shrink-0',
            isInCall
              ? isMuted
                ? 'bg-[#331B1A] border border-[#E87A70]/50 text-[#F2B8B2] hover:bg-[#432321]'
                : isSpeaking
                ? 'bg-[#173D30] border border-[#7AD3A8]/70 text-[#7AD3A8] ring-2 ring-[#7AD3A8]/60 shadow-[0_0_12px_rgba(122,211,168,0.35)]'
                : 'bg-[#173D30] border border-[#7AD3A8]/35 text-[#7AD3A8] hover:bg-[#1E4D3C]'
              : 'bg-[#173D30]/90 border border-[#E8DDC5]/18 text-[#E8DDC5] hover:bg-[#1E4D3C] hover:text-[#F7F4EC]'
          )}
          title={
            isInCall
              ? isMuted
                ? 'Unmute microphone'
                : 'Mute microphone'
              : 'Join voice call'
          }
          aria-label={
            isInCall
              ? isMuted
                ? 'Unmute microphone'
                : 'Mute microphone'
              : 'Join voice call'
          }
        >
          {isJoining ? (
            <Loader2 className="w-4 h-4 animate-spin text-[#9670FF]" />
          ) : isInCall ? (
            isMuted ? (
              <MicOff className="w-4 h-4 text-[#F2B8B2]" />
            ) : (
              <Mic className="w-4 h-4 text-[#7AD3A8]" />
            )
          ) : (
            <Mic className="w-4 h-4 text-[#E8DDC5]" />
          )}
        </button>

        {/* 2. Video / Camera Action */}
        <button
          type="button"
          onClick={handleCameraClick}
          className="w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full bg-[#173D30]/90 border border-[#E8DDC5]/18 text-[#E8DDC5] hover:bg-[#1E4D3C] hover:text-[#F7F4EC] flex items-center justify-center transition-all duration-150 cursor-pointer active:scale-95 shrink-0"
          title="Camera video (audio-only cinema mode)"
          aria-label="Toggle camera video"
        >
          <Video className="w-4 h-4 text-[#E8DDC5]" />
        </button>

        {/* 3. Screen Sharing Action */}
        <button
          type="button"
          onClick={handleScreenShareClick}
          className="w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full bg-[#173D30]/90 border border-[#E8DDC5]/18 text-[#E8DDC5] hover:bg-[#1E4D3C] hover:text-[#F7F4EC] flex items-center justify-center transition-all duration-150 cursor-pointer active:scale-95 shrink-0"
          title={canControl ? 'Load video or direct stream' : 'Screen & video source'}
          aria-label="Screen sharing or video source"
        >
          <ScreenShare className="w-4 h-4 text-[#E8DDC5]" />
        </button>

        {/* 4. Call / Room Participants Quick Trigger */}
        <button
          type="button"
          onClick={onOpenParticipants}
          className="relative w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full bg-[#173D30]/90 border border-[#E8DDC5]/18 text-[#E8DDC5] hover:bg-[#1E4D3C] hover:text-[#F7F4EC] flex items-center justify-center transition-all duration-150 cursor-pointer active:scale-95 shrink-0"
          title="View participants and permissions"
          aria-label="View room and call participants"
        >
          <Users className="w-4 h-4 text-[#E8DDC5]" />
          {participants.length > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#9670FF] text-[#091B15] text-[9px] font-mono font-bold flex items-center justify-center shadow-md">
              {participants.length}
            </span>
          )}
        </button>

        {/* 5. End Call / Join Call Primary Button */}
        {isInCall ? (
          <button
            type="button"
            onClick={() => void onLeaveCall()}
            disabled={isLeaving}
            className="w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full bg-[#DC2626] hover:bg-[#B91C1C] text-white shadow-[0_2px_12px_rgba(220,38,38,0.4)] flex items-center justify-center transition-all duration-150 cursor-pointer disabled:opacity-50 active:scale-95 shrink-0"
            title={isHost ? 'End voice call for everyone' : 'Leave voice call'}
            aria-label={isHost ? 'End voice call for everyone' : 'Leave voice call'}
          >
            {isLeaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <PhoneOff className="w-4 h-4" />
            )}
          </button>
        ) : (
          <button
            type="button"
            onClick={onJoinCall}
            disabled={isBusy || canStartCall === false || isCallFull}
            className={cn(
              'w-9 h-9 sm:w-9.5 sm:h-9.5 rounded-full flex items-center justify-center transition-all duration-150 cursor-pointer disabled:opacity-50 disabled:pointer-events-none active:scale-95 shrink-0',
              incomingCaller || participants.length > 0
                ? 'bg-[#7235A8] hover:bg-[#8342be] text-white shadow-[0_2px_12px_rgba(114,53,168,0.45)]'
                : 'bg-[#173D30] hover:bg-[#1E4D3C] text-[#7AD3A8] border border-[#7AD3A8]/40'
            )}
            title={
              isCallFull
                ? 'Voice call full'
                : canStartCall === false
                ? 'Host starts voice'
                : 'Join voice call'
            }
            aria-label="Join voice call"
          >
            {isJoining ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#F7F4EC]" />
            ) : (
              <PhoneCall className={cn('w-4 h-4', incomingCaller && 'animate-pulse')} />
            )}
          </button>
        )}
      </div>
    </div>
  );
};
