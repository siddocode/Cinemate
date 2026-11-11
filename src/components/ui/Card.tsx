import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
  tone?: 'sand' | 'forest';
}

export const Card: React.FC<CardProps> = ({
  className,
  glow = false,
  tone = 'sand',
  children,
  ...props
}) => {
  const isSand = tone === 'sand';

  return (
    <div
      className={cn(
        'relative rounded-2xl p-6 transition-colors duration-150',
        isSand
          ? 'bg-[#EDE2CA] text-[#102B23] border border-[#CDBF9F]/70'
          : 'bg-[#173D30] text-[#F7F4EC] border border-[#E8DDC5]/16',
        glow &&
          (isSand
            ? 'shadow-[0_24px_60px_rgba(4,14,10,0.45)]'
            : 'border-[#E8DDC5]/28 shadow-[0_20px_50px_rgba(4,14,10,0.45)]'),
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};
