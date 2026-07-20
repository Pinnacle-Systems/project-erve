/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@erve/theme';
import type { AuthUser, Role } from '@erve/types';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext.js';
import { setStoredToken } from '../../auth/token-storage.js';
import { apiClient } from '../../lib/api-client.js';
import { ForbiddenPage } from '../ForbiddenPage.js';
import { RoleRoute } from '../../routes/RoleRoute.js';
import { UserListPage } from './UserListPage.js';
import { UserDetailPage } from './UserDetailPage.js';
import { UserFormPage } from './UserFormPage.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function fail(config: InternalAxiosRequestConfig, status: number, message: string) {
  const error = new Error(message) as Error & { response: unknown; isAxiosError: boolean };
  error.isAxiosError = true;
  error.response = { status, data: { error: { message } }, statusText: '', headers: {}, config };
  throw error;
}

// React's controlled inputs track the native value setter, so a plain
// `input.value = x` followed by dispatching "input" is not observed —
// the native property setter must be invoked directly (see ProcessFlowPages.test.tsx).
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderPage(
  path: string,
  roles: Role[],
  adapter: AxiosAdapter,
  currentUserId = 'admin-1',
) {
  const user: AuthUser = {
    id: currentUserId,
    email: 'caller@test.local',
    mobile: null,
    name: 'Caller',
    roles,
  };
  setStoredToken('valid-token');
  apiClient.defaults.adapter = vi.fn(async (config) => {
    if (config.url === '/auth/me') return ok(config, { success: true, data: user });
    return adapter(config);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider theme="default">
          <QueryClientProvider client={client}>
            <AuthProvider>
              <Routes>
                <Route path="/forbidden" element={<ForbiddenPage />} />
                <Route
                  path="/master-data/users"
                  element={
                    <RoleRoute allowed={['ADMIN']}>
                      <UserListPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/master-data/users/new"
                  element={
                    <RoleRoute allowed={['ADMIN']}>
                      <UserFormPage />
                    </RoleRoute>
                  }
                />
                <Route
                  path="/master-data/users/:id"
                  element={
                    <RoleRoute allowed={['ADMIN']}>
                      <UserDetailPage />
                    </RoleRoute>
                  }
                />
              </Routes>
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
}

describe('user administration — access control', () => {
  it('redirects a non-ADMIN caller to /forbidden', async () => {
    await renderPage('/master-data/users', ['MERCHANDISER'], async (config) => {
      throw new Error(`Unexpected request: ${config.url}`);
    });
    expect(container.textContent).toContain('Access denied');
  });
});

describe('user list page', () => {
  it('renders users with search/status/role filters and shows key columns', async () => {
    await renderPage('/master-data/users', ['ADMIN'], async (config) => {
      if (config.url === '/users')
        return ok(config, {
          success: true,
          data: [
            {
              id: 'user-1',
              name: 'Jane Admin',
              email: 'jane@test.local',
              status: 'ACTIVE',
              roles: ['ADMIN'],
              distributors: [],
              factories: [],
              createdAt: '2026-01-01T00:00:00.000Z',
            },
          ],
        });
      throw new Error(`Unexpected request: ${config.url}`);
    });
    expect(container.textContent).toContain('Users');
    expect(container.textContent).toContain('jane@test.local');
    expect(container.textContent).toContain('ADMIN');
    expect(container.querySelector('input[placeholder="Search by name or email"]')).toBeTruthy();
  });

  it('shows an error state when the list fails to load', async () => {
    await renderPage('/master-data/users', ['ADMIN'], async (config) => {
      if (config.url === '/users') fail(config, 500, 'Something went wrong');
      throw new Error(`Unexpected request: ${config.url}`);
    });
    expect(container.textContent).toContain('Unable to load users');
  });
});

describe('create user form', () => {
  it('rejects mismatched passwords without calling the API', async () => {
    await renderPage('/master-data/users/new', ['ADMIN'], async (config) => {
      throw new Error(`Unexpected request: ${config.url}`);
    });

    const nameInput = container.querySelector('#field-name') as HTMLInputElement;
    const emailInput = container.querySelector('#field-email') as HTMLInputElement;
    const passwordInput = container.querySelector('#password-password') as HTMLInputElement;
    const confirmInput = container.querySelector('#password-confirm-password') as HTMLInputElement;
    const roleLabel = Array.from(container.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('MERCHANDISER'),
    ) as HTMLLabelElement;
    const roleCheckbox = roleLabel.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    const form = container.querySelector('form') as HTMLFormElement;

    await act(async () => {
      setInputValue(nameInput, 'New User');
      setInputValue(emailInput, 'new-user@test.local');
      setInputValue(passwordInput, 'password123');
      setInputValue(confirmInput, 'different123');
      roleCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(container.textContent).toContain('Passwords do not match');
  });
});

describe('user detail page', () => {
  const baseUser = {
    id: 'user-1',
    name: 'Distributor Person',
    email: 'dist@test.local',
    status: 'ACTIVE' as const,
    roles: ['DISTRIBUTOR'],
    distributors: [],
    factories: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  it('shows the distributor mapping panel for a DISTRIBUTOR-role user but not factory mappings', async () => {
    await renderPage('/master-data/users/user-1', ['ADMIN'], async (config) => {
      if (config.url === '/users/user-1') return ok(config, { success: true, data: baseUser });
      if (config.url === '/distributors') return ok(config, { success: true, data: [] });
      throw new Error(`Unexpected request: ${config.url}`);
    });
    expect(container.textContent).toContain('Distributor Mapping');
    expect(container.textContent).not.toContain('Factory Mappings');
    expect(container.textContent).toContain('Reset Password');
    expect(container.textContent).toContain('Deactivate');
  });

  it('shows the factory mappings panel for a FACTORY_USER-role user but not distributor mapping', async () => {
    await renderPage('/master-data/users/user-2', ['ADMIN'], async (config) => {
      if (config.url === '/users/user-2')
        return ok(config, {
          success: true,
          data: { ...baseUser, id: 'user-2', roles: ['FACTORY_USER'] },
        });
      if (config.url === '/factories') return ok(config, { success: true, data: [] });
      throw new Error(`Unexpected request: ${config.url}`);
    });
    expect(container.textContent).toContain('Factory Mappings');
    expect(container.textContent).not.toContain('Distributor Mapping');
  });

  it('disables self-deactivation and shows a warning', async () => {
    await renderPage(
      '/master-data/users/admin-1',
      ['ADMIN'],
      async (config) => {
        if (config.url === '/users/admin-1')
          return ok(config, {
            success: true,
            data: { ...baseUser, id: 'admin-1', roles: ['ADMIN'] },
          });
        throw new Error(`Unexpected request: ${config.url}`);
      },
      'admin-1',
    );
    expect(container.textContent).toContain('You cannot deactivate your own account');
    const deactivateButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Deactivate',
    ) as HTMLButtonElement;
    expect(deactivateButton.disabled).toBe(true);
  });

  it('opens the reset password dialog and validates a short password', async () => {
    await renderPage('/master-data/users/user-1', ['ADMIN'], async (config) => {
      if (config.url === '/users/user-1') return ok(config, { success: true, data: baseUser });
      if (config.url === '/distributors') return ok(config, { success: true, data: [] });
      throw new Error(`Unexpected request: ${config.url}`);
    });

    const resetButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reset Password',
    ) as HTMLButtonElement;
    await act(async () => {
      resetButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // Dialog content is rendered via a Radix portal into document.body, not
    // under `container`, so dialog assertions/queries use `document`.
    expect(document.body.textContent).toContain('Reset password');

    const newPasswordInput = document.querySelector('#password-new-password') as HTMLInputElement;
    const confirmInput = document.querySelector(
      '#password-confirm-new-password',
    ) as HTMLInputElement;
    const form = Array.from(document.querySelectorAll('form')).find((f) =>
      f.textContent?.includes('Reset Password'),
    ) as HTMLFormElement;

    await act(async () => {
      setInputValue(newPasswordInput, 'short');
      setInputValue(confirmInput, 'short');
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(document.body.textContent).toContain('Password must be at least 8 characters');
  });
});
