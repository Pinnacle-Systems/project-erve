import type { Prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import type {
  DispatchOrderDestinationInput,
  DispatchOrderDistributorGroupInput,
} from './sale-orders.service.js';

interface ExistingDestination {
  id: string;
  retailStoreId: string | null;
  storeCode: string | null;
  distributorId: string;
}

// Only a new reference captures master values. An ordinary round-trip of an
// existing Store keeps its historical snapshot, including an inactive Store.
export async function resolveRetailStoreSnapshots(
  tx: Prisma.TransactionClient,
  groups: DispatchOrderDistributorGroupInput[],
  destinations: Array<DispatchOrderDestinationInput & { groupClientKey: string }>,
  existing: ExistingDestination[] = [],
): Promise<void> {
  const originalById = new Map(existing.map((d) => [d.id, d]));
  const ownerByKey = new Map(groups.map((g) => [g.clientKey, g.distributorId]));
  const storeIds = destinations
    .map((d) => d.retailStoreId ?? (d.id ? originalById.get(d.id)?.retailStoreId : null))
    .filter((id): id is string => Boolean(id));
  // Same lock as master edits/status changes, sorted to avoid deadlocks.
  for (const id of [...new Set(storeIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`retail-store-${id}`}))`;
  }
  const stores = new Map(
    (await tx.retailStore.findMany({ where: { id: { in: storeIds } } })).map((s) => [s.id, s]),
  );
  for (const d of destinations) {
    const old = d.id ? originalById.get(d.id) : undefined;
    const storeId = d.retailStoreId === undefined ? (old?.retailStoreId ?? null) : d.retailStoreId;
    d.retailStoreId = storeId;
    d.storeCode = null;
    if (!storeId) continue; // Legacy/manual destination: never match by text.
    const store = stores.get(storeId);
    if (!store) throw HttpError.badRequest('Retail Store not found');
    const distributorId = ownerByKey.get(d.groupClientKey);
    if (store.distributorId !== distributorId)
      throw HttpError.badRequest('Retail Store does not belong to this Distributor');
    if (
      old?.retailStoreId === storeId &&
      old.distributorId === distributorId &&
      !d.refreshStoreSnapshot
    ) {
      d.storeCode = old.storeCode;
      continue;
    }
    if (store.status !== 'ACTIVE')
      throw HttpError.badRequest('Inactive Retail Stores cannot be selected for new destinations');
    Object.assign(d, {
      storeCode: store.code,
      label: store.name,
      addressLine1: store.addressLine1,
      addressLine2: store.addressLine2,
      city: store.city,
      state: store.state,
      country: store.country,
      postalCode: store.postalCode,
      contactName: store.contactName,
      contactEmail: store.contactEmail,
      contactPhone: store.contactPhone,
      gstin: store.gstin,
    });
  }
}
