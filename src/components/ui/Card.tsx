import React from 'react';
import { cn } from '@/lib/utils/cn';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: boolean;
}

export const Card: React.FC<CardProps> = ({ className, glow = false, children, ...props }) => {
  return (
    <div
      className={cn(
        'relative bg-neutral-900/70 backdrop-blur-xl border border-neutral-800/80 rounded-2xl p-6 transition-all duration-200',
        glow && 'shadow-xl shadow-indigo-500/5 border-indigo-500/20',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

