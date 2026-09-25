/** @vitest-environment jsdom */
import { describe, it } from 'vitest';
import { expectLoadsEveryPage } from '../../test-support/cursor-list-page.js';
import { PackingAuditQueuePage } from './PackingAuditQueuePage.js';

// GET /packing-audit/queue is cursor-paginated; the queue previously showed
// only its first 100 cartons.
describe('PackingAuditQueuePage pagination', () => {
  it('reaches every carton with Load more', async () => {
    await expectLoadsEveryPage({
      element: <PackingAuditQueuePage />,
      path: '/packing-audit/queue',
      noun: 'cartons',
      roles: ['QA_USER'],
      rowText: (n) => `EISO/26-27/${String(n).padStart(4, '0')}`,
      row: (n) => ({
        id: `c-${n}`,
        saleOrder: { id: `so-${n}`, saleOrderNumber: `EISO/26-27/${String(n).padStart(4, '0')}` },
        factory: { id: 'f1', name: 'Clifton' },
        cartonNumber: n,
        totalQuantity: 5,
        auditState: 'NOT_INSPECTED',
      }),
    });
  });
});
