import { z } from 'zod';

export const saleOrderStatusSchema = z.enum([
  'DRAFT',
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

const createLineSchema = z.object({
  purchaseOrderLineSizeId: z.string().trim().min(1),
  requestedQuantity: z.number().int().positive(),
  remarks: z.string().trim().optional().nullable(),
});

export const createSaleOrderSchema = z.object({
  distributorId: z.string().trim().min(1),
  soDate: z.string().trim().min(1),
  remarks: z.string().trim().optional().nullable(),
  lines: z.array(createLineSchema).min(1, 'At least one line is required'),
});

export const updateSaleOrderSchema = z
  .object({
    soDate: z.string().trim().optional(),
    remarks: z.string().trim().optional().nullable(),
    lines: z.array(createLineSchema).min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const listSaleOrdersQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: saleOrderStatusSchema.optional(),
  distributorId: z.string().trim().optional(),
  financialYearId: z.string().trim().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const versionedActionSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().optional().nullable(),
});

const sourcingEntrySchema = z.object({
  qaReleaseLineId: z.string().trim().min(1),
  quantity: z.number().int().positive(),
  reason: z.string().trim().optional().nullable(),
});

const approveLineSchema = z
  .object({
    saleOrderLineId: z.string().trim().min(1),
    approvedQuantity: z.number().int().nonnegative(),
    sourcing: z.array(sourcingEntrySchema).optional(),
  })
  .refine(
    (line) => {
      if (!line.sourcing || line.sourcing.length === 0) return true;
      const ids = line.sourcing.map((s) => s.qaReleaseLineId);
      return new Set(ids).size === ids.length;
    },
    { message: 'Each sourcing entry within a line must reference a distinct QA release line' },
  );

export const approveSaleOrderSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  reason: z.string().trim().optional().nullable(),
  lines: z.array(approveLineSchema).min(1, 'At least one line decision is required'),
});

export const globalInventoryQuerySchema = z.object({
  styleId: z.string().trim().optional(),
  sizeId: z.string().trim().optional(),
  distributorId: z.string().trim().optional(),
  onlyAvailable: z.coerce.boolean().optional(),
});
