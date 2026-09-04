import { z } from 'zod';

export const listInvoiceHandoffsQuerySchema = z.object({
  status: z.enum(['PENDING_TALLY', 'INVOICED']).optional(),
  distributorId: z.string().trim().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const recordTallyInvoiceReferenceSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  tallyInvoiceNumber: z.string().trim().min(1).max(100),
  tallyInvoiceDate: z.string().trim().min(1),
  tallyVoucherReference: z.string().trim().max(200).optional().nullable(),
  remarks: z.string().trim().max(1000).optional().nullable(),
});
