import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { InvoiceHandoffDetailDocument } from './InvoiceHandoffDetailDocument.js';
import type { InvoiceHandoffDetailPdfViewModel } from './buildInvoiceHandoffDetailViewModel.js';

function makeViewModel(overrides: Partial<InvoiceHandoffDetailPdfViewModel> = {}): InvoiceHandoffDetailPdfViewModel {
  return {
    title: 'INVOICE HANDOFF',
    subtitle: 'ST-1 / Medium — Outright — Acme Distributors',
    generatedAt: '2026-09-16T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [{ label: 'Style / Size', value: 'ST-1 / Medium' }],
    tallyItems: [{ label: 'Tally Invoice #', value: 'TALLY-001' }],
    ...overrides,
  };
}

describe('InvoiceHandoffDetailDocument', () => {
  it('renders a recorded handoff without throwing', async () => {
    const blob = await pdf(<InvoiceHandoffDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a PENDING_TALLY handoff with no Tally reference yet without throwing', async () => {
    const blob = await pdf(
      <InvoiceHandoffDetailDocument
        viewModel={makeViewModel({ tallyItems: [{ label: 'Tally Invoice #', value: null }, { label: 'Tally Invoice Date', value: null }] })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a DISTRIBUTOR-redacted (mostly null) Tally section without throwing', async () => {
    const blob = await pdf(
      <InvoiceHandoffDetailDocument
        viewModel={makeViewModel({
          tallyItems: [
            { label: 'Tally Invoice #', value: 'TALLY-001' },
            { label: 'Tally Voucher Reference', value: null },
            { label: 'Recorded By', value: null },
          ],
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
