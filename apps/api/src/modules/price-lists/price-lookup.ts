import { prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';

// Domain-level deterministic price lookup, kept free of HTTP/UI concerns so
// future sale-order and invoicing services can call it directly. Pricing is
// style-level (the approved product dimension of PriceListLine) and strictly
// distributor-specific: there is deliberately no fallback to another
// distributor's list or to any generic price.

export interface PriceLookupInput {
  distributorId: string;
  styleId: string;
  /** Transaction/pricing date. Strings must be YYYY-MM-DD. */
  date: Date | string;
}

export type PriceLookupMissReason = 'NO_ACTIVE_PRICE_LIST' | 'STYLE_NOT_PRICED';

export type PriceLookupResult =
  | {
      found: true;
      unitPrice: number;
      currency: string;
      priceListId: string;
      priceListCode: string;
      priceListLineId: string;
      effectiveFrom: string;
      effectiveTo: string | null;
    }
  | { found: false; reason: PriceLookupMissReason };

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

export async function lookupDistributorPrice(input: PriceLookupInput): Promise<PriceLookupResult> {
  const date = toDateOnly(input.date);

  const [distributor, style] = await Promise.all([
    prisma.distributor.findUnique({ where: { id: input.distributorId } }),
    prisma.style.findUnique({ where: { id: input.styleId } }),
  ]);

  if (!distributor) {
    throw HttpError.badRequest('Unknown distributor');
  }
  if (distributor.status !== 'ACTIVE') {
    throw HttpError.badRequest('Distributor is not active');
  }
  if (!style) {
    throw HttpError.badRequest('Unknown style');
  }
  if (style.status !== 'ACTIVE') {
    throw HttpError.badRequest(`Style ${style.styleNumber} is not active`);
  }

  const applicableLists = await prisma.priceList.findMany({
    where: {
      distributorId: input.distributorId,
      status: 'ACTIVE',
      effectiveFrom: { lte: date },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
    },
    include: { lines: { where: { styleId: input.styleId } } },
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
  const line = priceList.lines[0];
  if (!line) {
    return { found: false, reason: 'STYLE_NOT_PRICED' };
  }

  return {
    found: true,
    unitPrice: line.unitPrice.toNumber(),
    currency: line.currency,
    priceListId: priceList.id,
    priceListCode: priceList.code,
    priceListLineId: line.id,
    effectiveFrom: toDateOnlyString(priceList.effectiveFrom!),
    effectiveTo: priceList.effectiveTo ? toDateOnlyString(priceList.effectiveTo) : null,
  };
}
