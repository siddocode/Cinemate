import React from 'react';
import { cn } from '@/lib/utils/cn';

interface BrandMarkProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * Syncora rounded-frame play emblem with subtle electric-purple rim.
 */
export const BrandMark: React.FC<BrandMarkProps> = ({ size = 'md', className }) => {
  const sizes = {
    sm: 'w-8 h-8 rounded-lg',
    md: 'w-9 h-9 rounded-xl',
    lg: 'w-11 h-11 rounded-xl',
  };

  const iconSizes = {
    sm: 'w-4 h-4',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  return (
    <div
      className={cn(
        'bg-[#9670FF]/14 border border-[#9670FF]/65 flex items-center justify-center shrink-0 transition-colors duration-150',
        sizes[size],
        className
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={iconSizes[size]}
        aria-hidden="true"
      >
        <path
          d="M8.5 6.8L17.5 12L8.5 17.2V6.8Z"
          stroke="#F7F4EC"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
