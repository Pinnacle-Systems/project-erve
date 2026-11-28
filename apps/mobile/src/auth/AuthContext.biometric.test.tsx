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
  unlock: vi.fn(),
}));

vi.mock('./secure-session.js', async () => {
  class BiometricError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  }
  return {
    BiometricError,
    nativeBiometric: { status: biometric.status, unlock: biometric.unlock },
    nativeSecureSession: { isAvailable: () => false },
  };
});

import {
  AuthProvider,
  BIOMETRIC_CHANGED_NOTICE,
  BIOMETRIC_SESSION_ENDED_NOTICE,
  useAuth,
} from './AuthContext.js';
import { BiometricError } from './secure-session.js';

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
  biometric.unlock.mockReset();
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

const LOCKED = { availability: 'available', enabled: true, locked: true, userId: USER.id };
const UNLOCKED = { ...LOCKED, locked: false };

describe('mobile AuthContext — biometric login', () => {
  it('stays locked at launch without touching the credential or the API', async () => {
    biometric.status.mockResolvedValue(LOCKED);
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
    expect(latest().user).toBeNull();
    expect(provider.get).not.toHaveBeenCalled();
    expect(provider.clear).not.toHaveBeenCalled();
    expect(apiClient.defaults.adapter).not.toHaveBeenCalled();
    expect(getStoredToken()).toBeNull();
  });

  it('unlocks, refreshes through the server and loads the user', async () => {
    biometric.status.mockResolvedValueOnce(LOCKED).mockResolvedValue(UNLOCKED);
    biometric.unlock.mockResolvedValue(undefined);
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
    expect(latest().status).toBe('locked');

    await act(async () => {
      await latest().unlockWithBiometrics();
      await settle();
    });

    expect(urls).toEqual(['/auth/mobile/refresh', '/auth/me']);
    expect(latest().status).toBe('authenticated');
    expect(latest().user).toEqual(USER);
  });

  it('keeps the locked screen (and its retry/password choices) when the prompt is cancelled', async () => {
    biometric.status.mockResolvedValue(LOCKED);
    biometric.unlock.mockRejectedValue(new BiometricError('cancelled'));
    const latest = await renderAuth();

    await act(async () => {
      await expect(latest().unlockWithBiometrics()).rejects.toMatchObject({ code: 'cancelled' });
    });

    expect(latest().status).toBe('locked');
  });

  it('offers the password form without disabling biometric login', async () => {
    biometric.status.mockResolvedValue(LOCKED);
    const latest = await renderAuth();

    act(() => latest().switchToPassword());

    expect(latest().status).toBe('unauthenticated');
    expect(biometric.unlock).not.toHaveBeenCalled();
  });

  it('requires the password, with an explanation, when the biometric key was invalidated', async () => {
    biometric.status.mockResolvedValue(LOCKED);
    biometric.unlock.mockRejectedValue(new BiometricError('key-invalidated'));
    const latest = await renderAuth();

    await act(async () => {
      await expect(latest().unlockWithBiometrics()).rejects.toMatchObject({
        code: 'key-invalidated',
      });
    });

    expect(latest().status).toBe('unauthenticated');
    expect(latest().loginNotice).toBe(BIOMETRIC_CHANGED_NOTICE);
  });

  it.each([401, 403])(
    'requires the password, with a notice, when the server rejects the session (%i)',
    async (status) => {
      biometric.status.mockResolvedValueOnce(LOCKED).mockResolvedValue(UNLOCKED);
      biometric.unlock.mockResolvedValue(undefined);
      const provider = {
        get: vi.fn(async () => 'revoked-refresh'),
        set: vi.fn(async () => {}),
        clear: vi.fn(async () => {}),
      };
      configureRefreshCredentialProvider(provider);
      apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
        reject(config, status),
      ) satisfies AxiosAdapter;

      const latest = await renderAuth();
      await act(async () => {
        await latest().unlockWithBiometrics();
        await settle();
      });

      expect(latest().status).toBe('unauthenticated');
      expect(latest().loginNotice).toBe(BIOMETRIC_SESSION_ENDED_NOTICE);
      // A rejected refresh drops the credential (and with it biometric login) natively.
      expect(provider.clear).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps the session (retryable) when the server is unavailable after unlock', async () => {
    biometric.status.mockResolvedValueOnce(LOCKED).mockResolvedValue(UNLOCKED);
    biometric.unlock.mockResolvedValue(undefined);
    const provider = {
      get: vi.fn(async () => 'native-refresh'),
      set: vi.fn(async () => {}),
      clear: vi.fn(async () => {}),
    };
    configureRefreshCredentialProvider(provider);
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
      reject(config, 503),
    ) satisfies AxiosAdapter;

    const latest = await renderAuth();
    await act(async () => {
      await latest().unlockWithBiometrics();
      await settle();
    });

    expect(latest().status).toBe('unavailable');
    expect(provider.clear).not.toHaveBeenCalled();
  });

  it('is unaffected when biometric login is off or unsupported', async () => {
    biometric.status.mockResolvedValue({
      availability: 'unsupported',
      enabled: false,
      locked: false,
      userId: null,
    });
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) =>
      ok(config, { success: true, data: USER }),
    ) satisfies AxiosAdapter;
    setStoredToken('access');

    const latest = await renderAuth();

    expect(latest().status).toBe('authenticated');
  });

  it('offers biometric enrolment right after a password sign-in until it is answered', async () => {
    biometric.status.mockResolvedValue({
      availability: 'unsupported',
      enabled: false,
      locked: false,
      userId: null,
    });
    const latest = await renderAuth();
    expect(latest().biometricOfferPending).toBe(false);

    act(() => latest().login('access', USER));
    expect(latest().biometricOfferPending).toBe(true);

    act(() => latest().dismissBiometricOffer());
    expect(latest().biometricOfferPending).toBe(false);
  });
});
