import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../../apps/api/src/db/prisma.js';
import { createReleasedQaStock } from '../../apps/api/src/test/helpers.js';

const target = new URL(process.env.DATABASE_URL!);
if (
  target.hostname !== '127.0.0.1' ||
  target.port !== '55451' ||
  target.pathname !== '/erve_batch10_lookup10_test'
)
  throw new Error('Unverified browser seed target');
try {
  const stock = await createReleasedQaStock({ quantity: 10 });
  const styles = [{ id: stock.styleId, styleNumber: `BROWSER-${stock.styleId}-00` }];
  await prisma.style.update({
    where: { id: stock.styleId },
    data: { styleNumber: styles[0]!.styleNumber },
  });
  for (let i = 1; i < 29; i++) {
    const next = await createReleasedQaStock({ factoryId: stock.factoryId, quantity: 10 });
    const styleNumber = `BROWSER-${stock.styleId}-${String(i).padStart(2, '0')}`;
    await prisma.style.update({ where: { id: next.styleId }, data: { styleNumber } });
    styles.push({ id: next.styleId, styleNumber });
  }
  const other = await createReleasedQaStock({ styleId: styles.at(-1)!.id, quantity: 5 });
  const output = path.resolve('.data/lookup10/lookup10-browser-fixtures.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(
    output,
    JSON.stringify(
      {
        factory: await prisma.factory.findUniqueOrThrow({ where: { id: stock.factoryId } }),
        otherFactoryId: other.factoryId,
        distributorId: stock.distributorId,
        styles: styles.slice(0, 2),
      },
      null,
      2,
    ),
  );
} finally {
  await prisma.$disconnect();
}
