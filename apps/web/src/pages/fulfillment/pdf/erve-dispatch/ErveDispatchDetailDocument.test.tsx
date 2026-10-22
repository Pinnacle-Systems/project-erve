import { pdf } from '@react-pdf/renderer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
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

async function extractText(blob: Blob): Promise<string[]> {
  const task = getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useSystemFonts: true });
  try {
    const doc = await task.promise;
    const text: string[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const items = (await (await doc.getPage(p)).getTextContent()).items;
      for (const item of items) if ('str' in item) text.push(item.str);
    }
    return text;
  } finally {
    await task.destroy();
  }
}

describe('ErveDispatchDetailDocument', () => {
  it('renders without throwing', async () => {
    const blob = await pdf(<ErveDispatchDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  // ISS-055: the legacy Invoice/Tally Status section must never appear in
  // the extracted PDF text — not conditionally hidden, never printed at all.
  it('never prints an Invoice/Tally Status section or any Tally-labeled text', async () => {
    const blob = await pdf(<ErveDispatchDetailDocument viewModel={makeViewModel()} />).toBlob();
    const text = await extractText(blob);
    expect(text.join(' ')).not.toMatch(/Tally|Invoice Status|Invoice Handoff/i);
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
