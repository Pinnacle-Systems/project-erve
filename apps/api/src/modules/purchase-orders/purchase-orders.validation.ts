import { z } from 'zod';

// Purchase Mode is no longer client-supplied on the Order Sheet — it is
// derived server-side from Distributor.purchaseMode (see
// purchase-orders.service.ts). purchaseModeSchema itself is retained only
// because purchaseOrderStatusSchema/PurchaseMode enum values below are still
// read (e.g. list/detail responses); no create/update schema accepts it.
export const purchaseModeSchema = z.enum(['OUTRIGHT', 'SALE_RETURN']);
export const purchaseOrderStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'PARTIALLY_JOB_ORDERED',
  'FULLY_JOB_ORDERED',
  'PARTIALLY_FULFILLED',
  'FULLY_FULFILLED',
  'CLOSED',
  'CANCELLED',
]);

const lineSizeSchema = z.object({
  sizeId: z.string().trim().min(1),
  orderedQuantity: z.number().int().positive(),
});

const lineSchema = z.object({
  styleId: z.string().trim().min(1),
  remarks: z.string().trim().optional().nullable(),
  sizes: z.array(lineSizeSchema).min(1, 'Each line must have at least one size'),
});

// An Order Sheet is exactly one Style: exactly one line, never zero, never
// more than one. purchaseMode is never accepted here — it is always derived
// server-side from the selected Distributor's (locked) purchaseMode.
export const createPurchaseOrderSchema = z.object({
  distributorId: z.string().trim().min(1),
  poDate: z.string().trim().min(1),
  requiredDeliveryDate: z.string().trim().optional().nullable(),
  remarks: z.string().trim().optional().nullable(),
  lines: z.array(lineSchema).length(1, 'An Order Sheet must have exactly one Style line'),
});

// distributorId is intentionally NOT editable here — it never was (the
// create-only distributor selection is enforced today by the frontend
// disabling that field on edit); the "re-derive purchaseMode if distributor
// changes" contingency from the Order Sheet plan therefore doesn't arise.
export const updatePurchaseOrderSchema = z
  .object({
    poDate: z.string().trim().optional(),
    requiredDeliveryDate: z.string().trim().optional().nullable(),
    remarks: z.string().trim().optional().nullable(),
    lines: z.array(lineSchema).length(1, 'An Order Sheet must have exactly one Style line').optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

// User-facing Order Sheet planning state — replaces the raw legacy status
// filter, which no longer reflects a meaningful lifecycle (see
// purchase-orders.service.ts getPurchaseOrderList for the query semantics).
export const orderSheetPlanningStateSchema = z.enum([
  'AVAILABLE',
  'INCLUDED_IN_JOB_ORDER',
  'CANCELLED',
]);

export const listPurchaseOrdersQuerySchema = z.object({
  search: z.string().trim().optional(),
  planningState: orderSheetPlanningStateSchema.optional(),
  distributorId: z.string().trim().optional(),
  purchaseMode: purchaseModeSchema.optional(),
  // Job Order planning candidate narrowing (§19): once the first selected
  // Order Sheet fixes the Job Order's Style, filter remaining candidates to
  // that Style only.
  styleId: z.string().trim().optional(),
  // Filters by this PO's own Financial Year (derived from its poDate) —
  // never a downstream/parent document's Financial Year.
  financialYearId: z.string().trim().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// Order Sheet Style lookup (P1L1): a bounded server-side search, never the
// full Style master. No status filter is accepted — eligibility for a new
// selection is the server's rule (ACTIVE only), not the caller's choice.
export const STYLE_OPTIONS_DEFAULT_LIMIT = 20;
export const STYLE_OPTIONS_MAX_LIMIT = 50;

export const orderSheetStyleOptionsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(STYLE_OPTIONS_MAX_LIMIT)
    .default(STYLE_OPTIONS_DEFAULT_LIMIT),
});
