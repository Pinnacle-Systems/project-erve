/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { FactoryFormPage } from './FactoryFormPage.js';
import type { Factory } from './types.js';

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
    if (!container.textContent?.includes('Loading factory')) return;
    await flush();
  }
  throw new Error('Timed out waiting for the factory to finish loading');
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

// jsdom does not implement CSS.escape, and the ids this app derives from
// labels can contain "*" (e.g. "Code *" -> "field-code-*") — escape manually.
function cssEscapeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function findInput(label: string): HTMLInputElement {
  const clean = label.replace(/\s*\*$/, '');
  const labelEl = Array.from(container.querySelectorAll('label')).find(
    (el) => el.textContent?.replace(/\s*\*$/, '') === clean,
  );
  if (!labelEl) throw new Error(`Label "${label}" not found`);
  const forId = labelEl.getAttribute('for');
  const input = forId ? container.querySelector<HTMLInputElement>(`#${cssEscapeId(forId)}`) : null;
  if (!input) throw new Error(`Input for label "${label}" not found`);
  return input;
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
    addressLine1: null,
    addressLine2: null,
    state: null,
    country: null,
    postalCode: null,
    ...overrides,
  };
}

interface AdapterOverrides {
  get?: AxiosAdapter;
  post?: AxiosAdapter;
  patch?: AxiosAdapter;
}

function adapterFor(factory: Factory, overrides: AdapterOverrides = {}): AxiosAdapter {
  return (async (config: InternalAxiosRequestConfig) => {
    if (config.url === `/factories/${factory.id}` && config.method === 'get') {
      return overrides.get ? overrides.get(config) : ok(config, { success: true, data: factory });
    }
    if (config.url === '/factories' && config.method === 'post') {
      return overrides.post
        ? overrides.post(config)
        : ok(config, { success: true, data: { ...factory, ...JSON.parse(config.data as string) } });
    }
    if (config.url === `/factories/${factory.id}` && config.method === 'patch') {
      return overrides.patch
        ? overrides.patch(config)
        : ok(config, { success: true, data: { ...factory, ...JSON.parse(config.data as string) } });
    }
    throw new Error(`Unexpected request: ${config.method} ${config.url}`);
  }) as AxiosAdapter;
}

async function renderCreate(overrides: AdapterOverrides = {}): Promise<void> {
  apiClient.defaults.adapter = adapterFor(makeFactory(), overrides);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/master-data/factories/new']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/master-data/factories/new" element={<FactoryFormPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flush();
}

async function renderEdit(factory: Factory, overrides: AdapterOverrides = {}): Promise<void> {
  apiClient.defaults.adapter = adapterFor(factory, overrides);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[`/master-data/factories/${factory.id}/edit`]}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/master-data/factories/:id/edit" element={<FactoryFormPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await flush();
  await waitForLoaded();
}

describe('FactoryFormPage — Create', () => {
  it('renders all 10 supported fields, grouped into Identity / Contact / Address', async () => {
    await renderCreate();

    expect(container.textContent).toContain('Identity');
    expect(container.textContent).toContain('Contact');
    expect(container.textContent).toContain('Address');

    for (const label of [
      'Name *',
      'Contact Name',
      'Contact Email',
      'Contact Phone',
      'Address Line 1',
      'Address Line 2',
      'City',
      'State',
      'Country',
      'Postal Code',
    ]) {
      expect(findInput(label)).toBeDefined();
    }
  });

  it('Identity section contains Name and omits generated Code', async () => {
    await renderCreate();
    const identityHeading = Array.from(container.querySelectorAll('h4')).find(
      (el) => el.textContent === 'Identity',
    );
    const section = identityHeading?.closest('section');
    expect(section?.textContent).not.toContain('Code');
    expect(section?.textContent).toContain('Name');
    expect(section?.textContent).not.toContain('Contact Name');
  });

  it('Contact section contains the contact fields', async () => {
    await renderCreate();
    const heading = Array.from(container.querySelectorAll('h4')).find(
      (el) => el.textContent === 'Contact',
    );
    const section = heading?.closest('section');
    expect(section?.textContent).toContain('Contact Name');
    expect(section?.textContent).toContain('Contact Email');
    expect(section?.textContent).toContain('Contact Phone');
    expect(section?.textContent).not.toContain('Address Line 1');
  });

  it('Address section contains the address fields', async () => {
    await renderCreate();
    const heading = Array.from(container.querySelectorAll('h4')).find(
      (el) => el.textContent === 'Address',
    );
    const section = heading?.closest('section');
    expect(section?.textContent).toContain('Address Line 1');
    expect(section?.textContent).toContain('Address Line 2');
    expect(section?.textContent).toContain('City');
    expect(section?.textContent).toContain('State');
    expect(section?.textContent).toContain('Country');
    expect(section?.textContent).toContain('Postal Code');
  });

  it('requires Name before submitting', async () => {
    const postSpy = vi.fn();
    await renderCreate({ post: async (config) => { postSpy(); return ok(config, { success: true, data: makeFactory() }); } });

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Create Factory',
    );
    await act(async () => submit!.click());
    await flush();

    expect(postSpy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Name is required');

    expect(findInput('Name *').getAttribute('aria-invalid')).toBe('true');
  });

  it('submits a POST with all entered fields and navigates to the created Factory on success', async () => {
    let postBody: Record<string, unknown> | undefined;
    await renderCreate({
      post: async (config) => {
        postBody = JSON.parse(config.data as string) as Record<string, unknown>;
        return ok(config, {
          success: true,
          data: makeFactory({ id: 'factory-9', code: 'FAC-9', name: 'New Factory' }),
        });
      },
    });

    setInputValue(findInput('Name *'), 'New Factory');
    setInputValue(findInput('Contact Name'), 'Jane Doe');
    setInputValue(findInput('Contact Email'), 'jane@example.com');
    setInputValue(findInput('City'), 'Mumbai');

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Create Factory',
    );
    await act(async () => submit!.click());
    await flush();

    expect(postBody).not.toHaveProperty('code');
    expect(postBody).toMatchObject({
      name: 'New Factory',
      contactName: 'Jane Doe',
      contactEmail: 'jane@example.com',
      city: 'Mumbai',
    });
    expect(navigateSpy).toHaveBeenCalledWith('/master-data/factories/factory-9');
  });

  it('shows a visible server error on create failure and preserves the entered values', async () => {
    await renderCreate({
      post: async (config) => fail(config, 409, 'A factory with this code already exists'),
    });

    setInputValue(findInput('Name *'), 'New Factory');

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Create Factory',
    );
    await act(async () => submit!.click());
    await flush();

    expect(container.textContent).toContain('A factory with this code already exists');
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(findInput('Name *').value).toBe('New Factory');
  });
});

