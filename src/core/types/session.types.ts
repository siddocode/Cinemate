export interface UserIdentity {
  id: string;
  username: string;
  email?: string;
  isGuest: boolean;
}

export interface SignUpResult {
  error?: string;
  message?: string;
  requiresEmailConfirmation?: boolean;
}

export interface SignInResult {
  error?: string;
}

export interface SessionContextType {
  user: UserIdentity;
  isAuthenticated: boolean;
  isInitialized: boolean;
  setUsername: (name: string) => Promise<void> | void;
  signInWithEmail: (email: string, password: string) => Promise<SignInResult>;
  signUpWithEmail: (email: string, password: string, username: string) => Promise<SignUpResult>;
  signInAsGuest: (customUsername?: string) => Promise<void>;
  signOut: () => Promise<void>;
}
