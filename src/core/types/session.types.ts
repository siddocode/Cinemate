export interface UserIdentity {
  id: string;
  username: string;
  isGuest: boolean;
}

export interface SessionContextType {
  user: UserIdentity;
  setUsername: (name: string) => void;
  isInitialized: boolean;
}

