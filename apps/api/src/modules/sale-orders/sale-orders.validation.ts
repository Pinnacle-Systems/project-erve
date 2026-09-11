import { z } from 'zod';
import { GSTIN_REGEX } from '../master-data/master-data.validation.js';

// Blank/whitespace-only input is treated as absent before format-checking —
// forms commonly submit a blank optional field as "" rather than
// undefined/null, and a plain .regex().optional().nullable() would still
// reject that. Format-checked only when a non-empty value is supplied; no
// mandatory requirement and no live GST verification (Correction 8 §33).
const optionalGstinSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z
    .string()
    .trim()
    .toUpperCase()
    .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN (e.g., 22AAAAA0000A1Z5)')
    .nullable()
    .optional(),
);

const destinationSchema = z.object({
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

const dispatchLineSchema = z.object({
  id: z.string().trim().min(1).optional(),
  destinationClientKey: z.string().trim().min(1),
  styleId: z.string().trim().min(1),
  sizeId: z.string().trim().min(1),
  quantity: z.number().int().positive(),
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
