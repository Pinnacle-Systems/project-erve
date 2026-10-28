import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { createApp } from '../app.js';
import { prisma } from '../db/prisma.js';
import { resetDatabase } from '../test/helpers.js';
import { createApprovedSaleOrder, createFactoryUserToken, packAndFinalize } from '../modules/fulfillment/fulfillment-test-helpers.js';
import { runIss100Preflight } from './iss100-retail-store-identity-preflight.cli.js';

// ISS-100 PR #187 review correction: findMixedOrMissingStoreOpenEipls()
// previously reported `count: rows.length`, which is the SAMPLE_LIMIT-capped
// row count, not the true number of matching OPEN EIPLs — any environment
// with more than 20 matching records would silently under-report. This test
// seeds 21 OPEN EIPLs, each carrying exactly one carton whose destination is
// missing its Retail Store (a legacy-data shape that can only be produced by
// writing directly to the DB, since the API itself now makes retailStoreId
// mandatory), and asserts the reported count reflects all 21 while the
// sample stays capped.
const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('iss100-retail-store-identity-preflight: findMixedOrMissingStoreOpenEipls counting', () => {
  it('counts every matching OPEN EIPL, not just the capped sample', async () => {
    const fixture = await createApprovedSaleOrder(app, { quantity: 1 });
    const factoryToken = await createFactoryUserToken(fixture.stock.factoryId);
    const dispatch = await packAndFinalize(
      app,
      factoryToken,
      fixture.saleOrder.id,
      fixture.saleOrderLineId,
      fixture.saleOrder.destinations[0].id,
      1,
    );
    const baseCarton = await prisma.factoryPackingCarton.findUniqueOrThrow({ where: { id: dispatch.cartonId } });
    const baseDestination = await prisma.saleOrderDestination.findUniqueOrThrow({
      where: { id: fixture.saleOrder.destinations[0].id },
    });

    const matchingCount = 21;
    for (let i = 0; i < matchingCount; i++) {
      const destination = await prisma.saleOrderDestination.create({
        data: {
          id: createId(),
          // Simulates pre-ISS-100 legacy data: the API itself can no longer
          // create a destination without a Retail Store.
          retailStoreId: null,
          saleOrderId: baseDestination.saleOrderId,
          saleOrderDistributorId: baseDestination.saleOrderDistributorId,
          addressLine1: baseDestination.addressLine1,
          city: baseDestination.city,
          state: baseDestination.state,
          country: baseDestination.country,
        },
      });
      const ervePackingList = await prisma.ervePackingList.create({
        data: {
          id: createId(),
          ervePackingListNumber: `EIPL-ISS100-TEST-${createId()}`,
          status: 'OPEN',
          createdById: baseCarton.createdById,
          financialYearId: (await prisma.financialYear.findFirstOrThrow()).id,
          ervePackingListSerial: 900000 + i,
        },
      });
      await prisma.factoryPackingCarton.create({
        data: {
          id: createId(),
          factoryDispatchId: baseCarton.factoryDispatchId,
          destinationId: destination.id,
          ervePackingListId: ervePackingList.id,
          cartonNumber: `MISSING-STORE-${i}`,
          createdById: baseCarton.createdById,
        },
      });
    }

    const report = await prisma.$transaction((tx) => runIss100Preflight(tx, 'TEST'));

    expect(report.openEiplsWithMixedOrMissingStores.count).toBe(matchingCount);
    expect(report.openEiplsWithMixedOrMissingStores.sample.length).toBe(20);
  });
});
