import { z } from 'zod';
import type { PaginatedResponse } from '@erve/types';

// Opt-in cursor pagination for list endpoints that historically returned a
// plain full array (the master lists). Same wire contract as the
// transaction lists — ?cursor=<id>&limit=<n> → { items, pageInfo } — but
// only when the caller asks for it: without `cursor` and `limit` the
// endpoint keeps returning the full array, so existing consumers are not
// broken while they migrate. New list pages must always use paginated mode.
export const MASTER_LIST_DEFAULT_LIMIT = 25;
export const MASTER_LIST_MAX_LIMIT = 100;

export const optionalPageQueryFields = {
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MASTER_LIST_MAX_LIMIT).optional(),
};

export interface OptionalPageQuery {
  cursor?: string;
  limit?: number;
}

export interface PageArgs {
  take?: number;
  cursor?: { id: string };
  skip?: number;
}

// Runs `find` either once for the full legacy array, or for one page
// (take limit + 1 to detect hasMore, resuming after the cursor row). The
// caller's orderBy must end in a unique tie-breaker (id) so pages can
// never skip or repeat rows.
export async function listAllOrPage<T extends { id: string }>(
  query: OptionalPageQuery,
  find: (args: PageArgs) => Promise<T[]>,
): Promise<T[] | PaginatedResponse<T>> {
  if (query.cursor === undefined && query.limit === undefined) {
    return find({});
  }
  const limit = query.limit ?? MASTER_LIST_DEFAULT_LIMIT;
  const rows = await find({
    take: limit + 1,
    cursor: query.cursor ? { id: query.cursor } : undefined,
    skip: query.cursor ? 1 : undefined,
  });
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, pageInfo: { limit, hasMore, nextCursor: hasMore ? items.at(-1)!.id : null } };
}
