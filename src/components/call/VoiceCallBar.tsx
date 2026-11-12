'use client';

import React, { useState } from 'react';
import {
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Volume2,
  AlertCircle,
  Headphones,
  Loader2,
  X,
  RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/lib/utils/cn';
import {
  CallConnectionMode,
  CallError,
  CallParticipantState,
  CallStatus,
} from '@/core/types/call.types';

export interface VoiceCallBarProps {
  variant?: 'sidebar' | 'banner';
  status: CallStatus;
  isInCall: boolean;
  isLeaving?: boolean;
  isCallFull: boolean;
  isMuted: boolean;
  isAudioBlocked: boolean;
  iceMode: 'turn' | 'stun-only' | null;
  connectionMode: CallConnectionMode;
  error: CallError | null;
  participants: CallParticipantState[];
  incomingCaller: CallParticipantState | null;
  onJoin: () => void;
  onLeave: () => void;
  onToggleMute: () => void;
  onUnlockAudio: () => Promise<void> | void;
  onClearError: () => void;
  className?: string;
}

function getStatusMeta(
  status: CallStatus,
  connectionMode: CallConnectionMode
): { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'purple' } {
  switch (status) {
    case 'joining':
      return { label: 'Accessing mic…', variant: 'purple' };
    case 'waiting':
      return { label: 'Waiting for friend (1/2)', variant: 'warning' };
    case 'connecting':
      return { label: 'Connecting audio…', variant: 'purple' };
    case 'reconnecting':
      return { label: 'Reconnecting…', variant: 'warning' };
    case 'connected':
      if (connectionMode === 'relayed') {
        return { label: 'Live · Relayed', variant: 'success' };
      }
      if (connectionMode === 'stun-only') {
        return { label: 'Live · STUN', variant: 'success' };
      }
      return { label: 'Live · P2P', variant: 'success' };
    case 'error':
      return { label: 'Voice issue', variant: 'danger' };
    default:
      return { label: 'Voice ready', variant: 'default' };
  }
}

export const VoiceCallBar: React.FC<VoiceCallBarProps> = ({
  variant = 'sidebar',
  status,
  isInCall,
  isLeaving = false,
  isCallFull,
  isMuted,
  isAudioBlocked,
  iceMode,
  connectionMode,
  error,
  participants,
  incomingCaller,
  onJoin,
  onLeave,
  onToggleMute,
  onUnlockAudio,
  onClearError,
  className,
}) => {
  const [hideHeadphoneTip, setHideHeadphoneTip] = useState(false);
  const [isUnlockingAudio, setIsUnlockingAudio] = useState(false);

  const isJoining = status === 'joining';
  const isBusy = isJoining || isLeaving;

  const handleUnlockAudio = async () => {
    if (isUnlockingAudio || isBusy) return;
    setIsUnlockingAudio(true);
    try {
      await onUnlockAudio();
    } finally {
      setIsUnlockingAudio(false);
    }
  };

  const shouldRender =
    isInCall ||
    status === 'joining' ||
    Boolean(incomingCaller) ||
    isCallFull ||
    Boolean(error);

  if (!shouldRender) {
    return null;
  }

  const statusMeta = getStatusMeta(status, connectionMode);

  return (
    <div
      className={cn(
        'shrink-0 border-b border-[#E8DDC5]/12 bg-[#0E281F]/95 text-[#F7F4EC]',
        variant === 'sidebar' ? 'px-3.5 py-2.5 space-y-2' : 'px-3 sm:px-6 py-2 space-y-2',
        className
      )}
    >
      {/* Error State */}
      {error && (
        <div className="flex items-start justify-between gap-2 rounded-xl bg-[#331B1A] border border-[#E87A70]/35 px-3 py-2 text-xs text-[#F2B8B2]">
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-3.5 h-3.5 text-[#E87A70] shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="leading-snug break-words">{error.message}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {error.code !== 'CALL_FULL' && !isInCall && (
              <button
                type="button"
                onClick={onJoin}
                disabled={isBusy}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[#4B2623] hover:bg-[#5E2F2B] text-[11px] font-medium text-[#F7F4EC] cursor-pointer transition-colors disabled:opacity-50 disabled:pointer-events-none"
              >
                {isJoining ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <RefreshCw className="w-3 h-3" />
                )}
                {isJoining ? 'Joining…' : 'Retry'}
              </button>
            )}
            <button
              type="button"
              onClick={onClearError}
              disabled={isBusy}
              className="p-1 rounded-md hover:bg-[#E8DDC5]/10 text-[#F2B8B2]/80 hover:text-[#F7F4EC] cursor-pointer disabled:opacity-45 disabled:pointer-events-none"
              aria-label="Dismiss voice error"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Partner Already Waiting in Call (Incoming / Join CTA) */}
      {!isInCall && !isJoining && incomingCaller && (
        <div className="flex items-center justify-between gap-2.5 rounded-xl bg-[#133528]/90 border border-[#7AD3A8]/30 px-3 py-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7AD3A8] opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#7AD3A8]" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-medium text-[#F7F4EC] truncate">
                {incomingCaller.username} is on voice
              </p>
              <p className="text-[10px] font-mono text-[#9FE2BF]/85">
                1/2 slot open · Voice only
              </p>
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={onJoin}
            isLoading={isJoining}
            disabled={isBusy}
            className="h-7 px-3 text-[11px] rounded-full shrink-0"
            leftIcon={<PhoneCall className="w-3 h-3" />}
          >
            {isJoining ? 'Joining…' : 'Join Voice'}
          </Button>
        </div>
      )}

      {/* Call Full (2/2) for 3rd/4th room members */}
      {isCallFull && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-[#133227] border border-[#E8DDC5]/14 px-3 py-1.5 text-[11px] text-[#CDBF9F]">
          <div className="flex items-center gap-2 min-w-0 truncate">
            <Headphones className="w-3.5 h-3.5 text-[#9670FF] shrink-0" />
            <span className="truncate">
              On voice:{' '}
              <strong className="text-[#E8DDC5] font-medium">
                {participants.map((p) => p.username).join(' & ') || '2 participants'}
              </strong>
            </span>
          </div>
          <Badge variant="default" className="text-[10px] shrink-0">
            Voice Full 2/2
          </Badge>
        </div>
      )}

      {/* Active / Joining Voice Call Strip */}
      {(isInCall || status === 'joining') && (
        <div className="rounded-xl bg-[#133227] border border-[#E8DDC5]/16 p-2.5 space-y-2">
          {/* Status + Primary Call Controls */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
              <Badge
                variant={statusMeta.variant}
                dot={status !== 'joining'}
                className="text-[10px] py-0.5 px-2 whitespace-nowrap"
              >
                {status === 'joining' && (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                )}
                {statusMeta.label}
              </Badge>

              {iceMode === 'stun-only' && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-[#292214] border border-[#E9B872]/30 text-[#F0C987]"
                  title="STUN-only dev mode: configure Cloudflare TURN env vars for production mobile/NAT networks"
                >
                  STUN-only Dev
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {isInCall && (
                <Button
                  variant={isMuted ? 'danger' : 'secondary'}
                  size="sm"
                  onClick={onToggleMute}
                  disabled={isBusy}
                  className="h-7 px-2.5 text-[11px] rounded-full"
                  leftIcon={
                    isMuted ? (
                      <MicOff className="w-3 h-3" />
                    ) : (
                      <Mic className="w-3 h-3 text-[#7AD3A8]" />
                    )
                  }
                  aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
                >
                  {isMuted ? 'Muted' : 'Mute'}
                </Button>
              )}

              <Button
                variant="danger"
                size="sm"
                onClick={onLeave}
                isLoading={isLeaving}
                disabled={isJoining || isLeaving}
                className="h-7 px-2.5 text-[11px] rounded-full"
                leftIcon={<PhoneOff className="w-3 h-3" />}
                aria-label="Leave voice call"
              >
                {isLeaving ? 'Leaving…' : 'Leave'}
              </Button>
            </div>
          </div>

          {/* Participant Chips with Live Speaking Rings */}
          {participants.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              {participants.map((participant) => {
                const initial = (participant.username || '?').trim().charAt(0).toUpperCase();
                return (
                  <div
                    key={participant.userId}
                    className={cn(
                      'flex items-center gap-2 px-2.5 py-1 rounded-full border text-xs transition-all duration-150 min-w-0 max-w-full',
                      participant.isSpeaking
                        ? 'bg-[#173D30] border-[#7AD3A8]/65 shadow-[0_0_12px_rgba(122,211,168,0.22)]'
                        : 'bg-[#0E281F]/90 border-[#E8DDC5]/14'
                    )}
                  >
                    <span
                      className={cn(
                        'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 transition-shadow',
                        participant.isSpeaking
                          ? 'bg-[#7AD3A8] text-[#091B15] ring-2 ring-[#7AD3A8]/45'
                          : 'bg-[#1E4D3C] text-[#E8DDC5]'
                      )}
                    >
                      {initial}
                    </span>
                    <span className="truncate text-[11px] font-medium text-[#F7F4EC] max-w-[110px]">
                      {participant.isLocal ? 'You' : participant.username}
                    </span>
                    {participant.isMuted ? (
                      <MicOff
                        className="w-3 h-3 text-[#E87A70] shrink-0"
                        aria-label="Microphone muted"
                      />
                    ) : participant.isSpeaking ? (
                      <span
                        className="flex items-end gap-0.5 h-2.5 shrink-0"
                        aria-label="Speaking"
                      >
                        <span className="w-0.5 h-1.5 bg-[#7AD3A8] rounded-full animate-pulse" />
                        <span className="w-0.5 h-2.5 bg-[#7AD3A8] rounded-full animate-pulse" />
                        <span className="w-0.5 h-1 bg-[#7AD3A8] rounded-full animate-pulse" />
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}

          {/* Browser Autoplay Recovery CTA */}
          {isAudioBlocked && (
            <Button
              variant="accent"
              size="sm"
              onClick={() => void handleUnlockAudio()}
              isLoading={isUnlockingAudio}
              disabled={isBusy}
              className="w-full h-7 text-[11px] rounded-lg"
              leftIcon={<Volume2 className="w-3.5 h-3.5" />}
            >
              {isUnlockingAudio ? 'Enabling audio…' : 'Tap to enable partner audio'}
            </Button>
          )}

          {/* Subtle Headphones Echo Tip (sidebar only, dismissible) */}
          {variant === 'sidebar' && status === 'connected' && !hideHeadphoneTip && (
            <div className="flex items-center justify-between gap-2 text-[10px] text-[#CDBF9F]/70 pt-0.5">
              <span className="flex items-center gap-1.5 truncate">
                <Headphones className="w-3 h-3 text-[#9670FF] shrink-0" />
                <span className="truncate">Use headphones to prevent movie audio echo</span>
              </span>
              <button
                type="button"
                onClick={() => setHideHeadphoneTip(true)}
                className="text-[#CDBF9F]/55 hover:text-[#F7F4EC] cursor-pointer shrink-0"
                aria-label="Dismiss headphones tip"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

