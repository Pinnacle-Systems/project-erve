import { AxiosError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient, AUTH_EXPIRED_EVENT, logoutSession, refreshAccessToken } from './api-client.js';
import { clearStoredToken, getStoredToken, setStoredToken } from './token-storage.js';

interface MockSessionStorage {
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

function createStorage(): MockSessionStorage {
  const values = new Map<string, string>();

  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    clear: vi.fn(() => {
      values.clear();
    }),
  };
}

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
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

describe('apiClient refresh session integration', () => {
  let originalAdapter: typeof apiClient.defaults.adapter;
  let storage: MockSessionStorage;

  beforeEach(() => {
    originalAdapter = apiClient.defaults.adapter;
    storage = createStorage();
    vi.stubGlobal('sessionStorage', storage);
    vi.stubGlobal('window', new EventTarget());
    clearStoredToken();
  });

  afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    clearStoredToken();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stores only the returned access token, never a refresh token', () => {
    setStoredToken('access-token');

    expect(getStoredToken()).toBe('access-token');
    expect(storage.setItem).toHaveBeenCalledWith('erve.accessToken', 'access-token');
    expect(storage.setItem).not.toHaveBeenCalledWith(expect.stringContaining('refresh'), expect.any(String));
  });

  it('refreshes once and retries a protected request after a 401', async () => {
    setStoredToken('expired-token');
    let protectedCalls = 0;
    let refreshCalls = 0;

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/protected') {
        protectedCalls += 1;

        if (protectedCalls === 1) {
          unauthorized(config);
        }

        expect(config.headers.Authorization).toBe('Bearer fresh-token');
        return ok(config, { success: true, data: 'protected-data' });
      }

      if (config.url === '/auth/refresh') {
        refreshCalls += 1;
        expect(config.withCredentials).toBe(true);
        return ok(config, { success: true, data: { accessToken: 'fresh-token' } });
      }

      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const response = await apiClient.get('/protected');

    expect(response.data).toEqual({ success: true, data: 'protected-data' });
    expect(refreshCalls).toBe(1);
    expect(protectedCalls).toBe(2);
    expect(getStoredToken()).toBe('fresh-token');
  });

  it('clears auth and emits an event when refresh fails', async () => {
    setStoredToken('expired-token');
    const authExpired = vi.fn();
    window.addEventListener(AUTH_EXPIRED_EVENT, authExpired);

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/protected' || config.url === '/auth/refresh') {
        unauthorized(config);
      }

      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    await expect(apiClient.get('/protected')).rejects.toBeInstanceOf(AxiosError);

    expect(getStoredToken()).toBeNull();
    expect(authExpired).toHaveBeenCalledTimes(1);
  });

  it('shares one refresh call across parallel 401 responses', async () => {
    setStoredToken('expired-token');
    let refreshCalls = 0;
    const protectedCallsByUrl = new Map<string, number>();

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url?.startsWith('/protected')) {
        const calls = (protectedCallsByUrl.get(config.url) ?? 0) + 1;
        protectedCallsByUrl.set(config.url, calls);

        if (calls === 1) {
          unauthorized(config);
        }

        return ok(config, { success: true, data: config.url });
      }

      if (config.url === '/auth/refresh') {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        return ok(config, { success: true, data: { accessToken: 'shared-token' } });
      }

      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    await Promise.all([apiClient.get('/protected/a'), apiClient.get('/protected/b')]);

    expect(refreshCalls).toBe(1);
    expect(getStoredToken()).toBe('shared-token');
  });

  it('shares one refresh call across parallel startup refresh attempts', async () => {
    let refreshCalls = 0;

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/refresh') {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 1));
        return ok(config, { success: true, data: { accessToken: 'startup-token' } });
      }

      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    await Promise.all([refreshAccessToken(), refreshAccessToken()]);

    expect(refreshCalls).toBe(1);
    expect(getStoredToken()).toBe('startup-token');
  });

  it('does not recursively refresh login, refresh, or logout failures', async () => {
    let refreshCalls = 0;

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/refresh') {
        refreshCalls += 1;
      }

      unauthorized(config);
    }) satisfies AxiosAdapter;

    await expect(apiClient.post('/auth/login')).rejects.toBeInstanceOf(AxiosError);
    await expect(apiClient.post('/auth/refresh')).rejects.toBeInstanceOf(AxiosError);
    await expect(apiClient.post('/auth/logout')).rejects.toBeInstanceOf(AxiosError);

    expect(refreshCalls).toBe(1);
  });

  it('logout calls the backend and clears local auth state', async () => {
    setStoredToken('access-token');
    let logoutCalls = 0;

    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/logout') {
        logoutCalls += 1;
        expect(config.withCredentials).toBe(true);
        return ok(config, { success: true, data: {} });
      }

      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    await logoutSession();

    expect(logoutCalls).toBe(1);
    expect(getStoredToken()).toBeNull();
  });
});
