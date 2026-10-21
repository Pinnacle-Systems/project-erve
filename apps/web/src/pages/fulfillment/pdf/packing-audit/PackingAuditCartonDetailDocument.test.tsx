import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { PackingAuditCartonDetailDocument } from './PackingAuditCartonDetailDocument.js';
import type { PackingAuditCartonDetailPdfViewModel } from './buildPackingAuditCartonDetailViewModel.js';

function makeViewModel(overrides: Partial<PackingAuditCartonDetailPdfViewModel> = {}): PackingAuditCartonDetailPdfViewModel {
  return {
    title: 'PACKING AUDIT CARTON',
    subtitle: 'Carton C1 — EISO/26-27/0001 · Factory One',
    generatedAt: '2026-09-15T10:00:00Z',
    generatedBy: 'Test QA User',
    identityItems: [
      { label: 'Carton Number', value: 'C1' },
      { label: 'Dispatch Order', value: 'EISO/26-27/0001' },
      { label: 'Factory', value: 'Factory One' },
      { label: 'Distributor', value: 'Distributor One' },
      { label: 'Destination', value: 'Store 1' },
      { label: 'Audit State', value: 'Not Inspected' },
    ],
    retired: false,
    destinationMismatch: false,
    totalQuantity: 10,
    sizeColumns: [{ sizeId: 'size-1', sizeCode: 'M' }],
    styleRows: [{ styleId: 'style-1', styleNumber: 'ST-001', styleName: 'Classic Tee', values: { 'size-1': 10 } }],
    auditHistory: [],
    ...overrides,
  };
}

describe('PackingAuditCartonDetailDocument', () => {
  it('renders a pre-audit carton (no history) without throwing', async () => {
    const blob = await pdf(<PackingAuditCartonDetailDocument viewModel={makeViewModel()} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a completed audit with history without throwing', async () => {
    const blob = await pdf(
      <PackingAuditCartonDetailDocument
        viewModel={makeViewModel({
          auditHistory: [{ cartonVersion: 1, inspectedByName: 'QA One', inspectedAt: '01 Sep 2026, 10:00 am', remarks: 'looks good' }],
        })}
      />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders retired and destination-mismatch warnings without throwing', async () => {
    const blob = await pdf(
      <PackingAuditCartonDetailDocument viewModel={makeViewModel({ retired: true, destinationMismatch: true })} />,
    ).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a multi-Style carton with a multi-entry audit history without throwing', async () => {
    const sizeColumns = [{ sizeId: 'size-1', sizeCode: 'M' }];
    const styleRows = Array.from({ length: 20 }, (_, i) => ({
      styleId: `style-${i}`,
      styleNumber: `ST-${i}`,
      styleName: null,
      values: { 'size-1': 5 },
    }));
    const auditHistory = Array.from({ length: 10 }, (_, i) => ({
      cartonVersion: i + 1,
      inspectedByName: `QA ${i}`,
      inspectedAt: '01 Sep 2026, 10:00 am',
      remarks: i % 2 === 0 ? `remark ${i}` : null,
    }));
    const blob = await Promise.race([
      pdf(<PackingAuditCartonDetailDocument viewModel={makeViewModel({ sizeColumns, styleRows, auditHistory })} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a multi-Style carton')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
