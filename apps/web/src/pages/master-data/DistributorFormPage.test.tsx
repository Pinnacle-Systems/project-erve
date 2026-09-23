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

// jsdom does not implement CSS.escape, and the ids this app derives from
// labels can contain "*" (e.g. "Code *" -> "field-code-*") — escape manually.
function cssEscapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function findLabelledControl<T extends HTMLElement>(label: string): T {
  const labelEl = Array.from(container.querySelectorAll('label')).find(
    (el) => el.textContent === label,
  );
  if (!labelEl) throw new Error(`Label "${label}" not found`);
  const forId = labelEl.getAttribute('for');
  const control = forId ? container.querySelector<T>(`#${cssEscapeId(forId)}`) : null;
  if (!control) throw new Error(`Control for label "${label}" not found`);
  return control;
}

function findInput(label: string): HTMLInputElement {
  return findLabelledControl<HTMLInputElement>(label);
}

function findSelectTrigger(label: string): HTMLButtonElement {
  return findLabelledControl<HTMLButtonElement>(label);
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
    const codeInput = findInput('Code *');
    const nameInput = findInput('Name *');
    expect(codeInput.value).toBe('DIST-9001');
    expect(nameInput.value).toBe('Server Hydrated Distributor');
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
    const codeInput = findInput('Code *');
    expect(codeInput.value).toBe('');
  });
});

describe('DistributorFormPage — U3B section grouping and required-field presentation', () => {
  it('CREATE: groups fields into Identity / Business, Contact, and Address sections', async () => {
    mockDistributorGets();
    renderDistributorPage('/master-data/distributors/new', '/master-data/distributors/new');
    await act(async () => {
      await flushMicrotasks();
    });

    const sectionTitles = Array.from(container.querySelectorAll('h4')).map((h) => h.textContent);
    expect(sectionTitles).toEqual(['Identity / Business', 'Contact', 'Address']);

    expect(findInput('Code *')).toBeTruthy();
    expect(findInput('Name *')).toBeTruthy();
    expect(findInput('GSTIN *')).toBeTruthy();
    expect(findInput('Contact Name')).toBeTruthy();
    expect(findInput('Contact Email')).toBeTruthy();
    expect(findInput('Contact Phone')).toBeTruthy();
    expect(findInput('Address Line 1')).toBeTruthy();
    expect(findInput('Address Line 2')).toBeTruthy();
    expect(findInput('City')).toBeTruthy();
    expect(findInput('State')).toBeTruthy();
    expect(findInput('Country')).toBeTruthy();
    expect(findInput('Postal Code')).toBeTruthy();
  });

  it('CREATE: leaves Purchase Mode editable and shows the immutability explanation', async () => {
    mockDistributorGets();
    renderDistributorPage('/master-data/distributors/new', '/master-data/distributors/new');
    await act(async () => {
      await flushMicrotasks();
    });

    const purchaseModeTrigger = findSelectTrigger('Purchase Mode *');
    expect(purchaseModeTrigger.disabled).toBe(false);
    expect(container.textContent).toContain(
      'Locked after creation. If this distributor needs both Outright and Sale or Return, create separate distributor records.',
    );
  });

  it('EDIT: keeps Purchase Mode disabled and still shows the immutability explanation', async () => {
    const distributor = makeDistributor({ purchaseMode: 'SALE_RETURN' });
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

    const purchaseModeTrigger = findSelectTrigger('Purchase Mode *');
    expect(purchaseModeTrigger.disabled).toBe(true);
    expect(container.textContent).toContain(
      'Locked after creation. If this distributor needs both Outright and Sale or Return, create separate distributor records.',
    );
  });

  it('EDIT: never includes purchaseMode in the PATCH payload even though the field is rendered', async () => {
    const distributor = makeDistributor({ purchaseMode: 'SALE_RETURN' });
    let patchBody: unknown;
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/distributors/dist-1') return { data: { data: distributor } };
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.spyOn(apiClient, 'patch').mockImplementation(async (_url: string, body: unknown) => {
      patchBody = body;
      return { data: { data: distributor } };
    });
    renderDistributorPage(
      '/master-data/distributors/dist-1/edit',
      '/master-data/distributors/:id/edit',
    );
    await waitFor(
      () => !container.textContent?.includes('Loading distributor'),
      'timed out waiting for loading to clear',
    );

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(patchBody).toBeDefined();
    expect(patchBody).not.toHaveProperty('purchaseMode');
  });

  it('CREATE: rejects an invalid GSTIN with a visible error and does not call the API', async () => {
    const postSpy = vi.spyOn(apiClient, 'post');
    mockDistributorGets();
    renderDistributorPage('/master-data/distributors/new', '/master-data/distributors/new');
    await act(async () => {
      await flushMicrotasks();
    });

    act(() => {
      setInputValue(findInput('Code *'), 'DIST-9');
      setInputValue(findInput('Name *'), 'Test Distributor');
      setInputValue(findInput('GSTIN *'), 'NOT-A-GSTIN');
    });
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(container.textContent).toContain('Enter a valid 15-character GSTIN');
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('CREATE: submits successfully with a valid GSTIN', async () => {
    const created = makeDistributor({ id: 'dist-new', code: 'DIST-9', name: 'Test Distributor' });
    mockDistributorGets();
    vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: created } });
    renderDistributorPage('/master-data/distributors/new', '/master-data/distributors/new');
    await act(async () => {
      await flushMicrotasks();
    });

    act(() => {
      setInputValue(findInput('Code *'), 'DIST-9');
      setInputValue(findInput('Name *'), 'Test Distributor');
      setInputValue(findInput('GSTIN *'), '27aaaaa0000a1z5');
    });
    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(apiClient.post).toHaveBeenCalledWith(
      '/distributors',
      expect.objectContaining({ gstin: '27AAAAA0000A1Z5' }),
    );
  });
});
