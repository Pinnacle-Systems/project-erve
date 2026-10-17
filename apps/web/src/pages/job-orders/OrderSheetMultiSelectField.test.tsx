/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { OrderSheetMultiSelectField } from './OrderSheetMultiSelectField.js';

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

const image = (styleId: string) => ({
  id: `image-${styleId}`, styleId, fileId: `file-${styleId}`, fileName: `${styleId}.jpg`,
  mimeType: 'image/jpeg', sizeBytes: 1000, isPrimary: true, sortOrder: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
});
const orders = ['A', 'B', 'C'].map((styleId) => ({
  id: `os-${styleId}`, poNumber: `OS-${styleId}`, distributor: { name: `Distributor ${styleId}` },
  purchaseMode: 'OUTRIGHT', requiredDeliveryDate: null,
  lines: [{ styleId, styleNumber: `ST-${styleId}`, styleName: `Style ${styleId}`, primaryImage: styleId === 'C' ? null : image(styleId) }],
}));

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubGlobal('IntersectionObserver', undefined);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:style-image');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('associates each Style image and fallback with its Order Sheet, keeping viewer interaction separate from selection', async () => {
  const get = vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/purchase-orders') return { data: { data: { items: orders } } };
    if (url === '/styles/A/images') return { data: { data: [image('A')] } };
    if (url.endsWith('/content')) return { data: new Blob(['image']) };
    throw new Error(`Unexpected URL: ${url}`);
  });
  const onSelect = vi.fn();
  act(() => root.render(
    <QueryClientProvider client={queryClient}>
      <OrderSheetMultiSelectField excludeIds={[]} onSelect={onSelect} />
    </QueryClientProvider>,
  ));
  await vi.waitFor(() => expect(container.textContent).toContain('OS-C'));
  const selectors = orders.map((order) => Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(order.poNumber))!);
  const rows = selectors.map((button) => button.parentElement!);
  expect(selectors.map((button) => button.children[1]?.firstElementChild?.textContent?.trim())).toEqual([
    'ST-A Style A', 'ST-B Style B', 'ST-C Style C',
  ]);
  expect(rows.map((row) => row.querySelectorAll('button[aria-label="View style image"]').length)).toEqual([1, 1, 0]);
  expect(container.querySelector('button button')).toBeNull();
  expect(rows[2]!.querySelector('svg')).not.toBeNull();
  await vi.waitFor(() => {
    expect(get).toHaveBeenCalledWith('/styles/A/images/image-A/content', expect.anything());
    expect(get).toHaveBeenCalledWith('/styles/B/images/image-B/content', expect.anything());
  });
  act(() => (rows[0]!.querySelector('[aria-label="View style image"]') as HTMLButtonElement).click());
  await vi.waitFor(() => expect(document.body.querySelector('[role="dialog"]')?.textContent).toContain('ST-A'));
  expect(onSelect).not.toHaveBeenCalled();
  const close = document.body.querySelector('[aria-label="Close viewer"]') as HTMLButtonElement;
  act(() => close.click());
  act(() => {
    selectors[1]!.focus();
    selectors[1]!.click();
  });
  expect(selectors[1]!.type).toBe('button');
  expect(onSelect).toHaveBeenCalledExactlyOnceWith(orders[1]);
});
