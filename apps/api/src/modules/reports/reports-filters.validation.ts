import { z } from 'zod';

// RPT0 4.1/4.2 — shared reporting filter primitives. No endpoint is required
// to support every field: each report composes its own `z.object({...})`
// picking the subset of these it actually documents as supported, rather
// than sharing one all-fields schema every report must partially ignore.

/**
 * A reporting query's Record Origin filter (RPT0 2.2). `ALL` means "no
 * origin filter, include both" — distinct from the two persisted
 * `RecordOrigin` enum values a Job Order itself can carry.
 */
export const reportRecordOriginSchema = z.enum(['LIVE_WORKFLOW', 'HISTORICAL_IMPORT', 'ALL']);

export const reportPurchaseModeSchema = z.enum(['OUTRIGHT', 'SALE_RETURN']);

export const reportFilterFields = {
  financialYearId: z.string().trim().min(1).optional(),
  fromDate: z.string().trim().min(1).optional(),
  toDate: z.string().trim().min(1).optional(),
  seasonId: z.string().trim().min(1).optional(),
  factoryId: z.string().trim().min(1).optional(),
  distributorId: z.string().trim().min(1).optional(),
  styleId: z.string().trim().min(1).optional(),
  purchaseMode: reportPurchaseModeSchema.optional(),
  recordOrigin: reportRecordOriginSchema.optional(),
} as const;
