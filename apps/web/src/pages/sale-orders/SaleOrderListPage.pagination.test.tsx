/** @vitest-environment jsdom */
import { describe, it } from 'vitest';
import { expectLoadsEveryPage } from '../../test-support/cursor-list-page.js';
import { SaleOrderListPage } from './SaleOrderListPage.js';

// GET /sale-orders is cursor-paginated (25 per page); the list must reach
// every Dispatch Order, not just the first page.
describe('SaleOrderListPage pagination', () => {
  it('loads further pages by cursor with Load more', async () => {
    await expectLoadsEveryPage({
      element: <SaleOrderListPage />,
      path: '/sale-orders',
      noun: 'dispatch orders',
      rowText: (n) => `EISO/26-27/${String(n).padStart(4, '0')}`,
      row: (n) => ({
        id: `so-${n}`,
        saleOrderNumber: `EISO/26-27/${String(n).padStart(4, '0')}`,
        distributors: [{ id: 'd1', code: 'D1', name: 'Acme' }],
        factory: { id: 'f1', code: 'F1', name: 'Clifton' },
        soDate: '2026-09-01T00:00:00.000Z',
        financialYear: { id: 'fy', code: '2026-27' },
        destinationCount: 1,
        totalQuantity: 10,
        isLocked: false,
      }),
    });
  });
});
