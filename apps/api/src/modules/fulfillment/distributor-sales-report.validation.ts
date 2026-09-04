import { z } from 'zod';

export const listSaleOrReturnPositionsQuerySchema = z.object({
  distributorId: z.string().trim().optional(),
  onlyWithRemaining: z.coerce.boolean().optional(),
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
