'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { UserIdentity, SessionContextType } from '@/core/types/session.types';

const SESSION_STORAGE_KEY = 'syncora_guest_session';

const defaultContext: SessionContextType = {
  user: {
    id: '',
    username: 'Guest',
    isGuest: true,
  },
  setUsername: () => {},
  isInitialized: false,
};

const SessionContext = createContext<SessionContextType>(defaultContext);

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

function getInitialSession(): UserIdentity {
  if (typeof window !== 'undefined') {
    try {
      const stored = localStorage.getItem(SESSION_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.id && parsed.username) {
          return parsed;
        }
      }
    } catch {
      // Local storage unavailable
    }
  }

  const randomSuffix = Math.floor(1000 + Math.random() * 9000);
  return {
    id: generateUUID(),
    username: `Guest-${randomSuffix}`,
    isGuest: true,
  };
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserIdentity>(getInitialSession);
  const [isInitialized, setIsInitialized] = useState(false);

  useEffect(() => {
    // Ensure session is synchronized to localStorage
    try {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(user));
    } catch (err) {
      console.warn('[Syncora] Failed to save session to localStorage:', err);
    }
  }, [user]);

  // Mark initialized once mounted on client
  useEffect(() => {
    const timer = setTimeout(() => setIsInitialized(true), 0);
    return () => clearTimeout(timer);
  }, []);

  const updateUsername = (newUsername: string) => {
    const trimmed = newUsername.trim();
    if (!trimmed) return;

    setUser((prev) => ({ ...prev, username: trimmed }));
  };

  return (
    <SessionContext.Provider
      value={{
        user,
        setUsername: updateUsername,
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
