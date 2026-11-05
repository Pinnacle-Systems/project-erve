import { expect, it, vi } from 'vitest';
const globalDb = vi.hoisted(() => ({
  factoryDispatch: {
    findUnique: vi.fn(() => {
      throw new Error('Projection escaped its transaction');
    }),
  },
}));
vi.mock('../../db/prisma.js', () => ({ prisma: globalDb, Prisma: {} }));
vi.mock('../../config/env.js', () => ({ env: {} }));
import { getFactoryDispatchDetail } from './factory-dispatch.service.js';
import type { CurrentUser } from '../../auth/current-user.js';

it('reads the authorized label projection entirely on the supplied transaction client', async () => {
  const tx = {
    factoryDispatch: {
      findUnique: vi.fn(async () => ({
        id: 'fd',
        factoryId: 'factory',
        saleOrderId: 'so',
        status: 'DRAFT',
        version: 1,
      })),
    },
    saleOrder: {
      findUniqueOrThrow: vi.fn(async () => ({
        saleOrderNumber: 'DO1',
        factory: { id: 'factory', name: 'Factory' },
      })),
    },
    saleOrderDestination: { findMany: vi.fn(async () => []) },
    saleOrderLine: {
      findMany: vi.fn(async () => [
        {
          id: 'line-1',
          destinationId: 'dest-1',
          quantity: 4,
          style: { id: 'style-1', styleNumber: 'ST1', styleName: 'Tee', images: [] },
          size: { id: 'size-1', code: 'M', label: 'Medium', sortOrder: 1 },
        },
      ]),
    },
    factoryPackingCarton: { findMany: vi.fn(async () => []) },
    factoryPackingCartonLine: { groupBy: vi.fn(async () => []) },
    factoryInvoice: { findUnique: vi.fn(async () => null) },
  };
  const actor = { id: 'user', roles: ['ADMIN'] } as CurrentUser;
  const projection = await getFactoryDispatchDetail(actor, 'fd', tx as never);
  expect(projection).toMatchObject({
    saleOrderNumber: 'DO1',
    factoryDispatch: { id: 'fd' },
    destinations: [],
    retiredCartons: [],
  });
  expect(globalDb.factoryDispatch.findUnique).not.toHaveBeenCalled();
});
