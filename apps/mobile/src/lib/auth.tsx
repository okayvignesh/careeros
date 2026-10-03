import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Platform } from 'react-native';
import * as api from './api';
import { clearSession, loadSession } from './storage';
import type { MobileSession } from './types';

export type AuthStatus = 'loading' | 'signed-in' | 'signed-out';

export interface AuthValue {
  status: AuthStatus;
  session: MobileSession | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<MobileSession | null>(null);

  useEffect(() => {
    let alive = true;
    loadSession()
      .then((stored) => {
        if (!alive) return;
        setSession(stored);
        setStatus(stored ? 'signed-in' : 'signed-out');
      })
      .catch(() => {
        if (!alive) return;
        setSession(null);
        setStatus('signed-out');
      });
    // A dead/revoked token anywhere in the client drops the app to sign-in.
    api.setUnauthorizedHandler(() => {
      if (!alive) return;
      setSession(null);
      setStatus('signed-out');
    });
    return () => {
      alive = false;
      api.setUnauthorizedHandler(null);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const next = await api.signIn({
      email: email.trim(),
      password,
      deviceName: `${Platform.OS} device`,
      platform: Platform.OS,
    });
    setSession(next);
    setStatus('signed-in');
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut().catch(() => undefined);
    await clearSession();
    setSession(null);
    setStatus('signed-out');
  }, []);

  const value = useMemo<AuthValue>(
    () => ({ status, session, signIn, signOut }),
    [status, session, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
