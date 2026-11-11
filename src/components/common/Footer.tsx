'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { ShieldCheck } from 'lucide-react';

export const Footer: React.FC = () => {
  const pathname = usePathname();

  if (pathname?.startsWith('/room/')) {
    return null;
  }

  return (
    <footer className="w-full border-t border-[#E8DDC5]/12 bg-[#0B2019] py-6 px-4 sm:px-6 text-xs text-[#CDBF9F]/75">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="font-serif text-base font-medium text-[#E8DDC5] tracking-tight">
            Syncora
          </span>
          <span className="text-[#E8DDC5]/25">·</span>
          <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[#CDBF9F]/70">
            <span className="w-1.5 h-1.5 rounded-full bg-[#9670FF]" />
            Host-Authoritative Realtime
          </span>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-[#CDBF9F]/70">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-[#7AD3A8]" />
            Private, room-scoped sessions
          </span>
          <span className="text-[#E8DDC5]/25">·</span>
          <span>Crafted for two</span>
        </div>
      </div>
    </footer>
  );
};
