/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@erve/theme';
import type { AuthUser, Role, UserOption } from '@erve/types';
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext.js';
import { setStoredToken } from '../../auth/token-storage.js';
import { apiClient } from '../../lib/api-client.js';
import { DistributorDetailPage } from './DistributorDetailPage.js';
import { FactoryDetailPage } from './FactoryDetailPage.js';

// UL: Distributor and Factory user assignment pick from bounded,
// context-specific candidate endpoints — never the whole /users collection.

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

const distributor = {
  id: 'dist-1',
  code: 'DIST-1',
  name: 'Acme Distribution',
  gstin: '27AAAAA0000A1Z5',
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
};

const factory = {
  id: 'factory-1',
  code: 'FAC-1',
  name: 'Acme Factory',
  contactName: null,
  contactEmail: null,
  contactPhone: null,
  city: null,
  status: 'ACTIVE',
  usage: { styleMappings: 1, jobOrders: 4, mappedUsers: 0 },
};

const dana: UserOption = { id: 'u-1', name: 'Dana Candidate', email: 'dana@test.local' };
const eli: UserOption = { id: 'u-2', name: 'Eli Candidate', email: 'eli@test.local' };

interface RequestRecord {
  method: string;
  url: string;
  params?: unknown;
  body?: unknown;
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let requests: RequestRecord[];

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
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  requests = [];
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

type Handler = (config: InternalAxiosRequestConfig) => AxiosResponse | undefined;

async function renderPage(path: string, roles: Role[], handler: Handler) {
  const user: AuthUser = {
    id: 'caller',
    email: 'caller@test.local',
    mobile: null,
    name: 'Caller',
    roles,
  };
  setStoredToken('valid-token');
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    const method = (config.method ?? 'get').toLowerCase();
    requests.push({
      method,
      url: config.url ?? '',
      params: config.params,
      body: typeof config.data === 'string' ? JSON.parse(config.data) : config.data,
    });
    if (config.url === '/auth/me') return ok(config, { success: true, data: user });
    const response = handler(config);
    if (response) return response;
    throw new Error(`Unexpected request: ${method} ${config.url}`);
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <ThemeProvider theme="default">
          <QueryClientProvider client={client}>
            <AuthProvider>
              <Routes>
                <Route path="/master-data/distributors/:id" element={<DistributorDetailPage />} />
                <Route path="/master-data/factories/:id" element={<FactoryDetailPage />} />
              </Routes>
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await flush(100);
}

async function flush(ms = 20) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await flush();
  }
}

function lookupInput(): HTMLInputElement {
  return document.getElementById('lookup-assign-user') as HTMLInputElement;
}

function optionTexts(): string[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).map(
    (option) => option.textContent ?? '',
  );
}

async function openLookup() {
  await act(async () => {
    lookupInput().focus();
    lookupInput().click();
  });
}

async function choose(name: string) {
  await waitUntil(() => optionTexts().some((text) => text.includes(name)));
  const option = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (candidate) => candidate.textContent?.includes(name),
  )!;
  await act(async () => option.click());
}

async function clickAssign() {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === 'Assign',
  )!;
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

const candidateRequests = (url: string) =>
  requests.filter((request) => request.method === 'get' && request.url === url);
const fullUsersRequests = () => requests.filter((request) => request.url === '/users');

describe('Distributor detail — user assignment lookup (UL)', () => {
  const optionsUrl = '/distributors/dist-1/user-options';

  function handler(state: {
    candidates: UserOption[];
    mapped: unknown[];
    status?: string;
  }): Handler {
    return (config) => {
      if (config.url === '/distributors/dist-1')
        return ok(config, {
          success: true,
          data: { ...distributor, status: state.status ?? 'ACTIVE' },
        });
      if (config.url === '/distributors/dist-1/users')
        return ok(config, { success: true, data: state.mapped });
      if (config.url === optionsUrl) return ok(config, { success: true, data: state.candidates });
      if (config.url === '/users/u-1/distributors' && config.method === 'post') {
        state.candidates = state.candidates.filter((candidate) => candidate.id !== 'u-1');
        state.mapped = [{ ...dana, status: 'ACTIVE', roles: ['DISTRIBUTOR'] }];
        return ok(config, { success: true, data: {} });
      }
      return undefined;
    };
  }

  it('never requests /users, and asks for candidates only once the picker opens', async () => {
    await renderPage(
      '/master-data/distributors/dist-1',
      ['ADMIN'],
      handler({ candidates: [dana, eli], mapped: [] }),
    );

    expect(container.textContent).toContain('Mapped Users');
    expect(candidateRequests(optionsUrl)).toHaveLength(0);

    await openLookup();
    await waitUntil(() => optionTexts().length === 2);

    expect(candidateRequests(optionsUrl).map((request) => request.params)).toEqual([
      { search: '', limit: 20 },
    ]);
    expect(optionTexts()).toEqual(['Dana Candidatedana@test.local', 'Eli Candidateeli@test.local']);
    expect(fullUsersRequests()).toHaveLength(0);
  });

  it('assigns with the unchanged POST body, resets the picker and refreshes candidates and mappings', async () => {
    const state = { candidates: [dana, eli], mapped: [] as unknown[] };
    await renderPage('/master-data/distributors/dist-1', ['ADMIN'], handler(state));

    await openLookup();
    await choose('Dana Candidate');
    expect(lookupInput().value).toBe('Dana Candidate (dana@test.local)');
    await clickAssign();

    expect(requests.filter((request) => request.method === 'post')).toEqual([
      expect.objectContaining({
        url: '/users/u-1/distributors',
        body: { distributorId: 'dist-1' },
      }),
    ]);
    await waitUntil(() => lookupInput().value === '');
    await waitUntil(() => container.textContent?.includes('dana@test.local') ?? false);

    // The cached initial candidates were invalidated: reopening refetches and
    // no longer offers the just-assigned user.
    const before = candidateRequests(optionsUrl).length;
    await openLookup();
    await waitUntil(() => candidateRequests(optionsUrl).length > before);
    await waitUntil(() => optionTexts().length === 1);
    expect(optionTexts()).toEqual(['Eli Candidateeli@test.local']);
    expect(fullUsersRequests()).toHaveLength(0);
  });

  it('disables the picker for an inactive distributor', async () => {
    await renderPage(
      '/master-data/distributors/dist-1',
      ['ADMIN'],
      handler({ candidates: [dana], mapped: [], status: 'INACTIVE' }),
    );

    expect(lookupInput().disabled).toBe(true);
    expect(container.textContent).toContain('Users cannot be assigned to an inactive distributor.');
    await openLookup();
    await flush(50);
    expect(candidateRequests(optionsUrl)).toHaveLength(0);
  });

  it('shows no assignment panel (and no candidate lookup) to non-ADMIN roles', async () => {
    for (const role of ['MERCHANDISER', 'SENIOR_MANAGEMENT'] as const) {
      await renderPage(
        '/master-data/distributors/dist-1',
        [role],
        handler({ candidates: [dana], mapped: [] }),
      );
      expect(container.textContent).toContain('Acme Distribution');
      expect(container.textContent).not.toContain('Mapped Users');
      expect(lookupInput()).toBeNull();
    }
    expect(candidateRequests(optionsUrl)).toHaveLength(0);
    expect(fullUsersRequests()).toHaveLength(0);
  });
});

