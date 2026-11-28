import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshCredentialLockedError } from '@erve/client';

const native = vi.hoisted(() => ({
  platform: 'android',
  plugin: {
    setRefreshToken: vi.fn(),
    getRefreshToken: vi.fn(),
    clearRefreshToken: vi.fn(),
    getBiometricStatus: vi.fn(),
    createDeviceKey: vi.fn(),
    signWithDeviceKey: vi.fn(),
    commitDeviceRegistration: vi.fn(),
    discardDeviceKey: vi.fn(),
    removeDeviceAuthorization: vi.fn(),
    clearPendingRevocation: vi.fn(),
    acknowledgeInvalidation: vi.fn(),
    unlockLegacyBiometric: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => native.platform },
  registerPlugin: () => native.plugin,
}));

import { BiometricError, nativeBiometric, nativeSecureSession } from './secure-session.js';

function nativeError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

beforeEach(() => {
  native.platform = 'android';
  for (const method of Object.values(native.plugin)) method.mockReset();
});

describe('nativeSecureSession.get', () => {
  it('returns the credential when it is readable', async () => {
    native.plugin.getRefreshToken.mockResolvedValue({ token: 'refresh' });
    await expect(nativeSecureSession.get()).resolves.toBe('refresh');
  });

  it('reports a biometric-locked credential as a locked (not unreadable) error', async () => {
    native.plugin.getRefreshToken.mockRejectedValue(nativeError('BIOMETRIC_LOCKED'));
    await expect(nativeSecureSession.get()).rejects.toBeInstanceOf(RefreshCredentialLockedError);
  });

  it('passes other native failures through so they are treated as unreadable', async () => {
    const failure = nativeError('UNIMPLEMENTED');
    native.plugin.getRefreshToken.mockRejectedValue(failure);
    await expect(nativeSecureSession.get()).rejects.toBe(failure);
  });
});

describe('nativeBiometric', () => {
  it('is unsupported (and never calls native) outside packaged Android', async () => {
    native.platform = 'web';
    await expect(nativeBiometric.status()).resolves.toMatchObject({
      availability: 'unsupported',
      enabled: false,
      locked: false,
    });
    expect(native.plugin.getBiometricStatus).not.toHaveBeenCalled();
  });

  it('treats an APK without the biometric methods as unsupported', async () => {
    native.plugin.getBiometricStatus.mockRejectedValue(nativeError('UNIMPLEMENTED'));
    await expect(nativeBiometric.status()).resolves.toMatchObject({
      availability: 'unsupported',
      enabled: false,
    });
  });

  it('fills in fields an older native layer does not report', async () => {
    native.plugin.getBiometricStatus.mockResolvedValue({ availability: 'available', enabled: true });
    await expect(nativeBiometric.status()).resolves.toEqual({
      availability: 'available',
      enabled: true,
      locked: false,
      userId: null,
      deviceId: null,
      expiresAt: null,
      legacy: false,
      invalidatedReason: null,
      pendingRevocation: null,
    });
  });

  it('returns the native status', async () => {
    const status = {
      availability: 'available',
      enabled: true,
      locked: true,
      userId: 'u1',
      deviceId: 'd1',
      expiresAt: '2026-12-28T00:00:00.000Z',
      legacy: false,
      invalidatedReason: null,
      pendingRevocation: { deviceId: 'old', userId: 'u1' },
    };
    native.plugin.getBiometricStatus.mockResolvedValue(status);
    await expect(nativeBiometric.status()).resolves.toEqual(status);
  });

  it.each([
    ['BIOMETRIC_CANCELED', 'cancelled'],
    ['BIOMETRIC_LOCKOUT', 'lockout'],
    ['BIOMETRIC_UNAVAILABLE', 'unavailable'],
    ['BIOMETRIC_KEY_INVALIDATED', 'key-invalidated'],
    ['DEVICE_ALREADY_REGISTERED', 'already-registered'],
    ['BIOMETRIC_FAILED', 'failed'],
    ['SOMETHING_ELSE', 'failed'],
  ])('maps native code %s to %s when signing', async (code, expected) => {
    native.plugin.signWithDeviceKey.mockRejectedValue(nativeError(code));
    const error = await nativeBiometric.sign('message', 'sign-in').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BiometricError);
    expect((error as BiometricError).code).toBe(expected);
  });

  it('creates a key, signs a challenge and commits the registration through native', async () => {
    native.plugin.createDeviceKey.mockResolvedValue({
      publicKey: 'spki',
      deviceLabel: 'Pixel',
      appVersion: '0.3.0',
    });
    native.plugin.signWithDeviceKey.mockResolvedValue({ signature: 'sig' });
    native.plugin.commitDeviceRegistration.mockResolvedValue(undefined);

    await expect(nativeBiometric.createKey()).resolves.toMatchObject({ publicKey: 'spki' });
    await expect(nativeBiometric.sign('challenge text', 'register')).resolves.toBe('sig');
    expect(native.plugin.signWithDeviceKey).toHaveBeenCalledWith({
      message: 'challenge text',
      purpose: 'register',
    });
    await nativeBiometric.commit({ deviceId: 'd1', userId: 'u1', expiresAt: 'later' });
    expect(native.plugin.commitDeviceRegistration).toHaveBeenCalledWith({
      deviceId: 'd1',
      userId: 'u1',
      expiresAt: 'later',
    });
  });

  it('removes the device authorization without touching the session credential', async () => {
    native.plugin.removeDeviceAuthorization.mockResolvedValue(undefined);
    await nativeBiometric.remove({ keepPendingRevocation: true });
    expect(native.plugin.removeDeviceAuthorization).toHaveBeenCalledWith({
      keepPendingRevocation: true,
    });
    expect(native.plugin.clearRefreshToken).not.toHaveBeenCalled();
  });

  it('logging out clears the session credential but never the device authorization', async () => {
    native.plugin.clearRefreshToken.mockResolvedValue(undefined);
    await nativeSecureSession.clear();
    expect(native.plugin.clearRefreshToken).toHaveBeenCalledTimes(1);
    expect(native.plugin.removeDeviceAuthorization).not.toHaveBeenCalled();
    expect(native.plugin.discardDeviceKey).not.toHaveBeenCalled();
  });

  it('migrates a v0.2.0 biometric session through native and maps its failure', async () => {
    native.plugin.unlockLegacyBiometric.mockResolvedValue(undefined);
    await nativeBiometric.unlockLegacy();
    native.plugin.unlockLegacyBiometric.mockRejectedValue(nativeError('BIOMETRIC_KEY_INVALIDATED'));
    await expect(nativeBiometric.unlockLegacy()).rejects.toMatchObject({ code: 'key-invalidated' });
  });
});
