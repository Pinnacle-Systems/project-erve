import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';

// Domain-level deterministic resolver, kept free of HTTP/UI concerns so a
// later invoicing story (INV-004) can call it directly. Pricing is
// Distributor-wide (one percentage of MRP applies to every Style) and
// strictly distributor-specific: there is deliberately no fallback to
// another distributor's pricing or to any generic percentage.

export interface DistributorPricingLookupInput {
  distributorId: string;
  /** Transaction/pricing date. Strings must be YYYY-MM-DD. */
  date: Date | string;
}

export type DistributorPricingMissReason = 'NO_ACTIVE_PRICE_LIST';

export type DistributorPricingResult =
  | {
      found: true;
      priceListId: string;
      priceListCode: string;
      distributorId: string;
      percentageOfMrp: number;
      effectiveFrom: string;
      effectiveTo: string | null;
    }
  | { found: false; reason: DistributorPricingMissReason };

export function toDateOnly(value: Date | string): Date {
  // Normalizes to UTC midnight, matching how Postgres `date` columns round-trip
  // through the Prisma client.
  const date = typeof value === 'string' ? new Date(`${value}T00:00:00.000Z`) : value;
  if (Number.isNaN(date.getTime())) {
    throw HttpError.badRequest('Invalid date');
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

export function toDateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function resolveDistributorPricing(
  input: DistributorPricingLookupInput,
): Promise<DistributorPricingResult> {
  const date = toDateOnly(input.date);

  const distributor = await prisma.distributor.findUnique({ where: { id: input.distributorId } });
  if (!distributor) {
    throw HttpError.badRequest('Unknown distributor');
  }
  if (distributor.status !== 'ACTIVE') {
    throw HttpError.badRequest('Distributor is not active');
  }

  const applicableLists = await prisma.priceList.findMany({
    where: {
      distributorId: input.distributorId,
      status: 'ACTIVE',
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
  });

  if (applicableLists.length === 0) {
    return { found: false, reason: 'NO_ACTIVE_PRICE_LIST' };
  }

  // The price_lists_no_overlapping_active_periods exclusion constraint makes
  // this unreachable, but pricing must fail loudly rather than pick one of
  // two matches if that invariant is ever broken.
  if (applicableLists.length > 1) {
    throw HttpError.conflict(
      'Multiple active price lists cover this date for the distributor; pricing is ambiguous',
    );
  }

  const priceList = applicableLists[0]!;

  return {
    found: true,
    priceListId: priceList.id,
    priceListCode: priceList.code,
    distributorId: priceList.distributorId,
    percentageOfMrp: priceList.percentageOfMrp.toNumber(),
    effectiveFrom: toDateOnlyString(priceList.effectiveFrom!),
    effectiveTo: priceList.effectiveTo ? toDateOnlyString(priceList.effectiveTo) : null,
  };
}
