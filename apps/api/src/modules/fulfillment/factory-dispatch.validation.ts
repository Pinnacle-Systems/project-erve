import { z } from 'zod';
import { queryBooleanSchema } from '../../utils/query-boolean.js';

export const versionedActionSchema = z.object({ expectedVersion: z.number().int().nonnegative() });

// Business-level only — no stockAllocationId/factoryDispatchLineId: the
// Factory records physical carton contents against a Dispatch Order line
// directly, never selecting a StockAllocation/QaReleaseLine/Job Order.
export const cartonLineInputSchema = z.object({
  saleOrderLineId: z.string().trim().min(1),
  quantity: z.number().int().positive(),
});

// Carton create takes no version param — the FactoryDispatch packing root
// may not exist yet at all; correctness comes from lock ordering, not
// client-supplied CAS (see the Phase 4 plan §2).
export const createCartonSchema = z.object({
  cartonNumber: z.string().trim().min(1).max(100),
  destinationId: z.string().trim().min(1),
  packageDetails: z.string().trim().max(500).optional().nullable(),
  weight: z.number().positive().max(99999.999).optional().nullable(),
  lines: z.array(cartonLineInputSchema).min(1, 'A carton must contain at least one line'),
});

// Desired-state carton update — CAS via the carton's own expectedVersion
// (never the FactoryDispatch's).
export const updateCartonSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  destinationId: z.string().trim().min(1),
  packageDetails: z.string().trim().max(500).optional().nullable(),
  weight: z.number().positive().max(99999.999).optional().nullable(),
  lines: z.array(cartonLineInputSchema).min(1, 'A carton must contain at least one line'),
});

export const confirmCartonAuditSchema = z.object({
  remarks: z.string().trim().max(1000).optional().nullable(),
});

export const listFactoryDispatchesQuerySchema = z.object({
  status: z.enum(['DRAFT', 'READY_FOR_ERVE']).optional(),
  saleOrderId: z.string().trim().optional(),
  factoryId: z.string().trim().optional(),
  // API-P2-01: z.coerce.boolean() calls Boolean(value) on the raw query
  // string, so ?unconsolidatedOnly=false coerced to true — see
  // utils/query-boolean.ts.
  unconsolidatedOnly: queryBooleanSchema.optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const packingQueueQuerySchema = z.object({ factoryId: z.string().trim().optional() });

export const packingAuditQueueQuerySchema = z.object({
  factoryId: z.string().trim().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
