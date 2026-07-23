/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { ClipboardList, Hammer, LayoutDashboard } from 'lucide-react';
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
  { items: [{ to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }] },
  {
    heading: 'Orders',
    items: [
      { to: '/purchase-orders', label: 'Purchase Orders', end: true, icon: ClipboardList },
      { to: '/job-orders', label: 'Job Orders', icon: Hammer },
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

  it('renders Pinnacle "Powered by" branding at the bottom of the expanded sidebar, subordinate to the Erve logo', async () => {
    await renderShell();

    expect(container.textContent).toContain('Powered by');
    const pinnacleLogo = container.querySelector('img[alt=""]') as HTMLImageElement;
    expect(pinnacleLogo).not.toBeNull();
    expect(pinnacleLogo.getAttribute('src')).toBe('/pinnacle-logo-on-light.png');

    const erveLogo = container.querySelector('img[alt="Erve"]') as HTMLImageElement;
    // Structural, non-pixel-brittle check that Erve stays the visually
    // larger/primary mark: its height utility class is a bigger Tailwind
    // step than the Pinnacle row logo's.
    expect(erveLogo.className).toContain('h-8');
    expect(pinnacleLogo.className).toContain('h-6');
  });

  it('collapses the sidebar on toggle, persists the preference, and shows the compact branding treatment', async () => {
    await renderShell();

    const toggle = container.querySelector('button[aria-label="Collapse sidebar"]') as HTMLElement;
    expect(toggle).not.toBeNull();

    act(() => {
      toggle.click();
    });

    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.className).toContain('--erp-shell-sidebar-collapsed-width');
    expect(localStorage.getItem('erve.sidebarCollapsed')).toBe('true');

    // Row branding (visible "Powered by" text) is gone once collapsed...
    const sidebarText = aside.textContent ?? '';
    expect(sidebarText).not.toContain('Powered by');

    // ...replaced by the compact, alt-text-only treatment, which remains
    // fully accessible via its own alt attribute.
    const compactLogo = aside.querySelector('img[alt="Powered by Pinnacle Systems"]');
    expect(compactLogo).not.toBeNull();

    const expandToggle = container.querySelector(
      'button[aria-label="Expand sidebar"]',
    ) as HTMLElement;
    act(() => {
      expandToggle.click();
    });
    expect(localStorage.getItem('erve.sidebarCollapsed')).toBe('false');
    expect((container.querySelector('aside') as HTMLElement).className).not.toContain(
      '--erp-shell-sidebar-collapsed-width',
    );
  });

  it('keeps the full nav label available as the accessible name when the sidebar is collapsed', async () => {
    await renderShell();

    act(() => {
      (container.querySelector('button[aria-label="Collapse sidebar"]') as HTMLElement).click();
    });

    // Scoped to <nav> specifically: the sidebar's Erve-logo link is also
    // `to="/dashboard"` and precedes the nav in DOM order, but carries no
    // text (just the logo image), so an unscoped selector would find it
    // instead of the actual nav item.
    const dashboardLink = container.querySelector('aside nav a[href="/dashboard"]');
    expect(dashboardLink?.getAttribute('aria-label')).toBe('Dashboard');
    expect(dashboardLink?.querySelector('span')?.className).toContain('max-w-0');
    expect(dashboardLink?.querySelector('span')?.className).toContain('whitespace-nowrap');
  });

  it('shows a decorative icon (not text initials) for every nav item once collapsed', async () => {
    await renderShell();

    act(() => {
      (container.querySelector('button[aria-label="Collapse sidebar"]') as HTMLElement).click();
    });

    const navLinks = container.querySelectorAll('aside nav a');
    expect(navLinks).toHaveLength(NAV_SECTIONS.flatMap((section) => section.items).length);
    navLinks.forEach((link) => {
      const icon = link.querySelector('svg[aria-hidden="true"]');
      expect(icon).not.toBeNull();
      // The full label remains in a clipped, non-wrapping wrapper while
      // aria-label supplies the accessible name throughout the transition.
      const label = link.querySelector('span[aria-hidden="true"]');
      expect(label).not.toBeNull();
      expect(label?.className).toContain('max-w-0');
      expect(link.getAttribute('aria-label')).toBe(label?.textContent);
    });
  });

  it('uses fixed shared nav geometry and scopes scrolling to the navigation region', async () => {
    await renderShell();

    const aside = container.querySelector('aside') as HTMLElement;
    const nav = aside.querySelector('nav') as HTMLElement;
    const heading = Array.from(nav.querySelectorAll('div')).find(
      (element) => element.textContent === 'Orders',
    ) as HTMLElement;
    const expandedLinks = Array.from(nav.querySelectorAll('a'));

    expect(aside.className).toContain('overflow-hidden');
    expect(nav.className).toContain('min-h-0');
    expect(nav.className).toContain('overflow-y-auto');
    expect(nav.className).toContain('overflow-x-hidden');
    expect(heading.className).toContain('h-9');
    expandedLinks.forEach((link) => expect(link.className).toContain('h-10'));

    act(() => {
      (container.querySelector('button[aria-label="Collapse sidebar"]') as HTMLElement).click();
    });

    expect(heading.className).toContain('h-9');
    expect(heading.className).toContain('invisible');
    Array.from(nav.querySelectorAll('a')).forEach((link) => {
      expect(link.className).toContain('h-10');
      expect(link.className).toContain('justify-center');
    });
  });

  it('hides the native scrollbar only while collapsed, never in expanded mode', async () => {
    await renderShell();

    const aside = container.querySelector('aside') as HTMLElement;
    const nav = aside.querySelector('nav') as HTMLElement;

    // Expanded: the scrollbar stays visible — it's the only cue that more
    // nav items exist below the fold, and there's no icon column for it to
    // overlap in this mode.
    expect(nav.getAttribute('data-scrollbar-hidden')).toBeNull();
    expect(nav.className).not.toContain('scrollbar-width:none');
    expect(nav.className).not.toContain('::-webkit-scrollbar');

    act(() => {
      (container.querySelector('button[aria-label="Collapse sidebar"]') as HTMLElement).click();
    });

    // Collapsed: the scrollbar is suppressed so it can never render on top
    // of the centered icon column, while overflow-y-auto (asserted above)
    // keeps scrolling itself fully functional.
    expect(nav.getAttribute('data-scrollbar-hidden')).toBe('true');
    expect(nav.className).toContain('[scrollbar-width:none]');
    expect(nav.className).toContain('[-ms-overflow-style:none]');
    expect(nav.className).toContain('[&::-webkit-scrollbar]:hidden');

    act(() => {
      (container.querySelector('button[aria-label="Expand sidebar"]') as HTMLElement).click();
    });

    // Toggling back to expanded removes the hiding classes again — the
    // scrollbar's visibility tracks collapse state on every transition, not
    // just on first mount.
    expect(nav.getAttribute('data-scrollbar-hidden')).toBeNull();
    expect(nav.className).not.toContain('scrollbar-width:none');
  });

  it('starts collapsed when localStorage has a persisted collapsed preference', async () => {
    localStorage.setItem('erve.sidebarCollapsed', 'true');
    await renderShell();

    const aside = container.querySelector('aside') as HTMLElement;
    expect(aside.className).toContain('--erp-shell-sidebar-collapsed-width');
    expect(container.querySelector('button[aria-label="Expand sidebar"]')).not.toBeNull();
  });
});
