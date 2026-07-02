import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, AuthUser } from '@erve/types';
import { AUTH_EXPIRED_EVENT, apiClient } from '../lib/api-client.js';
import { clearStoredToken, getStoredToken, setStoredToken } from './token-storage.js';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login: (accessToken: string, user: AuthUser) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Restores the session on page refresh by trading a stored token for the
  // current user — if the token is missing or no longer valid, fall back
  // to the unauthenticated state instead of leaving the app stuck loading.
  useEffect(() => {
    const token = getStoredToken();
    if (!token) {
      setStatus('unauthenticated');
      return;
    }

    apiClient
      .get<ApiSuccessResponse<AuthUser>>('/auth/me')
      .then((response) => {
        setUser(response.data.data);
        setStatus('authenticated');
      })
      .catch((error: unknown) => {
        if (isAxiosError(error)) {
          clearStoredToken();
        }
        setUser(null);
        setStatus('unauthenticated');
      });
  }, []);

  useEffect(() => {
    const handleAuthExpired = () => {
      setUser(null);
      setStatus('unauthenticated');
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      login: (accessToken, nextUser) => {
        setStoredToken(accessToken);
        setUser(nextUser);
        setStatus('authenticated');
      },
      logout: () => {
        clearStoredToken();
        setUser(null);
        setStatus('unauthenticated');
      },
    }),
    [user, status],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
