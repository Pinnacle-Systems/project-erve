import { z } from 'zod';
import { distributorStatusSchema, factoryStatusSchema } from '../master-data/master-data.validation.js';
import { GSTIN_REGEX, normalizeGstin } from '@erve/shared';

// Blank/whitespace-only input is treated as absent before format-checking —
// forms commonly submit a blank optional field as "" rather than
// undefined/null, and a plain .regex().optional().nullable() would still
// reject that. Format-checked only when a non-empty value is supplied; no
// mandatory requirement and no live GST verification (Correction 8 §33).
const optionalGstinSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z
    .string()
    .overwrite(normalizeGstin)
    .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN (e.g., 22AAAAA0000A1Z5)')
    .nullable()
    .optional(),
);

// ISS-100: a Dispatch Order destination must always identify one real Retail
// Store master record — this is the sole authoritative destination identity
// used downstream for Erve consolidation, so there is no manual/unlinked
// destination-entry path any more (see retail-store-snapshot.ts).
const destinationSchema = z.object({
  retailStoreId: z.string().trim().min(1),
  refreshStoreSnapshot: z.boolean().optional(),
  clientKey: z.string().trim().min(1),
  id: z.string().trim().min(1).optional(),
  label: z.string().trim().min(1).optional().nullable(),
  contactName: z.string().trim().min(1).optional().nullable(),
  contactEmail: z.string().trim().min(1).optional().nullable(),
  contactPhone: z.string().trim().min(1).optional().nullable(),
  addressLine1: z.string().trim().min(1),
  addressLine2: z.string().trim().min(1).optional().nullable(),
  city: z.string().trim().min(1),
  state: z.string().trim().min(1),
  country: z.string().trim().min(1),
  postalCode: z.string().trim().min(1).optional().nullable(),
  gstin: optionalGstinSchema,
});

// DEMO-016: one total quantity per Style per destination — the server alone
// derives the per-Size split (exact division across the Style's currently
// active Sizes; see expandStyleTotalsToLines in sale-orders.service.ts). No
// client-supplied sizeId/quantity-per-size and no client-supplied line id:
// per-Size line identity is recovered server-side by natural key against
// the order's existing lines, not trusted from the client.
const dispatchLineSchema = z.object({
  destinationClientKey: z.string().trim().min(1),
  styleId: z.string().trim().min(1),
  totalQuantity: z.number().int().positive(),
});

// One Distributor group per Distributor per Dispatch Order (Correction 8) —
// duplicate-distributorId rejection is enforced both here (fast 400) and at
// the DB level (SaleOrderDistributor's @@unique([saleOrderId, distributorId])
// as defense-in-depth).
const distributorGroupSchema = z.object({
  clientKey: z.string().trim().min(1),
  id: z.string().trim().min(1).optional(),
  distributorId: z.string().trim().min(1),
  destinations: z.array(destinationSchema).min(1),
});

function assertNoDuplicateDistributors(distributors: Array<{ distributorId: string }>, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const group of distributors) {
    if (seen.has(group.distributorId)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Duplicate Distributor — each Distributor may appear only once per Dispatch Order',
        path: ['distributors'],
      });
      return;
    }
    seen.add(group.distributorId);
  }
}

export const createDispatchOrderSchema = z
  .object({
    factoryId: z.string().trim().min(1),
    soDate: z.string().trim().min(1),
    remarks: z.string().trim().min(1).optional().nullable(),
    distributors: z.array(distributorGroupSchema).min(1),
    lines: z.array(dispatchLineSchema).min(1),
  })
  .superRefine((value, ctx) => assertNoDuplicateDistributors(value.distributors, ctx));

export const updateDispatchOrderSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    factoryId: z.string().trim().min(1).optional(),
    soDate: z.string().trim().min(1).optional(),
    remarks: z.string().trim().min(1).optional().nullable(),
    distributors: z.array(distributorGroupSchema).min(1).optional(),
    lines: z.array(dispatchLineSchema).min(1).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.distributors) assertNoDuplicateDistributors(value.distributors, ctx);
  })
  .refine(
    (value) =>
      value.factoryId !== undefined ||
      value.soDate !== undefined ||
      value.remarks !== undefined ||
      value.distributors !== undefined ||
      value.lines !== undefined,
    { message: 'At least one field must be supplied' },
  );

export const listDispatchOrdersQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  distributorId: z.string().trim().min(1).optional(),
  factoryId: z.string().trim().min(1).optional(),
  financialYearId: z.string().trim().min(1).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// UXAUTH-015: the Dispatch Order Factory/Distributor filters' minimal
// lookups. No status filter is required — Dispatch Order list is
// historical, so a caller may deliberately omit it to keep selecting a
// Factory/Distributor that has since gone INACTIVE.
export const dispatchOrderFactoryOptionsQuerySchema = z.object({
  status: factoryStatusSchema.optional(),
});

// P1L8: `search`/`limit` let the Dispatch Order Distributor filter run a
// bounded search. Omitting `limit` keeps the original complete option set.
export const DISPATCH_ORDER_DISTRIBUTOR_OPTIONS_MAX_LIMIT = 50;

export const dispatchOrderDistributorOptionsQuerySchema = z.object({
  status: distributorStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(DISPATCH_ORDER_DISTRIBUTOR_OPTIONS_MAX_LIMIT).optional(),
});
