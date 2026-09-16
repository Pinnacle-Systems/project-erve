import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PackingAuditListDocument } from './PackingAuditListDocument.js';
import type { PackingAuditListPdfRow, PackingAuditListPdfViewModel } from './buildPackingAuditListViewModel.js';

function makeRow(overrides: Partial<PackingAuditListPdfRow> = {}): PackingAuditListPdfRow {
  return {
    id: 'carton-1',
    saleOrderNumber: 'EISO/26-27/0001',
    factoryName: 'Factory One',
    cartonNumber: 'C1',
    totalQuantity: 10,
    auditStateLabel: 'Not Inspected',
    ...overrides,
  };
}

function makeViewModel(rows: PackingAuditListPdfRow[]): PackingAuditListPdfViewModel {
  return {
    title: 'PACKING AUDIT QUEUE',
    subtitle: 'Open cartons awaiting or already inspected on active Factory Dispatches',
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test QA User',
    totalCount: rows.length,
    rows,
  };
}

describe('PackingAuditListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<PackingAuditListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<PackingAuditListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple pages without throwing', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => makeRow({ id: `carton-${i}`, cartonNumber: `C${i}` }));
    const blob = await Promise.race([
      pdf(<PackingAuditListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Packing Audit queue')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
