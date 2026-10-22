import { beforeEach, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';

const db = vi.hoisted(() => ({
  saleOrder: { findUniqueOrThrow: vi.fn() },
  saleOrderDestination: { findMany: vi.fn() },
  saleOrderLine: { findMany: vi.fn() },
  factoryDispatch: { findUnique: vi.fn() },
  factoryPackingCarton: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock('../../db/prisma.js', () => ({
  prisma: db,
  Prisma: { sql: (parts: TemplateStringsArray, ...values: unknown[]) => ({ parts, values }), empty: '' },
}));
vi.mock('./packing-reconciliation.js', () => ({ getPhysicalPackedQuantitiesForLines: async () => new Map(), reconcileFactoryDispatchLineAttribution: vi.fn() }));
vi.mock('./factory-invoice.service.js', () => ({ generateFactoryInvoiceForFinalizedDispatch: vi.fn() }));
vi.mock('../master-data/master-data.service.js', () => ({ listFactories: vi.fn() }));
vi.mock('../../audit/audit.service.js', () => ({ recordAuditLog: vi.fn() }));
vi.mock('../../config/env.js', () => ({ env: { NODE_ENV: 'test' } }));
vi.mock('../master-data/financial-year.service.js', () => ({ ensureFinancialYear: vi.fn() }));
vi.mock('../master-data/document-sequence.service.js', () => ({ allocateDocumentSerial: vi.fn() }));

import { buildPackingListProjection, getFactoryPackingQueue } from './factory-dispatch.service.js';

beforeEach(() => vi.resetAllMocks());

it('projects authoritative Size ordering onto packing lines without filtering inactive referenced Sizes', async () => {
  db.saleOrder.findUniqueOrThrow.mockResolvedValue({ saleOrderNumber: 'DO1', factory: { id: 'factory' } });
  db.saleOrderDestination.findMany.mockResolvedValue([{ id: 'destination', saleOrderDistributor: { distributor: { id: 'distributor' } } }]);
  db.saleOrderLine.findMany.mockResolvedValue([{ id: 'line', destinationId: 'destination', quantity: 5, style: { id: 'style', images: [] }, size: { id: 'size', code: 'M', label: 'Medium', sortOrder: -2, status: 'INACTIVE' } }]);
  db.factoryDispatch.findUnique.mockResolvedValue(null);
  db.factoryPackingCarton.findMany.mockResolvedValue([{
    id: 'carton', cartonNumber: 'C1', destinationId: 'destination', version: 1,
    retiredAt: null, createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), audits: [],
    lines: [{ saleOrderLineId: 'line', quantity: 3, saleOrderLine: {
      destinationId: 'destination', style: { id: 'style', images: [] },
      size: { id: 'size', code: 'M', label: 'Medium', sortOrder: -2 },
    } }],
  }]);
  const view = await buildPackingListProjection({ id: 'order', factoryId: 'factory' });
  expect(view.destinations[0]!.lines[0]).toMatchObject({ sizeSortOrder: -2, requiredQuantity: 5, packedQuantity: 0 });
  const query = db.saleOrderLine.findMany.mock.calls[0]![0];
  expect(query.include.size.select.sortOrder).toBe(true);
  expect(query.where).toEqual({ saleOrderId: 'order' });
  expect(view.destinations[0]!.cartons[0]!.lines[0]).toMatchObject({ sizeSortOrder: -2, quantity: 3 });
  expect(db.factoryPackingCarton.findMany.mock.calls[0]![0].include.lines.include.saleOrderLine.select.size.select.sortOrder).toBe(true);
});

it('projects queue ordering metadata while keeping the raw pagination order and cursor', async () => {
  const date = new Date('2026-01-01T00:00:00Z');
  db.$queryRaw.mockResolvedValue([
    { saleOrderLineId: 'line-z', createdAt: date, sizeSortOrder: 9, remainingQuantity: 5 },
    { saleOrderLineId: 'line-a', createdAt: date, sizeSortOrder: -1, remainingQuantity: 5 },
  ]);
  const actor: CurrentUser = { id: 'factory-user', email: 'factory@example.test', mobile: null, name: 'Factory', status: 'ACTIVE', authVersion: 1, roles: ['FACTORY_USER'], factoryIds: ['factory'], distributorIds: [] };
  const page = await getFactoryPackingQueue(actor, { limit: 1 });
  expect(page.items[0]).toMatchObject({ saleOrderLineId: 'line-z', sizeSortOrder: 9 });
  expect(page.pageInfo.hasMore).toBe(true);
  expect(Buffer.from(page.pageInfo.nextCursor!, 'base64url').toString()).toContain('line-z');
  const query = db.$queryRaw.mock.calls[0]![0];
  expect(query.parts.join(' ')).toContain('sz.sort_order AS "sizeSortOrder"');
  expect(query.parts.join(' ')).toContain('ORDER BY sol.created_at ASC, sol.id ASC');
});
