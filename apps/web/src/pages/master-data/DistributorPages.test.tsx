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

const distributor = {
  id: 'dist-1',
  code: 'DIST-1',
  name: 'Acme Distribution',
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

async function renderPage(path: string, adapter: AxiosAdapter) {
  const user: AuthUser = {
    id: 'merch-1',
    email: 'merch@test.local',
    mobile: null,
    name: 'Merchandiser',
    roles: ['MERCHANDISER'],
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
        return ok(config, { success: true, data: [distributor] });
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
  });
});
