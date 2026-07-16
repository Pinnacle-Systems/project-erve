/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@erve/theme';

import { PoweredByPinnacleBranding } from './PoweredByPinnacleBranding.js';

const STORAGE_KEY = 'erve.themePreference';

let container: HTMLDivElement;
let root: Root;

function stubMatchMedia(matches = false): void {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    addEventListener: () => {},
    removeEventListener: () => {},
  }) as unknown as typeof window.matchMedia;
}

function renderBranding(variant?: 'row' | 'compact'): void {
  act(() => {
    root.render(
      <ThemeProvider theme="default" density="comfortable">
        <PoweredByPinnacleBranding variant={variant} />
      </ThemeProvider>,
    );
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
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

describe('PoweredByPinnacleBranding (mobile)', () => {
  it('selects the light-theme logo when resolvedTheme is light', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    stubMatchMedia(false);
    renderBranding();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('pinnacle-logo-on-light');
  });

  it('selects the dark-theme logo when resolvedTheme is dark', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    stubMatchMedia(false);
    renderBranding();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('pinnacle-logo-on-dark');
  });

  it('system mode follows the resolved theme (jsdom has no matchMedia support, resolves light)', () => {
    window.localStorage.setItem(STORAGE_KEY, 'system');
    stubMatchMedia(false);
    renderBranding();
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('pinnacle-logo-on-light');
  });

  it('compact variant selects the theme-appropriate mark asset, not the full lockup', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    stubMatchMedia(false);
    renderBranding('compact');
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('pinnacle-mark-on-light');
  });

  it('compact variant follows dark theme too', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    stubMatchMedia(false);
    renderBranding('compact');
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('pinnacle-mark-on-dark');
  });
});
