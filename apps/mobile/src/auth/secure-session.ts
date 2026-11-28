import { Capacitor, registerPlugin } from '@capacitor/core';
import { RefreshCredentialLockedError } from '@erve/client';

export type BiometricAvailability =
  /** Strong (Class 3) biometrics are present and enrolled. */
  | 'available'
  | 'no-hardware'
  | 'none-enrolled'
  | 'unsupported'
  /** Present but not usable right now (e.g. security update required, hardware busy). */
  | 'unavailable';

export interface BiometricStatus {
  availability: BiometricAvailability;
  /** Biometric login is on: the refresh credential is only readable after a biometric prompt. */
  enabled: boolean;
  /** Enabled, and the prompt has not been passed in this app process yet. */
  locked: boolean;
  /** The Erve user the biometric login was enabled for. */
  userId: string | null;
}

export type BiometricErrorCode =
  | 'cancelled'
  | 'lockout'
  | 'unavailable'
  | 'key-invalidated'
  | 'no-session'
  | 'failed';

export class BiometricError extends Error {
  constructor(
    public readonly code: BiometricErrorCode,
    options?: ErrorOptions,
  ) {
    super(`Biometric authentication: ${code}`, options);
    this.name = 'BiometricError';
  }
}

interface SecureSessionPlugin {
  setRefreshToken(options: { token: string }): Promise<void>;
  getRefreshToken(): Promise<{ token: string | null }>;
  clearRefreshToken(): Promise<void>;
  getBiometricStatus(): Promise<BiometricStatus>;
  enableBiometric(options: { userId: string }): Promise<void>;
  unlockBiometric(): Promise<void>;
  disableBiometric(): Promise<void>;
}

const SecureSessionBridge = registerPlugin<SecureSessionPlugin>('SecureSessionBridge');

const NATIVE_CODES: Record<string, BiometricErrorCode> = {
  BIOMETRIC_CANCELED: 'cancelled',
  BIOMETRIC_LOCKOUT: 'lockout',
  BIOMETRIC_UNAVAILABLE: 'unavailable',
  BIOMETRIC_KEY_INVALIDATED: 'key-invalidated',
  NO_SESSION: 'no-session',
};

function nativeErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

function toBiometricError(error: unknown): BiometricError {
  const code = nativeErrorCode(error);
  return new BiometricError((code && NATIVE_CODES[code]) || 'failed', { cause: error });
}

export const nativeSecureSession = {
  isAvailable: () => Capacitor.getPlatform() === 'android',
  async get(): Promise<string | null> {
    if (!this.isAvailable()) return null;
    try {
      return (await SecureSessionBridge.getRefreshToken()).token;
    } catch (error) {
      // Biometric login is on and has not been passed: not a failure, and the stored credential
      // must be left alone (see RefreshCredentialLockedError).
      if (nativeErrorCode(error) === 'BIOMETRIC_LOCKED') {
        throw new RefreshCredentialLockedError({ cause: error });
      }
      throw error;
    }
  },
  async set(token: string): Promise<void> {
    if (this.isAvailable()) await SecureSessionBridge.setRefreshToken({ token });
  },
  /** Removes the credential and, with it, any biometric login. Used by logout and rejected sessions. */
  async clear(): Promise<void> {
    if (this.isAvailable()) await SecureSessionBridge.clearRefreshToken();
  },
};

const UNSUPPORTED_STATUS: BiometricStatus = {
  availability: 'unsupported',
  enabled: false,
  locked: false,
  userId: null,
};

/** Native biometric login. Everywhere except packaged Android it reports `unsupported`. */
export const nativeBiometric = {
  async status(): Promise<BiometricStatus> {
    if (!nativeSecureSession.isAvailable()) return UNSUPPORTED_STATUS;
    try {
      return await SecureSessionBridge.getBiometricStatus();
    } catch {
      // An older APK without the biometric methods: behave as if there is no biometric login.
      return UNSUPPORTED_STATUS;
    }
  },
  /** Shows the system prompt to confirm enrolment, then moves the credential behind it. */
  async enable(userId: string): Promise<void> {
    try {
      await SecureSessionBridge.enableBiometric({ userId });
    } catch (error) {
      throw toBiometricError(error);
    }
  },
  /** Shows the system prompt; on success the credential is readable by this process. */
  async unlock(): Promise<void> {
    try {
      await SecureSessionBridge.unlockBiometric();
    } catch (error) {
      throw toBiometricError(error);
    }
  },
  /** Turns biometric login off and keeps the current session signed in. */
  async disable(): Promise<void> {
    try {
      await SecureSessionBridge.disableBiometric();
    } catch (error) {
      throw toBiometricError(error);
    }
  },
};
