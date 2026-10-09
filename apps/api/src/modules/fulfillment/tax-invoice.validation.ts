import { z } from 'zod';

export const createTaxInvoiceDraftSchema = z.object({
  ervePackingListId: z.string().trim().min(1, 'ervePackingListId is required'),
});

// INV-006 override rate: follows this repo's existing Decimal-input
// convention (z.coerce.number(), e.g. price-lists.validation.ts'
// percentageOfMrp) rather than a parallel string-based transport, plus an
// explicit decimal-place check — the rate column is Decimal(20,6), and
// silently truncating extra digits would violate "never silently round an
// individual rate" (INV-006 §2.2/§1.6).
function countDecimalPlaces(value: number): number {
  const text = value.toString();
  if (text.includes('e') || text.includes('E')) return Number.POSITIVE_INFINITY;
  const dotIndex = text.indexOf('.');
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}

export const overrideTaxInvoiceLineRateSchema = z.object({
  overrideUnitRate: z.coerce
    .number()
    .finite('Enter a valid monetary rate')
    .positive('Override rate must be greater than zero')
    .refine((value) => countDecimalPlaces(value) <= 6, 'Override rate supports at most 6 decimal places'),
  reason: z.string().trim().min(1, 'A reason is required for a rate override'),
});

export const TAX_INVOICE_LIST_DEFAULT_LIMIT = 25;
export const TAX_INVOICE_LIST_MAX_LIMIT = 100;

export const listTaxInvoicesQuerySchema = z.object({
  distributorId: z.string().trim().min(1).optional(),
  status: z.enum(['DRAFT', 'FINALIZED']).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(TAX_INVOICE_LIST_MAX_LIMIT).default(TAX_INVOICE_LIST_DEFAULT_LIMIT),
});
