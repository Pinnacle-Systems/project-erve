/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import type { AuthUser, SessionInfo } from '@erve/types';
import { getSessionTiming, setSessionTiming, toSessionTiming } from '@erve/client';
import { apiClient, AUTH_EXPIRED_EVENT } from '../../lib/api-client.js';
import { sessionInfo } from '../../test-support/session.js';
import { AuthProvider } from '../AuthContext.js';
import { setStoredToken } from '../token-storage.js';
import { SessionManager } from './SessionManager.js';

const USER: AuthUser = {
  id: 'user-1',
  email: 'merch@test.local',
  mobile: null,
  name: 'Merchandiser',
  roles: ['MERCHANDISER'],
};
const MINUTE = 60_000;

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let visibility: DocumentVisibilityState;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  visibility = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  sessionStorage.clear();
  localStorage.clear();
  setSessionTiming(null);
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

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function unauthorized(config: InternalAxiosRequestConfig): never {
  throw new AxiosError('Unauthorized', AxiosError.ERR_BAD_REQUEST, config, undefined, {
    data: { success: false, error: { message: 'Invalid or expired refresh session' } },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  });
}

async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** A long form whose only copy of the entered data is React state. */
function DraftForm() {
  const [value, setValue] = useState('');
  return (
    <input
      aria-label="Style name"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

interface Server {
  refreshBodies: unknown[];
  refreshSession: () => SessionInfo;
  refreshFails: boolean;
}

async function renderApp(server: Server) {
  setStoredToken('access-token');
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/auth/me') return ok(config, { success: true, data: USER });
    if (config.url === '/auth/refresh') {
      server.refreshBodies.push(config.data ? JSON.parse(config.data as string) : undefined);
      if (server.refreshFails) unauthorized(config);
      return ok(config, {
        success: true,
        data: { accessToken: 'renewed-token', session: server.refreshSession() },
      });
    }
    if (config.url === '/auth/login') {
      return ok(config, {
        success: true,
        data: { accessToken: 'reauth-token', user: USER, session: sessionInfo(USER.id) },
      });
    }
    throw new Error(`Unexpected request: ${config.url}`);
  }) satisfies AxiosAdapter;

  act(() => {
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AuthProvider onHardNavigate={vi.fn()}>
          <MemoryRouter initialEntries={['/master-data/styles/new']}>
            <Routes>
              <Route
                path="/master-data/styles/new"
                element={
                  <>
                    <DraftForm />
                    <LocationProbe />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
          <SessionManager />
        </AuthProvider>
      </QueryClientProvider>,
    );
  });
  await flush();
}

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function styleInput(): HTMLInputElement {
  return container.querySelector('input[aria-label="Style name"]') as HTMLInputElement;
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === text,
  ) as HTMLButtonElement | undefined;
}

function server(overrides: Partial<Server> = {}): Server {
  return {
    refreshBodies: [],
    refreshSession: () => sessionInfo(USER.id),
    refreshFails: false,
    ...overrides,
  };
}

describe('SessionManager — idle warning and Continue Session', () => {
  it('shows no warning while more than five minutes of idle time remain', async () => {
    setSessionTiming(toSessionTiming(sessionInfo(USER.id)));
    await renderApp(server());

    expect(document.body.textContent).not.toContain('Your session will expire soon');
  });

  it('warns five minutes before idle expiry, and Continue Session renews in place', async () => {
    setSessionTiming(toSessionTiming(sessionInfo(USER.id)));
    const api = server();
    await renderApp(api);
    typeInto(styleInput(), 'Summer Tee with long description');
    await flush();
    expect(document.body.textContent).not.toContain('Your session will expire soon');

    // Time passes without activity: four minutes of idle time left.
    const now = Date.now();
    act(() => {
      setSessionTiming({ ...getSessionTiming()!, idleExpiresAt: now + 4 * MINUTE });
    });
    await flush();

    expect(document.body.textContent).toContain('Your session will expire soon');
    const continueButton = buttonByText('Continue Session');
    expect(continueButton).toBeDefined();

    await act(async () => {
      continueButton!.click();
    });
    await flush();

    expect(api.refreshBodies.at(-1)).toEqual({ activity: true });
    expect(document.body.textContent).not.toContain('Your session will expire soon');
    // Same route, same mounted form, same entered data.
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/master-data/styles/new',
    );
    expect(styleInput().value).toBe('Summer Tee with long description');
    expect(getSessionTiming()!.idleExpiresAt).toBeGreaterThan(now + 15 * MINUTE);
  });

  it('cannot continue past the absolute expiry: the capped session shows the absolute warning', async () => {
    const now = Date.now();
    const absoluteExpiresAt = new Date(now + 3 * MINUTE).toISOString();
    setSessionTiming(
      toSessionTiming(
        sessionInfo(USER.id, {
          idleExpiresAt: new Date(now + 2 * MINUTE).toISOString(),
          absoluteExpiresAt,
        }),
      ),
    );
    // The server caps the renewed idle expiry at the absolute expiry.
    await renderApp(
      server({
        refreshSession: () =>
          sessionInfo(USER.id, { idleExpiresAt: absoluteExpiresAt, absoluteExpiresAt }),
      }),
    );

    await act(async () => {
      buttonByText('Continue Session')!.click();
    });
    await flush();

    expect(document.body.textContent).not.toContain('Your session will expire soon');
    expect(document.body.textContent).toContain('Your session is ending');
    expect(buttonByText('Continue Session')).toBeUndefined();
  });
});

