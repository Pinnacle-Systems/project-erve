import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { JobOrderListDocument } from './JobOrderListDocument.js';
import type { JobOrderListPdfRow, JobOrderListPdfViewModel } from './buildJobOrderListViewModel.js';

function makeRow(overrides: Partial<JobOrderListPdfRow> = {}): JobOrderListPdfRow {
  return {
    id: 'jo-1',
    jobOrderNumber: 'EIJO/26-27/0001',
    styleDisplay: 'STY-0001 Basic Tee',
    factoryName: 'Acme Factory',
    sourceOrderSheetCount: 2,
    requiredDeliveryDate: '01 Jun 2026',
    orderedQuantityTotal: 1000,
    preparedQuantityTotal: 400,
    status: 'Sewing',
    ...overrides,
  };
}

function makeViewModel(rows: JobOrderListPdfRow[]): JobOrderListPdfViewModel {
  return {
    title: 'JOB ORDER LIST',
    subtitle: 'Factory production orders created from Order Sheet demand',
    filters: [],
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    totalCount: rows.length,
    rows,
  };
}

describe('JobOrderListDocument', () => {
  it('renders with zero rows without throwing', async () => {
    const blob = await pdf(<JobOrderListDocument viewModel={makeViewModel([])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders a single row without throwing', async () => {
    const blob = await pdf(<JobOrderListDocument viewModel={makeViewModel([makeRow()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders mixed statuses including Production Complete without throwing', async () => {
    const rows = [makeRow(), makeRow({ id: 'jo-2', status: 'Production Complete' })];
    const blob = await pdf(<JobOrderListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a row with no delivery date as an em dash without throwing', async () => {
    const rows = [makeRow({ requiredDeliveryDate: '' })];
    const blob = await pdf(<JobOrderListDocument viewModel={makeViewModel(rows)} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders many rows spanning multiple API and PDF pages without throwing', async () => {
    const rows = Array.from({ length: 120 }, (_, i) =>
      makeRow({ id: `jo-${i}`, jobOrderNumber: `EIJO/26-27/${String(i).padStart(4, '0')}` }),
    );
    const blob = await Promise.race([
      pdf(<JobOrderListDocument viewModel={makeViewModel(rows)} />).toBlob(),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error('PDF generation hung on a long Job Order list')), 8000),
      ),
    ]);
    expect(blob.size).toBeGreaterThan(0);
  }, 10000);
});
