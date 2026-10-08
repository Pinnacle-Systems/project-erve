import { z } from 'zod';

export const createTaxInvoiceDraftSchema = z.object({
  ervePackingListId: z.string().trim().min(1, 'ervePackingListId is required'),
});

export const TAX_INVOICE_LIST_DEFAULT_LIMIT = 25;
export const TAX_INVOICE_LIST_MAX_LIMIT = 100;

export const listTaxInvoicesQuerySchema = z.object({
  distributorId: z.string().trim().min(1).optional(),
  status: z.enum(['DRAFT', 'FINALIZED']).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(TAX_INVOICE_LIST_MAX_LIMIT).default(TAX_INVOICE_LIST_DEFAULT_LIMIT),
});
