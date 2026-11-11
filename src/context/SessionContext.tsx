'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  UserIdentity,
  SessionContextType,
  SignUpResult,
  SignInResult,
} from '@/core/types/session.types';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { isSupabaseConfigured } from '@/lib/supabase/config';

const SESSION_STORAGE_KEY = 'syncora_auth_session';

export const UNAUTHENTICATED_USER: UserIdentity = {
  id: '',
  username: '',
  email: undefined,
  isGuest: false,
};

let currentSession: UserIdentity = UNAUTHENTICATED_USER;
let sessionListeners: Array<() => void> = [];
let isAuthInitialized = false;
let initPromise: Promise<void> | null = null;
let isAuthListenerAttached = false;

function emitSessionChange() {
  for (const listener of sessionListeners) {
    listener();
  }
}

function setSessionIfChanged(next: UserIdentity): boolean {
  const unchanged =
    currentSession.id === next.id &&
    currentSession.username === next.username &&
    currentSession.email === next.email &&
    currentSession.isGuest === next.isGuest;

  if (unchanged) return false;

  currentSession = next;
  try {
    if (next.id) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(currentSession));
    } else {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  } catch {
    // Ignore storage quota
  }
  return true;
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
    return UNAUTHENTICATED_USER;
  },
  getIsInitialized(): boolean {
    return isAuthInitialized;
  },

  async init() {
    if (typeof window === 'undefined') return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      if (isSupabaseConfigured()) {
        try {
          const supabase = getSupabaseBrowserClient();

          // 1. Check existing verified session
          const { data: sessionData } = await supabase.auth.getSession();
          const authUser = sessionData.session?.user;

          if (authUser && !authUser.is_anonymous) {
            const username =
              (authUser.user_metadata?.username as string) ||
              authUser.email?.split('@')[0] ||
              'User';

            setSessionIfChanged({
              id: authUser.id,
              username,
              email: authUser.email,
              isGuest: false,
            });
          } else {
            setSessionIfChanged(UNAUTHENTICATED_USER);
          }

          // 2. Listen once to ongoing auth state changes (login, logout, refresh, token updates)
          if (!isAuthListenerAttached) {
            isAuthListenerAttached = true;
            supabase.auth.onAuthStateChange((_event, newSession) => {
              const u = newSession?.user;
              let changed = false;
              if (u && !u.is_anonymous) {
                const username =
                  (u.user_metadata?.username as string) ||
                  u.email?.split('@')[0] ||
                  'User';

                changed = setSessionIfChanged({
                  id: u.id,
                  username,
                  email: u.email,
                  isGuest: false,
                });
              } else {
                changed = setSessionIfChanged(UNAUTHENTICATED_USER);
              }
              const wasInit = isAuthInitialized;
              isAuthInitialized = true;
              if (changed || !wasInit) {
                emitSessionChange();
              }
            });
          }
        } catch (authErr) {
          console.warn('[Syncora] Auth initialization check error:', authErr);
          setSessionIfChanged(UNAUTHENTICATED_USER);
        }
      } else {
        setSessionIfChanged(UNAUTHENTICATED_USER);
      }

      isAuthInitialized = true;
      emitSessionChange();
    })();

    return initPromise;
  },

  async signInWithEmail(
    email: string,
    password: string
  ): Promise<SignInResult> {
    if (!isSupabaseConfigured()) {
      return { error: 'Supabase credentials not configured in .env.local.' };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error || !data.user) {
        return {
          error:
            error?.message ||
            'Invalid login credentials. Please check your email and password.',
        };
      }

      const verifiedSession: UserIdentity = {
        id: data.user.id,
        username:
          (data.user.user_metadata?.username as string) ||
          data.user.email?.split('@')[0] ||
          'User',
        email: data.user.email,
        isGuest: false,
      };

      currentSession = verifiedSession;
      try {
        localStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(verifiedSession)
        );
      } catch {
        // Ignore storage quota
      }
      isAuthInitialized = true;
      emitSessionChange();

      return {};
    } catch (err: unknown) {
      return {
        error: err instanceof Error ? err.message : 'Unknown sign in error',
      };
    }
  },

  async signUpWithEmail(
    email: string,
    password: string,
    username: string
  ): Promise<SignUpResult> {
    if (!isSupabaseConfigured()) {
      return { error: 'Supabase credentials not configured in .env.local.' };
    }

    try {
      const supabase = getSupabaseBrowserClient();
      const trimmedUser = username.trim() || email.split('@')[0];

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: trimmedUser,
          },
        },
      });

      if (error) {
        return { error: error.message };
      }

      // Check for duplicate email (Supabase returns empty identities array when email enumeration protection is on)
      if (
        data.user &&
        Array.isArray(data.user.identities) &&
        data.user.identities.length === 0
      ) {
        return {
          error:
            'An account with this email already exists. Please sign in instead.',
        };
      }

      // If Supabase project requires email confirmation, session is null until confirmed
      if (!data.session) {
        return {
          message:
            'Registration successful! Please check your email inbox to confirm your account before signing in.',
          requiresEmailConfirmation: true,
        };
      }

      // Direct sign-in (e.g. autoconfirm enabled or session returned immediately)
      const verifiedSession: UserIdentity = {
        id: data.user!.id,
        username: trimmedUser,
        email: data.user!.email,
        isGuest: false,
      };

      currentSession = verifiedSession;
      try {
        localStorage.setItem(
          SESSION_STORAGE_KEY,
          JSON.stringify(verifiedSession)
        );
      } catch {
        // Ignore storage quota
      }
      isAuthInitialized = true;
      emitSessionChange();

      return {
        message: 'Account created successfully! Redirecting...',
        requiresEmailConfirmation: false,
      };
    } catch (err: unknown) {
      return {
        error:
          err instanceof Error ? err.message : 'Unknown registration error',
      };
    }
  },

  async signOut(): Promise<void> {
    if (isSupabaseConfigured()) {
      try {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.signOut();
      } catch (err) {
        console.warn('[Syncora] Sign out error:', err);
      }
    }

    currentSession = UNAUTHENTICATED_USER;
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage quota
    }
    emitSessionChange();
  },

  async signInAsGuest(): Promise<void> {
    console.warn(
      '[Syncora] signInAsGuest is obsolete. Full authentication is required.'
    );
  },

  async setUsername(newUsername: string) {
    const trimmed = newUsername.trim();
    if (!trimmed || !currentSession.id) return;

    currentSession = { ...currentSession, username: trimmed };
    try {
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(currentSession)
      );
    } catch {
      // Ignore storage quota
    }
    emitSessionChange();

    if (isSupabaseConfigured() && currentSession.id) {
      try {
        const supabase = getSupabaseBrowserClient();
        await supabase.auth.updateUser({
          data: { username: trimmed },
        });

        await supabase.from('profiles').upsert(
          {
            id: currentSession.id,
            username: trimmed,
            is_guest: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' }
        );
      } catch (err) {
        console.warn('[Syncora] Failed to sync username:', err);
      }
    }
  },
};

