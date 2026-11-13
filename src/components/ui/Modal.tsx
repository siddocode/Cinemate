'use client';

import React, { useEffect, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils/cn';
import { X } from 'lucide-react';

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  preventClose?: boolean;
}

const emptySubscribe = () => () => {};

function useIsClient(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  description,
  children,
  className,
  preventClose = false,
}) => {
  const isClient = useIsClient();

  useEffect(() => {
    if (!isOpen || preventClose) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, preventClose]);

  if (!isOpen || !isClient) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* House-lights dimmed backdrop */}
      <div
        className="fixed inset-0 bg-[#071611]/82 backdrop-blur-[2px] transition-opacity"
        onClick={() => {
          if (!preventClose) onClose();
        }}
      />

      {/* Dark cinema dialog */}
      <div
        className={cn(
          'relative w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto bg-[#0B1E17] text-[#F7F4EC] border border-[#E8DDC5]/15 rounded-2xl shadow-[0_28px_72px_rgba(0,0,0,0.55)] p-5 sm:p-6 z-10 cinema-enter',
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E8DDC5]/12">
          <div>
            {title && (
              <h3 className="font-serif text-2xl font-semibold tracking-tight text-[#F7F4EC] leading-tight">
                {title}
              </h3>
            )}
            {description && (
              <p className="text-sm text-[#CDBF9F]/90 mt-1.5 leading-relaxed">{description}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={preventClose}
            aria-label="Close dialog"
            className="p-1.5 rounded-lg text-[#CDBF9F]/80 hover:text-[#F7F4EC] hover:bg-[#E8DDC5]/10 transition-colors cursor-pointer shrink-0 disabled:opacity-40 disabled:pointer-events-none"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body
  );
};
