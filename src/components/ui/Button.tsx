'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | 'primary'
    | 'sand'
    | 'accent'
    | 'secondary'
    | 'outline'
    | 'ghost'
    | 'ghostSand'
    | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      leftIcon,
      rightIcon,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      'inline-flex items-center justify-center font-medium transition-colors duration-150 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9670FF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E281F] disabled:opacity-45 disabled:pointer-events-none select-none active:scale-[0.99] cursor-pointer';

    const variants = {
      primary:
        'bg-[#7235A8] hover:bg-[#8342BE] text-[#F7F4EC] font-semibold border border-[#9670FF]/35 shadow-sm',
      sand:
        'bg-[#E8DDC5] hover:bg-[#F7F4EC] text-[#102B23] font-semibold border border-[#E8DDC5]',
      accent:
        'bg-[#9670FF] hover:bg-[#A684FF] text-[#0B1E18] font-semibold border border-[#9670FF]',
      secondary:
        'bg-[#173D30] hover:bg-[#1E4B3C] text-[#F7F4EC] border border-[#E8DDC5]/20',
      outline:
        'bg-transparent hover:bg-[#E8DDC5]/[0.08] text-[#E8DDC5] hover:text-[#F7F4EC] border border-[#E8DDC5]/25 hover:border-[#E8DDC5]/45',
      ghost:
        'bg-transparent hover:bg-[#E8DDC5]/[0.08] text-[#CDBF9F] hover:text-[#F7F4EC] border border-transparent',
      ghostSand:
        'bg-transparent hover:bg-[#102B23]/[0.08] text-[#173D30]/80 hover:text-[#102B23] border border-transparent focus-visible:ring-offset-[#EDE2CA]',
      danger:
        'bg-[#3A1E1C] hover:bg-[#4B2623] text-[#F2B8B2] border border-[#E87A70]/35',
    };

    const sizes = {
      sm: 'text-xs px-3 py-1.5 gap-1.5',
      md: 'text-sm px-4 py-2.5 gap-2',
      lg: 'text-sm px-6 py-3 gap-2 font-semibold tracking-wide',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-current shrink-0" />
        ) : (
          leftIcon
        )}
        {children}
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = 'Button';
