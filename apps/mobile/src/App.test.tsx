/** @vitest-environment jsdom */
import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@erve/theme';

vi.mock('./lib/api-client.js', () => ({
  AUTH_EXPIRED_EVENT: 'erve:auth-expired',
  apiClient: { get: vi.fn(), post: vi.fn() },
  logoutSession: vi.fn(),
  refreshAccessToken: vi.fn().mockRejectedValue(new Error('no session')),
}));

import { AuthProvider, useAuth } from './auth/AuthContext.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ThemeModeSelector } from './theme/ThemeModeSelector.js';

let container: HTMLDivElement;
let root: Root;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-color-mode');
  document.documentElement.style.cssText = '';
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

describe('Mobile App — theme applies without an explicit colorMode prop', () => {
  it('login renders under dark mode with semantic (not stock) color classes', async () => {
    const client = new QueryClient();
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable" colorMode="dark">
          <QueryClientProvider client={client}>
            <AuthProvider>
              <MemoryRouter initialEntries={['/login']}>
                <LoginPage />
              </MemoryRouter>
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>,
      );
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(container.innerHTML).toContain('bg-background');
    expect(container.innerHTML).toContain('bg-primary');
    expect(container.innerHTML).not.toMatch(/bg-white|bg-blue-600|text-blue-100/);
  });

  it('dashboard renders under dark mode with semantic (not stock) color classes', () => {
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable" colorMode="dark">
          <DashboardPage />
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(container.innerHTML).toContain('bg-background');
    expect(container.innerHTML).toContain('text-foreground');
    expect(container.innerHTML).toContain('text-muted-foreground');
    expect(container.innerHTML).not.toMatch(/bg-gray-50|text-gray-900|text-gray-500/);
  });

  it('does not render a Preferences section or inline theme selector on the dashboard', () => {
    // Theme selection moved to the authenticated shell's account menu — the
    // dashboard is page content and must not duplicate it.
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DashboardPage />
        </ThemeProvider>,
      );
    });

    expect(container.textContent).not.toContain('Preferences');
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(0);
  });
});

describe('Mobile App — theme switching does not disturb unrelated app state', () => {
  function QueryClientProbe({ onClient }: { onClient: (client: QueryClient) => void }) {
    const client = useQueryClient();
    useEffect(() => {
      onClient(client);
    }, [client, onClient]);
    return null;
  }

  function AuthStatusProbe({ onStatus }: { onStatus: (status: string) => void }) {
    const { status } = useAuth();
    useEffect(() => {
      onStatus(status);
    }, [status, onStatus]);
    return null;
  }

  function Harness({
    onClient,
    onStatus,
  }: {
    onClient: (client: QueryClient) => void;
    onStatus: (status: string) => void;
  }) {
    const clientRef = useRef<QueryClient | undefined>(undefined);
    clientRef.current ??= new QueryClient();

    return (
      <ThemeProvider theme="default" density="comfortable">
        <QueryClientProvider client={clientRef.current}>
          <AuthProvider>
            <QueryClientProbe onClient={onClient} />
            <AuthStatusProbe onStatus={onStatus} />
            <ThemeModeSelector />
          </AuthProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }

  it('switching theme mode does not recreate the query client or clear auth state', async () => {
    const clients: QueryClient[] = [];
    const statuses: string[] = [];

    act(() => {
      root.render(
        <Harness onClient={(c) => clients.push(c)} onStatus={(s) => statuses.push(s)} />,
      );
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(statuses.at(-1)).toBe('unauthenticated'); // mocked refreshAccessToken rejects
    const clientCountBefore = clients.length;
    const clientBefore = clients.at(-1);

    act(() => {
      (container.querySelector('#theme-mode-dark') as HTMLElement).click();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    // No new QueryClient instance was created by the theme change.
    expect(clients.every((c) => c === clientBefore)).toBe(true);
    // Auth status is unaffected by the theme change (still settled, not reset to "loading").
    expect(statuses.at(-1)).toBe('unauthenticated');
    expect(clientCountBefore).toBeGreaterThan(0);
  });
});
