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
import { apiClient, getStoredToken, setStoredToken } from '@erve/client';
import type { AuthUser } from '@erve/types';
import { AuthProvider, useAuth } from './AuthContext.js';

const TEST_USER: AuthUser = {
  id: 'user-1',
  email: 'driver@test.local',
  mobile: null,
  name: 'Test Driver',
  roles: ['DISTRIBUTOR'],
};

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function unauthorized(config: InternalAxiosRequestConfig): never {
  throw new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, config, undefined, {
    data: { success: false },
    status: 401,
    statusText: 'Unauthorized',
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
  localStorage.clear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type CapturedAuth = ReturnType<typeof useAuth>;

function Probe({ onAuth }: { onAuth: (value: CapturedAuth) => void }) {
  const auth = useAuth();
  useEffect(() => {
    onAuth(auth);
  }, [auth, onAuth]);
  return null;
}

async function renderAuth(): Promise<{ latest: () => CapturedAuth }> {
  let captured: CapturedAuth | undefined;

  act(() => {
    root.render(
      <AuthProvider>
        <Probe onAuth={(value) => (captured = value)} />
      </AuthProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });

  return {
    latest: () => {
      if (!captured) {
        throw new Error('AuthContext value was never captured');
      }
      return captured;
    },
  };
}

describe('mobile AuthContext — startup with no access token', () => {
  it('does not call /auth/refresh and starts unauthenticated', async () => {
    const calls: string[] = [];
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      calls.push(config.url ?? '');
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const { latest } = await renderAuth();

    expect(latest().status).toBe('unauthenticated');
    expect(latest().user).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('mobile AuthContext — startup with a valid access token in sessionStorage', () => {
  it('restores the token into the API client, calls /auth/me, and restores the user', async () => {
    setStoredToken('valid-token');
    let meCalls = 0;
    let authHeaderSeen: string | undefined;

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') {
        meCalls += 1;
        authHeaderSeen = config.headers.Authorization as string | undefined;
        return ok(config, { success: true, data: TEST_USER });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const { latest } = await renderAuth();

    expect(meCalls).toBe(1);
    expect(authHeaderSeen).toBe('Bearer valid-token');
    expect(latest().status).toBe('authenticated');
    expect(latest().user).toEqual(TEST_USER);
  });
});

describe('mobile AuthContext — startup with an expired access token', () => {
  it('refreshes exactly once, stores the replacement token, and retries the failed request', async () => {
    setStoredToken('expired-token');
    let meCalls = 0;
    let refreshCalls = 0;

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') {
        meCalls += 1;
        if (meCalls === 1) {
          unauthorized(config);
        }
        expect(config.headers.Authorization).toBe('Bearer fresh-token');
        return ok(config, { success: true, data: TEST_USER });
      }
      if (config.url === '/auth/refresh') {
        refreshCalls += 1;
        return ok(config, { success: true, data: { accessToken: 'fresh-token' } });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const { latest } = await renderAuth();

    expect(refreshCalls).toBe(1);
    expect(meCalls).toBe(2);
    expect(getStoredToken()).toBe('fresh-token');
    expect(latest().status).toBe('authenticated');
    expect(latest().user).toEqual(TEST_USER);
  });
});

describe('mobile AuthContext — failed refresh', () => {
  it('does not loop, clears sessionStorage, and returns to login', async () => {
    setStoredToken('expired-token');
    let refreshCalls = 0;

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') {
        unauthorized(config);
      }
      if (config.url === '/auth/refresh') {
        refreshCalls += 1;
        unauthorized(config);
      }
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const { latest } = await renderAuth();

    expect(refreshCalls).toBe(1);
    expect(latest().status).toBe('unauthenticated');
    expect(latest().user).toBeNull();
    expect(getStoredToken()).toBeNull();
  });
});

describe('mobile AuthContext — logout', () => {
  it('calls /auth/logout and clears sessionStorage, the API client token, and user state', async () => {
    setStoredToken('valid-token');
    let logoutCalls = 0;

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') {
        return ok(config, { success: true, data: TEST_USER });
      }
      if (config.url === '/auth/logout') {
        logoutCalls += 1;
        return ok(config, { success: true, data: {} });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const { latest } = await renderAuth();
    expect(latest().status).toBe('authenticated');

    await act(async () => {
      await latest().logout();
    });

    expect(logoutCalls).toBe(1);
    expect(latest().status).toBe('unauthenticated');
    expect(latest().user).toBeNull();
    expect(getStoredToken()).toBeNull();
  });
});
