/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@erve/theme';
import type { AuthUser } from '@erve/types';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext.js';
import { setStoredToken } from '../../auth/token-storage.js';
import { apiClient } from '../../lib/api-client.js';
import { DistributorDetailPage } from './DistributorDetailPage.js';
import { DistributorListPage } from './DistributorListPage.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function fail(config: InternalAxiosRequestConfig, status: number, message: string) {
  const error = new Error(message) as Error & { response: unknown; isAxiosError: boolean };
  error.isAxiosError = true;
  error.response = { status, data: { error: { message } }, statusText: '', headers: {}, config };
  throw error;
}

const distributor = {
  id: 'dist-1',
  code: 'DIST-1',
  name: 'Acme Distribution',
  gstin: '27AAAAA0000A1Z5',
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  state: null,
  country: null,
  postalCode: null,
  status: 'ACTIVE',
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
};

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
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
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
  vi.useRealTimers();
});

// React's controlled inputs track the native value setter, so a plain
// `input.value = x` followed by dispatching "input" is not observed —
// the native property setter must be invoked directly (see UserPages.test.tsx).
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

async function renderPage(
  path: string,
  adapter: AxiosAdapter,
  callerRoles: AuthUser['roles'] = ['MERCHANDISER'],
) {
  const user: AuthUser = {
    id: 'merch-1',
    email: 'merch@test.local',
    mobile: null,
    name: 'Merchandiser',
    roles: callerRoles,
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
                <Route path="/master-data/distributors" element={<DistributorListPage />} />
                <Route path="/master-data/distributors/:id" element={<DistributorDetailPage />} />
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

describe('distributor management pages', () => {
  it('shows the create action to MERCHANDISER on the distributor list', async () => {
    await renderPage('/master-data/distributors', async (config) => {
      if (config.url === '/distributors') {
        return ok(config, { success: true, data: { items: [distributor], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    });

    const createLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/master-data/distributors/new"]',
    );
    expect(createLink?.textContent).toContain('Create Distributor');
  });

  it('shows edit and status actions to MERCHANDISER without exposing user mappings', async () => {
    await renderPage('/master-data/distributors/dist-1', async (config) => {
      if (config.url === '/distributors/dist-1') {
        return ok(config, { success: true, data: distributor });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    });

    const editLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/master-data/distributors/dist-1/edit"]',
    );
    expect(editLink?.textContent).toContain('Edit');
    expect(container.textContent).toContain('Deactivate');
    expect(container.textContent).not.toContain('Mapped Users');
    expect(container.textContent).toContain('27AAAAA0000A1Z5');
  });

  it('shows the purchaseMode immutability explanation on the detail page for a manager', async () => {
    await renderPage('/master-data/distributors/dist-1', async (config) => {
      if (config.url === '/distributors/dist-1') {
        return ok(config, { success: true, data: { ...distributor, purchaseMode: 'OUTRIGHT' } });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    });

    expect(container.textContent).toContain('Purchase Mode is locked after creation');
  });

  it('debounces the distributor list search so rapid typing issues only the final request', async () => {
    const requestedSearches: Array<string | undefined> = [];
    await renderPage('/master-data/distributors', async (config) => {
      if (config.url === '/distributors') {
        requestedSearches.push((config.params as { search?: string } | undefined)?.search);
        return ok(config, { success: true, data: { items: [distributor], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } });
      }
      throw new Error(`Unexpected request: ${config.url}`);
    });

    const requestsBeforeTyping = requestedSearches.length;
    const input = container.querySelector<HTMLInputElement>(
      'input[placeholder="Search distributors"]',
    )!;

    vi.useFakeTimers();
    for (const value of ['A', 'Ac', 'Acm', 'Acme']) {
      act(() => setInputValue(input, value));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(requestedSearches.length).toBe(requestsBeforeTyping);
    expect(input.value).toBe('Acme');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    expect(requestedSearches.length).toBe(requestsBeforeTyping + 1);
    expect(requestedSearches.at(-1)).toBe('Acme');
  });
});

// Opens the "Assign user" lookup and clicks the candidate named `name`.
async function pickAssignUser(name: string) {
  const input = document.getElementById('lookup-assign-user') as HTMLInputElement;
  await act(async () => {
    input.focus();
    input.click();
  });
  const deadline = Date.now() + 3000;
  let option: HTMLElement | undefined;
  while (!option) {
    if (Date.now() > deadline) throw new Error(`Candidate ${name} never appeared`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find((el) =>
      el.textContent?.includes(name),
    );
  }
  await act(async () => option.click());
}

describe('distributor detail — UserMappingPanel (U3B regression coverage)', () => {
  // GET /distributors/:id/user-options — already eligible, id/name/email only.
  const eligibleUser = { id: 'du-1', name: 'Dana Distributor', email: 'dana@test.local' };
  const mappedUser = {
    id: 'du-2',
    name: 'Pat Distributor',
    email: 'pat@test.local',
    status: 'ACTIVE',
    roles: ['DISTRIBUTOR'],
  };

  it('is not shown to a MERCHANDISER (mapping management is ADMIN-only)', async () => {
    await renderPage(
      '/master-data/distributors/dist-1',
      async (config) => {
        if (config.url === '/distributors/dist-1') return ok(config, { success: true, data: distributor });
        throw new Error(`Unexpected request: ${config.url}`);
      },
      ['MERCHANDISER'],
    );
    expect(container.textContent).not.toContain('Mapped Users');
  });

  it('assigns an eligible distributor user to the distributor', async () => {
    const assignCalls: Array<{ url: string; body: unknown }> = [];
    await renderPage(
      '/master-data/distributors/dist-1',
      async (config) => {
        if (config.url === '/distributors/dist-1') return ok(config, { success: true, data: distributor });
        if (config.url === '/distributors/dist-1/users') return ok(config, { success: true, data: [] });
        if (config.url === '/distributors/dist-1/user-options')
          return ok(config, { success: true, data: [eligibleUser] });
        if (config.url === '/users/du-1/distributors' && config.method === 'post') {
          assignCalls.push({ url: config.url, body: config.data ? JSON.parse(config.data) : undefined });
          return ok(config, { success: true, data: {} });
        }
        throw new Error(`Unexpected request: ${config.url} ${config.method}`);
      },
      ['ADMIN'],
    );

    expect(container.textContent).toContain('Mapped Users');
    await pickAssignUser('Dana Distributor');
    const assignButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Assign',
    ) as HTMLButtonElement;
    await act(async () => {
      assignButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(assignCalls).toHaveLength(1);
    expect(assignCalls[0]).toEqual({ url: '/users/du-1/distributors', body: { distributorId: 'dist-1' } });
  });

  it('removes a mapped user after confirmation', async () => {
    let removeCalled = false;
    await renderPage(
      '/master-data/distributors/dist-1',
      async (config) => {
        if (config.url === '/distributors/dist-1') return ok(config, { success: true, data: distributor });
        if (config.url === '/distributors/dist-1/users')
          return ok(config, { success: true, data: [mappedUser] });
        if (config.url === '/distributors/dist-1/user-options')
          return ok(config, { success: true, data: [] });
        if (config.url === '/users/du-2/distributors/dist-1' && config.method === 'delete') {
          removeCalled = true;
          return ok(config, { success: true, data: {} });
        }
        throw new Error(`Unexpected request: ${config.url} ${config.method}`);
      },
      ['ADMIN'],
    );

    expect(container.textContent).toContain('Pat Distributor');
    const removeButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Remove',
    ) as HTMLButtonElement;
    await act(async () => {
      removeButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // ConfirmDialog is rendered via a Radix portal into document.body.
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Remove' && b !== removeButton,
    ) as HTMLButtonElement;
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(removeCalled).toBe(true);
  });

  it('shows a mutation error message when assignment fails', async () => {
    await renderPage(
      '/master-data/distributors/dist-1',
      async (config) => {
        if (config.url === '/distributors/dist-1') return ok(config, { success: true, data: distributor });
        if (config.url === '/distributors/dist-1/users') return ok(config, { success: true, data: [] });
        if (config.url === '/distributors/dist-1/user-options')
          return ok(config, { success: true, data: [eligibleUser] });
        if (config.url === '/users/du-1/distributors' && config.method === 'post') {
          fail(config, 409, 'User is already mapped to a distributor');
        }
        throw new Error(`Unexpected request: ${config.url} ${config.method}`);
      },
      ['ADMIN'],
    );

    await pickAssignUser('Dana Distributor');
    const assignButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Assign',
    ) as HTMLButtonElement;
    await act(async () => {
      assignButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(container.textContent).toContain('User is already mapped to a distributor');
  });
});
