import React from 'react';
import { Heart, ShieldCheck, Zap } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-neutral-900 bg-neutral-950 py-8 px-4 text-center text-xs text-neutral-500">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span>Syncora Duo Watch Party</span>
          <span>•</span>
          <span className="flex items-center gap-1 text-neutral-400">
            <Zap className="w-3.5 h-3.5 text-indigo-400" /> Host-Authoritative Realtime
          </span>
        </div>

        <div className="flex items-center gap-4 text-neutral-400">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> Private & End-to-End Synced
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            Built with <Heart className="w-3 h-3 text-pink-500 fill-pink-500" /> for couples & best friends
          </span>
        </div>
      </div>
    </footer>
  );
};

