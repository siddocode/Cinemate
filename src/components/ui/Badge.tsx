import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = 'default',
  dot = false,
  children,
  ...props
}) => {
  const variants = {
    default: 'bg-[#173D30] text-[#CDBF9F] border-[#E8DDC5]/22',
    success: 'bg-[#133528] text-[#9FE2BF] border-[#7AD3A8]/30',
    warning: 'bg-[#292214] text-[#F0C987] border-[#E9B872]/30',
    danger: 'bg-[#331B1A] text-[#F2B8B2] border-[#E87A70]/35',
    info: 'bg-[#173D30] text-[#E8DDC5] border-[#E8DDC5]/25',
    purple: 'bg-[#9670FF]/12 text-[#C9B3FF] border-[#9670FF]/35',
  };

  const dotColors = {
    default: 'bg-[#CDBF9F]',
    success: 'bg-[#7AD3A8]',
    warning: 'bg-[#E9B872]',
    danger: 'bg-[#E87A70]',
    info: 'bg-[#E8DDC5]',
    purple: 'bg-[#9670FF]',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border tracking-wide',
        variants[variant],
        className
      )}
      {...props}
    >
      {dot && <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColors[variant])} />}
      {children}
    </span>
  );
};
