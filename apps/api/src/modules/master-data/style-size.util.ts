import { Prisma, prisma } from '../../db/prisma.js';

type Client = Prisma.TransactionClient | typeof prisma;

// The single authoritative rule for "is this size currently valid for this
// Style": both the StyleSize mapping's own status AND the underlying Size's
// own global status must be ACTIVE. Shared by purchase-orders.service.ts
// (Order Sheet line sizes) and job-orders.service.ts (Job Order production
// plan sizes) so the two never drift apart.
export async function getActiveStyleSizeIds(client: Client, styleId: string): Promise<Set<string>> {
  const styleSizes = await client.styleSize.findMany({
    where: { styleId, status: 'ACTIVE', size: { status: 'ACTIVE' } },
    select: { sizeId: true },
  });
  return new Set(styleSizes.map((styleSize) => styleSize.sizeId));
}
