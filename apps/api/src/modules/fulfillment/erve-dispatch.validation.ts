import { z } from 'zod';

export const createErvePackingListSchema = z.object({
  saleOrderId: z.string().trim().min(1),
  factoryDispatchIds: z.array(z.string().trim().min(1)).min(1, 'At least one Factory Dispatch is required'),
});

export const listErvePackingListsQuerySchema = z.object({
  saleOrderId: z.string().trim().optional(),
  status: z.enum(['OPEN', 'DISPATCHED']).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const recordErveDispatchSchema = z.object({
  ervePackingListId: z.string().trim().min(1),
  dispatchDate: z.string().trim().min(1),
  transporter: z.string().trim().max(200).optional().nullable(),
  vehicleNumber: z.string().trim().max(100).optional().nullable(),
  lrNumber: z.string().trim().max(100).optional().nullable(),
  remarks: z.string().trim().max(1000).optional().nullable(),
});

export const updateErveDispatchLrSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    transporter: z.string().trim().max(200).optional().nullable(),
    vehicleNumber: z.string().trim().max(100).optional().nullable(),
    lrNumber: z.string().trim().max(100).optional().nullable(),
  })
  .refine((v) => v.transporter !== undefined || v.vehicleNumber !== undefined || v.lrNumber !== undefined, {
    message: 'At least one of transporter, vehicleNumber or lrNumber is required',
  });

export const confirmErveDispatchDeliverySchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  lines: z
    .array(
      z.object({
        saleOrderLineId: z.string().trim().min(1),
        receivedQuantity: z.number().int().nonnegative(),
      }),
    )
    .min(1, 'At least one line is required'),
  remarks: z.string().trim().max(1000).optional().nullable(),
});

export const listErveDispatchesQuerySchema = z.object({
  saleOrderId: z.string().trim().optional(),
  distributorId: z.string().trim().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
