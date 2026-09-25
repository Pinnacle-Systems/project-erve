/** @vitest-environment jsdom */
import { describe, it, vi } from 'vitest';
import { expectLoadsEveryPage } from '../../test-support/cursor-list-page.js';
import { expectPdfExportsEveryPage } from '../../test-support/cursor-list-pdf.js';
import { PriceListListPage } from './PriceListListPage.js';
import type { PriceListSummary } from './types.js';

const generator = vi.fn();
vi.mock('./pdf/generatePriceListListPdf.js', () => ({
  generatePriceListListPdfBlob: (...args: unknown[]) => generator(...args),
}));

function priceList(n: number): PriceListSummary {
  return {
    id: `pl-${n}`,
    code: `PL-2026-${String(n).padStart(6, '0')}`,
    name: 'FY Prices',
    distributor: { id: 'd1', code: 'D1', name: 'Acme', status: 'ACTIVE' },
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    status: 'DRAFT',
    lineCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

// PAG6: the Price List list pages by cursor (opt-in via limit) and its PDF
// exports every matching page, not only the loaded rows.
describe('Price List list pagination (PAG6)', () => {
  it('reaches every Price List with Load more', async () => {
    await expectLoadsEveryPage({
      element: <PriceListListPage />,
      path: '/price-lists',
      noun: 'price lists',
      row: priceList,
      rowText: (n) => `PL-2026-${String(n).padStart(6, '0')}`,
    });
  });

  it('exports every page to the PDF, not just the loaded rows', async () => {
    await expectPdfExportsEveryPage({
      element: <PriceListListPage />,
      path: '/price-lists',
      row: priceList,
      generator,
    });
  });
});
