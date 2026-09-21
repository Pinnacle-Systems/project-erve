/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import * as AuthContext from '../../auth/AuthContext.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import * as printModule from '../../lib/pdf/print.js';
import { StyleListPage } from './StyleListPage.js';
import type { Style } from './types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// Clicking a PDF action now triggers a dynamic import() of the PDF generation code (kept out of
// the eager bundle), which takes an unpredictable number of extra ticks beyond a single
// flushMicrotasks() to settle — poll instead (same rationale as waitForStylesLoaded below).
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

// React's controlled inputs track the native value setter, so a plain
// `input.value = x` followed by dispatching "input" is not observed —
// the native property setter must be invoked directly (see UserPages.test.tsx).
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function styleSearchCalls(): Array<string | undefined> {
  return vi
    .mocked(apiClient.get)
    .mock.calls.filter((call) => call[0] === '/styles')
    .map((call) => (call[1] as { params?: { search?: string } } | undefined)?.params?.search);
}

async function renderPage() {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/styles') return { data: { data: [] } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuthProvider>
            <StyleListPage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('StyleListPage search debounce', () => {
  it('debounces the style search so rapid typing issues only the final request', async () => {
    await renderPage();

    const requestsBeforeTyping = styleSearchCalls().length;
    const input = container.querySelector<HTMLInputElement>('input[placeholder="Search styles"]')!;

    vi.useFakeTimers();
    for (const value of ['S', 'ST', 'STY', 'STY-001']) {
      act(() => setInputValue(input, value));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(styleSearchCalls().length).toBe(requestsBeforeTyping);
    expect(input.value).toBe('STY-001');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    vi.useRealTimers();

    const searches = styleSearchCalls();
    expect(searches.length).toBe(requestsBeforeTyping + 1);
    expect(searches.at(-1)).toBe('STY-001');
  });
});

function makeStyle(overrides: Partial<Style> = {}): Style {
  return {
    id: 'style-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    description: null,
    categoryDescription: null,
    itemNameGroup: null,
    ipName: null,
    licensor: null,
    colour: null,
    lmixNumber: null,
    hsnCode: null,
    hsnDescription: null,
    finalMrp: 499,
    royaltyPercentage: null,
    status: 'ACTIVE',
    season: {
      id: 's1',
      code: 'SS27',
      name: 'Spring Summer 27',
      financialYear: { id: 'fy1', code: 'FY27' },
      displayName: 'SS27',
      status: 'ACTIVE',
    },
    sizes: [],
    factories: [],
    images: [],
    ...overrides,
  };
}

// A single flushMicrotasks() tick is not reliably enough for a useQuery-driven initial load to
// settle — poll until the LoadingState marker text is gone instead (see erve-web-radix-dialog-test-pattern).
async function waitForStylesLoaded(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (!container.textContent?.includes('Loading styles')) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for styles to finish loading');
}

async function renderPageWithStyles(styles: Style[]) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/styles') return { data: { data: styles } };
    if (url.includes('/images/')) return { data: new Blob(['bytes']) };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuthProvider>
            <StyleListPage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
  await waitForStylesLoaded();
}

describe('StyleListPage PDF actions and thumbnails', () => {
  it('renders a placeholder for a style with no image', async () => {
    await renderPageWithStyles([makeStyle({ id: 'a', images: [] })]);
    // No <img> yet (lazy-loaded), but a placeholder icon is present.
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('shows Download PDF and Print actions near the filter bar', async () => {
    await renderPageWithStyles([]);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows a generating state while the PDF is being built, then clears it', async () => {
    await renderPageWithStyles([makeStyle()]);
    let resolveGenerate!: (blob: Blob) => void;
    vi.spyOn(generateModule, 'renderPdfBlob').mockReturnValue(
      new Promise((resolve) => {
        resolveGenerate = resolve;
      }),
    );
    vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() =>
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Generating…'),
    );

    const generatingBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Generating…',
    );
    expect(generatingBtn).toBeDefined();
    expect(generatingBtn!.disabled).toBe(true);

    act(() => resolveGenerate(new Blob(['pdf'])));
    await waitFor(() =>
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === 'Download PDF'),
    );

    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    await renderPageWithStyles([makeStyle()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockRejectedValue(new Error('boom'));

    const printBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print',
    )!;
    act(() => printBtn.click());
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'PDF generation failed. Please try again.',
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.find((b) => b.textContent === 'Print')!.disabled).toBe(false);
    expect(buttons.find((b) => b.textContent === 'Download PDF')!.disabled).toBe(false);
  });

  it('invokes printPdfBlob (not the download path) when Print is clicked', async () => {
    await renderPageWithStyles([makeStyle()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const printSpy = vi.spyOn(printModule, 'printPdfBlob').mockImplementation(() => {});
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const printBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print',
    )!;
    act(() => printBtn.click());
    await waitFor(() => printSpy.mock.calls.length > 0);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).not.toHaveBeenCalled();
  });
});

// UXAUTH-009: Create Style must reflect the actual STYLE_MANAGE_ROLES
// mutation capability, not just STYLE_VIEW_ROLES read access.
// SENIOR_MANAGEMENT is a read-only Style viewer and must not see it.
function mockAuth(role: Role) {
  const user: AuthUser = { id: 'user-1', email: 'user@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

async function renderPageAsRole(role: Role) {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/styles') return { data: { data: [] } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <StyleListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('StyleListPage Create Style visibility (UXAUTH-009)', () => {
  it('shows Create Style for ADMIN and MERCHANDISER (STYLE_MANAGE_ROLES)', async () => {
    for (const role of ['ADMIN', 'MERCHANDISER'] as const) {
      await renderPageAsRole(role);
      const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'Create Style');
      expect(link, `expected Create Style for ${role}`).not.toBeUndefined();
    }
  });

  it('hides Create Style for SENIOR_MANAGEMENT (read-only Style viewer)', async () => {
    await renderPageAsRole('SENIOR_MANAGEMENT');
    const link = Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'Create Style');
    expect(link).toBeUndefined();
  });
});
