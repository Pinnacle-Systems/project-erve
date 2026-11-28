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
import {
  TrustedDeviceError,
  flushPendingRevocation,
  signInWithTrustedDevice,
} from './trusted-device.js';
import { DEVICE_AUTHORIZATION_ENDED_NOTICE } from './biometric-messages.js';

/**
 * `locked`: packaged Android with biometric sign-in registered and no session in this app process
 * (a fresh launch, or after logout or an ended session). The screen offers "Sign in with
 * biometrics" and "Sign in with password"; no credential is readable and no refresh is attempted.
 */
export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable' | 'locked';

/** Which kind of biometric sign-in the locked screen offers. */
export type BiometricLock = 'device' | 'legacy';

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
  /** The pending offer upgrades a v0.2.0 biometric login rather than introducing the feature. */
  biometricOfferMigration: boolean;
  dismissBiometricOffer: () => void;
  /** Set while biometric sign-in is registered on this phone (also while the password form shows). */
  biometricLock: BiometricLock | null;
  /** Whether the biometric screen should open the prompt by itself (not after a logout). */
  autoPromptBiometric: boolean;
  login: (accessToken: string, user: AuthUser) => void;
  logout: () => Promise<void>;
  retrySession: () => void;
  /**
   * Signs in with the registered phone: biometric prompt, then a fresh server session. Rejects with
   * BiometricError / TrustedDeviceError and stays on the locked screen, except when the phone's
   * authorization is gone, which switches to the password form with an explanation.
   */
  signInWithBiometrics: () => Promise<void>;
  /** Leaves the locked screen for the password form. Biometric sign-in stays registered. */
  switchToPassword: () => void;
  /** Returns from the password form to the biometric screen (only while registered). */
  switchToBiometrics: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [loginNotice, setLoginNotice] = useState<string | null>(null);
  const [biometricOfferPending, setBiometricOfferPending] = useState(false);
  const [biometricOfferMigration, setBiometricOfferMigration] = useState(false);
  const [biometricLock, setBiometricLock] = useState<BiometricLock | null>(null);
  const [autoPromptBiometric, setAutoPromptBiometric] = useState(true);
  // Set once a v0.2.0 biometric unlock was passed, so a server rejection right after it can be
  // explained and a successful restore offers the upgrade.
  const restoredViaLegacyRef = useRef(false);

  /**
   * Back to the sign-in screens after the session ended (logout, rejected or expired session):
   * the biometric screen when this phone is registered, otherwise the password form. Only the
   * session is gone; the registration is untouched.
   */
  const settleSignedOut = useCallback(async () => {
    let enabled = false;
    try {
      enabled = (await nativeBiometric.status()).enabled;
    } catch {
      // Treated as not registered: the password form always works.
    }
    setUser(null);
    setBiometricOfferPending(false);
    setBiometricLock(enabled ? 'device' : null);
    setStatus(enabled ? 'locked' : 'unauthenticated');
  }, []);

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
        // Biometric sign-in registered and no session in this process (or a v0.2.0 biometric lock
        // still on the phone): nothing is refreshed and no credential is readable until the user
        // signs in. Any leftover access token is dropped.
        const biometric = await nativeBiometric.status();
        if (cancelled) return;
        if (biometric.legacy || (biometric.enabled && biometric.locked)) {
          clearStoredToken();
          setUser(null);
          setBiometricLock(biometric.legacy ? 'legacy' : 'device');
          setStatus('locked');
          return;
        }
        setBiometricLock(biometric.enabled ? 'device' : null);
        // The phone itself turned biometric login off (biometrics changed). Explained on the
        // password form, which is where this lands, until the next sign-in.
        if (biometric.invalidatedReason) setLoginNotice(BIOMETRIC_CHANGED_NOTICE);

        if (!getStoredToken()) await refreshAccessToken();
        const me = await apiClient.get<ApiSuccessResponse<AuthUser>>('/auth/me');

        if (cancelled) {
          return;
        }

        setUser(me.data.data);
        if (restoredViaLegacyRef.current) {
          // A v0.2.0 session was carried over: offer the upgrade (the user decides).
          setBiometricOfferMigration(true);
          setBiometricOfferPending(true);
        }
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
          if (restoredViaLegacyRef.current) {
            // The server refused the v0.2.0 session behind the fingerprint (expired, revoked,
            // user inactive). The native layer has already dropped that credential.
            setLoginNotice(BIOMETRIC_SESSION_ENDED_NOTICE);
          }
          setStatus('unauthenticated');
        } else {
          setStatus('unavailable');
        }
      } finally {
        restoredViaLegacyRef.current = false;
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
      // Not the user's choice to sign out, so don't open the prompt over whatever they were doing.
      setAutoPromptBiometric(false);
      void settleSignedOut();
    };

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
  }, [settleSignedOut]);

  // A revocation this phone could not send earlier (offline when biometric login was turned off,
  // or the key was invalidated) is completed as soon as that user is signed in again.
  useEffect(() => {
    if (status !== 'authenticated' || !user) return;
    void flushPendingRevocation(user.id).catch(() => undefined);
  }, [status, user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      status,
      loginNotice,
      biometricOfferPending,
      biometricOfferMigration,
      biometricLock,
      autoPromptBiometric,
      dismissBiometricOffer: () => {
        setBiometricOfferPending(false);
        setBiometricOfferMigration(false);
      },
      login: (accessToken, nextUser) => {
        setStoredToken(accessToken);
        setUser(nextUser);
        setLoginNotice(null);
        void nativeBiometric.acknowledgeInvalidation();
        setBiometricOfferPending(true);
        setAutoPromptBiometric(true);
        setStatus('authenticated');
      },
      logout: async () => {
        // An explicit logout ends the session only. The phone's biometric registration stays, so
        // the screen that follows offers biometric sign-in (without opening the prompt itself).
        setAutoPromptBiometric(false);
        try {
          await logoutSession();
        } finally {
          await settleSignedOut();
        }
      },
      retrySession: () => {
        setStatus('loading');
        setRestoreAttempt((attempt) => attempt + 1);
      },
      signInWithBiometrics: async () => {
        if (biometricLock === 'legacy') {
          // v0.2.0: one prompt moves the working session out of the old envelope, then the usual
          // refresh and /auth/me restore it.
          try {
            await nativeBiometric.unlockLegacy();
          } catch (error) {
            if (error instanceof BiometricError && error.code === 'key-invalidated') {
              setLoginNotice(BIOMETRIC_CHANGED_NOTICE);
              setBiometricLock(null);
              setStatus('unauthenticated');
            }
            throw error;
          }
          restoredViaLegacyRef.current = true;
          setBiometricLock(null);
          setStatus('loading');
          setRestoreAttempt((attempt) => attempt + 1);
          return;
        }

        const registration = await nativeBiometric.status();
        if (!registration.enabled || !registration.deviceId) {
          // The registration disappeared (e.g. biometrics changed since the screen opened).
          if (registration.invalidatedReason) setLoginNotice(BIOMETRIC_CHANGED_NOTICE);
          setBiometricLock(null);
          setStatus('unauthenticated');
          return;
        }
        try {
          const session = await signInWithTrustedDevice(registration.deviceId);
          setStoredToken(session.accessToken);
          setUser(session.user);
          setLoginNotice(null);
          // Signed in by biometrics: no enrolment offer, and the next logout/launch behaves the same.
          setBiometricOfferPending(false);
          setAutoPromptBiometric(true);
          setStatus('authenticated');
        } catch (error) {
          if (error instanceof BiometricError && error.code === 'key-invalidated') {
            setLoginNotice(BIOMETRIC_CHANGED_NOTICE);
            setBiometricLock(null);
            setStatus('unauthenticated');
          } else if (error instanceof TrustedDeviceError && error.code === 'device-invalid') {
            setLoginNotice(DEVICE_AUTHORIZATION_ENDED_NOTICE);
            setBiometricLock(null);
            setStatus('unauthenticated');
          }
          throw error;
        }
      },
      switchToPassword: () => setStatus('unauthenticated'),
      switchToBiometrics: () => {
        if (biometricLock === 'device') setStatus('locked');
      },
    }),
    [
      user,
      status,
      loginNotice,
      biometricOfferPending,
      biometricOfferMigration,
      biometricLock,
      autoPromptBiometric,
      settleSignedOut,
    ],
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
