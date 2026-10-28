import { createHash } from 'node:crypto';
import { Prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';

export const ELIGIBLE_CARTON_SCAN_BUDGET = 200;

export interface EligibleCartonPosition {
  id: string;
  createdAt: Date;
}

// ISS-100: identity is the linked Retail Store alone — see
// erve-dispatch.service.ts destinationIdentityKeyOf.
export interface EligibleCartonCandidate extends EligibleCartonPosition {
  retailStoreId: string | null;
}

export function eligibleCartonContext(filters: {
  ervePackingListId?: string;
  search: string;
  distributorId?: string;
  matchKey?: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        filters.ervePackingListId ?? null,
        filters.search,
        filters.distributorId ?? null,
        filters.matchKey ?? null,
      ]),
    )
    .digest('hex');
}

export function encodeEligibleCartonCursor(
  position: EligibleCartonPosition,
  context: string,
): string {
  return Buffer.from(
    JSON.stringify({ v: 1, at: position.createdAt.toISOString(), id: position.id, context }),
  ).toString('base64url');
}

export function decodeEligibleCartonCursor(
  cursor: string,
  context: string,
): EligibleCartonPosition {
  try {
    if (cursor.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error();
    const buffer = Buffer.from(cursor, 'base64url');
    if (buffer.toString('base64url') !== cursor) throw new Error();
    const value: unknown = JSON.parse(buffer.toString('utf8'));
    if (!value || typeof value !== 'object') throw new Error();
    const v = value as Record<string, unknown>;
    if (
      v.v !== 1 ||
      v.context !== context ||
      typeof v.id !== 'string' ||
      !v.id.trim() ||
      v.id.length > 256 ||
      typeof v.at !== 'string'
    )
      throw new Error();
    const createdAt = new Date(v.at);
    if (!Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== v.at)
      throw new Error();
    return { id: v.id, createdAt };
  } catch {
    throw HttpError.badRequest(
      'Invalid eligible-carton cursor or cursor does not match the current filters',
    );
  }
}

/** Shared with the disposable benchmark so EXPLAIN measures the actual candidate query. */
export function eligibleCartonCandidateQuery(filters: {
  search: string;
  distributorId?: string;
  position?: EligibleCartonPosition;
}): Prisma.Sql {
  const pattern = `%${filters.search.replace(/[\\%_]/g, '\\$&')}%`;
  return Prisma.sql`
    SELECT c.id, c.created_at AS "createdAt",
      d.retail_store_id AS "retailStoreId"
    FROM factory_packing_cartons c
    JOIN factory_dispatches fd ON fd.id = c.factory_dispatch_id
    JOIN sale_orders so ON so.id = fd.sale_order_id
    JOIN sale_order_destinations d ON d.id = c.destination_id
    JOIN sale_order_distributors dg ON dg.id = d.sale_order_distributor_id
    WHERE c.retired_at IS NULL AND c.erve_packing_list_id IS NULL
      AND fd.status = 'READY_FOR_ERVE'
      AND EXISTS (SELECT 1 FROM factory_packing_carton_lines l WHERE l.carton_id = c.id)
      AND (SELECT MAX(a.carton_version) FROM factory_packing_carton_audits a WHERE a.carton_id = c.id) = c.version
      ${filters.distributorId ? Prisma.sql`AND dg.distributor_id = ${filters.distributorId}` : Prisma.empty}
      ${
        filters.search
          ? Prisma.sql`AND (
        c.carton_number ILIKE ${pattern} ESCAPE '\\'
        OR fd.factory_dispatch_number ILIKE ${pattern} ESCAPE '\\'
        OR so.sale_order_number ILIKE ${pattern} ESCAPE '\\'
      )`
          : Prisma.empty
      }
      ${filters.position ? Prisma.sql`AND (c.created_at, c.id) > (${filters.position.createdAt}, ${filters.position.id})` : Prisma.empty}
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT ${ELIGIBLE_CARTON_SCAN_BUDGET + 1}
  `;
}
