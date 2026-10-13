/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { TaxInvoiceDraftImageCell } from './TaxInvoiceDraftImageCell.js';
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => 'blob:draft-image',
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const image = { id: 'primary-1', mimeType: 'image/png', updatedAt: '2026-10-13T00:00:00Z' };
it('reads only the invoice-scoped primary image and opens the shared viewer', async () => {
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['image']) });
  const parent = vi.fn();
  act(() =>
    root.render(
      <div onClick={parent}>
        <TaxInvoiceDraftImageCell
          invoiceId="inv-1"
          styleId="style-1"
          image={image}
          styleNumber="ST-001"
        />
      </div>,
    ),
  );
  await vi.waitFor(() =>
    expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:draft-image'),
  );
  expect(get).toHaveBeenCalledWith('/tax-invoices/inv-1/styles/style-1/images/primary-1/content', {
    responseType: 'blob',
  });
  await act(async () => container.querySelector('button')!.click());
  expect(parent).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain('Primary image');
  await act(async () =>
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })),
  );
  await vi.waitFor(() => expect(document.activeElement).toBe(container.querySelector('button')));
});
it('defers offscreen media requests until near the viewport', async () => {
  let intersect: IntersectionObserverCallback;
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersect = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: new Blob(['image']) });
  act(() =>
    root.render(
      <TaxInvoiceDraftImageCell
        invoiceId="inv-1"
        styleId="style-1"
        image={image}
        styleNumber="ST-001"
      />,
    ),
  );
  expect(get).not.toHaveBeenCalled();
  await act(async () =>
    intersect!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver),
  );
  await vi.waitFor(() => expect(container.querySelector('img')).not.toBeNull());
});
it('shows a failed authorized primary image as unavailable', async () => {
  vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Forbidden'));
  act(() =>
    root.render(
      <TaxInvoiceDraftImageCell
        invoiceId="inv-1"
        styleId="style-1"
        image={image}
        styleNumber="ST-001"
      />,
    ),
  );
  await vi.waitFor(() => expect(container.textContent).toContain('Image unavailable'));
});
