/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import * as AuthContext from '../../auth/AuthContext.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import { StyleDetailPage } from './StyleDetailPage.js';
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
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// A single flushMicrotasks() tick is not reliably enough for a useQuery-driven initial load to
// settle — poll until the LoadingState marker text is gone instead (see erve-web-radix-dialog-test-pattern).
async function waitForLoaded(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (!container.textContent?.includes('Loading style')) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for the style to finish loading');
}

// Clicking a PDF action triggers a dynamic import() of the PDF generation code (kept out of the
// eager bundle), which takes an unpredictable number of extra ticks beyond a single
// flushMicrotasks() to settle — poll instead.
async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

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

async function renderPage(style: Style) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/styles/${style.id}`) return { data: { data: style } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/master-data/styles/${style.id}`]}>
          <AuthProvider>
            <Routes>
              <Route path="/master-data/styles/:id" element={<StyleDetailPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
  await waitForLoaded();
}

describe('StyleDetailPage PDF actions', () => {
  it('shows Download PDF and Print actions next to Edit once the style has loaded', async () => {
    await renderPage(makeStyle());
    const buttons = Array.from(container.querySelectorAll('button, a')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    await renderPage(makeStyle());
    vi.spyOn(generateModule, 'renderPdfBlob').mockRejectedValue(new Error('boom'));

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'PDF generation failed. Please try again.',
    );
    expect(
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Download PDF')!
        .disabled,
    ).toBe(false);
  });

  it('generates the PDF from the loaded style and downloads it under a sanitized filename', async () => {
    await renderPage(makeStyle({ styleNumber: 'STY/0001' }));
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy).toHaveBeenCalledWith(expect.any(Blob), 'ERVE-Style-STY-0001.pdf');
  });
});

// UXAUTH-009: Edit must reflect the actual STYLE_MANAGE_ROLES mutation
// capability, not just STYLE_VIEW_ROLES read access. SENIOR_MANAGEMENT is a
// read-only Style viewer and must not see it.
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

async function renderPageAsRole(style: Style, role: Role) {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/styles/${style.id}`) return { data: { data: style } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/master-data/styles/${style.id}`]}>
          <Routes>
            <Route path="/master-data/styles/:id" element={<StyleDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
  await waitForLoaded();
}

function editLink(): HTMLAnchorElement | undefined {
  return Array.from(container.querySelectorAll('a')).find((a) => a.textContent === 'Edit') as
    | HTMLAnchorElement
    | undefined;
}

describe('StyleDetailPage Edit visibility (UXAUTH-009)', () => {
  it('shows Edit for ADMIN and MERCHANDISER (STYLE_MANAGE_ROLES)', async () => {
    for (const role of ['ADMIN', 'MERCHANDISER'] as const) {
      await renderPageAsRole(makeStyle(), role);
      expect(editLink(), `expected Edit for ${role}`).not.toBeUndefined();
    }
  });

  it('hides Edit for SENIOR_MANAGEMENT (read-only Style viewer) while retaining read content', async () => {
    await renderPageAsRole(makeStyle(), 'SENIOR_MANAGEMENT');
    expect(editLink()).toBeUndefined();
    expect(content()).toContain('STY-0001');
    expect(content()).toContain('Basic Tee');
  });
});

function content(): string {
  return container.textContent ?? '';
}
