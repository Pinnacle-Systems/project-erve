/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { AuthUser, Role } from '@erve/types';
import { ThemeProvider } from '@erve/theme';
import { apiClient } from '../lib/api-client.js';
import { setStoredToken } from '../auth/token-storage.js';
import { AuthProvider } from '../auth/AuthContext.js';
import { AppLayout } from './AppLayout.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
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
  vi.unstubAllGlobals();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function renderAppLayout(roles: Role[]): Promise<void> {
  setStoredToken('valid-token');
  const user: AuthUser = {
    id: 'user-1',
    email: 'test@test.local',
    mobile: null,
    name: 'Test User',
    roles,
  };

  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/auth/me') {
      return ok(config, { success: true, data: user });
    }
    throw new Error(`Unexpected request: ${config.url}`);
  }) satisfies AxiosAdapter;

  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ThemeProvider theme="default" density="comfortable">
          <AuthProvider>
            <Routes>
              <Route path="/dashboard" element={<AppLayout />}>
                <Route index element={<div>Dashboard Page</div>} />
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

function sidebarLinkLabels(): string[] {
  const aside = container.querySelector('aside');
  return Array.from(aside?.querySelectorAll('nav a') ?? []).map((a) => a.textContent ?? '');
}

describe('AppLayout — role-gated navigation', () => {
  it('ADMIN sees every Master Data and Orders link', async () => {
    await renderAppLayout(['ADMIN']);
    const labels = sidebarLinkLabels();

    expect(labels).toContain('Styles');
    expect(labels).toContain('Sizes');
    expect(labels).toContain('Factories');
    expect(labels).toContain('Distributors');
    expect(labels).toContain('Process Flows');
    expect(labels).toContain('Price Lists');
    expect(labels).toContain('Purchase Orders');
    expect(labels).toContain('+ New PO');
    expect(labels).toContain('Job Orders');
    expect(labels).toContain('Users');
  });

  it('SENIOR_MANAGEMENT sees Styles, Distributors and Price Lists but not Sizes/Factories/Process Flows, +New PO, or Users', async () => {
    await renderAppLayout(['SENIOR_MANAGEMENT']);
    const labels = sidebarLinkLabels();

    expect(labels).toContain('Styles');
    expect(labels).not.toContain('Sizes');
    expect(labels).not.toContain('Factories');
    expect(labels).toContain('Distributors');
    expect(labels).not.toContain('Process Flows');
    expect(labels).toContain('Price Lists');
    expect(labels).toContain('Purchase Orders');
    expect(labels).not.toContain('+ New PO');
    expect(labels).toContain('Job Orders');
    expect(labels).not.toContain('Users');
  });

  it('FACTORY_USER sees only Factories in Master Data, and Job Orders but not +New PO', async () => {
    await renderAppLayout(['FACTORY_USER']);
    const labels = sidebarLinkLabels();

    expect(labels).not.toContain('Styles');
    expect(labels).not.toContain('Sizes');
    expect(labels).toContain('Factories');
    expect(labels).not.toContain('Distributors');
    expect(labels).not.toContain('Process Flows');
    expect(labels).not.toContain('Price Lists');
    expect(labels).toContain('Purchase Orders');
    expect(labels).not.toContain('+ New PO');
    expect(labels).toContain('Job Orders');
  });

  it('ACCOUNTANT sees Price Lists but no other Master Data links', async () => {
    await renderAppLayout(['ACCOUNTANT']);
    const labels = sidebarLinkLabels();

    expect(labels).not.toContain('Styles');
    expect(labels).not.toContain('Sizes');
    expect(labels).not.toContain('Factories');
    expect(labels).not.toContain('Distributors');
    expect(labels).not.toContain('Process Flows');
    expect(labels).toContain('Price Lists');
  });

  it('DISTRIBUTOR sees Purchase Orders, +New PO and Price Lists but no other Master Data or Job Orders links', async () => {
    await renderAppLayout(['DISTRIBUTOR']);
    const labels = sidebarLinkLabels();

    expect(labels).not.toContain('Styles');
    expect(labels).not.toContain('Sizes');
    expect(labels).not.toContain('Factories');
    expect(labels).not.toContain('Distributors');
    expect(labels).not.toContain('Process Flows');
    expect(labels).toContain('Price Lists');
    expect(labels).toContain('Purchase Orders');
    expect(labels).toContain('+ New PO');
    expect(labels).not.toContain('Job Orders');
  });
});
