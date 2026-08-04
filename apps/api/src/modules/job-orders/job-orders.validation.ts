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

export const createJobOrderSchema = z.object({
  purchaseOrderId: z.string().trim().min(1),
  factoryId: z.string().trim().min(1),
  processFlowVersionId: z.string().trim().min(1),
  unitPrice: z
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
    .transform(String),
  disclaimerText: disclaimerTextSchema.optional(),
  lines: z
    .array(
      z.object({
        purchaseOrderLineId: z.string().trim().min(1),
        sizes: z
          .array(
            z.object({
              purchaseOrderLineSizeId: z.string().trim().min(1),
              quantity: z.number().int().positive(),
            }),
          )
          .min(1),
      }),
    )
    .min(1, 'At least one line is required'),
});

export const listJobOrdersQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: jobOrderStatusSchema.optional(),
  factoryId: z.string().trim().optional(),
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
