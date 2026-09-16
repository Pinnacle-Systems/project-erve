import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { ErveDispatchDetailDocument } from './ErveDispatchDetailDocument.js';
import type { ErveDispatchDetailPdfViewModel, ErveDispatchDetailSaleOrReturnRow } from './buildErveDispatchDetailViewModel.js';

function makeViewModel(overrides: Partial<ErveDispatchDetailPdfViewModel> = {}): ErveDispatchDetailPdfViewModel {
  return {
    title: 'ERVE DISPATCH',
    subtitle: 'ED/26-27/0001 — Acme Distributors',
    generatedAt: '2026-09-16T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [{ label: 'Erve Dispatch Number', value: 'ED/26-27/0001' }],
    deliveryItems: [{ label: 'Delivery', value: 'Not yet confirmed' }],
    invoiceHandoffs: [
      { invoiceHandoffId: 'ih-1', modeLabel: 'Outright', styleDisplay: 'ST-1 / Medium', quantity: 20, statusLabel: 'Pending Tally', tallyInvoiceNumber: null },
    ],
    saleOrReturnLines: [],
    ...overrides,
  };
}

function makeSaleOrReturnRow(overrides: Partial<ErveDispatchDetailSaleOrReturnRow> = {}): ErveDispatchDetailSaleOrReturnRow {
  return {
    saleOrderLineId: 'sol-1',
    styleDisplay: 'ST-1 / Medium',
    dispatchedQuantity: 20,
    receivedQuantity: 20,
    actualSoldQuantity: 10,
    returnedQuantity: 0,
    approvedAwaitingReceiptQuantity: 0,
    pendingRequestedQuantity: 0,
    remainingWithDistributor: 10,
    ...overrides,
  };
}

describe('ErveDispatchDetailDocument', () => {
  it('renders with Invoice/Tally data permitted without throwing', async () => {
    const blob = await pdf(<ErveDispatchDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders "Not available for this viewer" when the Invoice/Tally section is excluded (null), never as an empty table', async () => {
    const blob = await pdf(<ErveDispatchDetailDocument viewModel={makeViewModel({ invoiceHandoffs: null })} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders with the Sale-or-Return Position section when present', async () => {
    const blob = await pdf(<ErveDispatchDetailDocument viewModel={makeViewModel({ saleOrReturnLines: [makeSaleOrReturnRow()] })} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many Sale-or-Return lines spanning multiple PDF pages without throwing', async () => {
    const saleOrReturnLines = Array.from({ length: 100 }, (_, i) => makeSaleOrReturnRow({ saleOrderLineId: `sol-${i}` }));
    const blob = await Promise.race([
      pdf(<ErveDispatchDetailDocument viewModel={makeViewModel({ saleOrReturnLines })} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Erve Dispatch detail')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
