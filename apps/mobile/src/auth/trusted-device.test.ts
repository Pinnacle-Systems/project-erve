import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { apiClient } from '@erve/client';

const native = vi.hoisted(() => ({
  biometric: {
    status: vi.fn(),
    createKey: vi.fn(),
    sign: vi.fn(),
    commit: vi.fn(),
    discardKey: vi.fn(),
    remove: vi.fn(),
    clearPendingRevocation: vi.fn(),
    acknowledgeInvalidation: vi.fn(),
    unlockLegacy: vi.fn(),
  },
  session: { set: vi.fn(), get: vi.fn(), clear: vi.fn(), isAvailable: () => true },
}));

vi.mock('./secure-session.js', async () => {
  class BiometricError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return { BiometricError, nativeBiometric: native.biometric, nativeSecureSession: native.session };
});

import { BiometricError } from './secure-session.js';
import {
  TrustedDeviceError,
  disableTrustedDevice,
  enableTrustedDevice,
  flushPendingRevocation,
  signInWithTrustedDevice,
} from './trusted-device.js';

const DEVICE = {
  id: 'device-1',
  label: 'Pixel',
  platform: 'ANDROID',
  appVersion: '0.3.0',
  createdAt: '2026-11-28T00:00:00.000Z',
  expiresAt: '2026-12-28T00:00:00.000Z',
  lastUsedAt: null,
};
const USER = { id: 'user-1', email: 'a@test.local', mobile: null, name: 'A', roles: ['QA_USER'] };

interface Call {
  method: string;
  url: string;
  body: unknown;
  params: unknown;
}
let calls: Call[];
let original: typeof apiClient.defaults.adapter;

function respond(config: InternalAxiosRequestConfig, data: unknown, status = 200): AxiosResponse {
  return { data: { success: true, data }, status, statusText: 'OK', headers: {}, config };
}

function failure(config: InternalAxiosRequestConfig, status: number, code?: string): never {
  throw new AxiosError('failed', AxiosError.ERR_BAD_REQUEST, config, undefined, {
    data: { success: false, error: { code } },
    status,
    statusText: 'failed',
    headers: {},
    config,
  });
}

function offline(config: InternalAxiosRequestConfig): never {
  throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
}

function serve(handler: (config: InternalAxiosRequestConfig, call: Call) => AxiosResponse) {
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    const call: Call = {
      method: (config.method ?? 'get').toUpperCase(),
      url: config.url ?? '',
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
      params: config.params,
    };
    calls.push(call);
    return handler(config, call);
  }) satisfies AxiosAdapter;
}

