'use client';

import { useEffect, useState } from 'react';

export interface LoadingStage {
  /** Minimum elapsed milliseconds before transitioning to this stage. */
  afterMs: number;
  /** Short primary label sized for compact buttons and headings. */
  label: string;
  /** Optional secondary telemetry line for full-screen loading states. */
  detail?: string;
}

export const CREATE_ROOM_BUTTON_STAGES: readonly LoadingStage[] = [
  { afterMs: 0, label: 'Creating…' },
  { afterMs: 900, label: 'Entering…' },
  { afterMs: 2200, label: 'Setting up…' },
  { afterMs: 4200, label: 'Almost done…' },
  { afterMs: 7200, label: 'Slow network…' },
];

export const JOIN_ROOM_BUTTON_STAGES: readonly LoadingStage[] = [
  { afterMs: 0, label: 'Finding…' },
  { afterMs: 900, label: 'Entering…' },
  { afterMs: 2200, label: 'Connecting…' },
  { afterMs: 4200, label: 'Almost done…' },
  { afterMs: 7200, label: 'Slow network…' },
];

export const REOPEN_ROOM_BUTTON_STAGES: readonly LoadingStage[] = [
  { afterMs: 0, label: 'Opening…' },
  { afterMs: 900, label: 'Entering…' },
  { afterMs: 2200, label: 'Almost done…' },
  { afterMs: 4800, label: 'Still loading…' },
];

export const FAVORITE_ROOM_BUTTON_STAGES: readonly LoadingStage[] = [
  { afterMs: 0, label: 'Starting…' },
  { afterMs: 900, label: 'Creating…' },
  { afterMs: 2200, label: 'Entering…' },
  { afterMs: 4200, label: 'Almost done…' },
  { afterMs: 7200, label: 'Slow network…' },
];

export const ROOM_CREATE_SCREEN_STAGES: readonly LoadingStage[] = [
  {
    afterMs: 0,
    label: 'Creating space…',
    detail: 'Setting up your private screening room',
  },
  {
    afterMs: 1000,
    label: 'Entering lounge…',
    detail: 'Opening live sync & chat channels',
  },
  {
    afterMs: 2400,
    label: 'Almost done…',
    detail: 'Readying theater stage & controls',
  },
  {
    afterMs: 4600,
    label: 'Taking a little longer…',
    detail: 'Slow network — finalizing room setup',
  },
  {
    afterMs: 8000,
    label: 'Still connecting…',
    detail: 'Hang tight — securing your session',
  },
];

export const ROOM_ENTER_SCREEN_STAGES: readonly LoadingStage[] = [
  {
    afterMs: 0,
    label: 'Entering room…',
    detail: 'Checking room code & access',
  },
  {
    afterMs: 1000,
    label: 'Joining lounge…',
    detail: 'Connecting live presence & chat',
  },
  {
    afterMs: 2400,
    label: 'Almost done…',
    detail: 'Syncing playback state with host',
  },
  {
    afterMs: 4600,
    label: 'Slow network…',
    detail: 'Still syncing — loading theater stage',
  },
  {
    afterMs: 8000,
    label: 'Almost there…',
    detail: 'Establishing realtime connection',
  },
];

/**
 * Pure helper that selects the active loading stage for a given elapsed duration.
 */
export function resolveLoadingStage(
  elapsedMs: number,
  stages: readonly LoadingStage[]
): { stage: LoadingStage; index: number } {
  if (stages.length === 0) {
    return { stage: { afterMs: 0, label: 'Loading…' }, index: 0 };
  }

  let matchedIndex = 0;
  for (let i = 0; i < stages.length; i++) {
    if (elapsedMs >= stages[i].afterMs) {
      matchedIndex = i;
    } else {
      break;
    }
  }

  return {
    stage: stages[matchedIndex],
    index: matchedIndex,
  };
}

/**
 * Progresses calmly through `stages` while `isActive` remains true,
 * adapting status text naturally when network or server setup is slower.
 */
export function useLoadingStages(
  isActive: boolean,
  stages: readonly LoadingStage[]
): { stage: LoadingStage; stageIndex: number } {
  const [stageIndex, setStageIndex] = useState(0);

  useEffect(() => {
    if (!isActive || stages.length <= 1) {
      return;
    }

    const timers: Array<ReturnType<typeof setTimeout>> = [];
    for (let i = 1; i < stages.length; i++) {
      const delay = Math.max(0, stages[i].afterMs);
      const timer = setTimeout(() => {
        setStageIndex(i);
      }, delay);
      timers.push(timer);
    }

    return () => {
      for (const timer of timers) {
        clearTimeout(timer);
      }
      setStageIndex(0);
    };
  }, [isActive, stages]);

  const effectiveIndex = isActive
    ? Math.min(stageIndex, Math.max(0, stages.length - 1))
    : 0;

  return {
    stage: stages[effectiveIndex] ?? { afterMs: 0, label: 'Loading…' },
    stageIndex: effectiveIndex,
  };
}

