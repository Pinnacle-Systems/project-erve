import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ApiSuccessResponse, AuthUser, SessionInfo } from '@erve/types';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { setExpectedSessionUser, subscribeSessionEvents } from '@erve/client';
import {
  AUTH_EXPIRED_EVENT,
  apiClient,
  logoutSession,
  publishSignedInSession,
} from '../lib/api-client.js';
import { clearStoredToken, getStoredToken } from './token-storage.js';

/**
 * - `unavailable`: the session could not be verified because the network or
 *   server failed (not because credentials were rejected) — retryable.
 * - `reauth-required`: a signed-in session expired mid-use. The user and the
 *   mounted page (including unsaved form state) are kept while the user
 *   signs in again in place.
 */
export type AuthStatus =
  'loading' | 'authenticated' | 'unauthenticated' | 'unavailable' | 'reauth-required';

/**
 * Why `status` became `'unauthenticated'`. `ProtectedRoute` uses this to
 * decide whether the page being left is worth returning to after the next
 * login: an intentional sign-out (`'explicit'`) must not hand the next
 * person — possibly a different user — the previous identity's protected
 * route, while an incidental loss of session (`'expired'`, or `null` at
 * startup) should still support the existing same-user return-to behavior.
 */
export type LogoutReason = 'explicit' | 'expired';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  logoutReason: LogoutReason | null;
  login: (accessToken: string, user: AuthUser, session?: SessionInfo) => Promise<void>;
  logout: () => Promise<void>;
  retrySession: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const IDENTITY_CHANGED_LOGIN_PATH = '/login?reason=identity-changed';

function hardNavigate(path: string): void {
  window.location.replace(path);
}

function isCredentialRejection(error: unknown): boolean {
  return isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403);
}

/**
 * After an in-place re-authentication, retry only queries that failed with
 * no data to show. Queries that still hold data are left alone: refetching
 * them could hand a form new record data and re-hydrate over the user's
 * unsaved edits. Mutations are never replayed — a save that failed while
 * signed out stays failed until the user retries it.
 */
function refetchFailedQueries(queryClient: QueryClient): void {
  void queryClient.refetchQueries({
    predicate: (query) => query.state.status === 'error' && query.state.data === undefined,
  });
}

export function AuthProvider({
  children,
  onHardNavigate = hardNavigate,
}: {
  children: ReactNode;
  /** Full-page navigation used when React state must not survive (identity change). */
  onHardNavigate?: (path: string) => void;
}) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [logoutReason, setLogoutReason] = useState<LogoutReason | null>(null);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const statusRef = useRef<AuthStatus>(status);
  const userRef = useRef<AuthUser | null>(user);
  const loggingOutRef = useRef(false);

  // Refs mirror state for the window/session event handlers below.
  useEffect(() => {
    statusRef.current = status;
    userRef.current = user;
    setExpectedSessionUser(user?.id ?? null);
  }, [status, user]);

  // Restores the session from a sessionStorage-scoped access token only.
  // No token means no prior session in this tab — start unauthenticated
  // without calling /auth/refresh just because an HttpOnly refresh cookie
  // might still exist. When a token is present, /auth/me validates it, and
  // the apiClient response interceptor transparently refreshes-and-retries
  // on a 401. Only a rejection of the credentials signs the user out; a
  // network or server failure leaves a retryable "unavailable" state.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      if (!getStoredToken()) {
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
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (isCredentialRejection(error)) {
          clearStoredToken();
          setUser(null);
          setStatus('unauthenticated');
          setLogoutReason('expired');
        } else {
          setStatus('unavailable');
        }
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [restoreAttempt]);

  const resetToSignedOut = useCallback(
    async (reason: LogoutReason) => {
      await queryClient.cancelQueries();
      queryClient.clear();
      clearStoredToken();
      setUser(null);
      setStatus('unauthenticated');
      setLogoutReason(reason);
    },
    [queryClient],
  );

  useEffect(() => {
    const handleAuthExpired = () => {
      const current = statusRef.current;
      if (
        !loggingOutRef.current &&
        userRef.current &&
        (current === 'authenticated' || current === 'reauth-required')
      ) {
        // Keep the user, the query cache and — crucially — the mounted page.
        clearStoredToken();
        setStatus('reauth-required');
        return;
      }
      // Either nothing to preserve, or this fired mid-logout (e.g. an
      // activity refresh racing the explicit /auth/logout call) — in the
      // latter case the in-flight logout() owns the reason and will set it
      // again right after this.
      void resetToSignedOut(loggingOutRef.current ? 'explicit' : 'expired');
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [resetToSignedOut]);

  useEffect(
    () =>
      subscribeSessionEvents((event) => {
        if (event.type === 'identity-changed') {
          // Requests would now run as someone else. Nothing from this tab —
          // cache, form state, token — may carry over: reload from scratch.
          queryClient.clear();
          clearStoredToken();
          setExpectedSessionUser(null);
          onHardNavigate(IDENTITY_CHANGED_LOGIN_PATH);
        } else if (event.type === 'remote-logout') {
          // The same account explicitly signed out from another tab —
          // treat it like this tab's own explicit logout, not an
          // interruption: the next login here should not be routed back.
          void resetToSignedOut('explicit');
        } else if (event.type === 'session-adopted' && statusRef.current === 'reauth-required') {
          setStatus('authenticated');
          refetchFailedQueries(queryClient);
        }
      }),
    [queryClient, onHardNavigate, resetToSignedOut],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      logoutReason,
      login: async (accessToken, nextUser, session) => {
        const previousUser = userRef.current;
        const preservingPage =
          previousUser !== null &&
          (statusRef.current === 'reauth-required' || statusRef.current === 'authenticated');

        if (preservingPage && previousUser.id === nextUser.id) {
          publishSignedInSession(accessToken, session);
          setStatus('authenticated');
          refetchFailedQueries(queryClient);
          return;
        }

        if (preservingPage) {
          // A different user signed in over a preserved page: nothing of the
          // previous user's page may survive.
          publishSignedInSession(accessToken, session);
          queryClient.clear();
          onHardNavigate('/dashboard');
          return;
        }

        await queryClient.cancelQueries();
        queryClient.clear();
        setExpectedSessionUser(nextUser.id);
        publishSignedInSession(accessToken, session);
        setUser(nextUser);
        setStatus('authenticated');
        // A fresh sign-in consumes whatever sent this tab to /login, so the
        // next time it becomes unauthenticated it starts from a clean slate.
        setLogoutReason(null);
      },
      logout: async () => {
        loggingOutRef.current = true;
        try {
          await logoutSession();
        } finally {
          loggingOutRef.current = false;
          await resetToSignedOut('explicit');
        }
      },
      retrySession: () => {
        setStatus('loading');
        setRestoreAttempt((attempt) => attempt + 1);
      },
    }),
    [user, status, logoutReason, queryClient, onHardNavigate, resetToSignedOut],
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

/** Useful for pages that retain read-only rendering in isolated test or embed contexts. */
export function useOptionalAuth(): AuthContextValue | undefined {
  return useContext(AuthContext);
}
