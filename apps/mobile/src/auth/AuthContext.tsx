import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { ApiSuccessResponse, AuthUser } from '@erve/types';
import { apiClient, clearStoredToken, getStoredToken, setStoredToken } from '@erve/client';
import { isAxiosError } from 'axios';
import {
  AUTH_EXPIRED_EVENT,
  RefreshCredentialError,
  logoutSession,
  refreshAccessToken,
} from '../lib/api-client.js';
import { BiometricError, nativeBiometric } from './secure-session.js';

/**
 * `locked`: packaged Android with biometric login enabled, before the biometric prompt has been
 * passed in this app process. No refresh is attempted and no credential is readable.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable' | 'locked';

export const BIOMETRIC_SESSION_ENDED_NOTICE =
  'Your session has ended. Sign in with your password to continue.';
export const BIOMETRIC_CHANGED_NOTICE =
  'Your device biometrics changed, so biometric login was turned off. Sign in with your password.';

interface AuthContextValue {
  user: AuthUser | null;
  status: AuthStatus;
  /** Shown on the sign-in screen when biometric login could not restore the session. */
  loginNotice: string | null;
  /** True right after a password sign-in, until the biometric enrolment offer is answered. */
  biometricOfferPending: boolean;
  dismissBiometricOffer: () => void;
  login: (accessToken: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  retrySession: () => void;
  /** Shows the biometric prompt. Rejects with BiometricError (the status stays `locked`). */
  unlockWithBiometrics: () => Promise<void>;
  /** Leaves the locked screen for the password form. Biometric login stays enabled. */
  switchToPassword: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [biometricOfferPending, setBiometricOfferPending] = useState(false);
  // Set once the biometric prompt was passed, so a server rejection right after it can be explained.
  const restoredViaBiometricRef = useRef(false);

  // Restores the session from a sessionStorage-scoped access token only.
  // No token means no prior session in this WebView session — start
  // unauthenticated without calling /auth/refresh just because an HttpOnly
  // refresh cookie might still exist. When a token is present, /auth/me
  // validates it, and the apiClient response interceptor transparently
  // refreshes-and-retries on a 401.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      try {
        // Biometric login on: no credential is readable and no refresh is attempted until the user
        // passes the prompt. Any leftover access token is dropped so nothing is sent unauthenticated-by-biometrics.
        const biometric = await nativeBiometric.status();
        if (cancelled) return;
        if (biometric.enabled && biometric.locked) {
          clearStoredToken();
          setUser(null);
          setStatus('locked');
          return;
        }

        if (!getStoredToken()) await refreshAccessToken();
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

        const rejectedRefresh =
          isAxiosError(error) &&
          error.config?.url?.endsWith('/refresh') &&
          [400, 401, 403].includes(error.response?.status ?? 0);

        if (
          error instanceof RefreshCredentialError ||
          rejectedRefresh ||
          (isAxiosError(error) &&
            (error.response?.status === 401 || error.response?.status === 403))
        ) {
          clearStoredToken();
          setUser(null);
          if (restoredViaBiometricRef.current) {
            // The server refused the session behind the fingerprint (expired, revoked, user
            // inactive). The native layer has already dropped the credential and biometric login.
            setLoginNotice(BIOMETRIC_SESSION_ENDED_NOTICE);
          }
          setStatus('unauthenticated');
        } else {
          setStatus('unavailable');
        }
      } finally {
        restoredViaBiometricRef.current = false;
      }
    }

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, [restoreAttempt]);

  useEffect(() => {
    const handleAuthExpired = () => {
      clearStoredToken();
      setUser(null);
      setBiometricOfferPending(false);
      setStatus('unauthenticated');
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      loginNotice,
      biometricOfferPending,
      dismissBiometricOffer: () => setBiometricOfferPending(false),
      login: (accessToken, nextUser) => {
        setStoredToken(accessToken);
        setUser(nextUser);
        setLoginNotice(null);
        setBiometricOfferPending(true);
        setStatus('authenticated');
      },
      logout: async () => {
        await logoutSession();
        setUser(null);
        setBiometricOfferPending(false);
        setStatus('unauthenticated');
      },
      retrySession: () => {
        setStatus('loading');
        setRestoreAttempt((attempt) => attempt + 1);
      },
      unlockWithBiometrics: async () => {
        try {
          await nativeBiometric.unlock();
        } catch (error) {
          if (error instanceof BiometricError && error.code === 'key-invalidated') {
            // The native layer wiped biometric login: only the password works now.
            setLoginNotice(BIOMETRIC_CHANGED_NOTICE);
            setStatus('unauthenticated');
          }
          throw error;
        }
        restoredViaBiometricRef.current = true;
        setStatus('loading');
        setRestoreAttempt((attempt) => attempt + 1);
      },
      switchToPassword: () => setStatus('unauthenticated'),
    }),
    [user, status, loginNotice, biometricOfferPending],
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
