/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { AuthUser } from '@erve/types';
import { apiClient, setStoredToken } from '@erve/client';
import { ThemeProvider } from '@erve/theme';
import { AuthProvider } from '../auth/AuthContext.js';
import { AuthenticatedShell } from './AuthenticatedShell.js';

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

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

/**
 * Two arbitrary child routes nested under the shell — standing in for
 * "any authenticated route" without depending on which real pages exist.
 * The account trigger must show up identically for both.
 */
async function renderShellAt(path: string): Promise<void> {
  setStoredToken('valid-token');
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/auth/me') {
      return ok(config, { success: true, data: TEST_USER });
    }
    throw new Error(`Unexpected request: ${config.url}`);
  }) satisfies AxiosAdapter;

  act(() => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider theme="default" density="comfortable">
          <AuthProvider>
            <Routes>
              <Route element={<AuthenticatedShell />}>
                <Route path="/one" element={<div>Page One</div>} />
                <Route path="/two" element={<div>Page Two</div>} />
              </Route>
            </Routes>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('AuthenticatedShell', () => {
  it('renders the account trigger alongside routed page content on one authenticated route', async () => {
    await renderShellAt('/one');

    expect(container.textContent).toContain('Page One');
    expect(container.querySelector('button[aria-label="Account menu"]')).not.toBeNull();
  });

  it('renders the account trigger alongside routed page content on a different authenticated route', async () => {
    await renderShellAt('/two');

    expect(container.textContent).toContain('Page Two');
    expect(container.querySelector('button[aria-label="Account menu"]')).not.toBeNull();
  });
});
