/** @vitest-environment jsdom */
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import {
  apiClient,
  configureRefreshCredentialProvider,
  getStoredToken,
  setStoredToken,
} from '@erve/client';
import type { AuthUser } from '@erve/types';

const biometric = vi.hoisted(() => ({
  status: vi.fn(),
  unlockLegacy: vi.fn(),
  acknowledgeInvalidation: vi.fn(),
  signIn: vi.fn(),
  flush: vi.fn(),
  logoutSession: vi.fn(),
}));

vi.mock('./secure-session.js', async () => {
  class BiometricError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return {
    BiometricError,
    nativeBiometric: {
      status: biometric.status,
      unlockLegacy: biometric.unlockLegacy,
      acknowledgeInvalidation: biometric.acknowledgeInvalidation,
    },
    nativeSecureSession: { isAvailable: () => false },
  };
});

vi.mock('./trusted-device.js', async () => {
  class TrustedDeviceError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return {
    TrustedDeviceError,
    signInWithTrustedDevice: biometric.signIn,
    flushPendingRevocation: biometric.flush,
  };
});

vi.mock('../lib/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api-client.js')>();
  return { ...actual, logoutSession: biometric.logoutSession };
});

import {
  AuthProvider,
  BIOMETRIC_CHANGED_NOTICE,
  BIOMETRIC_SESSION_ENDED_NOTICE,
  useAuth,
} from './AuthContext.js';
import { BiometricError } from './secure-session.js';
import { TrustedDeviceError } from './trusted-device.js';
import { DEVICE_AUTHORIZATION_ENDED_NOTICE } from './biometric-messages.js';
import { AUTH_EXPIRED_EVENT } from '../lib/api-client.js';

const USER: AuthUser = {
  id: 'user-1',
  email: 'qa@test.local',
  mobile: null,
  name: 'QA',
  roles: ['QA_USER'],
};

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function reject(config: InternalAxiosRequestConfig, status: number): never {
  throw new AxiosError('rejected', AxiosError.ERR_BAD_REQUEST, config, undefined, {
    data: { success: false },
    status,
    statusText: 'rejected',
    headers: {},
    config,
  });
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  sessionStorage.clear();
  configureRefreshCredentialProvider(null);
  biometric.status.mockReset();
  biometric.unlockLegacy.mockReset();
  biometric.acknowledgeInvalidation.mockReset().mockResolvedValue(undefined);
  biometric.signIn.mockReset();
  biometric.flush.mockReset().mockResolvedValue(true);
  biometric.logoutSession.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  sessionStorage.clear();
  configureRefreshCredentialProvider(null);
});

type Captured = ReturnType<typeof useAuth>;

function Probe({ onAuth }: { onAuth: (value: Captured) => void }) {
  const auth = useAuth();
  useEffect(() => {
    onAuth(auth);
  }, [auth, onAuth]);
  return null;
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function renderAuth(): Promise<() => Captured> {
  let captured: Captured | undefined;
  act(() => {
    root.render(
      <AuthProvider>
        <Probe onAuth={(value) => (captured = value)} />
      </AuthProvider>,
    );
  });
  await act(async () => {
    await settle();
  });
  return () => captured!;
}

const REGISTERED = {
  availability: 'available',
  enabled: true,
  locked: true,
  userId: USER.id,
  deviceId: 'device-1',
  expiresAt: '2026-12-28T00:00:00.000Z',
  legacy: false,
  invalidatedReason: null,
  pendingRevocation: null,
};
const NOT_REGISTERED = {
  ...REGISTERED,
  enabled: false,
  locked: false,
  userId: null,
  deviceId: null,
  expiresAt: null,
};
const LEGACY = { ...NOT_REGISTERED, legacy: true };
const UNSUPPORTED = { ...NOT_REGISTERED, availability: 'unsupported' };

/** No stored credential and no session: the refresh the app tries at launch is rejected. */
function serveNoSession() {
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
    reject(config, 401),
  ) satisfies AxiosAdapter;
}

function serveUser() {
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
    ok(config, { success: true, data: USER }),
  ) satisfies AxiosAdapter;
}

