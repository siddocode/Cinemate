'use client';

import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  tone?: 'sand' | 'dark';
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      label,
      error,
      helperText,
      leftIcon,
      rightIcon,
      tone = 'sand',
      id,
      ...props
    },
    ref
  ) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const isSand = tone === 'sand';

    return (
      <div className="w-full space-y-1.5 text-left">
        {label && (
          <label
            htmlFor={inputId}
            className={cn(
              'block text-[13px] font-semibold uppercase tracking-[0.12em]',
              isSand ? 'text-[#173D30]/85' : 'text-[#CDBF9F]'
            )}
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div
              className={cn(
                'absolute left-3.5 flex items-center pointer-events-none',
                isSand ? 'text-[#173D30]/55' : 'text-[#CDBF9F]/70'
              )}
            >
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            className={cn(
              'w-full text-base sm:text-sm rounded-xl border px-3.5 py-2.5 transition-colors duration-150',
              'focus:outline-none focus:border-[#7235A8] focus:ring-2 focus:ring-[#9670FF]/25',
              'disabled:opacity-50 disabled:cursor-not-allowed',
              isSand
                ? 'bg-[#F7F4EC] text-[#102B23] placeholder-[#173D30]/55 border-[#173D30]/25'
                : 'bg-[#102B23] text-[#F7F4EC] placeholder-[#CDBF9F]/55 border-[#E8DDC5]/20',
              leftIcon && 'pl-10',
              rightIcon && 'pr-10',
              error &&
                (isSand
                  ? 'border-[#B91C1C] focus:border-[#B91C1C] focus:ring-[#B91C1C]/20'
                  : 'border-[#E87A70] focus:border-[#E87A70] focus:ring-[#E87A70]/40'),
              className
            )}
            {...props}
          />
          {rightIcon && (
            <div
              className={cn(
                'absolute right-3.5 flex items-center',
                isSand ? 'text-[#173D30]/55' : 'text-[#CDBF9F]/70'
              )}
            >
              {rightIcon}
            </div>
          )}
        </div>
        {error && (
          <p className={cn('text-[13px] mt-1 font-medium', isSand ? 'text-[#991B1B]' : 'text-[#F2B8B2]')}>
            {error}
          </p>
        )}
        {helperText && !error && (
          <p className={cn('text-[13px] mt-1', isSand ? 'text-[#173D30]/75' : 'text-[#CDBF9F]/85')}>
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
