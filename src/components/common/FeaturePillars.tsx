import React from 'react';
import { Play, MessageSquare, Users2 } from 'lucide-react';

const PILLARS = [
  {
    icon: Play,
    title: 'Sub-Second Playback Sync',
    description: 'Play, pause, and seek together with near-zero delay.',
  },
  {
    icon: MessageSquare,
    title: 'Persistent Side-by-Side Chat',
    description: 'Real-time messaging and reactions without leaving the video.',
  },
  {
    icon: Users2,
    title: 'Live Viewer Presence',
    description: 'See up to 4 viewers connected, sync status, and playback roles in real time.',
  },
];

export const FeaturePillars: React.FC = () => {
  return (
    <div className="w-full max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 pt-10 mt-12 border-t border-[#E8DDC5]/12 text-left">
      {PILLARS.map((pillar) => {
        const Icon = pillar.icon;
        return (
          <div key={pillar.title} className="flex items-start gap-3.5">
            <div className="w-10 h-10 rounded-xl bg-[#173D30]/80 border border-[#9670FF]/55 flex items-center justify-center text-[#B397FF] shrink-0 mt-0.5">
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#F7F4EC] leading-snug">
                {pillar.title}
              </h3>
              <p className="text-xs text-[#CDBF9F]/80 mt-1 leading-relaxed">
                {pillar.description}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
};