describe('Factory detail — user assignment lookup (UL)', () => {
  const optionsUrl = '/factories/factory-1/user-options';

  function handler(state: {
    candidates: UserOption[];
    mapped: unknown[];
    status?: string;
  }): Handler {
    return (config) => {
      if (config.url === '/factories/factory-1')
        return ok(config, {
          success: true,
          data: { ...factory, status: state.status ?? 'ACTIVE' },
        });
      if (config.url === '/factories/factory-1/users')
        return ok(config, { success: true, data: state.mapped });
      if (config.url === optionsUrl) return ok(config, { success: true, data: state.candidates });
      if (config.url === '/users/u-2/factories' && config.method === 'post') {
        state.candidates = state.candidates.filter((candidate) => candidate.id !== 'u-2');
        state.mapped = [{ ...eli, status: 'ACTIVE', roles: ['FACTORY_USER'] }];
        return ok(config, { success: true, data: {} });
      }
      return undefined;
    };
  }

  it('never requests /users, and asks for candidates only once the picker opens', async () => {
    await renderPage(
      '/master-data/factories/factory-1',
      ['ADMIN'],
      handler({ candidates: [dana, eli], mapped: [] }),
    );

    expect(container.textContent).toContain('Mapped Factory Users');
    expect(candidateRequests(optionsUrl)).toHaveLength(0);

    await openLookup();
    await waitUntil(() => optionTexts().length === 2);
    expect(candidateRequests(optionsUrl).map((request) => request.params)).toEqual([
      { search: '', limit: 20 },
    ]);
    expect(fullUsersRequests()).toHaveLength(0);
  });

  it('assigns (a reassignment from another factory included) with the unchanged POST body, then refreshes', async () => {
    // Eli is currently mapped to another factory — still a candidate here.
    const state = { candidates: [dana, eli], mapped: [] as unknown[] };
    await renderPage('/master-data/factories/factory-1', ['ADMIN'], handler(state));

    await openLookup();
    await choose('Eli Candidate');
    await clickAssign();

    expect(requests.filter((request) => request.method === 'post')).toEqual([
      expect.objectContaining({ url: '/users/u-2/factories', body: { factoryId: 'factory-1' } }),
    ]);
    await waitUntil(() => lookupInput().value === '');
    await waitUntil(() => container.textContent?.includes('eli@test.local') ?? false);
    // There is still no Remove action on the Factory page.
    expect(
      Array.from(container.querySelectorAll('button')).map((b) => b.textContent),
    ).not.toContain('Remove');

    const before = candidateRequests(optionsUrl).length;
    await openLookup();
    await waitUntil(() => candidateRequests(optionsUrl).length > before);
    await waitUntil(() => optionTexts().length === 1);
    expect(optionTexts()).toEqual(['Dana Candidatedana@test.local']);
    expect(fullUsersRequests()).toHaveLength(0);
  });

  it('disables the picker for an inactive factory', async () => {
    await renderPage(
      '/master-data/factories/factory-1',
      ['ADMIN'],
      handler({ candidates: [dana], mapped: [], status: 'INACTIVE' }),
    );

    expect(lookupInput().disabled).toBe(true);
    expect(container.textContent).toContain('Users cannot be assigned to an inactive factory.');
  });

  it('shows no assignment panel to non-ADMIN roles', async () => {
    await renderPage(
      '/master-data/factories/factory-1',
      ['MERCHANDISER'],
      handler({ candidates: [dana], mapped: [] }),
    );
    expect(container.textContent).toContain('Acme Factory');
    expect(container.textContent).not.toContain('Mapped Factory Users');
    expect(candidateRequests(optionsUrl)).toHaveLength(0);
    expect(fullUsersRequests()).toHaveLength(0);
  });
});
