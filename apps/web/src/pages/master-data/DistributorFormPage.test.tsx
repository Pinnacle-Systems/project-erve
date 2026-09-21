/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { DistributorFormPage } from './DistributorFormPage.js';
import type { Distributor } from './types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error(message);
}

function makeDistributor(overrides: Partial<Distributor> = {}): Distributor {
  return {
    id: 'dist-1',
    code: 'DIST-1',
    name: 'Acme Distribution',
    gstin: '27AAAAA0000A1Z5',
    purchaseMode: 'OUTRIGHT',
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    addressLine1: null,
    addressLine2: null,
    city: null,
    state: null,
    country: null,
    postalCode: null,
    status: 'ACTIVE',
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

function mockDistributorGets(overrides: Record<string, () => Promise<unknown>> = {}) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    const handler = overrides[url];
    if (handler) return handler();
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderDistributorPage(path: string, routePath: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={<DistributorFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

describe('DistributorFormPage — UXAUTH-019 edit-load gating', () => {
  it('EDIT route: does not render a writable form while the record is still loading', async () => {
    mockDistributorGets({ '/distributors/dist-1': () => new Promise(() => {}) });
    renderDistributorPage(
      '/master-data/distributors/dist-1/edit',
      '/master-data/distributors/:id/edit',
    );

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.textContent).toContain('Loading distributor');
    expect(container.querySelectorAll('form').length).toBe(0);
    expect(container.querySelector('input')).toBeNull();
  });

  it('EDIT route: shows an error state and no writable form when the record fetch fails', async () => {
    mockDistributorGets({
      '/distributors/dist-1': () => Promise.reject(new Error('Distributor not found')),
    });
    renderDistributorPage(
      '/master-data/distributors/dist-1/edit',
      '/master-data/distributors/:id/edit',
    );

    await waitFor(
      () => !container.textContent?.includes('Loading distributor'),
      'timed out waiting for loading to clear',
    );

    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('Unable to load distributor');
    expect(container.textContent).toContain('Distributor not found');
  });

  it('EDIT route: hydrates the form from the real server record on success', async () => {
    const distributor = makeDistributor({ code: 'DIST-9001', name: 'Server Hydrated Distributor' });
    mockDistributorGets({
      '/distributors/dist-1': () => Promise.resolve({ data: { data: distributor } }),
    });
    renderDistributorPage(
      '/master-data/distributors/dist-1/edit',
      '/master-data/distributors/:id/edit',
    );

    await waitFor(
      () => !container.textContent?.includes('Loading distributor'),
      'timed out waiting for loading to clear',
    );

    expect(container.querySelector('form')).not.toBeNull();
    const codeInput = container.querySelector<HTMLInputElement>('#field-code');
    const nameInput = container.querySelector<HTMLInputElement>('#field-name');
    expect(codeInput?.value).toBe('DIST-9001');
    expect(nameInput?.value).toBe('Server Hydrated Distributor');
  });

  it('CREATE route (no id): renders the normal blank/default form immediately, unaffected by the edit-load gating', async () => {
    mockDistributorGets();
    renderDistributorPage('/master-data/distributors/new', '/master-data/distributors/new');

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.textContent).not.toContain('Loading distributor');
    expect(container.textContent).not.toContain('Unable to load distributor');
    expect(container.querySelector('form')).not.toBeNull();
    const codeInput = container.querySelector<HTMLInputElement>('#field-code');
    expect(codeInput?.value).toBe('');
  });
});
