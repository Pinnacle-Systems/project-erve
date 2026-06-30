import { z } from 'zod';

export const jobOrderStatusSchema = z.enum([
  'DRAFT',
  'SENT_TO_FACTORY',
  'CONFIRMED_BY_FACTORY',
  'IN_PRODUCTION',
  'PRODUCTION_COMPLETE',
  'READY_FOR_QA',
  'QA_IN_PROGRESS',
  'QA_PASSED',
  'PARTIALLY_QA_PASSED',
  'CLOSED',
  'CANCELLED',
]);

export const createJobOrderSchema = z.object({
  purchaseOrderId: z.string().trim().min(1),
  factoryId: z.string().trim().min(1),
  processFlowVersionId: z.string().trim().min(1),
  lines: z.array(z.object({
    purchaseOrderLineId: z.string().trim().min(1),
    sizes: z.array(z.object({
      purchaseOrderLineSizeId: z.string().trim().min(1),
      quantity: z.number().int().positive(),
    })).min(1),
  })).min(1, 'At least one line is required'),
});

export const listJobOrdersQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: jobOrderStatusSchema.optional(),
  factoryId: z.string().trim().optional(),
});

export const completeStageSchema = z.object({
  stageStatusId: z.string().trim().min(1),
  remarks: z.string().trim().optional().nullable(),
});

export const updatePreparedQuantitySchema = z.object({
  sizes: z.array(z.object({
    jobOrderLineSizeId: z.string().trim().min(1),
    preparedQuantity: z.number().int().min(0),
  })).min(1),
});
