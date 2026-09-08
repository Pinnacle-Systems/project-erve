import { z } from 'zod';

// Business-level only — no stockAllocationId: the Factory records packed
// quantity against a Dispatch Order line, never selecting a
// StockAllocation/QaReleaseLine/Job Order (see recordFactoryPacking).
export const recordPackingLineInputSchema = z.object({
  saleOrderLineId: z.string().trim().min(1),
  packedQuantity: z.number().int().positive(),
});

export const recordPackingSchema = z.object({
  saleOrderId: z.string().trim().min(1),
  lines: z.array(recordPackingLineInputSchema).min(1, 'At least one line is required'),
});

export const versionedActionSchema = z.object({ expectedVersion: z.number().int().nonnegative() });

export const createCartonSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  cartonNumber: z.string().trim().min(1).max(100),
  packageDetails: z.string().trim().max(500).optional().nullable(),
  weight: z.number().positive().max(99999.999).optional().nullable(),
  lines: z
    .array(
      z.object({
        factoryDispatchLineId: z.string().trim().min(1),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1, 'A carton must contain at least one line'),
});

export const listFactoryDispatchesQuerySchema = z.object({
  status: z.enum(['DRAFT', 'READY_FOR_ERVE']).optional(),
  saleOrderId: z.string().trim().optional(),
  factoryId: z.string().trim().optional(),
  unconsolidatedOnly: z.coerce.boolean().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const packingQueueQuerySchema = z.object({ factoryId: z.string().trim().optional() });
