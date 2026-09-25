/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { StyleFormPage } from './StyleFormPage.js';
import type { Style } from './types.js';

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

// A single flushMicrotasks() tick is not reliable enough for a useQuery-driven
// fetch to settle — poll until the predicate is satisfied instead.
async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error(message);
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

// Every StyleFormPage instance issues /sizes, /factories and /seasons
// regardless of create/edit mode (those queries aren't gated by isEdit), so
// they're stubbed by default here and only the record-specific GET varies
// per test.
function mockStyleGets(overrides: Record<string, () => Promise<unknown>> = {}) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/sizes/options') return { data: { data: [] } };
    if (url === '/factories/options') return { data: { data: [] } };
    if (url === '/seasons/options') return { data: { data: [] } };
    const handler = overrides[url];
    if (handler) return handler();
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderStylePage(path: string, routePath: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={<StyleFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

describe('StyleFormPage — UXAUTH-019 edit-load gating', () => {
  it('EDIT route: does not render a writable form while the record is still loading', async () => {
    mockStyleGets({ '/styles/style-1': () => new Promise(() => {}) });
    renderStylePage('/master-data/styles/style-1/edit', '/master-data/styles/:id/edit');

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.textContent).toContain('Loading style');
    expect(container.querySelectorAll('form').length).toBe(0);
    expect(container.querySelector('input')).toBeNull();
  });

  it('EDIT route: shows an error state and no writable form when the record fetch fails', async () => {
    mockStyleGets({
      '/styles/style-1': () => Promise.reject(new Error('Style not found')),
    });
    renderStylePage('/master-data/styles/style-1/edit', '/master-data/styles/:id/edit');

    await waitFor(
      () => !container.textContent?.includes('Loading style'),
      'timed out waiting for loading to clear',
    );

    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('Unable to load style');
    expect(container.textContent).toContain('Style not found');
  });

  it('EDIT route: hydrates the form from the real server record on success', async () => {
    const style = makeStyle({ styleNumber: 'STY-9001', styleName: 'Server Hydrated Tee' });
    mockStyleGets({
      '/styles/style-1': () => Promise.resolve({ data: { data: style } }),
    });
    renderStylePage('/master-data/styles/style-1/edit', '/master-data/styles/:id/edit');

    await waitFor(
      () => !container.textContent?.includes('Loading style'),
      'timed out waiting for loading to clear',
    );

    expect(container.querySelector('form')).not.toBeNull();
    const styleNumberInput = container.querySelector<HTMLInputElement>('#field-style-number');
    const styleNameInput = container.querySelector<HTMLInputElement>('#field-style-name');
    expect(styleNumberInput?.value).toBe('STY-9001');
    expect(styleNameInput?.value).toBe('Server Hydrated Tee');
  });

  it('CREATE route (no id): renders the normal blank/default form immediately, unaffected by the edit-load gating', async () => {
    mockStyleGets();
    renderStylePage('/master-data/styles/new', '/master-data/styles/new');

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.textContent).not.toContain('Loading style');
    expect(container.textContent).not.toContain('Unable to load style');
    expect(container.querySelector('form')).not.toBeNull();
    const styleNumberInput = container.querySelector<HTMLInputElement>('#field-style-number');
    expect(styleNumberInput?.value).toBe('');
  });
});
