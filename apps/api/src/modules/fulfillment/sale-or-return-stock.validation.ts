import { z } from 'zod';
import { sourceCursorSchema, storeKeySchema } from './retail-store-inventory.validation.js';

const id = z.string().trim().min(1).max(200);

export const stockStyleParamsSchema = z.object({ styleId: id });

export const listStockStylesQuerySchema = z.object({
  /** Internal viewers only; a Distributor is pinned server-side and may only name itself. */
  distributorId: id.optional(),
  /** Style number or name. */
  style: z.string().trim().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListStockStylesQuery = z.infer<typeof listStockStylesQuerySchema>;

export const stockStyleScopeQuerySchema = z.object({ distributorId: id.optional() });
export type StockStyleScopeQuery = z.infer<typeof stockStyleScopeQuerySchema>;

export const listStockStyleSourcesQuerySchema = z.object({
  distributorId: id.optional(),
  storeKey: storeKeySchema.optional(),
  sizeId: id.optional(),
  cursor: z.string().trim().min(1).max(1000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListStockStyleSourcesQuery = z.infer<typeof listStockStyleSourcesQuerySchema>;

export const styleCursorSchema = z.object({
  styleSort: z.string(),
  styleId: z.string().min(1),
});

export { sourceCursorSchema };
