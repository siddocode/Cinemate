import { useState, useEffect } from 'react';

/**
 * useDrawerTransition manages smooth enter and exit animations for slide-over side drawers.
 * Follows React 19 state synchronization during render and uses an effect strictly for the
 * exit timeout.
 */
export function useDrawerTransition(isOpen: boolean, durationMs = 240) {
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isAnimatingOut, setIsAnimatingOut] = useState(false);

  // Synchronize state during render when isOpen changes (React 19 pattern)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setIsRendered(true);
      setIsAnimatingOut(false);
    } else if (isRendered) {
      setIsAnimatingOut(true);
    }
  }

  // Handle the unmount timeout after exit animation finishes
  useEffect(() => {
    if (isAnimatingOut) {
      const timer = setTimeout(() => {
        setIsRendered(false);
        setIsAnimatingOut(false);
      }, durationMs);
      return () => clearTimeout(timer);
    }
  }, [isAnimatingOut, durationMs]);

  return {
    isRendered,
    isAnimatingOut,
  };
}
