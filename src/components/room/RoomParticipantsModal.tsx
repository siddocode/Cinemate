'use client';

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Room, RoomMember, RoomRole, ParticipantPresence } from '@/core/types/room.types';
import { copyTextToClipboard } from '@/lib/utils/share';
import {
  Shield,
  ShieldCheck,
  UserX,
  Sliders,
  Check,
  Copy,
  Loader2,
  AlertCircle,
  PhoneCall,
  Users,
  X,
} from 'lucide-react';

interface RoomParticipantsModalProps {
  isOpen: boolean;
  onClose: () => void;
  room: Room;
  currentUserId: string;
  isHost: boolean;
  members: RoomMember[];
  presenceList?: ParticipantPresence[];
  onUpdateRole: (userId: string, newRole: 'co-host' | 'viewer') => Promise<{ success: boolean; error?: string } | undefined>;
  onKickMember: (userId: string) => Promise<{ success: boolean; error?: string } | undefined>;
  onToggleGuestControl: (allow: boolean) => Promise<{ success: boolean; error?: string } | undefined>;
  onToggleGuestCall?: (allow: boolean) => Promise<{ success: boolean; error?: string } | undefined>;
}

export const RoomParticipantsModal: React.FC<RoomParticipantsModalProps> = ({
  isOpen,
  onClose,
  room,
  currentUserId,
  isHost,
  members,
  presenceList,
  onUpdateRole,
  onKickMember,
  onToggleGuestControl,
  onToggleGuestCall,
}) => {
  const [copied, setCopied] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [toggleLoading, setToggleLoading] = useState(false);
  const [callToggleLoading, setCallToggleLoading] = useState(false);
  const [confirmKickId, setConfirmKickId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleCopyLink = async () => {
    if (typeof window !== 'undefined') {
      const success = await copyTextToClipboard(window.location.href);
      if (success) {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  const handleToggleControl = async () => {
    if (toggleLoading || !isHost) return;
    setToggleLoading(true);
    setActionError(null);
    try {
      const res = await onToggleGuestControl(!room.allowGuestControl);
      if (res && !res.success && res.error) {
        setActionError(res.error);
      }
    } finally {
      setToggleLoading(false);
    }
  };

  const handleToggleGuestCall = async () => {
    if (callToggleLoading || !isHost || !onToggleGuestCall) return;
    setCallToggleLoading(true);
    setActionError(null);
    try {
      const res = await onToggleGuestCall(!room.allowGuestCall);
      if (res && !res.success && res.error) {
        setActionError(res.error);
      }
    } finally {
      setCallToggleLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, currentRole: RoomRole) => {
    if (actionLoadingId || !isHost) return;
    const targetRole = currentRole === 'co-host' ? 'viewer' : 'co-host';
    setActionLoadingId(`role-${userId}`);
    setActionError(null);
    try {
      const res = await onUpdateRole(userId, targetRole);
      if (res && !res.success && res.error) {
        setActionError(res.error);
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleKick = async (userId: string) => {
    if (actionLoadingId || !isHost) return;
    setActionLoadingId(`kick-${userId}`);
    setActionError(null);
    try {
      const res = await onKickMember(userId);
      if (res && !res.success && res.error) {
        setActionError(res.error);
      } else {
        setConfirmKickId(null);
        if (res?.error) {
          setActionError(res.error);
        }
      }
    } finally {
      setActionLoadingId(null);
    }
  };

  // Compile full participant list from members + presence
  const activeUserIds = new Set((presenceList || []).map((p) => p.userId));
  const displayMembers = members.length > 0 ? members : (presenceList || []).map((p) => ({
    id: p.userId,
    roomId: room.id,
    userId: p.userId,
    username: p.username,
    role: p.role,
    joinedAt: new Date(p.joinedAt).toISOString(),
    lastSeenAt: new Date().toISOString(),
  }));

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end pointer-events-none" role="dialog" aria-modal="true">
      {/* Soft non-intrusive backdrop on mobile (tap to close); hidden on desktop so video remains clickable */}
      <div
        className="absolute inset-0 bg-[#071611]/45 backdrop-blur-[1px] transition-opacity drawer-backdrop pointer-events-auto lg:hidden"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Wide cinema slide-over side drawer */}
      <aside className="relative z-10 flex h-full w-full max-w-lg lg:w-[32rem] xl:w-[36rem] lg:max-w-none flex-col border-l border-[#E8DDC5]/16 bg-[#0B1E17] shadow-[-28px_0_72px_rgba(0,0,0,0.65)] drawer-enter pointer-events-auto">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[#E8DDC5]/12 px-4 py-3.5 shrink-0 bg-[#0E281F]">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#9670FF]/35 bg-[#9670FF]/12 text-[#B397FF]">
              <Users className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2 className="font-serif text-lg sm:text-xl font-semibold leading-tight text-[#F7F4EC] truncate">
                Room Members &amp; Permissions
              </h2>
              <p className="text-xs text-[#CDBF9F]/85 truncate mt-0.5">
                Manage participants, playback control authority, and invite links.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1.5 text-[#CDBF9F] hover:bg-[#173D30] hover:text-[#F7F4EC] transition-colors cursor-pointer shrink-0"
            aria-label="Close members panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 space-y-5">
        {actionError && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#2A1215] border border-[#DC2626]/40 text-[13px] text-[#FCA5A5]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#EF4444]" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Host Authority Delegation Controls */}
        <div className="space-y-2.5">
          {/* Shared Playback Controls */}
          <div className="p-3.5 sm:p-4 rounded-xl bg-[#091B15] border border-[#E8DDC5]/14">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[#9670FF]/15 border border-[#9670FF]/40 text-[#B397FF] flex items-center justify-center shrink-0">
                  <Sliders className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h4 className="text-sm font-medium text-[#F7F4EC] truncate">
                    Shared Playback Controls
                  </h4>
                  <p className="text-xs text-[#CDBF9F] leading-tight mt-0.5">
                    {room.allowGuestControl
                      ? 'All members can control video'
                      : 'Host and Co-Hosts only'}
                  </p>
                </div>
              </div>

              {isHost ? (
                <button
                  type="button"
                  onClick={handleToggleControl}
                  disabled={toggleLoading}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                    room.allowGuestControl ? 'bg-[#9670FF]' : 'bg-[#E8DDC5]/25'
                  }`}
                  role="switch"
                  aria-checked={Boolean(room.allowGuestControl)}
                  title="Toggle playback permissions"
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#F7F4EC] shadow-md ring-0 transition duration-200 ease-in-out ${
                      room.allowGuestControl ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              ) : (
                <Badge variant={room.allowGuestControl ? 'success' : 'default'} className="text-xs shrink-0">
                  {room.allowGuestControl ? 'Enabled' : 'Host Only'}
                </Badge>
              )}
            </div>
          </div>

          {/* Voice Call Initiation Permission */}
          {onToggleGuestCall && (
            <div className="p-3.5 sm:p-4 rounded-xl bg-[#091B15] border border-[#E8DDC5]/14">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-[#9670FF]/15 border border-[#9670FF]/40 text-[#B397FF] flex items-center justify-center shrink-0">
                    <PhoneCall className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="text-sm font-medium text-[#F7F4EC] truncate">
                      Voice Call Initiation
                    </h4>
                    <p className="text-xs text-[#CDBF9F] leading-tight mt-0.5">
                      {room.allowGuestCall
                        ? 'All members can start calls'
                        : 'Host and Co-Hosts only'}
                    </p>
                  </div>
                </div>

                {isHost ? (
                  <button
                    type="button"
                    onClick={handleToggleGuestCall}
                    disabled={callToggleLoading}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 ${
                      room.allowGuestCall ? 'bg-[#9670FF]' : 'bg-[#E8DDC5]/25'
                    }`}
                    role="switch"
                    aria-checked={Boolean(room.allowGuestCall)}
                    title="Toggle who can start voice calls"
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[#F7F4EC] shadow-md ring-0 transition duration-200 ease-in-out ${
                        room.allowGuestCall ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                ) : (
                  <Badge variant={room.allowGuestCall ? 'success' : 'default'} className="text-xs shrink-0">
                    {room.allowGuestCall ? 'Enabled' : 'Host Only'}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Room Code & Copy Pill */}
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#E8DDC5] border border-[#E8DDC5] text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-[#102B23] font-semibold text-xs tracking-wider">
              {room.code}
            </span>
            <span className="text-[#173D30]/85 text-xs hidden sm:inline">
              · Invite link ready to share
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCopyLink}
            className="h-7 rounded-full shrink-0"
            leftIcon={
              copied ? (
                <Check className="w-3.5 h-3.5 text-[#7AD3A8]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )
            }
          >
            {copied ? 'Copied' : 'Copy Invite'}
          </Button>
        </div>

        {/* Participants Roster List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-[#F7F4EC] font-medium px-1">
            <span>Participants ({displayMembers.length}/4)</span>
            <span className="text-xs text-[#CDBF9F]/85">Max 4 viewers</span>
          </div>

          <div className="divide-y divide-[#E8DDC5]/10 rounded-xl bg-[#091B15] border border-[#E8DDC5]/14 overflow-hidden">
            {displayMembers.map((member) => {
              const isSelf = member.userId === currentUserId;
              const isRoomHost = member.userId === room.hostId || member.role === 'host';
              const isRestrictedViewer =
                !isRoomHost && Boolean(room.kickedUserIds?.includes(member.userId));
              const isCoHost = !isRestrictedViewer && member.role === 'co-host';
              const isOnline = activeUserIds.has(member.userId);
              const isBusy = actionLoadingId?.includes(member.userId);
              const isConfirmingKick = confirmKickId === member.userId;

              return (
                <div
                  key={member.userId}
                  className="p-3 sm:p-3.5 flex items-center justify-between gap-2.5 text-xs"
                >
                  {/* Left: User Info */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded-full bg-[#173D30] border border-[#E8DDC5]/20 flex items-center justify-center text-[#F7F4EC] font-semibold font-serif text-sm">
                        {member.username.slice(0, 1).toUpperCase()}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#091B15] ${
                          isOnline ? 'bg-[#7AD3A8]' : 'bg-[#CDBF9F]/40'
                        }`}
                        title={isOnline ? 'Online' : 'Offline'}
                      />
                    </div>

                    <div className="min-w-0 flex-1 flex items-center gap-2">
                      <span className="font-medium text-sm text-[#F7F4EC] truncate">
                        {member.username}
                      </span>
                      {isSelf && (
                        <span className="text-xs text-[#CDBF9F]/75 shrink-0 font-medium">
                          (You)
                        </span>
                      )}
                      {isRoomHost ? (
                        <Badge variant="purple" className="py-0.5 px-2 text-[11px] font-medium shrink-0">
                          Host
                        </Badge>
                      ) : isCoHost ? (
                        <Badge variant="success" className="py-0.5 px-2 text-[11px] font-medium shrink-0">
                          Co-Host
                        </Badge>
                      ) : isRestrictedViewer ? (
                        <Badge variant="warning" className="py-0.5 px-2 text-[11px] shrink-0">
                          View-Only
                        </Badge>
                      ) : (
                        <Badge variant="default" className="py-0.5 px-2 text-[11px] text-[#CDBF9F] shrink-0">
                          Viewer
                        </Badge>
                      )}
                      {!isOnline && (
                        <span className="text-[11px] text-[#CDBF9F]/60 shrink-0">
                          Offline
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions (Host only for non-self members) */}
                  {isHost && !isSelf && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isConfirmingKick ? (
                        <div className="flex items-center gap-1.5 bg-[#2A1215] border border-[#DC2626]/40 rounded-lg p-1">
                          <span className="text-xs text-[#FCA5A5] px-1 hidden sm:inline">
                            Kick?
                          </span>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleKick(member.userId)}
                            className="px-2.5 py-1 rounded bg-[#DC2626] hover:bg-[#B91C1C] text-[#F7F4EC] text-xs font-semibold cursor-pointer disabled:opacity-50"
                          >
                            {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Yes, Kick'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmKickId(null)}
                            className="px-2 py-1 text-[#CDBF9F] hover:text-[#F7F4EC] text-xs cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          {/* Co-Host toggle (blocked permanently for previously kicked members) */}
                          {!isRestrictedViewer && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => handleRoleChange(member.userId, member.role)}
                              className="h-7.5 px-2.5 rounded-lg text-xs text-[#E8DDC5] hover:text-[#F7F4EC] bg-[#173D30]/60 hover:bg-[#1E4B3C]"
                              leftIcon={
                                isBusy && actionLoadingId === `role-${member.userId}` ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : isCoHost ? (
                                  <Shield className="w-3.5 h-3.5" />
                                ) : (
                                  <ShieldCheck className="w-3.5 h-3.5 text-[#9670FF]" />
                                )
                              }
                            >
                              <span>
                                {isCoHost ? 'Demote' : 'Make Co-Host'}
                              </span>
                            </Button>
                          )}

                          {/* Kick from room button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => setConfirmKickId(member.userId)}
                            className="h-7.5 px-2 rounded-lg text-xs text-[#E87A70] hover:text-[#FF8E85] hover:bg-[#DC2626]/10"
                            leftIcon={<UserX className="w-3.5 h-3.5 text-[#E87A70]" />}
                            title="Remove participant from room"
                          >
                            <span>Kick</span>
                          </Button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        </div>
      </aside>
    </div>
  );
};

