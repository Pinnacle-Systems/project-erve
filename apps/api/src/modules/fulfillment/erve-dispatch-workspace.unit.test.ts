import { beforeEach, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';

const db = vi.hoisted(() => ({
  erveDispatch: { findUnique: vi.fn(), findMany: vi.fn() },
  factoryPackingCartonLine: { findMany: vi.fn() },
  erveDispatchDeliveryLine: { findMany: vi.fn() },
  invoiceHandoff: { findMany: vi.fn() },
}));
vi.mock('../../db/prisma.js', () => ({ prisma: db, Prisma: {} }));
vi.mock('../../audit/audit.service.js', () => ({ recordAuditLog: vi.fn() }));
vi.mock('../master-data/financial-year.service.js', () => ({ ensureFinancialYear: vi.fn() }));
vi.mock('../master-data/document-sequence.service.js', () => ({ allocateDocumentSerial: vi.fn() }));
vi.mock('./invoice-handoff.service.js', () => ({ createInvoiceHandoffsForDispatch: vi.fn() }));
vi.mock('../price-lists/price-lookup.js', () => ({
  resolveDistributorPricingForSnapshot: vi.fn(),
}));
vi.mock('../../config/env.js', () => ({ env: {} }));
import { getErveDispatchDetail } from './erve-dispatch.service.js';

const actor = (role: CurrentUser['roles'][number], distributorIds = ['dist-1']): CurrentUser => ({
  id: 'user',
  email: 'user@example.test',
  mobile: null,
  name: 'User',
  status: 'ACTIVE',
  authVersion: 1,
  roles: [role],
  factoryIds: [],
  distributorIds,
});
const date = new Date('2026-11-01T00:00:00Z');
beforeEach(() => {
  vi.resetAllMocks();
  db.erveDispatch.findUnique.mockResolvedValue({
    id: 'dispatch',
    ervePackingListId: 'packing',
    erveDispatchNumber: 'ED1',
    ervePackingList: { id: 'packing', ervePackingListNumber: 'PL1' },
    distributor: { id: 'dist-1', name: 'Distributor' },
    status: 'DELIVERED',
    dispatchDate: date,
    dispatchedAt: date,
    deliveryConfirmationSource: 'USER_CONFIRMED',
  });
  db.factoryPackingCartonLine.findMany.mockResolvedValue([]);
  db.invoiceHandoff.findMany.mockResolvedValue([]);
  db.erveDispatchDeliveryLine.findMany.mockResolvedValue([
    { saleOrderLineId: 'outright', receivedQuantity: 4 },
    { saleOrderLineId: 'return', receivedQuantity: 2 },
  ]);
});

it('projects carton quantities with real identities and native Size order, aggregating only identical source lines', async () => {
  const line = {
    saleOrderLineId: 'outright',
    quantity: 3,
    saleOrderLine: {
      style: { id: 'style', styleNumber: 'ST1', styleName: 'Tee', images: [] },
      size: { id: 'size', code: 'M', label: 'Medium', sortOrder: 8 },
      destination: { saleOrderDistributor: { purchaseMode: 'OUTRIGHT' } },
    },
  };
  db.factoryPackingCartonLine.findMany.mockResolvedValue([line, { ...line, quantity: 2 }]);
  const view = await getErveDispatchDetail(actor('ADMIN'), 'dispatch');
  expect(view).toMatchObject({
    totalQuantity: 5,
    quantityLines: [
      {
        saleOrderLineId: 'outright',
        styleId: 'style',
        styleNumber: 'ST1',
        primaryImage: null,
        sizeId: 'size',
        sizeCode: 'M',
        sizeSortOrder: 8,
        quantity: 5,
      },
    ],
    deliveryLines: [
      { saleOrderLineId: 'outright', receivedQuantity: 4 },
      { saleOrderLineId: 'return', receivedQuantity: 2 },
    ],
  });
  const query = db.factoryPackingCartonLine.findMany.mock.calls
    .map((call) => call[0])
    .find((query) => query.select?.saleOrderLine?.select?.size?.select?.id);
  expect(query.where).toEqual({ carton: { ervePackingListId: 'packing', retiredAt: null } });
  expect(query.select.saleOrderLine.select.size.select).toMatchObject({
    id: true,
    sortOrder: true,
  });
  expect(db.erveDispatchDeliveryLine.findMany).toHaveBeenCalledWith({
    where: { erveDispatchId: 'dispatch' },
    select: { saleOrderLineId: true, receivedQuantity: true },
    orderBy: { saleOrderLineId: 'asc' },
  });
});

it.each(['DISTRIBUTOR', 'ACCOUNTANT'] as const)(
  'does not expose protected images to %s',
  async (role) => {
    db.factoryPackingCartonLine.findMany.mockResolvedValue([
      {
        saleOrderLineId: 'line',
        quantity: 2,
        saleOrderLine: {
          style: { id: 'style', styleNumber: 'ST1', styleName: 'Tee', images: [{ secret: true }] },
          size: { id: 'size', code: 'M', label: 'Medium', sortOrder: 2 },
          destination: { saleOrderDistributor: { purchaseMode: 'OUTRIGHT' } },
        },
      },
    ]);
    const view = await getErveDispatchDetail(actor(role), 'dispatch');
    expect(view).toMatchObject({ quantityLines: [{ primaryImage: null }] });
    expect(JSON.stringify(view)).not.toContain('secret');
    const query = db.factoryPackingCartonLine.findMany.mock.calls
      .map((call) => call[0])
      .find((query) => query.select?.saleOrderLine?.select?.style?.select?.images);
    expect(query.select.saleOrderLine.select.style.select.images.take).toBe(0);
  },
);

it('rejects another Distributor before querying workspace evidence', async () => {
  await expect(
    getErveDispatchDetail(actor('DISTRIBUTOR', ['other']), 'dispatch'),
  ).rejects.toMatchObject({ statusCode: 403 });
  expect(db.factoryPackingCartonLine.findMany).not.toHaveBeenCalled();
  expect(db.erveDispatchDeliveryLine.findMany).not.toHaveBeenCalled();
});

it('rejects unauthorized roles and handles absent dispatches', async () => {
  await expect(getErveDispatchDetail(actor('FACTORY_USER'), 'dispatch')).rejects.toMatchObject({
    statusCode: 403,
  });
  db.erveDispatch.findUnique.mockResolvedValue(null);
  await expect(getErveDispatchDetail(actor('ADMIN'), 'missing')).rejects.toMatchObject({
    statusCode: 404,
  });
});
