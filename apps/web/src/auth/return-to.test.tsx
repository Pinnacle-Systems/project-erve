/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@erve/types';
import { setSessionTiming } from '@erve/client';
import { apiClient } from '../lib/api-client.js';
import { LoginPage } from '../pages/LoginPage.js';
import { ProtectedRoute } from '../routes/ProtectedRoute.js';
import { sessionInfo } from '../test-support/session.js';
import { AuthProvider } from './AuthContext.js';
import { DEFAULT_AFTER_LOGIN_PATH, returnToPath } from './return-to.js';

const USER: AuthUser = {
  id: 'u1',
  email: 'u1@test.local',
  mobile: null,
  name: 'U1',
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
