/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { TaxInvoiceArchivedImageCell } from './TaxInvoiceArchivedImageCell.js';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:invoice-image'),
    revokeObjectURL: vi.fn(),
  });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const image = {
  id: 'archive-1',
  mimeType: 'image/png',
  checksumSha256: 'issued-checksum',
  sizeBytes: 120,
};
describe('Invoice archive media adapter', () => {
  it('uses authorized invoice content and the shared viewer without reading Style media', async () => {
    const get = vi
      .spyOn(apiClient, 'get')
      .mockResolvedValue({ data: new Blob(['original-image']) });
    act(() =>
      root.render(
        <TaxInvoiceArchivedImageCell invoiceId="invoice-1" image={image} styleNumber="ST-001" />,
      ),
    );
    await vi.waitFor(() =>
      expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:invoice-image'),
    );
    expect(get).toHaveBeenCalledWith('/tax-invoices/invoice-1/images/archive-1/content', {
      responseType: 'blob',
    });
    expect(get).toHaveBeenCalledTimes(1);
    await act(async () => container.querySelector('button')?.click());
    expect(document.body.textContent).toContain('Issued image');
  });
  it('shows missing archives honestly without fetching another Style image', () => {
    const get = vi.spyOn(apiClient, 'get');
    act(() =>
      root.render(
        <TaxInvoiceArchivedImageCell invoiceId="invoice-1" image={null} styleNumber="ST-001" />,
      ),
    );
    expect(container.textContent).toContain('Image unavailable');
    expect(get).not.toHaveBeenCalled();
  });
  it('shows unavailable media when an authorized image request fails', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('Archive unavailable'));
    act(() =>
      root.render(
        <TaxInvoiceArchivedImageCell invoiceId="invoice-1" image={image} styleNumber="ST-001" />,
      ),
    );
    await vi.waitFor(() => expect(container.textContent).toContain('Image unavailable'));
    expect(container.querySelector('img')).toBeNull();
  });
});
