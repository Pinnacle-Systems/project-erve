/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import {
  DispatchOrderStyleField,
  type DispatchOrderStyleOption,
} from './DispatchOrderStyleField.js';

let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
const endpoint = '/job-orders/pooled-inventory/style-options';
const option = (n: number) => ({
  styleId: `s${n}`,
  styleNumber: `ST-${n}`,
  styleName: `Name ${n}`,
  lmixNumber: `LMIX-${n}`,
  primaryImage: null,
});
const page = (n: number, more = false) => ({
  data: {
    data: {
      items: [option(n)],
      pageInfo: { limit: 20, hasMore: more, nextCursor: more ? `cursor-${n}` : null },
    },
  },
});
const selected: DispatchOrderStyleOption = { ...option(99), sizes: [] };
const change = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  change.mockReset();
});
afterEach(async () => {
  act(() => root.unmount());
  // Radix FocusScope dispatches its unmount autofocus event on a zero-delay timer.
  // Keep this test's jsdom Event globals alive until that cleanup completes.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  client.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function flush(ms = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
async function render(
  factoryId = 'f1',
  value: DispatchOrderStyleOption | null = null,
  excludeStyleIds?: Set<string>,
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <DispatchOrderStyleField
          factoryId={factoryId}
          excludeSaleOrderId={factoryId === 'f1' ? 'order1' : undefined}
          value={value}
          onChange={change}
          excludeStyleIds={excludeStyleIds}
        />
      </QueryClientProvider>,
    ),
  );
}
const input = () => container.querySelector('input')!;
const options = () => [...document.querySelectorAll('[role="option"]')];
async function open() {
  await act(async () => input().click());
  await flush();
}
async function type(text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function button(text: string) {
  return [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
}
function key(key: string) {
  input().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
}

it('fetches only on open with bounded Factory/search/exclusion context; appends and deduplicates pages', async () => {
  const get = vi
    .spyOn(apiClient, 'get')
    .mockImplementation(async (_url, config) =>
      config?.params.cursor
        ? { data: { data: { ...page(2).data.data, items: [option(1), option(2)] } } }
        : page(1, true),
    );
  await render();
  expect(get).not.toHaveBeenCalled();
  await open();
  expect(get).toHaveBeenCalledWith(
    endpoint,
    expect.objectContaining({
      params: {
        factoryId: 'f1',
        search: '',
        limit: 20,
        cursor: undefined,
        excludeSaleOrderId: 'order1',
      },
      signal: expect.any(AbortSignal),
    }),
  );
  expect(options()).toHaveLength(1);
  const more = button('Load more');
  expect(more.type).toBe('button');
  expect(more.tabIndex).toBe(0);
  await act(async () => more.click());
  await flush();
  expect(options().map((o) => o.textContent)).toEqual(['ST-1Name 1', 'ST-2Name 2']);
  expect(change).not.toHaveBeenCalled();
});

it('debounces search, blocks stale keyboard selection and resets pagination', async () => {
  const get = vi
    .spyOn(apiClient, 'get')
    .mockImplementation(async (_url, config) =>
      page(config?.params.search ? 2 : 1, !config?.params.search),
    );
  await render();
  await open();
  await type('  LMIX  ');
  await act(async () => key('Enter'));
  expect(change).not.toHaveBeenCalled();
  await flush(340);
  await flush();
  expect(options().map((o) => o.textContent)).toEqual(['ST-2Name 2']);
  expect(get.mock.calls.at(-1)?.[1]?.params).toMatchObject({ search: 'LMIX', cursor: undefined });
  await act(async () => key('Enter'));
  expect(change.mock.calls[0]?.[0].styleId).toBe('s2');
});

it('isolates Factory results, cancels old requests and ignores late responses', async () => {
  let resolve!: (result: ReturnType<typeof page>) => void;
  let oldSignal: AbortSignal | undefined;
  vi.spyOn(apiClient, 'get').mockImplementation(async (_url, config) => {
    if (config?.params.factoryId === 'f1') {
      oldSignal = config.signal as AbortSignal;
      return new Promise((r) => {
        resolve = r;
      });
    }
    return page(2);
  });
  await render();
  await open();
  await render('f2');
  await open();
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => resolve(page(1)));
  await flush();
  expect(options().map((o) => o.textContent)).toEqual(['ST-2Name 2']);
  await act(async () => key('Enter'));
  expect(change.mock.calls[0]?.[0].styleId).toBe('s2');
});

it('preserves saved zero-stock identity independently of result pages and supports clear/reselect', async () => {
  vi.spyOn(apiClient, 'get').mockResolvedValue(page(1));
  await render('f1', selected);
  expect(input().value).toContain('ST-99');
  await open();
  expect(input().value).toContain('ST-99');
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Clear Style"]')!.click(),
  );
  expect(change).toHaveBeenCalledWith(null);
  await render();
  await open();
  await act(async () => key('Enter'));
  expect(change.mock.calls.at(-1)?.[0].styleId).toBe('s1');
});

it('excludes Styles already chosen at this destination and retries failed discovery', async () => {
  const get = vi
    .spyOn(apiClient, 'get')
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ data: { data: { ...page(2).data.data, items: [option(1), option(2)] } } });
  await render('f1', null, new Set(['s1']));
  await open();
  await flush();
  expect(document.body.textContent).toContain('Unable to load Styles');
  await act(async () => button('Retry').click());
  await flush();
  expect(get).toHaveBeenCalledTimes(2);
  expect(options().map((o) => o.textContent)).toEqual(['ST-2Name 2']);
});

it('opens the authenticated original-image viewer without selecting the Style', async () => {
  const image = {
    id: 'img1',
    styleId: 's1',
    fileId: 'file1',
    fileName: 'original.png',
    mimeType: 'image/png',
    sizeBytes: 10,
    sortOrder: 0,
    isPrimary: true,
    createdAt: '2026-10-25',
    updatedAt: '2026-10-25',
  };
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = () => 'blob:lookup-test';
      static revokeObjectURL = vi.fn();
    },
  );
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url) => {
    if (url === endpoint)
      return {
        data: { data: { ...page(1).data.data, items: [{ ...option(1), primaryImage: image }] } },
      };
    if (url === '/styles/s1/images') return { data: { data: [image] } };
    return { data: new Blob(['image'], { type: 'image/png' }) };
  });
  await render();
  await open();
  await act(async () => input().focus());
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="View style image"]')!.click(),
  );
  await flush();
  expect(change).not.toHaveBeenCalled();
  expect(get.mock.calls.some((c) => c[0] === '/styles/s1/images')).toBe(true);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();

  // Close the viewer while jsdom is still mounted so Radix can restore focus.
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="Close viewer"]')!.click();
  });
  await flush();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
