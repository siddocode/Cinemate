'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Copy,
  Check,
  Tv,
  LogOut,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DuoStatus, Room } from '@/core/types/room.types';

interface RoomHeaderProps {
  room: Room;
  isHost: boolean;
  duoStatus: DuoStatus;
  hostGraceSecondsLeft: number | null;
  onChangeVideoClick: () => void;
}

export const RoomHeader: React.FC<RoomHeaderProps> = ({
  room,
  isHost,
  duoStatus,
  hostGraceSecondsLeft,
  onChangeVideoClick,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyLink = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="shrink-0 flex flex-col border-b border-neutral-800/80 bg-neutral-950/70 backdrop-blur-md">
      {/* Failover Alert Banner if Host Disconnected */}
      {hostGraceSecondsLeft !== null && (
        <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between text-xs text-amber-300">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 animate-bounce" />
            <span>
              <strong>Host disconnected.</strong> Playback paused. Grace period active:
            </span>
          </div>
          <span className="font-mono font-bold bg-amber-500/20 px-2 py-0.5 rounded text-amber-200">
            {hostGraceSecondsLeft}s until auto-failover
          </span>
        </div>
      )}

      {/* Main Header Bar */}
      <div className="h-14 px-4 sm:px-6 flex items-center justify-between gap-3">
        {/* Left: Room Title & Share Code */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-white max-w-[140px] sm:max-w-xs truncate">
              {room.title}
            </h2>
            <span className="text-xs font-mono font-bold bg-neutral-900 border border-neutral-800 px-2 py-0.5 rounded-lg text-indigo-400">
              {room.code}
            </span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyLink}
            className="h-8 text-xs hidden sm:inline-flex"
            leftIcon={
              copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )
            }
          >
            {copied ? 'Link Copied!' : 'Copy Invite'}
          </Button>
        </div>

        {/* Right: Partner Status, Role Badge & Controls */}
        <div className="flex items-center gap-2.5">
          {/* Partner Status Pill */}
          {duoStatus.isPartnerConnected ? (
            <Badge variant="success" dot className="text-xs">
              Partner: {duoStatus.partner?.username || 'Connected'}
            </Badge>
          ) : (
            <button
              onClick={handleCopyLink}
              className="cursor-pointer transition-transform hover:scale-105"
            >
              <Badge variant="warning" dot className="text-xs">
                Waiting for Partner... (Click to Invite)
              </Badge>
            </button>
          )}

          {/* User Role */}
          <Badge
            variant={isHost ? 'purple' : 'default'}
            className="text-xs hidden md:inline-flex"
          >
            {isHost ? '👑 Host' : 'Viewer'}
          </Badge>

          {/* Host Change Video Button */}
          {isHost && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onChangeVideoClick}
              className="h-8 text-xs"
              leftIcon={<Tv className="w-3.5 h-3.5 text-indigo-400" />}
            >
              Change Video
            </Button>
          )}

          {/* Leave Room Button */}
          <Link href="/">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-neutral-400 hover:text-rose-400"
              title="Leave Room"
            >
              <LogOut className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
};
