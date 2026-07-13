import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ApiSuccessResponse, AuthUser } from '@erve/types';
import { apiClient, clearStoredToken, getStoredToken, setStoredToken } from '@erve/client';
import { AUTH_EXPIRED_EVENT, logoutSession } from '../lib/api-client.js';

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

  // Restores the session from a sessionStorage-scoped access token only.
  // No token means no prior session in this WebView session — start
  // unauthenticated without calling /auth/refresh just because an HttpOnly
  // refresh cookie might still exist. When a token is present, /auth/me
  // validates it, and the apiClient response interceptor transparently
  // refreshes-and-retries on a 401.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const token = getStoredToken();

      if (!token) {
        setStatus('unauthenticated');
        return;
      }

      try {
        const me = await apiClient.get<ApiSuccessResponse<AuthUser>>('/auth/me');

        if (cancelled) {
          return;
        }

        setUser(me.data.data);
        setStatus('authenticated');
      } catch {
        if (cancelled) {
          return;
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
      clearStoredToken();
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
