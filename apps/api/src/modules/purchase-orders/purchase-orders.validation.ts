import { z } from 'zod';

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

export const createPurchaseOrderSchema = z.object({
  distributorId: z.string().trim().min(1),
  merchandiserId: z.string().trim().optional().nullable(),
  poDate: z.string().trim().min(1),
  requiredDeliveryDate: z.string().trim().optional().nullable(),
  purchaseMode: purchaseModeSchema,
  remarks: z.string().trim().optional().nullable(),
  lines: z.array(lineSchema).min(1, 'At least one line is required'),
});

export const updatePurchaseOrderSchema = z
  .object({
    merchandiserId: z.string().trim().optional().nullable(),
    poDate: z.string().trim().optional(),
    requiredDeliveryDate: z.string().trim().optional().nullable(),
    purchaseMode: purchaseModeSchema.optional(),
    remarks: z.string().trim().optional().nullable(),
    lines: z.array(lineSchema).min(1).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const listPurchaseOrdersQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: purchaseOrderStatusSchema.optional(),
  distributorId: z.string().trim().optional(),
  purchaseMode: purchaseModeSchema.optional(),
});