describe('FactoryFormPage — Edit', () => {
  it('detects Edit mode from the route and loads the Factory values', async () => {
    await renderEdit(
      makeFactory({ code: 'FAC-2', name: 'Second Factory', city: 'Delhi', contactName: 'Sam' }),
    );

    expect(container.textContent).toContain('Edit Factory');
    expect(findInput('Code').value).toBe('FAC-2');
    expect(findInput('Code').readOnly).toBe(true);
    expect(findInput('Name *').value).toBe('Second Factory');
    expect(findInput('City').value).toBe('Delhi');
    expect(findInput('Contact Name').value).toBe('Sam');
  });

  it('submits a PATCH and navigates to the Factory detail page on success', async () => {
    let patchBody: Record<string, unknown> | undefined;
    const factory = makeFactory();
    await renderEdit(factory, {
      patch: async (config) => {
        patchBody = JSON.parse(config.data as string) as Record<string, unknown>;
        return ok(config, { success: true, data: factory });
      },
    });

    setInputValue(findInput('City'), 'Chennai');
    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save Changes',
    );
    await act(async () => submit!.click());
    await flush();

    expect(patchBody).not.toHaveProperty('code');
    expect(patchBody).toMatchObject({ city: 'Chennai' });
    expect(navigateSpy).toHaveBeenCalledWith(`/master-data/factories/${factory.id}`);
  });

  it('shows a visible server error on edit failure without navigating away', async () => {
    const factory = makeFactory();
    await renderEdit(factory, {
      patch: async (config) => fail(config, 500, 'Unable to update factory'),
    });

    const submit = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Save Changes',
    );
    await act(async () => submit!.click());
    await flush();

    expect(container.textContent).toContain('Unable to update factory');
    expect(navigateSpy).not.toHaveBeenCalled();
  });
});

