/** @vitest-environment jsdom */
import { act, useEffect, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '@erve/theme';

import { ThemeModeSelector } from './ThemeModeSelector.js';

const STORAGE_KEY = 'erve.themePreference';

type ChangeHandler = (event: { matches: boolean }) => void;

class FakeMediaQueryList {
  matches: boolean;
  private listeners = new Set<ChangeHandler>();

  constructor(matches: boolean) {
    this.matches = matches;
  }

  addEventListener(type: 'change', listener: ChangeHandler): void {
    if (type === 'change') this.listeners.add(listener);
  }

  removeEventListener(type: 'change', listener: ChangeHandler): void {
    if (type === 'change') this.listeners.delete(listener);
  }

  emit(matches: boolean): void {
    this.matches = matches;
    for (const listener of this.listeners) listener({ matches });
  }
}

function stubMatchMedia(initialMatches = false): FakeMediaQueryList {
  const mql = new FakeMediaQueryList(initialMatches);
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return mql;
}

let container: HTMLDivElement;
let root: Root;

function render(ui: ReactElement): void {
  act(() => {
    root.render(ui);
  });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);

  window.localStorage.clear();
  document.documentElement.className = '';
  document.documentElement.removeAttribute('data-theme');
  document.documentElement.removeAttribute('data-density');
  document.documentElement.removeAttribute('data-color-mode');
  document.documentElement.style.cssText = '';

  stubMatchMedia(false);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ThemeModeSelector renders inline (no popover to open first), unlike web's
// ThemeModeMenu — so options are directly clickable in the same container.
function selectThemeOption(mode: 'light' | 'dark' | 'system'): void {
  act(() => {
    (container.querySelector(`#theme-mode-${mode}`) as HTMLElement).click();
  });
}

function checkedRadio(): string | null {
  const checked = container.querySelector('[role="radio"][aria-checked="true"]');
  return checked?.id.replace(/^theme-mode-/, '') ?? null;
}

/** Mirrors apps/mobile's real App.tsx wiring: an uncontrolled ThemeProvider
 * with the selector mounted inside it — without pulling in auth/router/
 * query-client, which are unrelated to theme behavior and would make these
 * tests fragile (real network calls on mount). */
function Harness() {
  return (
    <ThemeProvider theme="default" density="comfortable">
      <ThemeModeSelector />
    </ThemeProvider>
  );
}

describe('Mobile theme runtime — initial mode', () => {
  it('no stored preference + system light -> light', () => {
    stubMatchMedia(false);
    render(<Harness />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('no stored preference + system dark -> dark', () => {
    stubMatchMedia(true);
    render(<Harness />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('stored light + system dark -> light', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    stubMatchMedia(true);
    render(<Harness />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('stored dark + system light -> dark', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    stubMatchMedia(false);
    render(<Harness />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('stored system follows the system preference (dark)', () => {
    window.localStorage.setItem(STORAGE_KEY, 'system');
    stubMatchMedia(true);
    render(<Harness />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('invalid stored value falls back to system', () => {
    window.localStorage.setItem(STORAGE_KEY, 'blue');
    stubMatchMedia(true);
    render(<Harness />);
    expect(checkedRadio()).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('Mobile theme runtime — runtime switching', () => {
  it('light -> dark via the selector', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    render(<Harness />);

    selectThemeOption('dark');

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('dark -> light via the selector', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    render(<Harness />);

    selectThemeOption('light');

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('explicit mode ignores a subsequent system-preference change', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    const mql = stubMatchMedia(false);
    render(<Harness />);

    act(() => {
      mql.emit(true);
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(checkedRadio()).toBe('light');
  });

  it('a system-preference change updates resolvedTheme when mode is system', () => {
    window.localStorage.setItem(STORAGE_KEY, 'system');
    const mql = stubMatchMedia(false);
    render(<Harness />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    act(() => {
      mql.emit(true);
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('Mobile theme runtime — persistence', () => {
  it('selecting dark stores "dark"', () => {
    render(<Harness />);
    selectThemeOption('dark');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('a fresh mount ("app restart") picks up the persisted selection', () => {
    render(<Harness />);
    selectThemeOption('dark');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    render(<Harness />);

    expect(checkedRadio()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('Mobile theme runtime — DOM markers', () => {
  it('toggles .dark correctly', () => {
    render(<Harness />);
    selectThemeOption('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('data-color-mode reflects the SELECTED mode (may be "system")', () => {
    render(<Harness />);
    selectThemeOption('system');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('system');
  });

  it('data-theme remains "default" and data-density remains "comfortable"', () => {
    render(<Harness />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('default');
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable');
  });

  it('style.colorScheme matches the resolved theme', () => {
    stubMatchMedia(true);
    window.localStorage.setItem(STORAGE_KEY, 'system');
    render(<Harness />);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });
});

describe('Mobile theme runtime — selector', () => {
  it('shows all three modes', () => {
    render(<Harness />);
    expect(container.querySelectorAll('[role="radio"]')).toHaveLength(3);
  });

  it('reflects the selected ThemeMode, not merely the resolved theme', () => {
    stubMatchMedia(true); // system resolves dark, but selection stays "light"
    window.localStorage.setItem(STORAGE_KEY, 'light');
    render(<Harness />);
    expect(checkedRadio()).toBe('light');
  });

  it('stays selected on "system" after an OS theme change', () => {
    window.localStorage.setItem(STORAGE_KEY, 'system');
    const mql = stubMatchMedia(false);
    render(<Harness />);
    expect(checkedRadio()).toBe('system');

    act(() => {
      mql.emit(true);
    });

    expect(checkedRadio()).toBe('system');
  });

  it('updates the "currently light/dark" caption when the resolved theme changes', () => {
    window.localStorage.setItem(STORAGE_KEY, 'system');
    const mql = stubMatchMedia(false);
    render(<Harness />);
    expect(container.textContent).toContain('Currently light');

    act(() => {
      mql.emit(true);
    });
    expect(container.textContent).toContain('Currently dark');
  });
});

describe('Mobile theme runtime — no full remount on theme change', () => {
  it('changing mode does not remount an unrelated sibling component', () => {
    let mountEffectCount = 0;
    function Sentinel() {
      useEffect(() => {
        mountEffectCount += 1;
      }, []);
      return null;
    }

    render(
      <ThemeProvider theme="default" density="comfortable">
        <Sentinel />
        <ThemeModeSelector />
      </ThemeProvider>,
    );
    expect(mountEffectCount).toBe(1);

    selectThemeOption('dark');

    expect(mountEffectCount).toBe(1);
  });
});
