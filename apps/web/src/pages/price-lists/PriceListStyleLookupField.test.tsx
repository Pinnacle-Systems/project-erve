/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { ThemeProvider } from '@erve/theme';
import { apiClient } from '../../lib/api-client.js';
import { PriceListStyleLookupField } from './PriceListStyleLookupField.js';
import type { PriceListStyleCandidate } from './types.js';

// What GET /price-lists/:id/style-options returns: already eligible (ACTIVE,
// not priced on this list) — the field never filters.
const girlsTee: PriceListStyleCandidate = {
  id: 'style-1',
  styleNumber: '25426015',
  styleName: 'GIRLS REGULAR T SHIRTS',
  lmixNumber: 'LMIX5526015',
  status: 'ACTIVE',
};
const boysPant: PriceListStyleCandidate = {
  id: 'style-2',
  styleNumber: '25426020',
  styleName: 'BOYS SWEAT PANT',
  lmixNumber: 'LMIX5526020',
  status: 'ACTIVE',
};

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let requests: Array<{ url: string; params: unknown }>;
let respond: (params: { search?: string }) => PriceListStyleCandidate[];

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
  respond = ({ search = '' }) =>
    [girlsTee, boysPant].filter((style) =>
      style.styleName.toLowerCase().includes(search.toLowerCase()),
    );
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

let queryClient: QueryClient;

function Harness() {
  const [value, setValue] = useState<PriceListStyleCandidate | null>(null);
  return (
    <>
      <PriceListStyleLookupField priceListId="pl-1" value={value} onChange={setValue} />
      <button type="button" onClick={() => setValue(null)}>
        Reset
      </button>
    </>
  );
}

function render() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <ThemeProvider theme="default" density="comfortable">
        <QueryClientProvider client={queryClient}>
          <Harness />
        </QueryClientProvider>
      </ThemeProvider>,
    ),
  );
}

function input(): HTMLInputElement {
  return document.getElementById('lookup-style') as HTMLInputElement;
}

function options(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
}

function panelText(): string {
  return document.body.querySelector('[data-lookup-panel]')?.textContent ?? '';
}

async function open() {
  await act(async () => {
    input().focus();
    input().click();
  });
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

const fresh = (count: number) => () =>
  options().length === count && document.body.querySelector('[role="listbox"][aria-busy]') === null;

describe('PriceListStyleLookupField (LU0)', () => {
  it('fetches nothing until opened, then shows the bounded eligible Styles for this price list', async () => {
    render();
    await act(async () => input().focus());
    expect(requests).toHaveLength(0);

    await open();
    await waitUntil(fresh(2));

    // Eligibility (ACTIVE, not already priced) is the endpoint's, before its limit.
    expect(requests).toEqual([
      { url: '/price-lists/pl-1/style-options', params: { search: '', limit: 20 } },
    ]);
    expect(panelText()).not.toContain('Type to search');
  });

  it('searches as the user types and restores the initial Styles when cleared', async () => {
    render();
    await type('pant');
    await waitUntil(fresh(1));
    expect(requests).toEqual([
      { url: '/price-lists/pl-1/style-options', params: { search: 'pant', limit: 20 } },
    ]);

    await type('');
    await waitUntil(fresh(2));
    expect(requests.at(-1)).toEqual({
      url: '/price-lists/pl-1/style-options',
      params: { search: '', limit: 20 },
    });
  });

  it('resets after use, and a price list refresh re-requests the eligible Styles', async () => {
    render();
    await open();
    await waitUntil(fresh(2));
    await act(async () => options()[0]!.click());
    expect(input().value).toBe('25426015 · LMIX5526015 · GIRLS REGULAR T SHIRTS');

    // The page clears the picker after Add Line and refreshes ['price-list', id].
    respond = () => [boysPant];
    const reset = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Reset',
    )!;
    await act(async () => reset.click());
    expect(input().value).toBe('');
    await act(async () => queryClient.invalidateQueries({ queryKey: ['price-list', 'pl-1'] }));

    await open();
    await waitUntil(fresh(1));
    expect(options()[0]!.textContent).toContain('25426020');
  });

  it('says when no Styles are left to add, and when a search matches none', async () => {
    respond = () => [];
    render();
    await open();
    await waitUntil(() => panelText().includes('No active Styles left to add to this price list'));

    await type('zzz');
    await waitUntil(() => panelText().includes('No active, unpriced Styles match your search'));
  });
});
