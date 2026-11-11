import { z } from 'zod';

const id = z.string().trim().min(1).max(200);
const purchaseMode = z.enum(['SALE_RETURN', 'OUTRIGHT']);
/** `S:<retailStoreId>` (mapped Store) or `D:<saleOrderDestinationId>` (unmapped historical destination). */
export const storeKeySchema = z
  .string()
  .trim()
  .regex(/^[SD]:[A-Za-z0-9_-]{1,100}$/, 'Invalid store key');

export const listRetailStoreInventoryQuerySchema = z.object({
  // Required for a Distributor-scoped user's own data only implicitly: the
  // service forces a DISTRIBUTOR to its single mapped Distributor.
  distributorId: id.optional(),
  purchaseMode: purchaseMode.optional(),
  /** Retail Store name or code. */
  store: z.string().trim().min(1).max(100).optional(),
  /** Exact stable Store key, as returned by this API. */
  storeKey: storeKeySchema.optional(),
  /** Style number or name. */
  style: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ListRetailStoreInventoryQuery = z.infer<typeof listRetailStoreInventoryQuerySchema>;

export const listRetailStoreInventorySourcesQuerySchema = z.object({
  distributorId: id.optional(),
  storeKey: storeKeySchema,
  styleId: id,
  sizeId: id.optional(),
  purchaseMode,
  cursor: z.string().trim().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListRetailStoreInventorySourcesQuery = z.infer<
  typeof listRetailStoreInventorySourcesQuerySchema
>;

export const storeCursorSchema = z.object({
  distributorSort: z.string(),
  distributorId: z.string().min(1),
  storeSort: z.string(),
  storeKey: z.string().min(1),
});

export const sourceCursorSchema = z.object({
  dispatchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dispatchId: z.string().min(1),
  saleOrderLineId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// ISS-089 — Store-level FIFO actions. The Distributor is never asked for a Dispatch id.
// ---------------------------------------------------------------------------

const isoDate = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const storeFifoAvailabilityQuerySchema = z.object({
  storeKey: storeKeySchema,
  styleId: id,
  sizeId: id,
  date: isoDate,
});

const storeFifoBase = {
  storeKey: storeKeySchema,
  styleId: id,
  sizeId: id,
  quantity: z.number().int().positive().max(1_000_000),
  remarks: z.string().trim().max(1000).optional().nullable(),
};

export const storeFifoSalesReportSchema = z.object({ ...storeFifoBase, reportDate: isoDate });

export const storeFifoReturnSchema = z.object({
  ...storeFifoBase,
  returnDate: isoDate,
  returnReason: z.string().trim().min(1, 'A return reason is required').max(1000),
});

export const storeFifoIdempotencyKeySchema = z
  .string({ error: 'Idempotency-Key header is required' })
  .trim()
  .min(8, 'Idempotency-Key must be at least 8 characters')
  .max(200, 'Idempotency-Key must be at most 200 characters');
