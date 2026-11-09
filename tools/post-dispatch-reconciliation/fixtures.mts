import { writeFile } from 'node:fs/promises';
import request from '../../apps/api/node_modules/supertest/index.js';
import { requireSafeTestDatabaseUrl } from '../../apps/api/src/test/database-safety.js';
import { a5BrowserTarget } from './safety.mjs';

const target = requireSafeTestDatabaseUrl({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  developmentDatabaseUrl: process.env.DATABASE_URL,
});
a5BrowserTarget(target.url, process.env.DATABASE_URL);
process.env.DATABASE_URL = target.url;
process.env.NODE_ENV = 'test';
const { createApp } = await import('../../apps/api/src/app.js');
const { prisma } = await import('../../apps/api/src/db/prisma.js');
const { resetDatabase } = await import('../../apps/api/src/test/helpers.js');
const { createId } = await import('../../packages/shared/src/id.js');
const helpers = await import('../../apps/api/src/modules/fulfillment/fulfillment-test-helpers.js');
const app = createApp();
try {
  await resetDatabase();
  const source = await helpers.createSingleFactoryApprovedSaleOrder(app, 100, 'SALE_RETURN');
  const factory = await helpers.createFactoryUserToken(source.stock.factoryId);
  const packed = await helpers.packAndFinalize(
    app,
    factory,
    source.saleOrder.id,
    source.saleOrderLineId,
    source.saleOrder.destinations[0].id,
    100,
  );
  const dispatch = await helpers.consolidateAndDispatch(app, source.merchToken, [packed.cartonId]);
  await prisma.erveDispatchDeliveryLine.create({
    data: {
      id: createId(),
      erveDispatchId: dispatch.id,
      saleOrderLineId: source.saleOrderLineId,
      receivedQuantity: 100,
    },
  });
  await prisma.erveDispatch.update({
    where: { id: dispatch.id },
    data: { status: 'DELIVERED', deliveryConfirmationSource: 'LEGACY_ASSUMED_FULL_RECEIPT' },
  });
  const line = await prisma.saleOrderLine.findUniqueOrThrow({
    where: { id: source.saleOrderLineId },
  });
  await request(app)
    .post(`/erve-dispatches/${dispatch.id}/distributor-receipt`)
    .set('Authorization', `Bearer ${source.distributorToken}`)
    .set('Idempotency-Key', createId())
    .send({
      expectedVersion: dispatch.version,
      acknowledged: true,
      remarks: 'Only 70 received; operational follow-up required',
      groups: [{ styleId: line.styleId, sizeId: line.sizeId, receivedQuantity: 70 }],
    })
    .expect(201);
  const admin = await helpers.createRoleToken('ADMIN');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
  // Token fixtures embed an uppercase ULID; browser login uses canonical email.
  const email = user.email.toLowerCase();
  await prisma.user.update({ where: { id: user.id }, data: { email } });
  await writeFile(
    process.env.A5_FIXTURES!,
    JSON.stringify({ dispatchId: dispatch.id, email, password: 'pass' }),
  );
} finally {
  await prisma.$disconnect();
}
