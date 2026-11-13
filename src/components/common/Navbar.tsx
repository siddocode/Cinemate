'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, LogIn, LogOut, Check } from 'lucide-react';
import { useSession } from '@/hooks/useSession';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { AuthModal } from '@/components/auth/AuthModal';
import { BrandMark } from '@/components/common/BrandMark';

export const Navbar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isAuthenticated, setUsername, signOut } = useSession();
  const [isNameModalOpen, setIsNameModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [tempName, setTempName] = useState(user.username || '');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const isAuthRoute =
    pathname === '/login' || pathname === '/register' || pathname === '/auth';
  const isRoomRoute = pathname?.startsWith('/room/');

  const handleOpenNameModal = () => {
    if (isSigningOut) return;
    setTempName(user.username || '');
    setIsNameModalOpen(true);
  };

  const handleSaveName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingName) return;
    const trimmed = tempName.trim();
    if (!trimmed) return;

    setIsSavingName(true);
    try {
      await setUsername(trimmed);
      setIsNameModalOpen(false);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleOpenAuth = (tab: 'signin' | 'signup') => {
    setAuthTab(tab);
    setIsAuthModalOpen(true);
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      if (typeof window !== 'undefined') {
        window.location.replace('/login');
      } else {
        router.push('/login');
      }
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#E8DDC5]/12 bg-[#0E281F]/95 backdrop-blur-sm">
      <div
        className={`${
          isRoomRoute ? 'max-w-full' : 'max-w-7xl'
        } mx-auto px-2.5 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-2 sm:gap-4`}
      >
        {/* Brand Logo */}
        <Link href="/" className="flex items-center gap-2 sm:gap-2.5 group min-w-0 shrink">
          <BrandMark size="sm" className="group-hover:border-[#9670FF] shrink-0" />
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <span className="font-serif text-lg sm:text-2xl font-medium tracking-tight text-[#F7F4EC] leading-none truncate">
              Syncora
            </span>
            <span
              className={`${
                isRoomRoute ? 'hidden sm:inline-flex' : 'inline-flex'
              } items-center px-2 sm:px-2.5 py-0.5 rounded-full bg-[#E8DDC5] text-[#102B23] text-[11px] font-bold uppercase tracking-[0.12em] leading-tight shrink-0`}
            >
              Lounge
            </span>
          </div>
        </Link>

        {/* User Identity / Session Controls */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
          {!isAuthenticated ? (
            isAuthRoute ? (
              <>
                <Link href="/login">
                  <Button
                    variant={pathname === '/register' ? 'outline' : 'secondary'}
                    size="sm"
                    className="rounded-full px-2.5 sm:px-3.5"
                    leftIcon={<LogIn className="w-3.5 h-3.5 text-[#9670FF]" />}
                  >
                    Sign In
                  </Button>
                </Link>

                <Link href="/register">
                  <Button
                    variant={pathname === '/register' ? 'primary' : 'outline'}
                    size="sm"
                    className="rounded-full px-3 sm:px-4"
                  >
                    Register
                  </Button>
                </Link>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenAuth('signin')}
                  className="rounded-full px-2.5 sm:px-3.5"
                  leftIcon={<LogIn className="w-3.5 h-3.5 text-[#9670FF]" />}
                >
                  Sign In
                </Button>

                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleOpenAuth('signup')}
                  className="rounded-full px-3 sm:px-4"
                >
                  Register
                </Button>
              </>
            )
          ) : (
            <>
              <button
                type="button"
                onClick={handleOpenNameModal}
                disabled={isSigningOut}
                className="flex items-center gap-1.5 sm:gap-2.5 pl-1 pr-2 sm:pl-1.5 sm:pr-3 py-1 rounded-full bg-[#173D30]/80 border border-[#E8DDC5]/20 hover:border-[#E8DDC5]/40 transition-colors text-xs group cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                title="Click to edit display name"
              >
                <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-full bg-[#0E281F] border border-[#E8DDC5]/25 flex items-center justify-center text-[#F7F4EC] font-medium text-xs uppercase shrink-0">
                  {(user.username || user.email || 'U').charAt(0)}
                </div>
                <div className="flex flex-col text-left min-w-0">
                  <span
                    className="font-medium max-w-[76px] sm:max-w-[140px] truncate text-[#F7F4EC] leading-tight"
                    suppressHydrationWarning
                  >
                    {user.username || 'User'}
                  </span>
                  {user.email && (
                    <span className="text-xs text-[#CDBF9F]/90 max-w-[110px] sm:max-w-[150px] truncate hidden sm:block leading-tight">
                      {user.email}
                    </span>
                  )}
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-[#CDBF9F]/70 group-hover:text-[#F7F4EC] transition-colors shrink-0" />
              </button>

              <div className="hidden sm:block h-5 w-px bg-[#E8DDC5]/15" />

              <Button
                variant="ghost"
                size="sm"
                onClick={handleSignOut}
                isLoading={isSigningOut}
                className="text-[#E8DDC5]/85 hover:text-[#F7F4EC] rounded-full px-2 sm:px-3"
                title="Sign Out"
                aria-label="Sign Out"
                leftIcon={<LogOut className="w-3.5 h-3.5" />}
              >
                <span className="hidden sm:inline">
                  {isSigningOut ? 'Signing Out…' : 'Sign Out'}
                </span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Edit Display Name Modal */}
      <Modal
        isOpen={isNameModalOpen}
        onClose={() => setIsNameModalOpen(false)}
        preventClose={isSavingName}
        title="Display Name"
        description="This name appears to other viewers in room presence and live chat."
      >
        <form onSubmit={handleSaveName} className="space-y-4">
          <Input
            label="Display Name"
            value={tempName}
            onChange={(e) => setTempName(e.target.value)}
            placeholder="e.g. Alex"
            maxLength={25}
            disabled={isSavingName}
            tone="dark"
            autoFocus
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghostSand"
              size="sm"
              onClick={() => setIsNameModalOpen(false)}
              disabled={isSavingName}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              isLoading={isSavingName}
              disabled={!tempName.trim()}
              leftIcon={<Check className="w-3.5 h-3.5" />}
            >
              {isSavingName ? 'Saving…' : 'Save Name'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Auth Modal (Sign In / Register) */}
      {!isAuthRoute && (
        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
          initialTab={authTab}
        />
      )}
    </header>
  );
};
