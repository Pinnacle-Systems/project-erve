/** @vitest-environment jsdom */
import { describe, it } from 'vitest';
import { expectLoadsEveryPage } from '../../test-support/cursor-list-page.js';
import { PurchaseOrderListPage } from './PurchaseOrderListPage.js';

// GET /purchase-orders is cursor-paginated (25 per page); the list must
// reach every Order Sheet, not just the first page.
describe('PurchaseOrderListPage pagination', () => {
  it('loads further pages by cursor with Load more', async () => {
    await expectLoadsEveryPage({
      element: <PurchaseOrderListPage />,
      path: '/purchase-orders',
      noun: 'Order Sheets',
      rowText: (n) => `EIPO/26-27/${String(n).padStart(4, '0')}`,
      row: (n) => ({
        id: `po-${n}`,
        poNumber: `EIPO/26-27/${String(n).padStart(4, '0')}`,
        distributor: { id: 'd1', code: 'D1', name: 'Acme' },
        poDate: '2026-09-01T00:00:00.000Z',
        financialYear: { id: 'fy', code: '2026-27' },
        requiredDeliveryDate: null,
        purchaseMode: 'OUTRIGHT',
        status: 'DRAFT',
        jobOrderId: null,
        totalOrderedQuantity: 10,
        createdAt: '2026-09-01T00:00:00.000Z',
      }),
    });
  });
});
