/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { OrderSheetStyleOption } from '@erve/types';
import { ThemeProvider } from '@erve/theme';
import { apiClient } from '../../lib/api-client.js';
import { StyleLookupField, type StyleLookupValue } from './StyleLookupField.js';

const season = { code: 'SS26', displayName: 'SS26 26-27' };
const tee: OrderSheetStyleOption = {
  id: 'style-1',
  styleNumber: 'ST-001',
  styleName: 'Classic Tee',
  lmixNumber: 'LMIX5526011',
  status: 'ACTIVE',
  season,
};
const hoody: OrderSheetStyleOption = {
  id: 'style-2',
  styleNumber: 'ST-002',
  styleName: 'Girls Hoody',
  lmixNumber: 'LMIX5526022',
  status: 'ACTIVE',
  season,
};

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let requests: Array<{ url: string; params: unknown }>;
let changes: Array<OrderSheetStyleOption | null>;
let respond: (params: { search?: string }) => OrderSheetStyleOption[];

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
  // Mirrors the endpoint: LMIX / Style No. / Style Name contains.
  respond = ({ search = '' }) =>
    [tee, hoody].filter((style) =>
      [style.lmixNumber ?? '', style.styleNumber, style.styleName].some((field) =>
        field.toLowerCase().includes(search.toLowerCase()),
      ),
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

function Harness({ initial }: { initial: StyleLookupValue | null }) {
  const [value, setValue] = useState<StyleLookupValue | null>(initial);
  return (
    <StyleLookupField
      label="Style"
      value={value}
      onChange={(next) => {
        changes.push(next);
        setValue(next);
      }}
    />
  );
}

function render(initial: StyleLookupValue | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <ThemeProvider theme="default" density="comfortable">
        <QueryClientProvider client={queryClient}>
          <Harness initial={initial} />
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

describe('StyleLookupField (LU0)', () => {
  it('makes no request on mount or focus; opening requests the bounded initial Styles', async () => {
    render();
    await act(async () => input().focus());
    expect(requests).toHaveLength(0);

    await open();
    await waitUntil(fresh(2));

    expect(requests).toEqual([
      { url: '/purchase-orders/style-options', params: { search: '', limit: 20 } },
    ]);
    expect(options().map((option) => option.textContent)).toEqual([
      expect.stringContaining('ST-001'),
      expect.stringContaining('ST-002'),
    ]);
    expect(panelText()).not.toContain('Type to search');
  });

  it('searches as the user types and restores the initial Styles when cleared', async () => {
    render();
    await open();
    await waitUntil(fresh(2));

    await type('hood');
    await waitUntil(fresh(1));
    expect(requests.at(-1)).toEqual({
      url: '/purchase-orders/style-options',
      params: { search: 'hood', limit: 20 },
    });

    await type('');
    await waitUntil(fresh(2));
    // Served from the cached initial set.
    expect(requests).toHaveLength(2);
  });

  it('selects a Style and shows its label', async () => {
    render();
    await open();
    await waitUntil(fresh(2));

    await act(async () => options()[1]!.click());

    expect(changes).toEqual([hoody]);
    expect(input().value).toBe('ST-002 · LMIX5526022 · Girls Hoody');
  });

  it('keeps a hydrated inactive value as-is, without searching', async () => {
    render({ id: 'style-9', styleNumber: 'AW24-OLD', styleName: 'Old Hoody', status: 'INACTIVE' });

    expect(input().value).toBe('AW24-OLD · Old Hoody (inactive)');
    expect(container.textContent).toContain('This Style is no longer active');
    expect(requests).toHaveLength(0);
  });

  it('distinguishes an empty eligible set from a search with no matches', async () => {
    respond = () => [];
    render();
    await open();
    await waitUntil(() => panelText().includes('No active Styles available'));

    await type('zzz');
    await waitUntil(() => panelText().includes('No active Styles match your search'));
  });
});
