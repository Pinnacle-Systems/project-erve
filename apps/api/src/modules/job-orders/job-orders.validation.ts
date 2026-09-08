import { z } from 'zod';

export const MAX_JOB_ORDER_DISCLAIMER_LENGTH = 10_000;

export function normalizeDisclaimerText(value: string): string {
  return value.replace(/\r\n?/g, '\n').trim();
}

const disclaimerTextSchema = z
  .string()
  .max(MAX_JOB_ORDER_DISCLAIMER_LENGTH)
  .transform(normalizeDisclaimerText);

export const jobOrderStatusSchema = z.enum([
  'DRAFT',
  'SENT_TO_FACTORY',
  'CONFIRMED_BY_FACTORY',
  'IN_PRODUCTION',
  'PRODUCTION_COMPLETE',
  'READY_FOR_QA',
  'QA_IN_PROGRESS',
  'REWORK_REQUIRED',
  'READY_FOR_REINSPECTION',
  'QA_APPROVED',
  'QA_PASSED',
  'PARTIALLY_QA_PASSED',
  'CLOSED',
  'CANCELLED',
]);

const unitPriceSchema = z
  .union([z.string(), z.number()])
  .superRefine((value, ctx) => {
    const raw = String(value).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || Number(raw) <= 0 || !Number.isFinite(Number(raw))) {
      ctx.addIssue({
        code: 'custom',
        message: 'Unit price must be a finite positive INR amount',
      });
    }
  })
  .transform(String);

// The Job Order's own production plan (Phase 2.1) — one entry per Style
// size, entirely independent of any source Order Sheet. Validated further
// in job-orders.service.ts (no duplicates, every sizeId ACTIVE for the
// Style, at least one non-zero quantity, total > 0).
export const jobOrderPlanSizeSchema = z.object({
  sizeId: z.string().trim().min(1),
  quantity: z.number().int().min(0),
});

export const jobOrderPlanSizesSchema = z.array(jobOrderPlanSizeSchema).min(1);

// One or more compatible Order Sheets (same Style; any Distributor/Purchase
// Mode) inform this Job Order's planning provenance only — see Order Sheet
// Phase 2/2.1. Production quantities live solely in `sizes` below.
export const createJobOrderSchema = z.object({
  orderSheetIds: z.array(z.string().trim().min(1)).min(1, 'At least one Order Sheet is required'),
  factoryId: z.string().trim().min(1),
  processFlowVersionId: z.string().trim().min(1),
  unitPrice: unitPriceSchema,
  disclaimerText: disclaimerTextSchema.optional(),
  // Required only when the selected Order Sheets disagree on their own
  // requiredDeliveryDate; otherwise their shared date is used.
  requiredDeliveryDate: z.string().trim().min(1).optional().nullable(),
  sizes: jobOrderPlanSizesSchema,
});

// DRAFT-only source Order Sheet mapping edit (§14) — add and/or remove
// source Order Sheets in one call; at least one change is required, and the
// service enforces "at least one source Order Sheet must remain." Source
// mapping is pure planning provenance (Phase 2.1) — it never carries
// production quantities, so `add` is a bare list of Order Sheet ids.
export const updateJobOrderSourcesSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    add: z.array(z.string().trim().min(1)).optional().default([]),
    remove: z.array(z.string().trim().min(1)).optional().default([]),
  })
  .refine((value) => value.add.length > 0 || value.remove.length > 0, {
    message: 'At least one Order Sheet addition or removal is required',
  });

// DRAFT-only Job Order production-plan edit (Phase 2.1) — the sole way to
// set/change the Job Order's own size-wise production quantities once
// created. Fully replaces the size set (subject to the inactive-existing-
// size preservation rule in job-orders.service.ts).
export const updateJobOrderPlanSchema = z.object({
  expectedVersion: z.number().int().positive(),
  sizes: jobOrderPlanSizesSchema,
});

export const updateJobOrderDeliveryDateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  requiredDeliveryDate: z.string().trim().min(1).nullable(),
});

export const listJobOrdersQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: jobOrderStatusSchema.optional(),
  factoryId: z.string().trim().optional(),
  // Filters by this JO's own Financial Year (derived from its createdAt) —
  // never the parent Purchase Order's Financial Year.
  financialYearId: z.string().trim().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const assignedTasksQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: jobOrderStatusSchema.optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const versionedMutationSchema = z.object({
  expectedVersion: z.number().int().positive(),
});

export const updateJobOrderDisclaimerSchema = z.object({
  expectedVersion: z.number().int().positive(),
  disclaimerText: disclaimerTextSchema,
});

export const confirmJobOrderSchema = z.object({
  expectedVersion: z.number().int().positive(),
  expectedDisclaimerRevision: z.number().int().min(0),
  acknowledgeDisclaimer: z.boolean().optional(),
});

export const completeStageSchema = z.object({
  expectedVersion: z.number().int().positive(),
  stageStatusId: z.string().trim().min(1),
  remarks: z.string().trim().optional().nullable(),
});

export const startStageSchema = z.object({
  expectedVersion: z.number().int().positive(),
  stageStatusId: z.string().trim().min(1),
});

// Pooled Factory + Style + Size inventory read path (Phase 2.1 §12/§29).
export const pooledInventoryQuerySchema = z.object({
  factoryId: z.string().trim().min(1).optional(),
  styleId: z.string().trim().min(1).optional(),
  sizeId: z.string().trim().min(1).optional(),
});

export const updatePreparedQuantitySchema = z.object({
  expectedVersion: z.number().int().positive(),
  sizes: z
    .array(
      z.object({
        jobOrderLineSizeId: z.string().trim().min(1),
        preparedQuantity: z.number().int().min(0),
      }),
    )
    .min(1),
});
