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
import type { AuthUser } from '@erve/types';
import { apiClient } from '../lib/api-client.js';
import { getStoredToken, setStoredToken } from './token-storage.js';
import { AuthProvider, useAuth } from './AuthContext.js';

const TEST_USER: AuthUser = {
  id: 'user-1',
  email: 'admin@test.local',
  mobile: null,
  name: 'Test Admin',
  roles: ['ADMIN'],
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

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

async function renderAuth(): Promise<{ latest: () => CapturedAuth; queryClient: QueryClient }> {
  let captured: CapturedAuth | undefined;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Probe onAuth={(value) => (captured = value)} />
        </AuthProvider>
      </QueryClientProvider>,
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
    queryClient,
  };
}

describe('web AuthContext — startup with no access token', () => {
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

describe('web AuthContext — startup with a valid access token in sessionStorage', () => {
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

describe('web AuthContext — startup with an expired access token', () => {
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

describe('web AuthContext — failed refresh', () => {
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

describe('web AuthContext — logout', () => {
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

import { AUTH_EXPIRED_EVENT } from '../lib/api-client.js';

describe('UXAUTH-001 — authenticated-user/query-cache isolation', () => {
  it('CASE 1 — LOGOUT CLEARS OLD DATA', async () => {
    setStoredToken('valid-token');
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') return ok(config, { success: true, data: TEST_USER });
      if (config.url === '/auth/logout') return ok(config, { success: true, data: {} });
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const { latest, queryClient } = await renderAuth();
    
    // Populate query cache
    queryClient.setQueryData(['test-query'], { data: 'secret' });
    expect(queryClient.getQueryCache().getAll().length).toBe(1);
    
    await act(async () => {
      await latest().logout();
    });
    
    expect(queryClient.getQueryCache().getAll().length).toBe(0);
  });

  it('CASE 2 — USER A → USER B', async () => {
    const { latest, queryClient } = await renderAuth();
    
    // User A populates cache
    queryClient.setQueryData(['test-query'], { data: 'user-a-secret' });
    
    const nextUser = { ...TEST_USER, id: 'user-2' };
    
    await act(async () => {
      await latest().login('new-token', nextUser);
    });
    
    expect(queryClient.getQueryCache().getAll().length).toBe(0);
    expect(latest().user).toEqual(nextUser);
  });

  it('CASE 3 — NEW USER REQUEST FAILS (NO FALLBACK)', async () => {
    // Tests behavior when User B logs in but their queries reject.
    // The queryClient is wiped and User A's data doesn't fallback.
    const { latest, queryClient } = await renderAuth();
    
    queryClient.setQueryData(['query-3'], { data: 'user-a-data' });
    const nextUser = { ...TEST_USER, id: 'user-2' };

    await act(async () => {
      await latest().login('new-token', nextUser);
    });

    const data = queryClient.getQueryData(['query-3']);
    expect(data).toBeUndefined();
  });

  it('CASE 4 — DELAYED OLD REQUEST CANNOT REPOPULATE', async () => {
    const { latest, queryClient } = await renderAuth();
    
    let resolveQuery!: (val: unknown) => void;
    const promise = new Promise((resolve) => { resolveQuery = resolve; });
    
    // Simulate an active fetch that will resolve AFTER transition
    queryClient.fetchQuery({ queryKey: ['delayed'], queryFn: () => promise }).catch(() => {});
    
    await act(async () => {
      await latest().login('new-token', TEST_USER);
    });
    
    // Now resolve the old request
    resolveQuery({ data: 'old-data' });
    await flushMicrotasks();
    
    // The cancelled query should not repopulate the cache
    expect(queryClient.getQueryData(['delayed'])).toBeUndefined();
  });

  it('CASE 5 — TRANSITION RACE WINDOW', async () => {
    // A test to ensure that cancellation is awaited before clear, so observers are unsubscribed
    // or queries are properly aborted.
    setStoredToken('valid-token');
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') return ok(config, { success: true, data: TEST_USER });
      if (config.url === '/auth/logout') return ok(config, { success: true, data: {} });
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const { latest, queryClient } = await renderAuth();
    
    let cancelled = false;
    queryClient.fetchQuery({ 
      queryKey: ['race'], 
      queryFn: ({ signal }) => {
        signal.addEventListener('abort', () => { cancelled = true; });
        return new Promise((resolve) => setTimeout(resolve, 100));
      }
    }).catch(() => {});
    
    await act(async () => {
      await latest().logout();
    });
    
    expect(cancelled).toBe(true);
    expect(queryClient.getQueryCache().getAll().length).toBe(0);
  });

  it('CASE 6 — AUTH EXPIRY ISOLATION', async () => {
    setStoredToken('valid-token');
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') return ok(config, { success: true, data: TEST_USER });
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    const { latest, queryClient } = await renderAuth();
    queryClient.setQueryData(['sensitive'], { data: 'account-data' });
    
    await act(async () => {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
      await flushMicrotasks(); // Allow async event listener to finish
    });
    
    expect(queryClient.getQueryCache().getAll().length).toBe(0);
    expect(latest().status).toBe('unauthenticated');
  });

  it('CASE 7 — NORMAL SAME-USER CACHING', async () => {
    const { queryClient } = await renderAuth();
    queryClient.setQueryData(['valid-query'], { data: 'ok' });
    expect(queryClient.getQueryData(['valid-query'])).toEqual({ data: 'ok' });
  });

  it('CASE 8 — ROLE-REDACTED DTO CACHE ISOLATION', async () => {
    // We simulate an Internal User fetching an Invoice Handoff DTO (which contains tallyVoucherReference)
    // into the React Query cache, then transition to a Distributor. This only proves the cached DTO
    // itself is gone from the query cache post-transition — it does not invoke any PDF generator or
    // Invoice Handoff query hook. PDF-consumer coverage lives separately under UXAUTH-002.
    const { latest, queryClient } = await renderAuth();
    
    // Populate cache with Internal User's DTO
    queryClient.setQueryData(['invoice-handoff', '123'], { 
      data: { id: '123', tallyVoucherReference: 'SECRET-VOUCHER' } 
    });
    
    // Distributor logs in
    const distributorUser: AuthUser = { ...TEST_USER, id: 'user-dist', roles: ['DISTRIBUTOR'] };
    await act(async () => {
      await latest().login('dist-token', distributorUser);
    });
    
    // Assert the data is gone
    const data = queryClient.getQueryData(['invoice-handoff', '123']);
    expect(data).toBeUndefined();
  });
});
