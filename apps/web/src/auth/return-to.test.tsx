/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { AuthUser } from '@erve/types';
import { setSessionTiming } from '@erve/client';
import { apiClient } from '../lib/api-client.js';
import { LoginPage } from '../pages/LoginPage.js';
import { ProtectedRoute } from '../routes/ProtectedRoute.js';
import { sessionInfo } from '../test-support/session.js';
import { setStoredToken } from './token-storage.js';
import { AuthProvider, useAuth } from './AuthContext.js';
import { DEFAULT_AFTER_LOGIN_PATH, returnToPath } from './return-to.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

const USER: AuthUser = {
  id: 'u1',
  email: 'u1@test.local',
  mobile: null,
  name: 'U1',
  roles: ['ADMIN'],
};

const OTHER_USER: AuthUser = {
  id: 'u2',
  email: 'u2@test.local',
  mobile: null,
  name: 'U2',
  roles: ['ADMIN'],
};

describe('returnToPath', () => {
  it('returns the interrupted in-app location', () => {
    expect(
      returnToPath({
        from: { pathname: '/job-orders/new', search: '?purchaseOrderId=p1', hash: '' },
      }),
    ).toBe('/job-orders/new?purchaseOrderId=p1');
  });

  it.each([
    [undefined],
    [null],
    [{}],
    [{ from: { pathname: '//evil.example/path', search: '', hash: '' } }],
    [{ from: { pathname: 'https://evil.example', search: '', hash: '' } }],
    [{ from: { pathname: '/login', search: '', hash: '' } }],
  ])('falls back to the dashboard for %j', (state) => {
    expect(returnToPath(state)).toBe(DEFAULT_AFTER_LOGIN_PATH);
  });
});

describe('return-to fallback through the login page', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    setSessionTiming(null);
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function Where() {
    return <output data-testid="where">{useLocation().pathname}</output>;
  }

  it('sends a signed-out visitor to login and back to the requested page afterwards', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: { accessToken: 'token', user: USER, session: sessionInfo(USER.id) } },
    });

    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <MemoryRouter initialEntries={['/master-data/styles/new']}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/dashboard" element={<Where />} />
                <Route
                  path="/master-data/styles/new"
                  element={
                    <ProtectedRoute>
                      <Where />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const form = container.querySelector('form');
    expect(form).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const [id, value] of [
      ['identifier', USER.email!],
      ['password', 'secret'],
    ] as const) {
      const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await act(async () => {
      form!.requestSubmit();
    });
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    expect(container.querySelector('[data-testid="where"]')?.textContent).toBe(
      '/master-data/styles/new',
    );
  });
});

describe('SESS-F3 — explicit logout discards the interrupted route', () => {
  let container: HTMLDivElement;
  let root: Root;
  let originalAdapter: typeof apiClient.defaults.adapter;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    originalAdapter = apiClient.defaults.adapter;
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    apiClient.defaults.adapter = originalAdapter;
    setSessionTiming(null);
    sessionStorage.clear();
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function Where() {
    return <output data-testid="where">{useLocation().pathname}</output>;
  }

  function PageWithLogout() {
    const { logout } = useAuth();
    return (
      <>
        <Where />
        <button type="button" onClick={() => void logout()}>
          Log out
        </button>
      </>
    );
  }

  function renderApp(initialEntry: string) {
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <AuthProvider>
            <MemoryRouter initialEntries={[initialEntry]}>
              <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route
                  path="/dashboard"
                  element={
                    <ProtectedRoute>
                      <PageWithLogout />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/job-orders/:id"
                  element={
                    <ProtectedRoute>
                      <PageWithLogout />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </MemoryRouter>
          </AuthProvider>
        </QueryClientProvider>,
      );
    });
  }

  async function flush() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  async function submitLogin() {
    const form = container.querySelector('form')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    for (const [id, value] of [
      ['identifier', 'whoever@test.local'],
      ['password', 'secret'],
    ] as const) {
      const input = container.querySelector<HTMLInputElement>(`#${id}`)!;
      act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    await act(async () => {
      form.requestSubmit();
    });
    for (let i = 0; i < 3; i += 1) {
      await flush();
    }
  }

  function where(): string | undefined {
    return container.querySelector('[data-testid="where"]')?.textContent ?? undefined;
  }

  it('does not restore the previous user’s protected route after explicit logout, even when the next user could access it', async () => {
    setStoredToken('user-a-token');
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') return ok(config, { success: true, data: USER });
      if (config.url === '/auth/logout') return ok(config, { success: true, data: {} });
      if (config.url === '/auth/login') {
        return ok(config, {
          success: true,
          data: { accessToken: 'user-b-token', user: OTHER_USER, session: sessionInfo(OTHER_USER.id) },
        });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    renderApp('/job-orders/123');
    await flush();
    expect(where()).toBe('/job-orders/123');

    const logoutButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Log out',
    );
    expect(logoutButton).toBeDefined();
    await act(async () => {
      logoutButton!.click();
      await flush();
    });

    // User B — who, per OTHER_USER's roles, could legitimately open
    // /job-orders/123 — signs in on the same tab.
    await submitLogin();

    expect(where()).toBe(DEFAULT_AFTER_LOGIN_PATH);
  });

  it('does not accumulate stale redirect state across repeated logout/login cycles', async () => {
    setStoredToken('user-a-token');
    let meUser = USER;
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') return ok(config, { success: true, data: meUser });
      if (config.url === '/auth/logout') return ok(config, { success: true, data: {} });
      if (config.url === '/auth/login') {
        return ok(config, {
          success: true,
          data: { accessToken: 'token', user: meUser, session: sessionInfo(meUser.id) },
        });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    renderApp('/job-orders/123');
    await flush();

    for (const nextUser of [OTHER_USER, USER]) {
      meUser = nextUser;
      const logoutButton = Array.from(container.querySelectorAll('button')).find(
        (button) => button.textContent === 'Log out',
      );
      await act(async () => {
        logoutButton!.click();
        await flush();
      });
      await submitLogin();
      expect(where()).toBe(DEFAULT_AFTER_LOGIN_PATH);
    }
  });
});
