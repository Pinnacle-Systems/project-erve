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

/** A device registration this phone dropped locally but could not yet revoke on the server. */
export interface PendingRevocation {
  deviceId: string;
  userId: string;
}

export interface BiometricStatus {
  availability: BiometricAvailability;
  /**
   * Biometric sign-in is set up on this phone: a trusted-device key exists in the Keystore and
   * is registered with the server. It survives logout.
   */
  enabled: boolean;
  /** Enabled, and no session is held in this app process: a biometric (or password) sign-in is needed. */
  locked: boolean;
  /** The Erve user the registration belongs to. */
  userId: string | null;
  /** The server-side device id of this registration. */
  deviceId: string | null;
  /** When the server authorization ends (a hint; the server is authoritative). */
  expiresAt: string | null;
  /** A v0.2.0 biometric-protected refresh credential is still on this phone and must be migrated. */
  legacy: boolean;
  /** Set when the phone itself turned biometric login off, e.g. because biometrics changed. */
  invalidatedReason: 'key-invalidated' | null;
  pendingRevocation: PendingRevocation | null;
}

export type BiometricErrorCode =
  | 'cancelled'
  | 'lockout'
  | 'unavailable'
  | 'key-invalidated'
  | 'already-registered'
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

export interface DeviceKeyInfo {
  /** Base64 SPKI DER of the new EC P-256 public key. */
  publicKey: string;
  deviceLabel: string;
  appVersion: string;
}

export type SignPurpose = 'register' | 'sign-in';

interface SecureSessionPlugin {
  setRefreshToken(options: { token: string }): Promise<void>;
  getRefreshToken(): Promise<{ token: string | null }>;
  clearRefreshToken(): Promise<void>;
  getBiometricStatus(): Promise<Partial<BiometricStatus> & { availability: BiometricAvailability }>;
  createDeviceKey(): Promise<DeviceKeyInfo>;
  signWithDeviceKey(options: { message: string; purpose: SignPurpose }): Promise<{ signature: string }>;
  commitDeviceRegistration(options: {
    deviceId: string;
    userId: string;
    expiresAt: string;
  }): Promise<void>;
  discardDeviceKey(): Promise<void>;
  removeDeviceAuthorization(options: { keepPendingRevocation: boolean }): Promise<void>;
  clearPendingRevocation(): Promise<void>;
  acknowledgeInvalidation(): Promise<void>;
  unlockLegacyBiometric(): Promise<void>;
}

const SecureSessionBridge = registerPlugin<SecureSessionPlugin>('SecureSessionBridge');

const NATIVE_CODES: Record<string, BiometricErrorCode> = {
  BIOMETRIC_CANCELED: 'cancelled',
  BIOMETRIC_LOCKOUT: 'lockout',
  BIOMETRIC_UNAVAILABLE: 'unavailable',
  BIOMETRIC_KEY_INVALIDATED: 'key-invalidated',
  DEVICE_ALREADY_REGISTERED: 'already-registered',
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
      // Biometric sign-in is set up and no session exists in this process: not a failure, and
      // nothing may be cleared (see RefreshCredentialLockedError).
      if (nativeErrorCode(error) === 'BIOMETRIC_LOCKED') {
        throw new RefreshCredentialLockedError({ cause: error });
      }
      throw error;
    }
  },
  async set(token: string): Promise<void> {
    if (this.isAvailable()) await SecureSessionBridge.setRefreshToken({ token });
  },
  /**
   * Ends the stored session. Used by logout and rejected or expired sessions. It does NOT touch
   * the biometric trusted-device registration, which is what lets a logged-out user sign back in.
   */
  async clear(): Promise<void> {
    if (this.isAvailable()) await SecureSessionBridge.clearRefreshToken();
  },
};

const UNSUPPORTED_STATUS: BiometricStatus = {
  availability: 'unsupported',
  enabled: false,
  locked: false,
  userId: null,
  deviceId: null,
  expiresAt: null,
  legacy: false,
  invalidatedReason: null,
  pendingRevocation: null,
};

/** Native biometric trusted-device operations. Everywhere except packaged Android: `unsupported`. */
export const nativeBiometric = {
  async status(): Promise<BiometricStatus> {
    if (!nativeSecureSession.isAvailable()) return UNSUPPORTED_STATUS;
    try {
      const status = await SecureSessionBridge.getBiometricStatus();
      return { ...UNSUPPORTED_STATUS, ...status, availability: status.availability };
    } catch {
      // An older APK without these methods: behave as if there is no biometric login.
      return UNSUPPORTED_STATUS;
    }
  },
  /** Creates the device key (no prompt) and returns its public half. Not trusted until committed. */
  async createKey(): Promise<DeviceKeyInfo> {
    try {
      return await SecureSessionBridge.createDeviceKey();
    } catch (error) {
      throw toBiometricError(error);
    }
  },
  /** Shows the system prompt bound to the key and returns the signature over `message`. */
  async sign(message: string, purpose: SignPurpose): Promise<string> {
    try {
      return (await SecureSessionBridge.signWithDeviceKey({ message, purpose })).signature;
    } catch (error) {
      throw toBiometricError(error);
    }
  },
  /** The server accepted the key: marks this phone registered and keeps the session in memory only. */
  async commit(registration: { deviceId: string; userId: string; expiresAt: string }): Promise<void> {
    try {
      await SecureSessionBridge.commitDeviceRegistration(registration);
    } catch (error) {
      throw toBiometricError(error);
    }
  },
  /** Enabling failed or was abandoned: removes the uncommitted key. */
  async discardKey(): Promise<void> {
    await SecureSessionBridge.discardDeviceKey().catch(() => undefined);
  },
  /**
   * Deletes this phone's signing key and registration metadata and keeps any live session signed in.
   * `keepPendingRevocation` remembers the server record so it can still be revoked later.
   */
  async remove(options: { keepPendingRevocation: boolean }): Promise<void> {
    try {
      await SecureSessionBridge.removeDeviceAuthorization(options);
    } catch (error) {
      throw toBiometricError(error);
    }
  },
  async clearPendingRevocation(): Promise<void> {
    await SecureSessionBridge.clearPendingRevocation();
  },
  async acknowledgeInvalidation(): Promise<void> {
    if (nativeSecureSession.isAvailable()) {
      await SecureSessionBridge.acknowledgeInvalidation().catch(() => undefined);
    }
  },
  /** v0.2.0 upgrade: one prompt moves the existing session out of the old biometric envelope. */
  async unlockLegacy(): Promise<void> {
    try {
      await SecureSessionBridge.unlockLegacyBiometric();
    } catch (error) {
      throw toBiometricError(error);
    }
  },
};
