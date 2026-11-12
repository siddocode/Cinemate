'use client';

import React, { useState } from 'react';
import { Modal } from '@/components/ui/Modal';
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
  Crown,
  Loader2,
  AlertCircle,
  PhoneCall,
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Room Members &amp; Permissions"
      description="Manage room participants, playback control authority, and membership."
    >
      <div className="space-y-6">
        {actionError && (
          <div className="flex items-start gap-2.5 p-3 rounded-xl bg-[#2A1215] border border-[#DC2626]/40 text-xs text-[#FCA5A5]">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-[#EF4444]" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Host Authority Delegation Controls */}
        <div className="space-y-2.5">
          {/* Shared Playback Controls */}
          <div className="p-4 rounded-xl bg-[#091B15] border border-[#E8DDC5]/14">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-[#9670FF]/15 border border-[#9670FF]/40 text-[#B397FF] flex items-center justify-center shrink-0">
                  <Sliders className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs sm:text-sm font-medium text-[#F7F4EC]">
                    Shared Playback Controls
                  </h4>
                  <p className="text-[11px] text-[#CDBF9F] leading-tight mt-0.5">
                    {room.allowGuestControl
                      ? 'All participants can play, pause, seek, and change video'
                      : 'Restricted: Only Host and Co-Hosts can control video'}
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
                <Badge variant={room.allowGuestControl ? 'success' : 'default'} className="text-[10px]">
                  {room.allowGuestControl ? 'Enabled' : 'Host Only'}
                </Badge>
              )}
            </div>
          </div>

          {/* Voice Call Initiation Permission */}
          {onToggleGuestCall && (
            <div className="p-4 rounded-xl bg-[#091B15] border border-[#E8DDC5]/14">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#9670FF]/15 border border-[#9670FF]/40 text-[#B397FF] flex items-center justify-center shrink-0">
                    <PhoneCall className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs sm:text-sm font-medium text-[#F7F4EC]">
                      Voice Call Initiation
                    </h4>
                    <p className="text-[11px] text-[#CDBF9F] leading-tight mt-0.5">
                      {room.allowGuestCall
                        ? 'All participants can start a new voice call'
                        : 'Restricted: Only Host and Co-Hosts can start calls (others can join)'}
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
                  <Badge variant={room.allowGuestCall ? 'success' : 'default'} className="text-[10px]">
                    {room.allowGuestCall ? 'Enabled' : 'Host Only'}
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Room Code & Copy Pill */}
        <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-[#DFD2B4]/30 border border-[#CDBF9F]/30 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[#102B23] font-semibold text-xs tracking-wider">
              {room.code}
            </span>
            <span className="text-[#173D30]/70 text-[11px] hidden sm:inline">
              · Invite link ready to share
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="h-7 text-xs rounded-full"
            leftIcon={
              copied ? (
                <Check className="w-3.5 h-3.5 text-[#15803D]" />
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
          <div className="flex items-center justify-between text-xs text-[#173D30]/80 font-medium px-1">
            <span>Participants ({displayMembers.length}/4)</span>
            <span className="text-[11px] text-[#173D30]/60">Max 4 viewers</span>
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
                  className="p-3 sm:p-3.5 flex items-center justify-between gap-3 text-xs"
                >
                  {/* Left: User Info */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="relative shrink-0">
                      <div className="w-8 h-8 rounded-full bg-[#173D30] border border-[#E8DDC5]/20 flex items-center justify-center text-[#F7F4EC] font-semibold font-serif">
                        {member.username.slice(0, 1).toUpperCase()}
                      </div>
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-[#091B15] ${
                          isOnline ? 'bg-[#7AD3A8]' : 'bg-[#CDBF9F]/40'
                        }`}
                        title={isOnline ? 'Online' : 'Offline'}
                      />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-[#F7F4EC] truncate max-w-[130px] sm:max-w-[180px]">
                          {member.username}
                        </span>
                        {isSelf && (
                          <span className="text-[10px] font-mono text-[#CDBF9F]/80">
                            (You)
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {isRoomHost ? (
                          <Badge variant="purple" dot className="text-[9px] py-0 px-1.5">
                            <Crown className="w-2.5 h-2.5 mr-0.5" />
                            Host
                          </Badge>
                        ) : isCoHost ? (
                          <Badge variant="success" dot className="text-[9px] py-0 px-1.5">
                            <ShieldCheck className="w-2.5 h-2.5 mr-0.5" />
                            Co-Host
                          </Badge>
                        ) : isRestrictedViewer ? (
                          <Badge variant="warning" className="text-[9px] py-0 px-1.5">
                            View-Only (Previously Kicked)
                          </Badge>
                        ) : (
                          <Badge variant="default" className="text-[9px] py-0 px-1.5 text-[#CDBF9F]">
                            Viewer
                          </Badge>
                        )}
                        <span className="text-[10px] text-[#CDBF9F]/60">
                          {isOnline ? 'Connected' : 'Offline'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions (Host only for non-self members) */}
                  {isHost && !isSelf && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isConfirmingKick ? (
                        <div className="flex items-center gap-1 bg-[#2A1215] border border-[#DC2626]/40 rounded-lg p-1">
                          <span className="text-[10px] text-[#FCA5A5] px-1 hidden sm:inline">
                            Kick?
                          </span>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleKick(member.userId)}
                            className="px-2 py-1 rounded bg-[#DC2626] hover:bg-[#B91C1C] text-[#F7F4EC] text-[10px] font-semibold cursor-pointer disabled:opacity-50"
                          >
                            {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Yes, Kick'}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setConfirmKickId(null)}
                            className="px-1.5 py-1 text-[#CDBF9F] hover:text-[#F7F4EC] text-[10px] cursor-pointer"
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
                              className="h-7 text-[11px] px-2 rounded-lg text-[#CDBF9F] hover:text-[#F7F4EC]"
                              leftIcon={
                                isBusy && actionLoadingId === `role-${member.userId}` ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : isCoHost ? (
                                  <Shield className="w-3 h-3" />
                                ) : (
                                  <ShieldCheck className="w-3 h-3 text-[#9670FF]" />
                                )
                              }
                            >
                              <span className="hidden sm:inline">
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
                            className="h-7 text-[11px] px-2 rounded-lg text-[#E87A70] hover:text-[#FF8E85] hover:bg-[#DC2626]/10"
                            leftIcon={<UserX className="w-3 h-3 text-[#E87A70]" />}
                            title="Remove participant from room"
                          >
                            <span className="hidden sm:inline">Kick</span>
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

        {/* Footer Note */}
        <p className="text-[11px] text-[#173D30]/65 text-center leading-relaxed">
          Kicked participants are disconnected immediately. If they rejoin, they are permanently locked to view-only access (no Co-Host or Shared Controls).
        </p>
      </div>
    </Modal>
  );
};