const defaultContext: SessionContextType = {
  user: UNAUTHENTICATED_USER,
  isAuthenticated: false,
  isInitialized: false,
  setUsername: () => {},
  signInWithEmail: async () => ({}),
  signUpWithEmail: async () => ({}),
  signInAsGuest: async () => {},
  signOut: async () => {},
};

const SessionContext = createContext<SessionContextType>(defaultContext);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const user = useSyncExternalStore(
    sessionStore.subscribe,
    sessionStore.getSnapshot,
    sessionStore.getServerSnapshot
  );

  const [isClientReady, setIsClientReady] = useState(false);

  useEffect(() => {
    sessionStore.init().finally(() => {
      setIsClientReady(true);
    });

    // Multi-tab synchronization via window storage events
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === SESSION_STORAGE_KEY) {
        if (!e.newValue) {
          currentSession = UNAUTHENTICATED_USER;
          emitSessionChange();
        } else {
          try {
            const parsed = JSON.parse(e.newValue);
            if (parsed.id) {
              currentSession = parsed;
              emitSessionChange();
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const isAuthenticated = Boolean(user.id && !user.isGuest);
  const isInitialized = isClientReady && sessionStore.getIsInitialized();

  return (
    <SessionContext.Provider
      value={{
        user,
        isAuthenticated,
        isInitialized,
        setUsername: sessionStore.setUsername,
        signInWithEmail: sessionStore.signInWithEmail,
        signUpWithEmail: sessionStore.signUpWithEmail,
        signInAsGuest: sessionStore.signInAsGuest,
        signOut: sessionStore.signOut,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  return useContext(SessionContext);
}
