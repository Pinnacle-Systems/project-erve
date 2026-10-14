/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role, TaxInvoiceReviewView } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as Auth from '../../auth/AuthContext.js';
import { TaxInvoiceDetailPage } from './TaxInvoiceDetailPage.js';
import { taxInvoiceFixture } from './tax-invoice-test-fixture.js';
import * as PdfDownloads from '../../lib/pdf/download.js';

const generatePdf = vi.hoisted(() => vi.fn());
vi.mock('./pdf/tax-invoice/generateTaxInvoicePdf.js', () => ({
  generateTaxInvoicePdfBlob: generatePdf,
}));

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  generatePdf.mockReset();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});
const text = () => document.body.textContent ?? '';
const button = (label: string) =>
  Array.from(document.querySelectorAll('button')).find(
    (node) => node.textContent?.trim() === label,
  );
async function render(
  invoice: TaxInvoiceReviewView,
  role: Role = 'ACCOUNTANT',
  auditError = false,
) {
  const user: AuthUser = {
    id: 'user-1',
    email: 'user@test.local',
    mobile: null,
    name: 'Test User',
    roles: [role],
  };
  vi.spyOn(Auth, 'useAuth').mockReturnValue({
    user,
    token: 'test-token',
    isInitializing: false,
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  } as unknown as ReturnType<typeof Auth.useAuth>);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url.endsWith('/review')) return { data: { data: invoice } };
    if (url.endsWith('/audit')) {
      if (auditError) throw new Error('Audit service unavailable');
      return {
        data: {
          data: [
            {
              id: 'event-1',
              action: 'TAX_INVOICE_LINE_RATE_OVERRIDDEN',
              entityType: 'TaxInvoiceLine',
              entityId: 'line-1',
              metadata: {
                calculatedUnitRate: '66.676667',
                overrideUnitRate: '70.00',
                reason: 'Commercial correction',
              },
              actor: { id: 'acct-1', name: 'Accountant One' },
              createdAt: '2026-10-11T05:00:00.000Z',
            },
          ],
        },
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  act(() =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/fulfillment/tax-invoices/inv-1']}>
          <Routes>
            <Route path="/fulfillment/tax-invoices/:id" element={<TaxInvoiceDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await vi.waitFor(() => expect(text()).toContain('physical quantities are read-only'));
}
describe('Tax Invoice Accountant review and immutable presentation', () => {
  it.each(['ADMIN', 'ACCOUNTANT'] as const)(
    'allows %s to download the finalized frozen invoice',
    async (role) => {
      const invoice = taxInvoiceFixture({
        status: 'FINALIZED',
        invoiceNumber: 'EI/26-27/0001',
        finalizedAt: '2026-10-11T05:00:00Z',
        review: { state: 'FINALIZED', isPreview: false, calculatedAt: null, blockers: [] },
      });
      const blob = new Blob(['pdf'], { type: 'application/pdf' });
      generatePdf.mockResolvedValue(blob);
      const download = vi.spyOn(PdfDownloads, 'downloadPdfBlob').mockImplementation(() => {});
      await render(invoice, role);
      await act(async () => button('Download PDF')?.click());
      await vi.waitFor(() =>
        expect(download).toHaveBeenCalledWith(blob, 'ERVE-Tax-Invoice-EI-26-27-0001.pdf'),
      );
      expect(generatePdf).toHaveBeenCalledWith(
        expect.objectContaining({ grandTotal: '490.07', payableTotal: '490.00' }),
      );
      expect(button('Print')).toBeDefined();
      expect(button('Finalize invoice')).toBeUndefined();
    },
  );

  it('does not offer PDF actions for drafts or an unauthorized role', async () => {
    await render(taxInvoiceFixture());
    expect(button('Download PDF')).toBeUndefined();
    expect(button('Print')).toBeUndefined();
    await render(
      taxInvoiceFixture({
        status: 'FINALIZED',
        invoiceNumber: 'EI/26-27/0001',
        finalizedAt: '2026-10-11T05:00:00Z',
      }),
      'MERCHANDISER',
    );
    expect(button('Download PDF')).toBeUndefined();
    expect(generatePdf).not.toHaveBeenCalled();
  });

  it('keeps the issued document visible and permits PDF retry after generation failure', async () => {
    generatePdf
      .mockRejectedValueOnce(new Error('Unavailable image decoder'))
      .mockResolvedValue(new Blob(['pdf']));
    vi.spyOn(PdfDownloads, 'downloadPdfBlob').mockImplementation(() => {});
    await render(
      taxInvoiceFixture({
        status: 'FINALIZED',
        invoiceNumber: 'EI/26-27/0001',
        finalizedAt: '2026-10-11T05:00:00Z',
      }),
    );
    await act(async () => button('Download PDF')?.click());
    await vi.waitFor(() => expect(text()).toContain('PDF generation failed. Please try again.'));
    expect(text()).toContain('EI/26-27/0001');
    await act(async () => button('Download PDF')?.click());
    await vi.waitFor(() => expect(generatePdf).toHaveBeenCalledTimes(2));
  });
  it('does not submit finalization after backend review values change', async () => {
    await render(taxInvoiceFixture());
    vi.mocked(apiClient.get).mockResolvedValue({
      data: { data: taxInvoiceFixture({ payableTotal: '491.00' }) },
    });
    const post = vi.spyOn(apiClient, 'post');
    await act(async () => button('Finalize invoice')?.click());
    await act(async () => button('Confirm finalization')?.click());
    await vi.waitFor(() => expect(text()).toContain('Review values or prerequisites changed'));
    expect(post).not.toHaveBeenCalled();
  });
  it('retains the draft and explains a rejected finalization', async () => {
    await render(taxInvoiceFixture());
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Finalization unavailable'));
    await act(async () => button('Finalize invoice')?.click());
    await act(async () => button('Confirm finalization')?.click());
    await vi.waitFor(() => expect(text()).toContain('Finalization unavailable'));
    expect(button('Finalize invoice')).toBeDefined();
    expect(text()).not.toContain('EI/26-27/');
  });
  it('shows explicit draft preview, exact backend rate and read-only quantity', async () => {
    await render(taxInvoiceFixture());
    expect(text()).toContain('Preview');
    expect(text()).toContain('₹66.676667');
    expect(text()).not.toContain('EI/26-27/');
    expect(document.querySelector('input[aria-label*="quantity"]')).toBeNull();
    expect(button('Finalize invoice')).toBeDefined();
  });
  it('does not offer Accountant mutations to ADMIN', async () => {
    await render(taxInvoiceFixture(), 'ADMIN');
    expect(button('Finalize invoice')).toBeUndefined();
    expect(button('Override')).toBeUndefined();
  });
  it('presents legacy issued totals without manufacturing zero round-off', async () => {
    await render(
      taxInvoiceFixture({
        status: 'FINALIZED',
        invoiceNumber: 'EI/26-27/0001',
        payableTotal: null,
        roundOffAdjustment: null,
        roundingPolicy: null,
        finalizedAt: '2026-10-11T05:00:00.000Z',
        review: { state: 'FINALIZED', isPreview: false, calculatedAt: null, blockers: [] },
      }),
    );
    expect(text()).toContain('Original issued total');
    expect(text()).toContain('Not snapshotted');
    expect(button('Finalize invoice')).toBeUndefined();
    expect(button('Override')).toBeUndefined();
  });
  it('shows persisted financial audit context', async () => {
    await render(taxInvoiceFixture());
    await act(async () =>
      button('History')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      ),
    );
    await vi.waitFor(() => expect(text()).toContain('Commercial correction'));
    expect(text()).toContain('Accountant One');
    expect(text()).toContain('₹66.676667');
  });
  it('distinguishes audit service failure from empty history', async () => {
    await render(taxInvoiceFixture(), 'ACCOUNTANT', true);
    await act(async () =>
      button('History')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      ),
    );
    await vi.waitFor(() => expect(text()).toContain('Unable to load financial history'));
    expect(text()).not.toContain('No financial history');
  });
  it('blocks finalization when backend review reports missing prerequisites', async () => {
    await render(
      taxInvoiceFixture({
        grandTotal: null,
        payableTotal: null,
        review: {
          state: 'BLOCKED',
          isPreview: true,
          calculatedAt: null,
          blockers: [
            { code: 'HSN_NOT_ASSIGNED', message: 'Complete the canonical HSN assignment' },
          ],
        },
      }),
    );
    expect(text()).toContain('Complete the canonical HSN assignment');
    expect((button('Finalize invoice') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows cancellation banner, reason and preserves PDF download for a CANCELLED invoice', async () => {
    const invoice = taxInvoiceFixture({
      status: 'CANCELLED',
      invoiceNumber: 'EI/26-27/0001',
      finalizedAt: '2026-10-11T05:00:00Z',
      cancelledAt: '2026-10-12T06:00:00Z',
      cancellationReason: 'Wrong distributor address',
      cancelledBy: { id: 'acct-1', name: 'Accountant One' },
      replacedByInvoiceId: 'inv-2',
      replacedByInvoiceNumber: 'EI/26-27/0002',
      review: { state: 'CANCELLED', isPreview: false, calculatedAt: null, blockers: [] },
    });
    const blob = new Blob(['pdf'], { type: 'application/pdf' });
    generatePdf.mockResolvedValue(blob);
    const download = vi.spyOn(PdfDownloads, 'downloadPdfBlob').mockImplementation(() => {});

    await render(invoice, 'ACCOUNTANT');

    expect(text()).toContain('Invoice Cancelled');
    expect(text()).toContain('Reason: Wrong distributor address');
    expect(text()).toContain('Accountant One');
    expect(text()).toContain('View replacement (EI/26-27/0002)');
    expect(button('Download PDF')).toBeDefined();
    expect(button('Print')).toBeDefined();
    expect(button('Finalize invoice')).toBeUndefined();
    expect(button('Cancel invoice')).toBeUndefined();

    await act(async () => button('Download PDF')?.click());
    await vi.waitFor(() =>
      expect(download).toHaveBeenCalledWith(blob, 'ERVE-Tax-Invoice-EI-26-27-0001.pdf'),
    );
  });

  it('allows ACCOUNTANT to cancel a FINALIZED invoice with a mandatory reason', async () => {
    const invoice = taxInvoiceFixture({
      status: 'FINALIZED',
      invoiceNumber: 'EI/26-27/0001',
      finalizedAt: '2026-10-11T05:00:00Z',
      review: { state: 'FINALIZED', isPreview: false, calculatedAt: null, blockers: [] },
    });
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: invoice } });

    await render(invoice, 'ACCOUNTANT');

    expect(button('Cancel invoice')).toBeDefined();
    await act(async () => button('Cancel invoice')?.click());

    await vi.waitFor(() => expect(text()).toContain('Cancel Tax Invoice'));
    expect(text()).toContain('Cancelling invoice EI/26-27/0001 is permanent.');

    const initialBtn = button('Confirm cancellation') as HTMLButtonElement;
    expect(initialBtn.disabled).toBe(true);

    const input = document.querySelector(
      'input[placeholder*="why this invoice is being cancelled"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      valueSetter?.call(input, 'Distributor GSTIN changed');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await vi.waitFor(() => {
      const btn = button('Confirm cancellation') as HTMLButtonElement;
      expect(btn).toBeDefined();
      expect(btn.disabled).toBe(false);
    });

    await act(async () => (button('Confirm cancellation') as HTMLButtonElement).click());

    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith(
        '/tax-invoices/inv-1/actions/cancel',
        { reason: 'Distributor GSTIN changed' },
      ),
    );
  });

  it('does not offer cancel invoice button to ADMIN on a finalized invoice', async () => {
    const invoice = taxInvoiceFixture({
      status: 'FINALIZED',
      invoiceNumber: 'EI/26-27/0001',
      finalizedAt: '2026-10-11T05:00:00Z',
      review: { state: 'FINALIZED', isPreview: false, calculatedAt: null, blockers: [] },
    });
    await render(invoice, 'ADMIN');
    expect(button('Cancel invoice')).toBeUndefined();
  });

  it('offers Create replacement invoice to ACCOUNTANT on a CANCELLED invoice without replacement', async () => {
    const invoice = taxInvoiceFixture({
      status: 'CANCELLED',
      invoiceNumber: 'EI/26-27/0001',
      finalizedAt: '2026-10-11T05:00:00Z',
      cancelledAt: '2026-10-12T06:00:00Z',
      cancellationReason: 'Distributor requested correction',
      cancelledBy: { id: 'acct-1', name: 'Accountant One' },
      replacedByInvoiceId: null,
      replacedByInvoiceNumber: null,
      review: { state: 'CANCELLED', isPreview: false, calculatedAt: null, blockers: [] },
    });
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { data: taxInvoiceFixture({ id: 'draft-2', replacesInvoiceId: 'inv-1' }) },
    });

    await render(invoice, 'ACCOUNTANT');

    expect(button('Create replacement invoice')).toBeDefined();
    await act(async () => button('Create replacement invoice')?.click());

    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith('/tax-invoices', {
        ervePackingListId: 'eipl-1',
        replacesInvoiceId: 'inv-1',
      }),
    );
  });
});
