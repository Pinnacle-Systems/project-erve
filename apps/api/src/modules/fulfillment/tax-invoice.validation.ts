import { z } from 'zod';

export const createTaxInvoiceDraftSchema = z.object({
  ervePackingListId: z.string().trim().min(1, 'ervePackingListId is required'),
});

// INV-006 override rate: follows this repo's existing Decimal-input
// convention (z.coerce.number(), e.g. price-lists.validation.ts'
// percentageOfMrp) rather than a parallel string-based transport.
//
// Input precision is deliberately capped at 2 decimal places — the
// approved spec (§1.3) is explicit: "The future UI is expected to accept
// normal currency entry to two decimal places, while stored calculated
// rates must retain six-decimal precision." An Accountant types a rupee
// amount the normal way (e.g. 2600.00); the Decimal(20,6) column exists so
// the SYSTEM's own calculated rate (frozen MRP x frozen % / 100) never
// loses precision, not so a human can type 6 decimals. Rejecting anything
// with more than 2 decimal places (rather than silently rounding it) keeps
// this distinction explicit, per "never silently round an individual
// rate" (§2.2/§1.6).
function countDecimalPlaces(value: number): number {
  const text = value.toString();
  if (text.includes('e') || text.includes('E')) return Number.POSITIVE_INFINITY;
  const dotIndex = text.indexOf('.');
  return dotIndex === -1 ? 0 : text.length - dotIndex - 1;
}

export const OVERRIDE_UNIT_RATE_MAX_DECIMAL_PLACES = 2;

export const overrideTaxInvoiceLineRateSchema = z.object({
  overrideUnitRate: z.coerce
    .number()
    .finite('Enter a valid monetary rate')
    .positive('Override rate must be greater than zero')
    .refine(
      (value) => countDecimalPlaces(value) <= OVERRIDE_UNIT_RATE_MAX_DECIMAL_PLACES,
      `Override rate supports at most ${OVERRIDE_UNIT_RATE_MAX_DECIMAL_PLACES} decimal places — enter a normal currency amount`,
    ),
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
