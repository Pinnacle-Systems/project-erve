/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { DistributorOption } from '@erve/types';
import { ThemeProvider } from '@erve/theme';
import { apiClient } from '../../lib/api-client.js';
import { DistributorLookupField, type DistributorLookupValue } from './DistributorLookupField.js';

const acme: DistributorOption = {
  id: 'dist-1',
  code: 'DIST-1',
  name: 'Acme Distribution',
  status: 'ACTIVE',
  purchaseMode: 'OUTRIGHT',
};
const bharat: DistributorOption = {
  id: 'dist-2',
  code: 'DIST-2',
  name: 'Bharat Traders',
  status: 'ACTIVE',
  purchaseMode: 'SALE_RETURN',
};

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let requests: Array<{ url: string; params: unknown }>;
let changes: Array<DistributorOption | null>;
// What the stubbed endpoint returns for a given request.
let respond: (params: { search?: string; limit?: number }) => DistributorOption[];

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

beforeEach(() => {
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
  changes = [];
  respond = () => [acme, bharat];
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    requests.push({ url: config.url ?? '', params: config.params });
    return ok(config, { success: true, data: respond(config.params ?? {}) });
  }) satisfies AxiosAdapter;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  vi.unstubAllGlobals();
});

function Harness({
  initial,
  excludeIds,
  searchPath,
}: {
  initial: DistributorLookupValue | null;
  excludeIds?: ReadonlySet<string>;
  searchPath?: string;
}) {
  const [value, setValue] = useState<DistributorLookupValue | null>(initial);
  return (
    <DistributorLookupField
      label="Distributor"
      value={value}
      excludeIds={excludeIds}
      searchPath={searchPath}
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
    />
  );
}

function render(props: Parameters<typeof Harness>[0]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <ThemeProvider theme="default" density="comfortable">
        <QueryClientProvider client={queryClient}>
          <Harness {...props} />
        </QueryClientProvider>
      </ThemeProvider>,
    ),
  );
}

function input(): HTMLInputElement {
  return document.getElementById('lookup-distributor') as HTMLInputElement;
}

function options(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
}

async function type(text: string) {
  await act(async () => {
    input().focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function openByClick() {
  await act(async () => {
    input().focus();
    input().click();
  });
}

function panelText(): string {
  return document.body.querySelector('[data-lookup-panel]')?.textContent ?? '';
}

const freshResults = () =>
  options().length > 0 && document.body.querySelector('[role="listbox"][aria-busy]') === null;

describe('DistributorLookupField', () => {
  it('makes no request on mount or Tab focus, only once the panel opens', async () => {
    render({ initial: null });
    expect(requests).toHaveLength(0);

    await act(async () => input().focus());
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(requests).toHaveLength(0);
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('opening with no text shows the bounded initial Distributors (LU0)', async () => {
    render({ initial: null });
    await openByClick();
    await waitUntil(freshResults);

    expect(requests).toEqual([{ url: '/distributors/options', params: { search: '', limit: 20 } }]);
    expect(options().map((option) => option.textContent)).toEqual([
      'Acme DistributionDIST-1',
      'Bharat TradersDIST-2',
    ]);
    expect(panelText()).not.toContain('Type to search');
  });

  it('ArrowDown also opens on the initial Distributors', async () => {
    render({ initial: null });
    await act(async () => {
      input().focus();
      input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await waitUntil(freshResults);
    expect(requests).toEqual([{ url: '/distributors/options', params: { search: '', limit: 20 } }]);
  });

  it('typing searches the bounded Distributor lookup, and clearing restores the initial rows', async () => {
    respond = ({ search }) =>
      search ? [acme, bharat].filter((d) => d.name.toLowerCase().includes(search)) : [acme, bharat];
    render({ initial: null });

    await type('ac');
    await waitUntil(() => freshResults() && options().length === 1);
    // Opening by typing searches the typed text only.
    expect(requests).toEqual([
      { url: '/distributors/options', params: { search: 'ac', limit: 20 } },
    ]);
    expect(options().map((option) => option.textContent)).toEqual(['Acme DistributionDIST-1']);

    await type('');
    await waitUntil(() => freshResults() && options().length === 2);
    expect(requests.at(-1)).toEqual({
      url: '/distributors/options',
      params: { search: '', limit: 20 },
    });
  });

  it('says none are available for an empty search, and none match for a typed one', async () => {
    respond = () => [];
    render({ initial: null });
    await openByClick();
    await waitUntil(() => panelText().includes('No active distributors available'));

    await type('zzz');
    await waitUntil(() => panelText().includes('No distributors match your search'));
  });

  it('selects an option by click and shows its name', async () => {
    render({ initial: null });
    await type('bha');
    await waitUntil(freshResults);

    const option = options().find((candidate) => candidate.textContent?.includes('Bharat'))!;
    await act(async () => option.click());

    expect(changes).toEqual([bharat]);
    expect(input().value).toBe('Bharat Traders');
  });

  it('displays a hydrated (even inactive) value without searching, and clears to null', async () => {
    render({ initial: { id: 'dist-9', name: 'Retired Distribution', status: 'INACTIVE' } });

    expect(input().value).toBe('Retired Distribution (inactive)');
    expect(requests).toHaveLength(0);

    const clear = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear Distributor"]',
    )!;
    await act(async () => clear.click());
    expect(changes).toEqual([null]);
  });

  it('hides excluded Distributors from the results', async () => {
    render({ initial: null, excludeIds: new Set(['dist-1']) });
    await type('a');
    await waitUntil(freshResults);

    expect(options().map((option) => option.textContent)).toEqual(['Bharat TradersDIST-2']);
  });

  it('over-fetches by the excluded count so up to 20 usable rows remain (Dispatch Order groups)', async () => {
    const many: DistributorOption[] = Array.from({ length: 50 }, (_, index) => ({
      id: `bulk-${index}`,
      code: `BULK-${index}`,
      name: `Bulk ${String(index).padStart(2, '0')}`,
      status: 'ACTIVE',
      purchaseMode: 'OUTRIGHT',
    }));
    respond = ({ limit }) => many.slice(0, limit);
    // Two other groups picked the first two rows; '' is an unpicked group.
    render({ initial: null, excludeIds: new Set(['bulk-0', 'bulk-1', '']) });
    await openByClick();
    await waitUntil(freshResults);

    expect(requests).toEqual([{ url: '/distributors/options', params: { search: '', limit: 22 } }]);
    const shown = options().map((option) => option.textContent);
    expect(shown).toHaveLength(20);
    expect(shown[0]).toBe('Bulk 02BULK-2');
    expect(shown.at(-1)).toBe('Bulk 21BULK-21');
  });

  it('never asks for more than the endpoint maximum of 50', async () => {
    const excluded = new Set(Array.from({ length: 40 }, (_, index) => `x-${index}`));
    render({ initial: null, excludeIds: excluded });
    await openByClick();
    await waitUntil(freshResults);

    expect(requests[0]).toEqual({
      url: '/distributors/options',
      params: { search: '', limit: 50 },
    });
  });

  it('can search a module-specific endpoint with the same contract', async () => {
    render({ initial: null, searchPath: '/example-module/distributor-options' });
    await openByClick();
    await waitUntil(freshResults);
    expect(requests[0]).toEqual({
      url: '/example-module/distributor-options',
      params: { search: '', limit: 20 },
    });

    await type('ac');
    await waitUntil(() => requests.length === 2);

    expect(requests[1]).toEqual({
      url: '/example-module/distributor-options',
      params: { search: 'ac', limit: 20 },
    });
  });
});
