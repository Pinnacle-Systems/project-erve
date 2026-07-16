/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { AuthUser } from '@erve/types';
import { apiClient, setStoredToken } from '@erve/client';
import { ThemeProvider } from '@erve/theme';
import { AuthProvider } from '../auth/AuthContext.js';
import { AccountMenu } from './AccountMenu.js';

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
let logoutCalls: number;

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  logoutCalls = 0;
  sessionStorage.clear();
  localStorage.clear();
  document.documentElement.className = '';
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
});

async function renderAccountMenu(): Promise<void> {
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
            <AccountMenu />
          </AuthProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

function openSheet(): void {
  act(() => {
    (container.querySelector('button[aria-label="Account menu"]') as HTMLElement).click();
  });
}

describe('AccountMenu', () => {
  it('renders a trigger with a 44px effective touch target', async () => {
    await renderAccountMenu();

    const trigger = container.querySelector('button[aria-label="Account menu"]') as HTMLElement;
    expect(trigger).not.toBeNull();
    // h-11 w-11 = 2.75rem = 44px at the default 16px root font size.
    expect(trigger.className).toMatch(/\bh-11\b/);
    expect(trigger.className).toMatch(/\bw-11\b/);
  });

  it('shows the current user name and role once opened', async () => {
    await renderAccountMenu();
    openSheet();

    const sheet = document.body.querySelector('[role="dialog"]');
    expect(sheet).not.toBeNull();
    expect(sheet?.textContent).toContain('Test Driver');
    expect(sheet?.textContent).toContain('DISTRIBUTOR');
  });

  it('renders as a bottom sheet anchored to the viewport bottom, not a centered dialog', async () => {
    await renderAccountMenu();
    openSheet();

    const sheet = document.body.querySelector('[role="dialog"]');
    expect(sheet?.className).toMatch(/\bbottom-0\b/);
  });

  it('offers Light, Dark, and Use device setting inline, with the caption only under the system option', async () => {
    await renderAccountMenu();
    openSheet();

    const sheet = document.body.querySelector('[role="dialog"]') as HTMLElement;
    expect(sheet.querySelectorAll('[role="radio"]')).toHaveLength(3);
    expect(sheet.textContent).toContain('Light');
    expect(sheet.textContent).toContain('Dark');
    expect(sheet.textContent).toContain('Use device setting');
  });

  it('switches the app theme from the account menu', async () => {
    await renderAccountMenu();
    openSheet();

    act(() => {
      (document.body.querySelector('#theme-mode-dark') as HTMLElement).click();
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('shows "Currently light/dark" only beneath the device-setting option', async () => {
    // jsdom has no matchMedia, so system-preference detection deterministically
    // falls back to "light" — see packages/theme/src/system-preference.ts.
    await renderAccountMenu();
    openSheet();

    const systemRow = document.body.querySelector('#theme-mode-system')?.closest('.min-h-11');
    expect(systemRow?.textContent).toContain('Currently light');

    const lightRow = document.body.querySelector('#theme-mode-light')?.closest('.min-h-11');
    expect(lightRow?.textContent).not.toContain('Currently');

    const darkRow = document.body.querySelector('#theme-mode-dark')?.closest('.min-h-11');
    expect(darkRow?.textContent).not.toContain('Currently');
  });

  it('logs out and navigates to /login from the account menu', async () => {
    await renderAccountMenu();
    openSheet();

    const logoutButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.textContent === 'Log out',
    );
    expect(logoutButton).toBeDefined();

    await act(async () => {
      logoutButton?.click();
      await flushMicrotasks();
    });

    expect(logoutCalls).toBe(1);
    // The sheet closes itself as part of logging out.
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('closes via the close button without logging out', async () => {
    await renderAccountMenu();
    openSheet();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();

    act(() => {
      (document.body.querySelector('button[aria-label="Close"]') as HTMLElement).click();
    });

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(logoutCalls).toBe(0);
  });
});
