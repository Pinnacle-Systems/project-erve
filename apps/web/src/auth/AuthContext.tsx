import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, AuthUser } from '@erve/types';
import { AUTH_EXPIRED_EVENT, apiClient, logoutSession, refreshAccessToken } from '../lib/api-client.js';
import { clearStoredToken, setStoredToken } from './token-storage.js';

type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  login: (accessToken: string, user: AuthUser) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Restores the session by validating the HttpOnly refresh cookie first.
  // A stored access token alone is not trusted as proof of a live session.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        await refreshAccessToken();

        const me = await apiClient.get<ApiSuccessResponse<AuthUser>>('/auth/me');

        if (cancelled) {
          return;
        }

        setUser(me.data.data);
        setStatus('authenticated');
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }

        if (isAxiosError(error)) {
          clearStoredToken();
        }

        setUser(null);
        setStatus('unauthenticated');
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
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
      logout: async () => {
        await logoutSession();
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
