'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from 'react';
import { UserIdentity, SessionContextType } from '@/core/types/session.types';

const SESSION_STORAGE_KEY = 'syncora_guest_session';

const SERVER_SESSION: UserIdentity = {
  id: '',
  username: 'Guest',
  isGuest: true,
};

let currentSession: UserIdentity = SERVER_SESSION;
let sessionListeners: Array<() => void> = [];

function emitSessionChange() {
  for (const listener of sessionListeners) {
    listener();
  }
}

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export const sessionStore = {
  subscribe(listener: () => void) {
    sessionListeners.push(listener);
    return () => {
      sessionListeners = sessionListeners.filter((l) => l !== listener);
    };
  },
  getSnapshot(): UserIdentity {
    return currentSession;
  },
  getServerSnapshot(): UserIdentity {
    return SERVER_SESSION;
  },
  init() {
    if (typeof window === 'undefined') return;

    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.id && parsed.username) {
          currentSession = parsed;
          emitSessionChange();
          return;
        }
      }
    } catch {
      // Local storage unavailable
    }

    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const newSession: UserIdentity = {
      id: generateUUID(),
      username: `Guest-${randomSuffix}`,
      isGuest: true,
    };

    currentSession = newSession;
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(newSession));
    } catch {
      // Storage quota or restriction
    }
    emitSessionChange();
  },
  setUsername(newUsername: string) {
    const trimmed = newUsername.trim();
    if (!trimmed) return;

    currentSession = { ...currentSession, username: trimmed };
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(currentSession));
    } catch {
      // Storage quota or restriction
    }
    emitSessionChange();
  },
};

const defaultContext: SessionContextType = {
  user: SERVER_SESSION,
  setUsername: () => {},
  isInitialized: false,
};

const SessionContext = createContext<SessionContextType>(defaultContext);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const user = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot
  );

  useEffect(() => {
    sessionStore.init();
  }, []);

  const isInitialized = user.id !== '';

  return (
    <SessionContext.Provider
      value={{
        user,
        setUsername: sessionStore.setUsername,
        isInitialized,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