describe('mobile AuthContext — biometric trusted-device sign-in', () => {
  it('is locked at launch without touching the credential or the API', async () => {
    biometric.status.mockResolvedValue(REGISTERED);
    const provider = {
      get: vi.fn(async () => 'must-not-be-read'),
      set: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    configureRefreshCredentialProvider(provider);
    // A leftover access token must not authenticate a locked app either.
    setStoredToken('stale-access-token');
    apiClient.defaults.adapter = vi.fn(async () => {
      throw new Error('No request may be made while locked');
    }) satisfies AxiosAdapter;

    const latest = await renderAuth();

    expect(latest().status).toBe('locked');
    expect(latest().biometricLock).toBe('device');
    expect(latest().autoPromptBiometric).toBe(true);
    expect(latest().user).toBeNull();
    expect(provider.get).not.toHaveBeenCalled();
    expect(provider.clear).not.toHaveBeenCalled();
    expect(apiClient.defaults.adapter).not.toHaveBeenCalled();
    expect(getStoredToken()).toBeNull();
  });

  it('signs in with the device: a fresh session, no password, no extra refresh', async () => {
    biometric.status.mockResolvedValue(REGISTERED);
    biometric.signIn.mockResolvedValue({ accessToken: 'new-access', user: USER });
    apiClient.defaults.adapter = vi.fn(async () => {
      throw new Error('Signing in must not refresh or call /auth/me');
    }) satisfies AxiosAdapter;
    const latest = await renderAuth();

    await act(async () => {
      await latest().signInWithBiometrics();
    });

    expect(biometric.signIn).toHaveBeenCalledWith('device-1');
    expect(latest().status).toBe('authenticated');
    expect(latest().user).toEqual(USER);
    expect(getStoredToken()).toBe('new-access');
    // Signed in by biometrics: nothing to enrol, so no offer.
    expect(latest().biometricOfferPending).toBe(false);
    expect(apiClient.defaults.adapter).not.toHaveBeenCalled();
  });

  it('after an explicit logout returns to the biometric screen, registration intact, without auto-prompting', async () => {
    biometric.status.mockResolvedValue(NOT_REGISTERED);
    serveUser();
    setStoredToken('access');
    const latest = await renderAuth();
    expect(latest().status).toBe('authenticated');

    // The phone is registered, and once the session is cleared it is locked.
    biometric.status.mockResolvedValue(REGISTERED);
    await act(async () => {
      await latest().logout();
    });

    expect(biometric.logoutSession).toHaveBeenCalledTimes(1);
    expect(latest().status).toBe('locked');
    expect(latest().user).toBeNull();
    expect(latest().autoPromptBiometric).toBe(false);

    // And it signs back in: the mandatory acceptance path.
    biometric.signIn.mockResolvedValue({ accessToken: 'second-access', user: USER });
    await act(async () => {
      await latest().signInWithBiometrics();
    });
    expect(latest().status).toBe('authenticated');
    expect(getStoredToken()).toBe('second-access');
    expect(latest().autoPromptBiometric).toBe(true);
  });

  it('logout without a registration goes to the password form as before', async () => {
    biometric.status.mockResolvedValue(NOT_REGISTERED);
    serveUser();
    setStoredToken('access');
    const latest = await renderAuth();

    await act(async () => {
      await latest().logout();
    });

    expect(latest().status).toBe('unauthenticated');
    expect(latest().biometricLock).toBeNull();
  });

  it('still ends the local session when the logout request fails, and offers biometrics', async () => {
    biometric.status.mockResolvedValue(NOT_REGISTERED);
    serveUser();
    setStoredToken('access');
    const latest = await renderAuth();
    biometric.status.mockResolvedValue(REGISTERED);
    biometric.logoutSession.mockRejectedValue(new Error('offline'));

    await act(async () => {
      await expect(latest().logout()).rejects.toThrow('offline');
    });

    expect(latest().status).toBe('locked');
    expect(latest().user).toBeNull();
  });

  it('offers biometric sign-in again when the session ends mid-use (expired or revoked)', async () => {
    biometric.status.mockResolvedValue(NOT_REGISTERED);
    serveUser();
    setStoredToken('access');
    const latest = await renderAuth();
    biometric.status.mockResolvedValue(REGISTERED);

    await act(async () => {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      await settle();
    });

    expect(latest().status).toBe('locked');
    expect(latest().autoPromptBiometric).toBe(false);
  });

  it('keeps the locked screen (and its retry/password choices) when the prompt is cancelled', async () => {
    biometric.status.mockResolvedValue(REGISTERED);
    biometric.signIn.mockRejectedValue(new BiometricError('cancelled'));
    const latest = await renderAuth();

    await act(async () => {
      await expect(latest().signInWithBiometrics()).rejects.toMatchObject({ code: 'cancelled' });
    });

    expect(latest().status).toBe('locked');
    expect(latest().biometricLock).toBe('device');
  });

  it.each(['offline', 'server', 'rate-limited'])(
    'stays locked, with the registration, on a transient failure (%s)',
    async (code) => {
      biometric.status.mockResolvedValue(REGISTERED);
      biometric.signIn.mockRejectedValue(new TrustedDeviceError(code as never));
      const latest = await renderAuth();

      await act(async () => {
        await expect(latest().signInWithBiometrics()).rejects.toMatchObject({ code });
      });

      expect(latest().status).toBe('locked');
    },
  );

  it('moves to the password form with an explanation when the device authorization is gone', async () => {
    biometric.status.mockResolvedValue(REGISTERED);
    biometric.signIn.mockRejectedValue(new TrustedDeviceError('device-invalid'));
    const latest = await renderAuth();

    await act(async () => {
      await expect(latest().signInWithBiometrics()).rejects.toMatchObject({
        code: 'device-invalid',
      });
    });

    expect(latest().status).toBe('unauthenticated');
    expect(latest().loginNotice).toBe(DEVICE_AUTHORIZATION_ENDED_NOTICE);
    expect(latest().biometricLock).toBeNull();
  });

  it('requires the password, with an explanation, when the biometric key was invalidated', async () => {
    biometric.status.mockResolvedValue(REGISTERED);
    biometric.signIn.mockRejectedValue(new BiometricError('key-invalidated'));
    const latest = await renderAuth();

    await act(async () => {
      await expect(latest().signInWithBiometrics()).rejects.toMatchObject({
        code: 'key-invalidated',
      });
    });

    expect(latest().status).toBe('unauthenticated');
    expect(latest().loginNotice).toBe(BIOMETRIC_CHANGED_NOTICE);
  });

  it('explains on the password form when the phone dropped biometric login while the app was closed', async () => {
    biometric.status.mockResolvedValue({ ...NOT_REGISTERED, invalidatedReason: 'key-invalidated' });
    serveNoSession();
    const latest = await renderAuth();

    expect(latest().status).toBe('unauthenticated');
    expect(latest().loginNotice).toBe(BIOMETRIC_CHANGED_NOTICE);

    // A password sign-in clears the notice and the native one-time marker.
    act(() => latest().login('access', USER));
    expect(latest().loginNotice).toBeNull();
    expect(biometric.acknowledgeInvalidation).toHaveBeenCalledTimes(1);
  });

  it('offers the password form, and the way back, without disabling biometric login', async () => {
    biometric.status.mockResolvedValue(REGISTERED);
    const latest = await renderAuth();

    act(() => latest().switchToPassword());
    expect(latest().status).toBe('unauthenticated');
    expect(latest().biometricLock).toBe('device');
    expect(biometric.signIn).not.toHaveBeenCalled();

    act(() => latest().switchToBiometrics());
    expect(latest().status).toBe('locked');
  });

  it('does not offer the way back when nothing is registered', async () => {
    biometric.status.mockResolvedValue(NOT_REGISTERED);
    serveNoSession();
    const latest = await renderAuth();
    expect(latest().status).toBe('unauthenticated');
    act(() => latest().switchToBiometrics());
    expect(latest().status).toBe('unauthenticated');
  });

  it('completes a pending server revocation once that user is signed in', async () => {
    biometric.status.mockResolvedValue(NOT_REGISTERED);
    const latest = await renderAuth();
    expect(biometric.flush).not.toHaveBeenCalled();

    act(() => latest().login('access', USER));
    await act(async () => {
      await settle();
    });

    expect(biometric.flush).toHaveBeenCalledWith(USER.id);
  });

  describe('upgrade from v0.2.0', () => {
    it('shows the locked screen for a leftover biometric-protected credential', async () => {
      biometric.status.mockResolvedValue(LEGACY);
      const latest = await renderAuth();
      expect(latest().status).toBe('locked');
      expect(latest().biometricLock).toBe('legacy');
    });

    it('keeps the working session after one prompt, then offers (never forces) the upgrade', async () => {
      biometric.status.mockResolvedValueOnce(LEGACY).mockResolvedValue(NOT_REGISTERED);
      biometric.unlockLegacy.mockResolvedValue(undefined);
      configureRefreshCredentialProvider({
        get: vi.fn(async () => 'native-refresh'),
        set: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
      });
      const urls: string[] = [];
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
        urls.push(config.url ?? '');
        if (config.url === '/auth/mobile/refresh') {
          return ok(config, { success: true, data: { accessToken: 'fresh', refreshToken: 'next' } });
        }
        return ok(config, { success: true, data: USER });
      }) satisfies AxiosAdapter;

      const latest = await renderAuth();
      await act(async () => {
        await latest().signInWithBiometrics();
        await settle();
      });

      expect(urls).toEqual(['/auth/mobile/refresh', '/auth/me']);
      expect(latest().status).toBe('authenticated');
      expect(latest().biometricOfferPending).toBe(true);
      expect(latest().biometricOfferMigration).toBe(true);
      // Nothing was registered by itself.
      expect(biometric.signIn).not.toHaveBeenCalled();

      act(() => latest().dismissBiometricOffer());
      expect(latest().biometricOfferPending).toBe(false);
      expect(latest().biometricOfferMigration).toBe(false);
    });

    it('requires the password, with a notice, when the upgraded session was already rejected', async () => {
      biometric.status.mockResolvedValueOnce(LEGACY).mockResolvedValue(NOT_REGISTERED);
      biometric.unlockLegacy.mockResolvedValue(undefined);
      configureRefreshCredentialProvider({
        get: vi.fn(async () => 'revoked-refresh'),
        set: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
      });
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
        reject(config, 401),
      ) satisfies AxiosAdapter;

      const latest = await renderAuth();
      await act(async () => {
        await latest().signInWithBiometrics();
        await settle();
      });

      expect(latest().status).toBe('unauthenticated');
      expect(latest().loginNotice).toBe(BIOMETRIC_SESSION_ENDED_NOTICE);
    });

    it('lets the password through when the old biometric key was invalidated', async () => {
      biometric.status.mockResolvedValue(LEGACY);
      biometric.unlockLegacy.mockRejectedValue(new BiometricError('key-invalidated'));
      const latest = await renderAuth();

      await act(async () => {
        await expect(latest().signInWithBiometrics()).rejects.toMatchObject({
          code: 'key-invalidated',
        });
      });

      expect(latest().status).toBe('unauthenticated');
      expect(latest().loginNotice).toBe(BIOMETRIC_CHANGED_NOTICE);
      expect(latest().biometricLock).toBeNull();
    });

    it('lets the password form be used without unlocking the old credential', async () => {
      biometric.status.mockResolvedValue(LEGACY);
      const latest = await renderAuth();
      act(() => latest().switchToPassword());
      expect(latest().status).toBe('unauthenticated');
      expect(biometric.unlockLegacy).not.toHaveBeenCalled();
    });
  });

  it('is unaffected when biometric login is unsupported', async () => {
    biometric.status.mockResolvedValue(UNSUPPORTED);
    serveUser();
    setStoredToken('access');

    const latest = await renderAuth();

    expect(latest().status).toBe('authenticated');
  });

  it('offers biometric enrolment right after a password sign-in until it is answered', async () => {
    biometric.status.mockResolvedValue(UNSUPPORTED);
    const latest = await renderAuth();
    expect(latest().biometricOfferPending).toBe(false);

    act(() => latest().login('access', USER));
    expect(latest().biometricOfferPending).toBe(true);
    expect(latest().biometricOfferMigration).toBe(false);

    act(() => latest().dismissBiometricOffer());
    expect(latest().biometricOfferPending).toBe(false);
  });
});
