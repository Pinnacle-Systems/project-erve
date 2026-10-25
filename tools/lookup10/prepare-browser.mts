import { prisma } from '../../apps/api/src/db/prisma.js';
import { createTestUserAndToken } from '../../apps/api/src/test/helpers.js';

const target = new URL(process.env.DATABASE_URL!);
if (
  target.hostname !== '127.0.0.1' ||
  target.port !== '55451' ||
  target.pathname !== '/erve_batch10_lookup10_test'
)
  throw new Error('Unverified browser fixture target');
try {
  const email = 'browser-lookup10@test.local';
  if (!(await prisma.user.findUnique({ where: { email } })))
    await createTestUserAndToken({ email, password: 'lookup10-browser-pass', roles: ['ADMIN'] });
  const actor = await prisma.user.findUniqueOrThrow({ where: { email } });
  const previous = await prisma.saleOrder.findMany({
    where: { createdBy: actor.id, destinations: { some: { addressLine1: 'Browser test' } } },
    select: { id: true },
  });
  const ids = previous.map((order) => order.id);
  if (ids.length) {
    if (await prisma.factoryDispatch.count({ where: { saleOrderId: { in: ids } } }))
      throw new Error('Browser fixture unexpectedly dispatched');
    await prisma.$transaction(async (tx) => {
      await tx.stockAllocation.deleteMany({
        where: { saleOrderLine: { saleOrderId: { in: ids } } },
      });
      await tx.saleOrderLine.deleteMany({ where: { saleOrderId: { in: ids } } });
      await tx.saleOrderDestination.deleteMany({ where: { saleOrderId: { in: ids } } });
      await tx.saleOrderDistributor.deleteMany({ where: { saleOrderId: { in: ids } } });
      await tx.saleOrder.deleteMany({ where: { id: { in: ids } } });
    });
  }
} finally {
  await prisma.$disconnect();
}
