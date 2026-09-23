/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import { setStoredToken } from '../../auth/token-storage.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import * as printModule from '../../lib/pdf/print.js';
import { FactoryListPage } from './FactoryListPage.js';
import type { Factory } from './types.js';

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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

function makeFactory(overrides: Partial<Factory> = {}): Factory {
  return {
    id: 'factory-1',
    code: 'FAC-1',
    name: 'Acme Factory',
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    city: null,
    status: 'ACTIVE',
    ...overrides,
  };
}

async function renderPageWithFactories(factories: Factory[]) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/factories') return { data: { data: factories } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuthProvider>
            <FactoryListPage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('FactoryListPage PDF actions', () => {
  it('shows Download PDF and Print actions above the table', async () => {
    await renderPageWithFactories([]);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    await renderPageWithFactories([makeFactory()]);
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

  it('downloads the factory list PDF under the expected filename', async () => {
    await renderPageWithFactories([makeFactory()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy.mock.calls[0]![1]).toMatch(/^ERVE-Factories-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('invokes printPdfBlob (not the download path) when Print is clicked', async () => {
    await renderPageWithFactories([makeFactory()]);
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

async function renderPageAsRole(role: Role, factories: Factory[]) {
  const user: AuthUser = { id: 'user-1', email: 'user@test.local', mobile: null, name: 'Test User', roles: [role] };
  setStoredToken('valid-token');
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { data: user } };
    if (url === '/factories') return { data: { data: factories } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuthProvider>
            <FactoryListPage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('FactoryListPage Add Factory navigation', () => {
  afterEach(() => {
    sessionStorage.clear();
  });

  it('no longer renders the old partial inline Add Factory form', async () => {
    await renderPageAsRole('ADMIN', []);
    // The old surface was a 4-field inline <form>/<Panel title="Add Factory">
    // on this page itself. It's replaced by a page-level action that
    // navigates to the routed Create page (asserted separately below) — so
    // the text "Add Factory" legitimately remains, just as a link, not a form.
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
  });

  it('shows a page-level Add Factory action linking to /master-data/factories/new for a manage role', async () => {
    await renderPageAsRole('ADMIN', []);
    const addLink = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === 'Add Factory',
    );
    expect(addLink).toBeDefined();
    expect(addLink?.getAttribute('href')).toBe('/master-data/factories/new');
  });

  it('hides the Add Factory action for a non-manage role', async () => {
    await renderPageAsRole('FACTORY_USER', []);
    const addLink = Array.from(container.querySelectorAll('a')).find(
      (a) => a.textContent === 'Add Factory',
    );
    expect(addLink).toBeUndefined();
  });
});
