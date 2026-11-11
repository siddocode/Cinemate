'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Tv, User, Edit2, Check } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export const Navbar: React.FC = () => {
  const { user, setUsername } = useSession();
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [tempName, setTempName] = useState(user.username);

  const handleOpenModal = () => {
    setTempName(user.username);
    setIsNameModalOpen(true);
  };

  const handleSaveName = (e: React.FormEvent) => {
    e.preventDefault();
    if (tempName.trim()) {
      setUsername(tempName.trim());
      setIsNameModalOpen(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-neutral-800/80 bg-neutral-950/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform duration-200">
            <Tv className="w-5 h-5 text-white" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-white via-neutral-200 to-neutral-400 bg-clip-text text-transparent">
                Syncora
              </span>
              <Badge variant="purple" className="text-[10px] px-1.5 py-0 font-medium">
                Duo
              </Badge>
            </div>
            <span className="text-[11px] text-neutral-400 -mt-1 hidden sm:inline">
              Watch Together in Realtime
            </span>
          </div>
        </Link>

        {/* User Identity / Session Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleOpenModal}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-800/60 transition-all text-xs text-neutral-300 group cursor-pointer"
            title="Click to edit display name"
          >
            <div className="w-6 h-6 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <User className="w-3.5 h-3.5" />
            </div>
            <span
              className="font-medium max-w-[120px] truncate text-white"
              suppressHydrationWarning
            >
              {user.username}
            </span>
            <Edit2 className="w-3 h-3 text-neutral-500 group-hover:text-indigo-400 transition-colors" />
          </button>
        </div>
      </div>

      {/* Edit Display Name Modal */}
      <Modal
        isOpen={isNameModalOpen}
        onClose={() => setIsNameModalOpen(false)}
        title="Set Your Display Name"
        description="This is the name your watch partner will see in chat and room presence."
      >
        <form onSubmit={handleSaveName} className="space-y-4">
          <Input
            label="Display Name"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            placeholder="e.g. Alex"
            maxLength={25}
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setIsNameModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              leftIcon={<Check className="w-4 h-4" />}
            >
              Save Name
            </Button>
          </div>
        </form>
      </Modal>
    </header>
  );
};
