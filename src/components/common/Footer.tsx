'use client';

import React from 'react';
import { usePathname } from 'next/navigation';

export const Footer: React.FC = () => {
  const pathname = usePathname();

  if (pathname?.startsWith('/room/') || pathname?.startsWith('/browse')) {
    return null;
  }

  return (
    <footer className="w-full border-t border-[#E8DDC5]/12 bg-[#0B2019] py-6 px-4 sm:px-6 text-sm text-[#CDBF9F]/85">
      <div className="max-w-7xl mx-auto flex items-center justify-center text-center">
        <span>
          Made with{' '}
          <span aria-label="love" className="text-[#E87A70]">
            ♥
          </span>{' '}
          by{' '}
          <a
            href="https://siddocode.in"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#E8DDC5] hover:text-[#9670FF] underline underline-offset-4 transition-colors font-medium"
          >
            sid
          </a>
        </span>
      </div>
    </footer>
  );
};
