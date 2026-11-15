'use client';

import { useState, useEffect } from 'react';

export interface VisualViewportState {
  viewportHeight: number | null;
  isKeyboardOpen: boolean;
  keyboardHeight: number;
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>({
    viewportHeight: null,
    isKeyboardOpen: false,
    keyboardHeight: 0,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = () => {
      const vv = window.visualViewport;
      if (vv) {
        const h = Math.round(vv.height);
        const winH = window.innerHeight;
        const diff = Math.max(0, winH - h);
        const keyboardActive = diff > 80;
        setState({
          viewportHeight: h,
          isKeyboardOpen: keyboardActive,
          keyboardHeight: keyboardActive ? diff : 0,
        });
      } else {
        setState({
          viewportHeight: window.innerHeight,
          isKeyboardOpen: false,
          keyboardHeight: 0,
        });
      }
    };

    update();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return state;
}
