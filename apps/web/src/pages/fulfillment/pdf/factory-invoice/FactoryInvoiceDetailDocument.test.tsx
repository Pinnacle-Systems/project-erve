import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { FactoryInvoiceDetailDocument } from './FactoryInvoiceDetailDocument.js';
import type { FactoryInvoiceDetailLineRow, FactoryInvoiceDetailPdfViewModel } from './buildFactoryInvoiceDetailViewModel.js';

interface PdfNode {
  value?: string;
  children?: PdfNode[];
}
function nodes(root: PdfNode): PdfNode[] {
  return [root, ...(root.children ?? []).flatMap(nodes)];
}
/** Renders the document and extracts its full text content, for asserting on qualifier/banner text (e.g. the ISS-025 Provisional label) a blob-size-only check can't see. */
async function renderText(viewModel: FactoryInvoiceDetailPdfViewModel): Promise<string> {
  const instance = pdf(<FactoryInvoiceDetailDocument viewModel={viewModel} />);
  await instance.toBlob();
  const all = nodes((instance.container as unknown as { document: PdfNode }).document);
  return all.map((node) => node.value ?? '').join('\n');
}

function makeLine(overrides: Partial<FactoryInvoiceDetailLineRow> = {}): FactoryInvoiceDetailLineRow {
  return {
    id: 'l1',
    styleDisplay: 'ST-1 — Shirt',
    sizeBreakdown: 'Medium: 108',
    totalQuantity: 108,
    defaultRate: 'INR 105.00',
    rate: 'INR 95.00',
    rateOverridden: true,
    amount: 'INR 10260.00',
    ...overrides,
  };
}

function makeViewModel(overrides: Partial<FactoryInvoiceDetailPdfViewModel> = {}): FactoryInvoiceDetailPdfViewModel {
  return {
    title: 'FACTORY INVOICE',
    subtitle: 'FD/26-27/0001 — Acme Factory',
    generatedAt: '2026-09-16T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [{ label: 'Factory', value: 'Acme Factory' }],
    lines: [makeLine()],
    subtotal: 'INR 1000.00',
    gstAmount: 'INR 50.00',
    total: 'INR 1050.00',
    remarks: null,
    isFinalized: false,
    ...overrides,
  };
}

describe('FactoryInvoiceDetailDocument', () => {
  it('renders a single-line invoice without throwing', async () => {
    const blob = await pdf(<FactoryInvoiceDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders with remarks without throwing', async () => {
    const blob = await pdf(<FactoryInvoiceDetailDocument viewModel={makeViewModel({ remarks: 'Please expedite' })} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a zero-GST, zero-total invoice without throwing', async () => {
    const blob = await pdf(
      <FactoryInvoiceDetailDocument viewModel={makeViewModel({ gstAmount: 'INR 0.00', total: 'INR 0.00', subtotal: 'INR 0.00' })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many invoice lines spanning multiple PDF pages without throwing', async () => {
    const lines = Array.from({ length: 150 }, (_, i) => makeLine({ id: `l${i}`, styleDisplay: `ST-${i} — Style ${i}` }));
    const blob = await Promise.race([
      pdf(<FactoryInvoiceDetailDocument viewModel={makeViewModel({ lines })} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Factory Invoice detail')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});

describe('FactoryInvoiceDetailDocument — ISS-025 Provisional qualifier', () => {
  it('shows a PROVISIONAL banner near the Totals when the invoice is not finalized', async () => {
    const text = await renderText(makeViewModel({ isFinalized: false }));
    expect(text).toContain('PROVISIONAL');
    expect(text).toContain('Not yet finalized');
  });

  it('shows the PROVISIONAL banner at GENERATED-equivalent (isFinalized: false) even when GST is zero', async () => {
    const text = await renderText(makeViewModel({ isFinalized: false, gstAmount: 'INR 0.00', total: 'INR 1000.00' }));
    expect(text).toContain('PROVISIONAL');
  });

  it('omits the PROVISIONAL banner once the invoice is finalized', async () => {
    const text = await renderText(makeViewModel({ isFinalized: true }));
    expect(text).not.toContain('PROVISIONAL');
    expect(text).not.toContain('Not yet finalized');
  });

  it('a finalized invoice with a legitimate zero GST still prints the real INR 0.00 figure, unqualified', async () => {
    const text = await renderText(makeViewModel({ isFinalized: true, gstAmount: 'INR 0.00', total: 'INR 1000.00' }));
    expect(text).not.toContain('PROVISIONAL');
    expect(text).toContain('INR 0.00');
  });
});
