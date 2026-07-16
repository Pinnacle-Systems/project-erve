/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { AuthUser } from '@erve/types';
import { ThemeProvider } from '@erve/theme';
import { apiClient } from '../lib/api-client.js';
import { setStoredToken } from '../auth/token-storage.js';
import { AuthProvider } from '../auth/AuthContext.js';
import { AppShell, type AppShellNavSection } from './AppShell.js';

const TEST_USER: AuthUser = {
  id: 'user-1',
  email: 'admin@test.local',
  mobile: null,
  name: 'Test Admin',
  roles: ['ADMIN'],
};

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const NAV_SECTIONS: AppShellNavSection[] = [
  { items: [{ to: '/dashboard', label: 'Dashboard' }] },
  {
    heading: 'Orders',
    items: [
      { to: '/purchase-orders', label: 'Purchase Orders', end: true },
      { to: '/job-orders', label: 'Job Orders' },
    ],
  },
];

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let logoutCalls: number;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  logoutCalls = 0;
  sessionStorage.clear();
  localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-color-mode');
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

// Radix's DropdownMenuTrigger opens on `pointerdown`, not `click` — a plain
// `.click()` (a synthetic "click" event only) never triggers it in jsdom.
function firePointerDown(element: HTMLElement): void {
  element.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
}

async function renderShell(navSections: AppShellNavSection[] = NAV_SECTIONS): Promise<void> {
  setStoredToken('valid-token');
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    if (config.url === '/auth/me') {
      return ok(config, { success: true, data: TEST_USER });
    }
    if (config.url === '/auth/logout') {
      logoutCalls += 1;
      return ok(config, { success: true, data: {} });
    }
    throw new Error(`Unexpected request: ${config.url}`);
  }) satisfies AxiosAdapter;

  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/dashboard']}>
        <ThemeProvider theme="default" density="comfortable">
          <AuthProvider>
            <AppShell navSections={navSections}>
              <div>Page Content</div>
            </AppShell>
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('AppShell', () => {
  it('renders the Erve logo, nav sections, and the routed page content', async () => {
    await renderShell();

    const logo = container.querySelector('img[alt="Erve"]');
    expect(logo).not.toBeNull();
    expect(logo?.getAttribute('src')).toBe('/erve-logo.png');
    expect(container.textContent).toContain('Dashboard');
    expect(container.textContent).toContain('Orders');
    expect(container.textContent).toContain('Purchase Orders');
    expect(container.textContent).toContain('Job Orders');
    expect(container.textContent).toContain('Page Content');
  });

  it('shows the authenticated user name and roles in the header', async () => {
    await renderShell();

    expect(container.textContent).toContain('Test Admin');
    expect(container.textContent).toContain('ADMIN');
  });

  it('renders the same nav items in both the sidebar and the mobile nav', async () => {
    await renderShell();

    const poLinks = Array.from(container.querySelectorAll('a')).filter(
      (a) => a.getAttribute('href') === '/purchase-orders',
    );
    expect(poLinks).toHaveLength(2);
  });

  it('toggles light/dark theme via the header ThemeModeMenu control', async () => {
    await renderShell();

    act(() => {
      firePointerDown(container.querySelector('button[aria-label^="Theme:"]') as HTMLElement);
    });
    act(() => {
      (document.body.querySelector('#theme-mode-dark') as HTMLElement).click();
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    act(() => {
      firePointerDown(container.querySelector('button[aria-label^="Theme:"]') as HTMLElement);
    });
    act(() => {
      (document.body.querySelector('#theme-mode-light') as HTMLElement).click();
    });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('logs out and clears the session when Log out is clicked', async () => {
    await renderShell();

    const logoutButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Log out',
    );
    expect(logoutButton).toBeDefined();

    await act(async () => {
      logoutButton?.click();
      await flushMicrotasks();
    });

    expect(logoutCalls).toBe(1);
  });
});
