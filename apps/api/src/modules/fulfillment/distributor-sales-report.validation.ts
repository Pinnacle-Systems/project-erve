import { z } from 'zod';
import { queryBooleanSchema } from '../../utils/query-boolean.js';

export const listSaleOrReturnPositionsQuerySchema = z.object({
  distributorId: z.string().trim().optional(),
  // RPT1 6.11: was z.coerce.boolean(), which reads ?onlyWithRemaining=false
  // as true (Boolean('false') === true) — every non-empty query string
  // coerces truthy.
  onlyWithRemaining: queryBooleanSchema.optional(),
});

export const listDistributorSalesReportsQuerySchema = z.object({
  distributorId: z.string().trim().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const submitDistributorSalesReportSchema = z.object({
  distributorId: z.string().trim().min(1),
  reportDate: z.string().trim().min(1),
  remarks: z.string().trim().max(1000).optional().nullable(),
  lines: z
    .array(
      z.object({
        erveDispatchId: z.string().trim().min(1),
        saleOrderLineId: z.string().trim().min(1),
        quantitySold: z.number().int().positive(),
      }),
    )
    .min(1, 'A sales report must have at least one line'),
});