describe('SessionManager — activity', () => {
  function dueTiming() {
    // Last activity slide 10 minutes ago: an activity renewal is due.
    const now = Date.now();
    return toSessionTiming(
      sessionInfo(USER.id, {
        idleExpiresAt: new Date(now + 10 * MINUTE).toISOString(),
        accessExpiresAt: new Date(now + 4 * MINUTE).toISOString(),
      }),
    );
  }

  it('renews silently, flagged as activity, when the user types', async () => {
    setSessionTiming(dueTiming());
    const api = server();
    await renderApp(api);

    typeInto(styleInput(), 'a');
    await flush();

    expect(api.refreshBodies).toEqual([{ activity: true }]);
    expect(styleInput().value).toBe('a');
  });

  it.each(['keydown', 'pointerdown', 'click', 'change', 'touchstart', 'wheel', 'scroll'])(
    'recognises %s as activity',
    async (type) => {
      setSessionTiming(dueTiming());
      const api = server();
      await renderApp(api);

      act(() => {
        styleInput().dispatchEvent(new Event(type, { bubbles: false }));
      });
      await flush();

      expect(api.refreshBodies).toEqual([{ activity: true }]);
    },
  );

  it('ignores interaction events while the tab is hidden', async () => {
    setSessionTiming(dueTiming());
    const api = server();
    await renderApp(api);
    visibility = 'hidden';

    act(() => {
      window.dispatchEvent(new Event('keydown'));
      window.dispatchEvent(new Event('scroll'));
    });
    await flush();

    expect(api.refreshBodies).toEqual([]);
  });

  it('re-checks wall-clock expiry when the tab becomes visible again', async () => {
    const now = Date.now();
    setSessionTiming(
      toSessionTiming(
        sessionInfo(USER.id, { idleExpiresAt: new Date(now + 30 * MINUTE).toISOString() }),
      ),
    );
    const api = server({ refreshFails: true });
    await renderApp(api);
    expect(api.refreshBodies).toEqual([]);

    // While hidden the device slept past idle expiry; no timer ran.
    setSessionTiming({ ...getSessionTiming()!, idleExpiresAt: Date.now() - 1000 });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();

    // Asked the server (no activity claimed) and, on rejection, moved to in-place sign-in.
    expect(api.refreshBodies).toEqual([{ activity: false }]);
    expect(document.body.textContent).toContain('Sign in to continue');
  });
});

describe('SessionManager — in-place re-authentication', () => {
  it('keeps the route and unsaved input while signing back in', async () => {
    setSessionTiming(toSessionTiming(sessionInfo(USER.id)));
    await renderApp(server());
    typeInto(styleInput(), 'Unsaved style entry');

    await act(async () => {
      window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
    });
    await flush();

    expect(document.body.textContent).toContain('Sign in to continue');
    expect(styleInput().value).toBe('Unsaved style entry');
    const identifier = document.getElementById('reauth-identifier') as HTMLInputElement;
    expect(identifier.value).toBe(USER.email);
    expect(identifier.readOnly).toBe(true);

    const password = document.getElementById('reauth-password') as HTMLInputElement;
    typeInto(password, 'secret');
    await act(async () => {
      buttonByText('Sign in')!.click();
    });
    await flush();

    expect(document.body.textContent).not.toContain('Sign in to continue');
    expect(styleInput().value).toBe('Unsaved style entry');
    expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(
      '/master-data/styles/new',
    );
    expect(sessionStorage.getItem('erve.accessToken')).toBe('reauth-token');
  });
});