describe('FactoryFormPage — optional GSTIN', () => {
  const GSTIN = '33AAAAA0000A1Z5';
  async function renderWithPolicy(
    factory: Factory,
    mode: 'create' | 'edit',
    policy: { enabled: boolean; mode?: 'DEMO' | 'LIVE' },
    onRequest: (config: InternalAxiosRequestConfig) => void = () => undefined,
    overrides: AdapterOverrides = {},
  ) {
    const base = adapterFor(factory, overrides);
    apiClient.defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      onRequest(config);
      if (config.url === '/gst-compliance/verification/policy')
        return ok(config, { success: true, data: policy });
      if (config.url === '/gst-compliance/verification')
        return ok(config, {
          success: true,
          data: {
            enabled: true,
            mode: policy.mode ?? 'LIVE',
            level: 'BASIC',
            canVerify: true,
            canRefresh: false,
            cacheState: 'NONE',
            evidence: null,
            latestFailure: null,
          },
        });
      return base(config);
    }) as AxiosAdapter;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const path =
      mode === 'create' ? '/master-data/factories/new' : `/master-data/factories/${factory.id}/edit`;
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/master-data/factories/new" element={<FactoryFormPage />} />
              <Route path="/master-data/factories/:id/edit" element={<FactoryFormPage />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await flush();
    if (mode === 'edit') await waitForLoaded();
    await flush();
  }
  const submitButton = (label: string) =>
    Array.from(container.querySelectorAll('button')).find((b) => b.textContent === label)!;

  it('is optional: a Factory with no GSTIN saves with gstin null, even when verification is on', async () => {
    let body: Record<string, unknown> | undefined;
    await renderWithPolicy(makeFactory(), 'create', { enabled: true, mode: 'LIVE' }, () => undefined, {
      post: async (config) => {
        body = JSON.parse(config.data as string);
        return ok(config, { success: true, data: makeFactory({ id: 'factory-9' }) });
      },
    });
    expect(findInput('GSTIN').required).toBe(false);
    setInputValue(findInput('Name *'), 'No GST Factory');
    await act(async () => submitButton('Create Factory').click());
    await flush();
    expect(body).toMatchObject({ name: 'No GST Factory', gstin: null });
    expect(navigateSpy).toHaveBeenCalledWith('/master-data/factories/factory-9');
  });

  it('normalizes and sends an entered GSTIN; an unverified GSTIN still saves', async () => {
    let body: Record<string, unknown> | undefined;
    const requests: string[] = [];
    await renderWithPolicy(
      makeFactory(),
      'create',
      { enabled: true, mode: 'LIVE' },
      (config) => requests.push(`${config.method} ${config.url}`),
      {
        post: async (config) => {
          body = JSON.parse(config.data as string);
          return ok(config, { success: true, data: makeFactory({ id: 'factory-9' }) });
        },
      },
    );
    setInputValue(findInput('Name *'), 'GST Factory');
    setInputValue(findInput('GSTIN'), ` ${GSTIN.toLowerCase()} `);
    await flush();
    await act(async () => submitButton('Create Factory').click());
    await flush();
    expect(body).toMatchObject({ gstin: GSTIN });
    // The cache was read; no verification (POST) request was ever made.
    expect(requests.filter((r) => r.startsWith('post /gst-compliance'))).toEqual([]);
  });

  it('rejects a malformed GSTIN before calling the API, with verification off', async () => {
    const post = vi.fn();
    await renderWithPolicy(makeFactory(), 'create', { enabled: false }, () => undefined, {
      post: async (config) => {
        post();
        return ok(config, { success: true, data: makeFactory() });
      },
    });
    setInputValue(findInput('Name *'), 'Bad GST Factory');
    setInputValue(findInput('GSTIN'), 'ABC123');
    await act(async () => submitButton('Create Factory').click());
    await flush();
    expect(post).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Enter a valid 15-character GSTIN');
  });

  it('makes no verification request while verification is off', async () => {
    const requests: string[] = [];
    await renderWithPolicy(makeFactory(), 'create', { enabled: false }, (config) =>
      requests.push(`${config.method} ${config.url}`),
    );
    setInputValue(findInput('GSTIN'), GSTIN);
    await flush();
    expect(
      requests.filter((r) => r.includes('/gst-compliance/verification') && !r.endsWith('/policy')),
    ).toEqual([]);
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => /Verify/.test(b.textContent ?? '')),
    ).toBe(false);
  });

  it('edits an existing Factory: hydrates a saved GSTIN, reads it as the saved record, and can clear it', async () => {
    let body: Record<string, unknown> | undefined;
    const reads: Array<Record<string, unknown> | undefined> = [];
    await renderWithPolicy(
      makeFactory({ gstin: GSTIN }),
      'edit',
      { enabled: true, mode: 'LIVE' },
      (config) => {
        if (config.url === '/gst-compliance/verification') reads.push(config.params);
      },
      {
        patch: async (config) => {
          body = JSON.parse(config.data as string);
          return ok(config, { success: true, data: makeFactory() });
        },
      },
    );
    expect(findInput('GSTIN').value).toBe(GSTIN);
    expect(reads[0]).toEqual({ gstin: GSTIN, sourceType: 'FACTORY', sourceId: 'factory-1' });
    setInputValue(findInput('GSTIN'), '');
    await act(async () => submitButton('Save Changes').click());
    await flush();
    expect(body).toMatchObject({ gstin: null });
  });

  it('leaves a legacy Factory (NULL GSTIN) editable and unchanged', async () => {
    let body: Record<string, unknown> | undefined;
    await renderWithPolicy(makeFactory({ gstin: null }), 'edit', { enabled: false }, () => undefined, {
      patch: async (config) => {
        body = JSON.parse(config.data as string);
        return ok(config, { success: true, data: makeFactory() });
      },
    });
    expect(findInput('GSTIN').value).toBe('');
    await act(async () => submitButton('Save Changes').click());
    await flush();
    expect(body).toMatchObject({ gstin: null });
  });
});
