import { z } from 'zod';

// Matches StyleFactoryMapping.exFactoryPrice's own validation
// (master-data.validation.ts) — a unit rate follows the same master-data
// rule rather than a stricter one invented for this module.
const positiveMoney = z.coerce.number().positive();
// GST is additive-only in this phase (see factory-invoice.service.ts) —
// zero is a valid "no GST configured yet" state, so this allows it.
const nonNegativeMoney = z.coerce.number().nonnegative();

export const confirmFactoryInvoiceSchema = z.object({}).strict();

export const updateFactoryInvoiceFinancialsSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    lines: z
      .array(
        z.object({
          id: z.string().trim().min(1),
          unitRate: positiveMoney,
        }),
      )
      .optional(),
    gstAmount: nonNegativeMoney.optional(),
    remarks: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

export const listFactoryInvoicesQuerySchema = z.object({
  status: z.enum(['GENERATED', 'FACTORY_CONFIRMED', 'FINALIZED']).optional(),
  factoryId: z.string().trim().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
