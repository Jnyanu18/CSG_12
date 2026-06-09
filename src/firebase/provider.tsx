'use client';

import React, {
  createContext,
  useContext,
  ReactNode,
  useState,
  useEffect,
  useMemo,
  useCallback,
  DependencyList,
} from 'react';
import { FirebaseErrorListener } from '@/components/FirebaseErrorListener';

export interface SessionUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  getIdToken: () => Promise<string>;
}

interface UserAuthState {
  user: SessionUser | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export interface FirebaseContextState extends UserAuthState {
  areServicesAvailable: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (email: string, password: string, displayName?: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

export interface FirebaseServicesAndUser {
  user: SessionUser | null;
  isUserLoading: boolean;
  userError: Error | null;
  auth: Record<string, never>;
  firestore: null;
  firebaseApp: null;
}

export interface UserHookResult {
  user: SessionUser | null;
  isUserLoading: boolean;
  userError: Error | null;
}

export interface AuthActions {
  login: (email: string, password: string) => Promise<SessionUser>;
  register: (email: string, password: string, displayName?: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

export const FirebaseContext = createContext<FirebaseContextState | undefined>(undefined);

function toSessionUser(raw: { uid: string; email: string; displayName: string }): SessionUser {
  return { ...raw, getIdToken: async () => 'session-cookie' };
}

async function readJson(res: Response): Promise<any> {
  return res.json().catch(() => ({}));
}

export const FirebaseProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [userAuthState, setUserAuthState] = useState<UserAuthState>({
    user: null,
    isUserLoading: true,
    userError: null,
  });

  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await readJson(res);
      setUserAuthState({
        user: data.user ? toSessionUser(data.user) : null,
        isUserLoading: false,
        userError: null,
      });
    } catch (err) {
      setUserAuthState({ user: null, isUserLoading: false, userError: err as Error });
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error || 'Unable to sign in.');
    const user = toSessionUser(data.user);
    setUserAuthState({ user, isUserLoading: false, userError: null });
    return user;
  }, []);

  const register = useCallback(async (email: string, password: string, displayName?: string) => {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, displayName }),
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error || 'Unable to create an account.');
    const user = toSessionUser(data.user);
    setUserAuthState({ user, isUserLoading: false, userError: null });
    return user;
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    setUserAuthState({ user: null, isUserLoading: false, userError: null });
  }, []);

  const contextValue = useMemo(
    (): FirebaseContextState => ({
      areServicesAvailable: true,
      user: userAuthState.user,
      isUserLoading: userAuthState.isUserLoading,
      userError: userAuthState.userError,
      login,
      register,
      logout,
    }),
    [userAuthState, login, register, logout]
  );

  return (
    <FirebaseContext.Provider value={contextValue}>
      <FirebaseErrorListener />
      {children}
    </FirebaseContext.Provider>
  );
};

function useFirebaseContext(): FirebaseContextState {
  const context = useContext(FirebaseContext);
  if (!context) throw new Error('Firebase hooks must be used within a FirebaseProvider.');
  return context;
}

export const useFirebase = (): FirebaseServicesAndUser => {
  const context = useFirebaseContext();
  return {
    user: context.user,
    isUserLoading: context.isUserLoading,
    userError: context.userError,
    auth: {},
    firestore: null,
    firebaseApp: null,
  };
};

export const useAuth = (): AuthActions => {
  const context = useFirebaseContext();
  return { login: context.login, register: context.register, logout: context.logout };
};

export const useFirestore = (): null => null;

export const useFirebaseApp = (): null => null;

export function useMemoFirebase<T>(factory: () => T, deps: DependencyList): T {
  return useMemo(factory, deps);
}

export const useUser = (): UserHookResult => {
  const context = useFirebaseContext();
  return {
    user: context.user,
    isUserLoading: context.isUserLoading,
    userError: context.userError,
  };
};
