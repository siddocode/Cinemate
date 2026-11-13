'use client';

import React from 'react';
import {
  ROOM_CREATE_SCREEN_STAGES,
  ROOM_ENTER_SCREEN_STAGES,
  useLoadingStages,
} from '@/hooks/useLoadingStages';

interface RoomLoadingStateProps {
  mode?: 'create' | 'join';
}

export const RoomLoadingState: React.FC<RoomLoadingStateProps> = ({
  mode = 'join',
}) => {
  const stages =
    mode === 'create' ? ROOM_CREATE_SCREEN_STAGES : ROOM_ENTER_SCREEN_STAGES;
  const { stage, stageIndex } = useLoadingStages(true, stages);

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center bg-[#0E281F] text-[#F7F4EC] px-6 text-center select-none"
      role="status"
      aria-live="polite"
    >
      <div className="relative mb-5 flex items-center justify-center">
        <div className="w-11 h-11 rounded-full border-2 border-[#E8DDC5]/15 border-t-[#9670FF] animate-spin" />
        <div className="absolute w-2.5 h-2.5 rounded-full bg-[#9670FF]/80 animate-pulse" />
      </div>

      <h2 className="font-serif text-xl sm:text-2xl font-medium tracking-tight text-[#F7F4EC] max-w-xs sm:max-w-sm">
        {stage.label}
      </h2>

      {stage.detail && (
        <p className="text-xs font-mono uppercase tracking-[0.12em] text-[#CDBF9F]/85 mt-2 max-w-xs sm:max-w-sm leading-relaxed min-h-[2.25rem] flex items-center justify-center">
          {stage.detail}
        </p>
      )}

      <div className="flex items-center gap-1.5 mt-4" aria-hidden="true">
        {stages.map((s, idx) => (
          <span
            key={s.label}
            className={`h-1 rounded-full transition-all duration-300 ${
              idx === stageIndex
                ? 'w-5 bg-[#9670FF]'
                : idx < stageIndex
                ? 'w-2 bg-[#7AD3A8]/70'
                : 'w-1.5 bg-[#E8DDC5]/20'
            }`}
          />
        ))}
      </div>
    </div>
  );
};

