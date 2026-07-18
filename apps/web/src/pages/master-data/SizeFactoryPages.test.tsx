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
import { FactoryDetailPage } from './FactoryDetailPage.js';
import { SizeDetailPage } from './SizeDetailPage.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
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

async function renderPage(path: string, roles: Role[], adapter: AxiosAdapter) {
  const user: AuthUser = {
    id: 'user-1',
    email: 'user@test.local',
    mobile: null,
    name: 'Test User',
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
                <Route path="/master-data/sizes/:id" element={<SizeDetailPage />} />
                <Route path="/master-data/factories/:id" element={<FactoryDetailPage />} />
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

describe('size and factory management pages', () => {
  it('renders size detail, usage, and management actions', async () => {
    await renderPage('/master-data/sizes/size-1', ['ADMIN'], async (config) => {
      if (config.url === '/sizes/size-1')
        return ok(config, {
          success: true,
          data: {
            id: 'size-1',
            code: 'AGE_3',
            label: '3 years',
            sizeType: 'AGE',
            sortOrder: 3,
            status: 'ACTIVE',
            usage: { styleMappings: 2, purchaseOrderLines: 1, jobOrderLines: 1 },
          },
        });
      throw new Error(`Unexpected request: ${config.url}`);
    });
    expect(container.textContent).toContain('AGE_3');
    expect(container.textContent).toContain('Usage and impact');
    expect(container.textContent).toContain('Deactivate');
    expect(container.textContent).toContain('Edit');
  });

  it('renders mapped users for ADMIN', async () => {
    await renderPage('/master-data/factories/factory-1', ['ADMIN'], async (config) => {
      if (config.url === '/factories/factory-1')
        return ok(config, {
          success: true,
          data: {
            id: 'factory-1',
            code: 'FAC-1',
            name: 'Acme Factory',
            contactName: null,
            contactEmail: null,
            contactPhone: null,
            city: null,
            status: 'ACTIVE',
            usage: { styleMappings: 1, jobOrders: 4, mappedUsers: 1 },
          },
        });
      if (config.url === '/factories/factory-1/users')
        return ok(config, {
          success: true,
          data: [
            {
              id: 'factory-user-1',
              name: 'Operator',
              email: 'operator@test.local',
              status: 'ACTIVE',
              roles: ['FACTORY_USER'],
            },
          ],
        });
      if (config.url === '/users') return ok(config, { success: true, data: [] });
      throw new Error(`Unexpected request: ${config.url}`);
    });
    expect(container.textContent).toContain('Mapped Factory Users');
    expect(container.textContent).toContain('operator@test.local');
    expect(container.textContent).toContain('Remove');
  });

  it('keeps factory detail read-only for FACTORY_USER', async () => {
    await renderPage('/master-data/factories/factory-1', ['FACTORY_USER'], async (config) => {
      if (config.url === '/factories/factory-1')
        return ok(config, {
          success: true,
          data: {
            id: 'factory-1',
            code: 'FAC-1',
            name: 'Acme Factory',
            contactName: null,
            contactEmail: null,
            contactPhone: null,
            city: null,
            status: 'ACTIVE',
            usage: { styleMappings: 1, jobOrders: 4, mappedUsers: 1 },
          },
        });
      throw new Error(`Unexpected request: ${config.url}`);
    });
    expect(container.textContent).toContain('Acme Factory');
    expect(container.textContent).not.toContain('Mapped Factory Users');
    expect(container.textContent).not.toContain('Deactivate');
    expect(container.textContent).not.toContain('Edit');
  });
});