beforeEach(() => {
  calls = [];
  original = apiClient.defaults.adapter;
  vi.stubGlobal('sessionStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  });
  for (const fn of Object.values(native.biometric)) fn.mockReset().mockResolvedValue(undefined);
  for (const fn of [native.session.set, native.session.get, native.session.clear]) {
    fn.mockReset().mockResolvedValue(undefined);
  }
  native.biometric.createKey.mockResolvedValue({
    publicKey: 'spki-key',
    deviceLabel: 'Pixel',
    appVersion: '0.3.0',
  });
  native.biometric.sign.mockResolvedValue('signature');
});

afterEach(() => {
  apiClient.defaults.adapter = original;
  vi.unstubAllGlobals();
});

describe('enableTrustedDevice', () => {
  it('registers the public key after one biometric signature and only then commits locally', async () => {
    serve((config, call) => {
      if (call.url === '/auth/trusted-devices/challenge') {
        return respond(config, { challengeId: 'c1', message: 'text-to-sign', expiresAt: 'x' });
      }
      if (call.url === '/auth/trusted-devices') return respond(config, { device: DEVICE }, 201);
      throw new Error(`unexpected ${call.url}`);
    });

    await expect(enableTrustedDevice('user-1')).resolves.toEqual(DEVICE);

    expect(native.biometric.sign).toHaveBeenCalledWith('text-to-sign', 'register');
    expect(calls.map((call) => call.url)).toEqual([
      '/auth/trusted-devices/challenge',
      '/auth/trusted-devices',
    ]);
    // Only the public key, the signature and descriptive metadata ever reach the server.
    expect(calls[1]!.body).toEqual({
      challengeId: 'c1',
      publicKey: 'spki-key',
      signature: 'signature',
      label: 'Pixel',
      appVersion: '0.3.0',
    });
    expect(native.biometric.commit).toHaveBeenCalledWith({
      deviceId: 'device-1',
      userId: 'user-1',
      expiresAt: DEVICE.expiresAt,
    });
    expect(native.biometric.discardKey).not.toHaveBeenCalled();
  });

  it('discards the new key and registers nothing when the prompt is cancelled', async () => {
    serve((config, call) =>
      respond(config, { challengeId: 'c1', message: call.url, expiresAt: 'x' }),
    );
    native.biometric.sign.mockRejectedValue(new BiometricError('cancelled'));

    await expect(enableTrustedDevice('user-1')).rejects.toMatchObject({ code: 'cancelled' });

    expect(calls.map((call) => call.url)).toEqual(['/auth/trusted-devices/challenge']);
    expect(native.biometric.discardKey).toHaveBeenCalledTimes(1);
    expect(native.biometric.commit).not.toHaveBeenCalled();
  });

  it.each([
    [403, 'PASSWORD_SIGN_IN_REQUIRED', 'password-required'],
    [409, 'DEVICE_LIMIT_REACHED', 'device-limit'],
    [503, undefined, 'server'],
  ])('discards the key when the server answers %i %s', async (status, code, expected) => {
    serve((config, call) => {
      if (call.url === '/auth/trusted-devices/challenge') {
        return respond(config, { challengeId: 'c1', message: 'm', expiresAt: 'x' });
      }
      return failure(config, status, code);
    });

    await expect(enableTrustedDevice('user-1')).rejects.toMatchObject({ code: expected });
    expect(native.biometric.discardKey).toHaveBeenCalledTimes(1);
    expect(native.biometric.commit).not.toHaveBeenCalled();
  });

  it('reports offline and leaves nothing behind', async () => {
    serve((config) => offline(config));
    await expect(enableTrustedDevice('user-1')).rejects.toMatchObject({ code: 'offline' });
    expect(native.biometric.discardKey).toHaveBeenCalledTimes(1);
  });

  it('takes the authorization back from the server if this phone cannot adopt the key', async () => {
    serve((config, call) => {
      if (call.url === '/auth/trusted-devices/challenge') {
        return respond(config, { challengeId: 'c1', message: 'm', expiresAt: 'x' });
      }
      if (call.method === 'POST') return respond(config, { device: DEVICE }, 201);
      return respond(config, {});
    });
    native.biometric.commit.mockRejectedValue(new BiometricError('key-invalidated'));

    await expect(enableTrustedDevice('user-1')).rejects.toMatchObject({ code: 'key-invalidated' });

    const revoke = calls.find((call) => call.method === 'DELETE');
    expect(revoke?.url).toBe('/auth/trusted-devices/device-1');
    expect(native.biometric.discardKey).toHaveBeenCalledTimes(1);
  });
});

describe('signInWithTrustedDevice', () => {
  const challenge = { challengeId: 'c9', message: 'sign-in-text', expiresAt: 'x' };

  it('exchanges a biometric signature for a new session and stores its refresh credential', async () => {
    serve((config, call) => {
      if (call.url === '/auth/mobile/trusted-device/challenge') return respond(config, challenge);
      if (call.url === '/auth/mobile/trusted-device/sign-in') {
        return respond(config, {
          accessToken: 'access-1',
          refreshToken: 'refresh-1',
          user: USER,
          trustedDevice: { id: 'device-1', expiresAt: DEVICE.expiresAt },
        });
      }
      throw new Error(`unexpected ${call.url}`);
    });

    await expect(signInWithTrustedDevice('device-1')).resolves.toEqual({
      accessToken: 'access-1',
      user: USER,
    });

    expect(calls[0]!.body).toEqual({ deviceId: 'device-1' });
    expect(native.biometric.sign).toHaveBeenCalledWith('sign-in-text', 'sign-in');
    expect(calls[1]!.body).toEqual({
      deviceId: 'device-1',
      challengeId: 'c9',
      signature: 'signature',
    });
    expect(native.session.set).toHaveBeenCalledWith('refresh-1');
  });

  it('never shows the prompt when the server is unreachable', async () => {
    serve((config) => offline(config));
    await expect(signInWithTrustedDevice('device-1')).rejects.toMatchObject({ code: 'offline' });
    expect(native.biometric.sign).not.toHaveBeenCalled();
    expect(native.biometric.remove).not.toHaveBeenCalled();
  });

  it.each([
    [429, undefined, 'rate-limited'],
    [503, undefined, 'server'],
  ])('keeps the registration on a transient %i', async (status, code, expected) => {
    serve((config) => failure(config, status, code));
    await expect(signInWithTrustedDevice('device-1')).rejects.toMatchObject({ code: expected });
    expect(native.biometric.remove).not.toHaveBeenCalled();
  });

  it('keeps the registration when the biometric prompt is cancelled or fails', async () => {
    serve((config) => respond(config, challenge));
    native.biometric.sign.mockRejectedValue(new BiometricError('cancelled'));
    await expect(signInWithTrustedDevice('device-1')).rejects.toMatchObject({ code: 'cancelled' });
    expect(calls).toHaveLength(1);
    expect(native.biometric.remove).not.toHaveBeenCalled();
    expect(native.session.set).not.toHaveBeenCalled();
  });

  it.each(['challenge', 'sign-in'])(
    'drops the local key when the server says the device is no longer authorized (%s)',
    async (stage) => {
      serve((config, call) => {
        if (call.url.endsWith('/challenge')) {
          return stage === 'challenge'
            ? failure(config, 401, 'DEVICE_AUTHORIZATION_INVALID')
            : respond(config, challenge);
        }
        return failure(config, 401, 'DEVICE_AUTHORIZATION_INVALID');
      });

      const error = await signInWithTrustedDevice('device-1').catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(TrustedDeviceError);
      expect((error as TrustedDeviceError).code).toBe('device-invalid');
      // Nothing is left to revoke on the server, so no pending revocation is kept.
      expect(native.biometric.remove).toHaveBeenCalledWith({ keepPendingRevocation: false });
      expect(native.session.set).not.toHaveBeenCalled();
    },
  );

  it('does not store a session when the response carries no refresh credential', async () => {
    serve((config, call) =>
      call.url.endsWith('/challenge')
        ? respond(config, challenge)
        : respond(config, { accessToken: 'a', user: USER }),
    );
    await expect(signInWithTrustedDevice('device-1')).rejects.toBeInstanceOf(TrustedDeviceError);
    expect(native.session.set).not.toHaveBeenCalled();
  });
});

describe('disableTrustedDevice', () => {
  const pending = { deviceId: 'device-1', userId: 'user-1' };

  it('deletes the key first, then revokes on the server while keeping the session', async () => {
    const order: string[] = [];
    native.biometric.remove.mockImplementation(async () => void order.push('remove-local'));
    native.biometric.status.mockResolvedValue({ pendingRevocation: pending });
    native.biometric.clearPendingRevocation.mockImplementation(async () => void order.push('clear-pending'));
    serve((config, call) => {
      order.push(`server:${call.method}`);
      return respond(config, {});
    });

    await expect(disableTrustedDevice()).resolves.toBe(true);

    expect(order).toEqual(['remove-local', 'server:DELETE', 'clear-pending']);
    expect(native.biometric.remove).toHaveBeenCalledWith({ keepPendingRevocation: true });
    expect(calls[0]).toMatchObject({
      method: 'DELETE',
      url: '/auth/trusted-devices/device-1',
      params: { revokeSessions: false },
    });
  });

  it('is still turned off locally, and remembers the revocation, when the network is down', async () => {
    native.biometric.status.mockResolvedValue({ pendingRevocation: pending });
    serve((config) => offline(config));

    await expect(disableTrustedDevice()).resolves.toBe(false);

    expect(native.biometric.remove).toHaveBeenCalledWith({ keepPendingRevocation: true });
    expect(native.biometric.clearPendingRevocation).not.toHaveBeenCalled();
  });

  it('keeps the revocation pending on a server error too', async () => {
    native.biometric.status.mockResolvedValue({ pendingRevocation: pending });
    serve((config) => failure(config, 500));
    await expect(disableTrustedDevice()).resolves.toBe(false);
    expect(native.biometric.clearPendingRevocation).not.toHaveBeenCalled();
  });

  it('has nothing to send when no registration was recorded', async () => {
    native.biometric.status.mockResolvedValue({ pendingRevocation: null });
    serve((config) => respond(config, {}));
    await expect(disableTrustedDevice()).resolves.toBe(true);
    expect(calls).toHaveLength(0);
  });
});

describe('flushPendingRevocation', () => {
  const pending = { deviceId: 'device-1', userId: 'user-1' };

  it('only completes a revocation for the user who is signed in', async () => {
    native.biometric.status.mockResolvedValue({ pendingRevocation: pending });
    serve((config) => respond(config, {}));
    await expect(flushPendingRevocation('someone-else')).resolves.toBe(false);
    expect(calls).toHaveLength(0);
    expect(native.biometric.clearPendingRevocation).not.toHaveBeenCalled();
  });

  it('treats an already-removed device as done', async () => {
    native.biometric.status.mockResolvedValue({ pendingRevocation: pending });
    serve((config) => failure(config, 404, 'NOT_FOUND'));
    await expect(flushPendingRevocation('user-1')).resolves.toBe(true);
    expect(native.biometric.clearPendingRevocation).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when nothing is pending', async () => {
    native.biometric.status.mockResolvedValue({ pendingRevocation: null });
    await expect(flushPendingRevocation('user-1')).resolves.toBe(true);
  });
});
