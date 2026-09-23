/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { SizeFormPage } from './SizeFormPage.js';
import type { Size } from './types.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

function fail(config: InternalAxiosRequestConfig, status: number, message: string): never {
  const error = new Error(message) as Error & { response: unknown; isAxiosError: boolean };
  error.isAxiosError = true;
  error.response = { status, data: { error: { message } }, statusText: '', headers: {}, config };
  throw error;
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let navigateSpy: ReturnType<typeof vi.fn>;

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateSpy,
  };
});

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
  originalAdapter = apiClient.defaults.adapter;
  navigateSpy = vi.fn();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function flush(): Promise<void> {
  await act(async () => {
    await flushMicrotasks();
  });
}

async function waitForLoaded(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (!container.textContent?.includes('Loading size')) return;
    await flush();
  }
  throw new Error('Timed out waiting for the size to finish loading');
}

function makeSize(overrides: Partial<Size> = {}): Size {
  return {
    id: 'size-1',
    code: 'AGE_3',
    label: '3 years',
    sizeType: 'AGE',
    sortOrder: 3,
    status: 'ACTIVE',
    usage: { styleMappings: 0, purchaseOrderLines: 0, jobOrderLines: 0 },
    ...overrides,
  };
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// jsdom does not implement CSS.escape, and the ids this app derives from
// labels can contain "*" (e.g. "Code *" -> "field-code-*"), which is not a
// valid bare CSS identifier character — escape it manually instead.
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

interface AdapterOverrides {
  get?: AxiosAdapter;
  patch?: AxiosAdapter;
}

function adapterFor(size: Size, overrides: AdapterOverrides = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    if (config.url === `/sizes/${size.id}` && config.method === 'get') {
      return overrides.get ? overrides.get(config) : ok(config, { success: true, data: size });
    }
    if (config.url === `/sizes/${size.id}` && config.method === 'patch') {
      return overrides.patch
        ? overrides.patch(config)
        : ok(config, { success: true, data: { ...size, ...JSON.parse(config.data as string) } });
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  }) as AxiosAdapter;
}

async function renderPage(size: Size, overrides: AdapterOverrides = {}): Promise<void> {
  apiClient.defaults.adapter = adapterFor(size, overrides);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/master-data/sizes/${size.id}/edit`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/master-data/sizes/:id/edit" element={<SizeFormPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flush();
  await waitForLoaded();
}

describe('SizeFormPage', () => {
  it('loads the existing Size into the Edit form', async () => {
    await renderPage(makeSize({ code: 'AGE_3', label: '3 years', sortOrder: 3 }));

    expect(findInput('Code *').value).toBe('AGE_3');
    expect(findInput('Label *').value).toBe('3 years');
    expect(findInput('Sort Order *').value).toBe('3');
  });

  it('submits an editable (unused) Size successfully and navigates to its detail page', async () => {
    await renderPage(makeSize());

    setInputValue(findInput('Label *'), '3 Years Updated');
    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save Changes',
    );
    await act(async () => submit!.click());
    await flush();

    expect(navigateSpy).toHaveBeenCalledWith('/master-data/sizes/size-1');
  });

  it('displays a server submit failure without navigating away', async () => {
    await renderPage(makeSize(), {
      patch: async (config) => fail(config, 409, 'A size with this code already exists'),
    });

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save Changes',
    );
    await act(async () => submit!.click());
    await flush();

    expect(container.textContent).toContain('A size with this code already exists');
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('unused Size: Code and Type remain enabled, and no lock notice is shown', async () => {
    await renderPage(
      makeSize({ usage: { styleMappings: 0, purchaseOrderLines: 0, jobOrderLines: 0 } }),
    );

    expect(findInput('Code *').disabled).toBe(false);
    expect(findSelectTrigger('Type *').disabled).toBe(false);
    expect(container.textContent).not.toContain('Code and type are locked');
  });

  it('used Size: Code and Type are disabled, Label and Sort Order remain editable, and the lock notice is accurate', async () => {
    await renderPage(
      makeSize({ usage: { styleMappings: 2, purchaseOrderLines: 1, jobOrderLines: 0 } }),
    );

    expect(findInput('Code *').disabled).toBe(true);
    expect(findSelectTrigger('Type *').disabled).toBe(true);
    expect(findInput('Label *').disabled).toBe(false);
    expect(findInput('Sort Order *').disabled).toBe(false);
    expect(container.textContent).toContain(
      'Code and type are locked because this size has transactional history',
    );
  });

  it('used Size (via job-order lines only) also locks Code and Type', async () => {
    await renderPage(
      makeSize({ usage: { styleMappings: 0, purchaseOrderLines: 0, jobOrderLines: 4 } }),
    );

    expect(findInput('Code *').disabled).toBe(true);
  });

  it('the static Type Select hydrates with the loaded Size value', async () => {
    await renderPage(makeSize({ sizeType: 'NUMERIC' }));

    expect(findSelectTrigger('Type *').textContent).toContain('NUMERIC');
  });

  it('Cancel navigates back without saving', async () => {
    await renderPage(makeSize());

    const cancel = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Cancel',
    );
    await act(async () => cancel!.click());

    expect(navigateSpy).toHaveBeenCalledWith(-1);
  });

  it('a failed fetch shows an error state instead of being stuck on the hydration-gated loading state forever', async () => {
    const size = makeSize();
    apiClient.defaults.adapter = adapterFor(size, {
      get: async (config) => fail(config, 500, 'Size not found'),
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[`/master-data/sizes/${size.id}/edit`]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/master-data/sizes/:id/edit" element={<SizeFormPage />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    for (let i = 0; i < 20 && container.textContent?.includes('Loading size'); i++) {
      await flush();
    }

    expect(container.textContent).toContain('Unable to load size');
    expect(container.textContent).toContain('Size not found');
    expect(container.querySelector('form')).toBeNull();
  });
});
