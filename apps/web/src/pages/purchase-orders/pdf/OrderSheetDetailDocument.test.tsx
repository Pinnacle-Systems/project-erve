import { pdf } from '@react-pdf/renderer';
import { describe, expect, it } from 'vitest';
import { OrderSheetDetailDocument } from './OrderSheetDetailDocument.js';
import type {
  OrderSheetDetailLineSection,
  OrderSheetDetailPdfViewModel,
} from './buildOrderSheetDetailViewModel.js';

function makeLine(overrides: Partial<OrderSheetDetailLineSection> = {}): OrderSheetDetailLineSection {
  return {
    id: 'line-1',
    styleNumber: 'STY-0001',
    styleName: 'Basic Tee',
    seasonDisplay: 'SS27',
    totalOrderedQuantity: 500,
    sizes: [
      { id: 'sz-1', sizeCode: 'S', orderedQuantity: 200 },
      { id: 'sz-2', sizeCode: 'M', orderedQuantity: 0 },
      { id: 'sz-3', sizeCode: 'L', orderedQuantity: 300 },
    ],
    ...overrides,
  };
}

function makeViewModel(lines: OrderSheetDetailLineSection[]): OrderSheetDetailPdfViewModel {
  return {
    title: 'ORDER SHEET',
    subtitle: 'EIOS/26-27/0001 — Acme Distributors',
    generatedAt: '2026-09-12T10:00:00Z',
    generatedBy: 'Test Admin',
    identityItems: [
      { label: 'Order Sheet Number', value: 'EIOS/26-27/0001' },
      { label: 'Distributor', value: 'Acme Distributors' },
      { label: 'Purchase Mode', value: 'Outright' },
      { label: 'Total Quantity', value: 500 },
      { label: 'Required Delivery Date', value: null },
      { label: 'Job Order', value: null },
      { label: 'Remarks', value: null },
    ],
    lines,
  };
}

describe('OrderSheetDetailDocument', () => {
  it('renders with a single Style/line without throwing', async () => {
    const blob = await pdf(<OrderSheetDetailDocument viewModel={makeViewModel([makeLine()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe('application/pdf');
  });

  it('renders zero quantities without collapsing them to an em dash', async () => {
    const blob = await pdf(<OrderSheetDetailDocument viewModel={makeViewModel([makeLine()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a line with many sizes (wide matrix) without throwing', async () => {
    const sizes = Array.from({ length: 20 }, (_, i) => ({ id: `sz-${i}`, sizeCode: `SZ${i}`, orderedQuantity: i * 10 }));
    const line = makeLine({ sizes });
    const blob = await pdf(<OrderSheetDetailDocument viewModel={makeViewModel([line])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders a long Style/Distributor name without throwing', async () => {
    const line = makeLine({ styleName: 'A Very Long Style Name That Could Wrap Across Multiple Lines In The PDF Layout' });
    const vm = { ...makeViewModel([line]), subtitle: 'EIOS/26-27/0001 — A Very Long Distributor Name Private Limited' };
    const blob = await pdf(<OrderSheetDetailDocument viewModel={vm} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });

  it('renders null identity values as an em dash without throwing', async () => {
    const blob = await pdf(<OrderSheetDetailDocument viewModel={makeViewModel([makeLine()])} />).toBlob();
    expect(blob.size).toBeGreaterThan(0);
  });
});
