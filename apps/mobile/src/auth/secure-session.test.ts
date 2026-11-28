import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshCredentialLockedError } from '@erve/client';

const native = vi.hoisted(() => ({
  platform: 'android',
  plugin: {
    setRefreshToken: vi.fn(),
    getRefreshToken: vi.fn(),
    clearRefreshToken: vi.fn(),
    getBiometricStatus: vi.fn(),
    enableBiometric: vi.fn(),
    unlockBiometric: vi.fn(),
    disableBiometric: vi.fn(),
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

  it('returns the native status', async () => {
    const status = { availability: 'available', enabled: true, locked: true, userId: 'u1' };
    native.plugin.getBiometricStatus.mockResolvedValue(status);
    await expect(nativeBiometric.status()).resolves.toEqual(status);
  });

  it.each([
    ['BIOMETRIC_CANCELED', 'cancelled'],
    ['BIOMETRIC_LOCKOUT', 'lockout'],
    ['BIOMETRIC_UNAVAILABLE', 'unavailable'],
    ['BIOMETRIC_KEY_INVALIDATED', 'key-invalidated'],
    ['NO_SESSION', 'no-session'],
    ['BIOMETRIC_FAILED', 'failed'],
    ['SOMETHING_ELSE', 'failed'],
  ])('maps native code %s to %s when unlocking', async (code, expected) => {
    native.plugin.unlockBiometric.mockRejectedValue(nativeError(code));
    const error = await nativeBiometric.unlock().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BiometricError);
    expect((error as BiometricError).code).toBe(expected);
  });

  it('passes the user id when enabling and maps its failures', async () => {
    native.plugin.enableBiometric.mockResolvedValue(undefined);
    await nativeBiometric.enable('user-1');
    expect(native.plugin.enableBiometric).toHaveBeenCalledWith({ userId: 'user-1' });

    native.plugin.enableBiometric.mockRejectedValue(nativeError('BIOMETRIC_CANCELED'));
    await expect(nativeBiometric.enable('user-1')).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('disables through the native layer', async () => {
    native.plugin.disableBiometric.mockResolvedValue(undefined);
    await nativeBiometric.disable();
    expect(native.plugin.disableBiometric).toHaveBeenCalledTimes(1);
  });
});
