/** @vitest-environment jsdom */
import { act, useEffect, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@erve/primitives';
import { ThemeProvider } from '@erve/theme';

import { ThemeModeMenu } from './ThemeModeMenu.js';

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

/** DropdownMenu/Tooltip position themselves via Radix Popper, which calls
 * ResizeObserver — unimplemented in jsdom. Content is rendered via `open`,
 * so no simulated pointer interaction depends on real measurement. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** Mirrors apps/web/src/App.tsx's real (post-Part-1) wiring: an uncontrolled
 * ThemeProvider with the selector mounted inside it — without pulling in
 * auth/router/query-client, which are unrelated to theme behavior and would
 * make these tests fragile (real network calls on mount). */
function Harness() {
  return (
    <ThemeProvider theme="default" density="comfortable">
      <ThemeModeMenu />
    </ThemeProvider>
  );
}

let container: HTMLDivElement;
let root: Root;

function render(ui: ReactElement): void {
  act(() => {
    root.render(ui);
  });
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
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

// Radix's DropdownMenuTrigger opens on `pointerdown`, not `click` — a plain
// `.click()` (a synthetic "click" event only) never triggers it in jsdom.
function firePointerDown(element: HTMLElement): void {
  element.dispatchEvent(
    new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }),
  );
}

function openThemeMenu(): void {
  act(() => {
    firePointerDown(container.querySelector('button[aria-label^="Theme:"]') as HTMLElement);
  });
}

function selectThemeOption(mode: 'light' | 'dark' | 'system'): void {
  openThemeMenu();
  act(() => {
    (document.body.querySelector(`#theme-mode-${mode}`) as HTMLElement).click();
  });
}

function checkedRadio(): string | null {
  openThemeMenu();
  const checked = document.body.querySelector('[role="menuitemradio"][aria-checked="true"]');
  // Radix's RadioItem doesn't forward `value` onto the DOM node, so recover
  // it from the stable `id="theme-mode-{value}"` set on each option instead.
  const value = checked?.id.replace(/^theme-mode-/, '') ?? null;
  // Close the menu again so it doesn't linger open for the assertions/clicks
  // that follow this helper call.
  act(() => {
    firePointerDown(container.querySelector('button[aria-label^="Theme:"]') as HTMLElement);
  });
  return value;
}

describe('Web theme runtime — initial mode', () => {
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

  it('stored system follows the system preference (light)', () => {
    window.localStorage.setItem(STORAGE_KEY, 'system');
    stubMatchMedia(false);
    render(<Harness />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('invalid stored value falls back to system', () => {
    window.localStorage.setItem(STORAGE_KEY, 'blue');
    stubMatchMedia(true);
    render(<Harness />);
    expect(checkedRadio()).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('Web theme runtime — runtime switching', () => {
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

  it('explicit -> system via the selector', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    const mql = stubMatchMedia(true);
    render(<Harness />);
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    selectThemeOption('system');

    expect(checkedRadio()).toBe('system');
    expect(document.documentElement.classList.contains('dark')).toBe(true); // follows mql (true)
    void mql;
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

  it('a system-preference change does NOT change an explicit mode', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    const mql = stubMatchMedia(false);
    render(<Harness />);

    act(() => {
      mql.emit(true);
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(checkedRadio()).toBe('light');
  });
});

describe('Web theme runtime — persistence', () => {
  it('selecting light stores "light"', () => {
    render(<Harness />);
    selectThemeOption('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');
  });

  it('selecting dark stores "dark"', () => {
    render(<Harness />);
    selectThemeOption('dark');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');
  });

  it('selecting system stores "system"', () => {
    window.localStorage.setItem(STORAGE_KEY, 'light');
    render(<Harness />);
    selectThemeOption('system');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('system');
  });

  it('a fresh mount ("reload") picks up the persisted selection', () => {
    render(<Harness />);
    selectThemeOption('dark');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');

    act(() => {
      root.unmount();
    });
    root = createRoot(container);
    render(<Harness />); // simulates a fresh page load reading the same storage

    expect(checkedRadio()).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});

describe('Web theme runtime — DOM markers', () => {
  it('toggles .dark correctly', () => {
    render(<Harness />);
    selectThemeOption('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    selectThemeOption('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('data-color-mode reflects the SELECTED mode (may be "system"), matching the documented ThemeProvider contract', () => {
    render(<Harness />);
    selectThemeOption('system');
    expect(document.documentElement.getAttribute('data-color-mode')).toBe('system');
  });

  it('data-theme remains "default"', () => {
    render(<Harness />);
    expect(document.documentElement.getAttribute('data-theme')).toBe('default');
  });

  it('data-density remains "comfortable"', () => {
    render(<Harness />);
    expect(document.documentElement.getAttribute('data-density')).toBe('comfortable');
  });

  it('style.colorScheme matches the resolved theme', () => {
    stubMatchMedia(true);
    window.localStorage.setItem(STORAGE_KEY, 'system');
    render(<Harness />);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('Dialog content still renders outside the root while inheriting the global theme', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <Dialog open>
            <DialogContent aria-describedby={undefined}>
              <DialogTitle>Example</DialogTitle>
            </DialogContent>
          </Dialog>
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('DropdownMenu content still renders outside the root while inheriting the global theme', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <DropdownMenu open>
            <DropdownMenuTrigger>Open</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem>Item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    const menu = document.body.querySelector('[role="menu"]');
    expect(menu).not.toBeNull();
    expect(container.contains(menu)).toBe(false);
  });

  it('Tooltip content still renders outside the root while inheriting the global theme', () => {
    window.localStorage.setItem(STORAGE_KEY, 'dark');
    act(() => {
      root.render(
        <ThemeProvider theme="default" density="comfortable">
          <TooltipProvider>
            <Tooltip open>
              <TooltipTrigger>Hover</TooltipTrigger>
              <TooltipContent>Hint</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </ThemeProvider>,
      );
    });

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    const tooltip = document.body.querySelector('[role="tooltip"]');
    expect(tooltip).not.toBeNull();
    expect(container.contains(tooltip)).toBe(false);
  });
});

describe('Web theme runtime — selector', () => {
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
    openThemeMenu();
    expect(document.body.textContent).toContain('Currently light');

    act(() => {
      mql.emit(true);
    });
    expect(document.body.textContent).toContain('Currently dark');
  });
});

describe('Web theme runtime — no full remount on theme change', () => {
  it('changing mode does not remount an unrelated sibling component', () => {
    let mountEffectCount = 0;
    function Sentinel() {
      // An empty-deps effect runs exactly once per real mount lifecycle —
      // unlike a counter in the component body (which increments on every
      // re-render), this only increases if Sentinel is actually
      // unmounted-then-remounted, which is what "no full remount" means.
      useEffect(() => {
        mountEffectCount += 1;
      }, []);
      return null;
    }

    render(
      <ThemeProvider theme="default" density="comfortable">
        <Sentinel />
        <ThemeModeMenu />
      </ThemeProvider>,
    );
    expect(mountEffectCount).toBe(1);

    selectThemeOption('dark');

    expect(mountEffectCount).toBe(1);
  });
});
