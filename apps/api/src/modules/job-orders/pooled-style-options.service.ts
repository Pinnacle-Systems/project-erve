import { z } from 'zod';
import type { PooledInventoryStyleOption, PooledInventoryStylePage } from '@erve/types';
import { Prisma, prisma } from '../../db/prisma.js';
import { HttpError } from '../../errors/http-error.js';
import {
  stylePrimaryImageInclude,
  toPrimaryImageView,
} from '../master-data/style-images.service.js';

const entityId = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/);
export const pooledStyleOptionsQuerySchema = z.object({
  factoryId: entityId,
  search: z.string().max(1000).trim().max(200).default(''),
  excludeSaleOrderId: entityId.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(4096).optional(),
});
type Filters = z.infer<typeof pooledStyleOptionsQuerySchema>;
const cursorSchema = z.strictObject({
  v: z.literal(1),
  factoryId: entityId,
  search: z.string().max(200),
  excludeSaleOrderId: entityId.nullable(),
  styleNumber: z.string().max(1000),
  styleId: entityId,
});

// A cursor is a position in a live inventory view, not a stock reservation or
// snapshot. Inventory changes can add/remove candidates between pages; submit
// always performs fresh authoritative allocation validation.
export async function getPooledInventoryStyleOptions(
  client: Prisma.TransactionClient | typeof prisma,
  filters: Filters,
): Promise<PooledInventoryStylePage> {
  const context = {
    v: 1 as const,
    factoryId: filters.factoryId,
    search: filters.search.toLowerCase(),
    excludeSaleOrderId: filters.excludeSaleOrderId ?? null,
  };
  let after = Prisma.empty;
  if (filters.cursor) {
    try {
      const decoded = Buffer.from(filters.cursor, 'base64url');
      if (decoded.toString('base64url') !== filters.cursor) throw new Error('Invalid encoding');
      const cursor = cursorSchema.parse(JSON.parse(decoded.toString('utf8')));
      if (
        cursor.factoryId !== context.factoryId ||
        cursor.search !== context.search ||
        cursor.excludeSaleOrderId !== context.excludeSaleOrderId
      )
        throw new Error('Mismatched context');
      after = Prisma.sql`AND (s.style_number, s.id) > (${cursor.styleNumber}, ${cursor.styleId})`;
    } catch {
      throw HttpError.badRequest('Invalid or mismatched Style lookup cursor');
    }
  }
  // Escape LIKE metacharacters so search is a literal substring. All values,
  // including cursor and limit, remain bound Prisma.sql parameters.
  const pattern = `%${context.search.replace(/[\\%_]/g, '\\$&')}%`;
  const search = context.search
    ? Prisma.sql`AND (s.style_number ILIKE ${pattern} OR s.lmix_number ILIKE ${pattern} OR s.style_name ILIKE ${pattern})`
    : Prisma.empty;
  const ownJoin = filters.excludeSaleOrderId
    ? Prisma.sql`JOIN sale_order_lines sol ON sol.id = sa.sale_order_line_id`
    : Prisma.empty;
  const ownQuantity = filters.excludeSaleOrderId
    ? Prisma.sql`COALESCE(SUM(sa.quantity) FILTER (WHERE sol.sale_order_id = ${filters.excludeSaleOrderId}), 0)`
    : Prisma.sql`0::bigint`;
  // Deliberately mirrors PR #171: independently sum releases and ACTIVE
  // commitments per Style/Size before joining; positive *Size* availability
  // determines eligibility. Never cap release rows or pool rows before this.
  const rows = await client.$queryRaw<
    Omit<PooledInventoryStyleOption, 'primaryImage'>[]
  >(Prisma.sql`
    WITH filtered_releases AS MATERIALIZED (
      SELECT qrl.id, qrl.quantity, jol.style_id, jols.size_id
      FROM qa_release_lines qrl
      JOIN job_order_line_sizes jols ON jols.id = qrl.job_order_line_size_id
      JOIN job_order_lines jol ON jol.id = jols.job_order_line_id
      JOIN job_orders jo ON jo.id = jol.job_order_id
      JOIN styles s ON s.id = jol.style_id
      WHERE jo.factory_id = ${filters.factoryId} ${search}
    ), released AS (
      SELECT style_id, size_id, SUM(quantity) AS quantity
      FROM filtered_releases GROUP BY style_id, size_id
    ), committed AS (
      SELECT fr.style_id, fr.size_id, SUM(sa.quantity) AS quantity, ${ownQuantity} AS own_quantity
      FROM filtered_releases fr
      JOIN stock_allocations sa ON sa.qa_release_line_id = fr.id AND sa.status = 'ACTIVE'
      ${ownJoin}
      GROUP BY fr.style_id, fr.size_id
    ), eligible AS (
      SELECT DISTINCT r.style_id FROM released r
      LEFT JOIN committed c USING (style_id, size_id)
      WHERE r.quantity - COALESCE(c.quantity, 0) + COALESCE(c.own_quantity, 0) > 0
    )
    SELECT s.id AS "styleId", s.style_number AS "styleNumber", s.style_name AS "styleName", s.lmix_number AS "lmixNumber"
    FROM eligible e JOIN styles s ON s.id = e.style_id
    WHERE TRUE ${after}
    ORDER BY s.style_number ASC, s.id ASC LIMIT ${filters.limit + 1}
  `);
  const hasMore = rows.length > filters.limit;
  const page = rows.slice(0, filters.limit);
  const images = page.length
    ? await client.style.findMany({
        where: { id: { in: page.map((s) => s.styleId) } },
        select: { id: true, images: stylePrimaryImageInclude },
      })
    : [];
  const byId = new Map(images.map((s) => [s.id, toPrimaryImageView(s.images)]));
  const last = page.at(-1);
  return {
    items: page.map((s) => ({ ...s, primaryImage: byId.get(s.styleId) ?? null })),
    pageInfo: {
      limit: filters.limit,
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({ ...context, styleNumber: last.styleNumber, styleId: last.styleId }),
            ).toString('base64url')
          : null,
    },
  };
}
