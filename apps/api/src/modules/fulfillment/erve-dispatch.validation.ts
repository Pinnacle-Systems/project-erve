import { z } from 'zod';

export const createErvePackingListSchema = z.object({
  cartonIds: z.array(z.string().trim().min(1)).min(1, 'At least one carton is required'),
});

export const addErvePackingListCartonsSchema = z.object({
  cartonIds: z.array(z.string().trim().min(1)).min(1, 'At least one carton is required'),
});

export const listErvePackingListsQuerySchema = z.object({
  saleOrderId: z.string().trim().optional(),
  distributorId: z.string().trim().optional(),
  status: z.enum(['OPEN', 'FINALIZED', 'DISPATCHED']).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const listEligibleCartonsQuerySchema = z.object({
  ervePackingListId: z.string().trim().optional(),
  search: z
    .string()
    .trim()
    .max(256)
    .refine((value) => !value.includes('\u0000'), 'Search must not contain null characters')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().trim().min(1).max(1024).optional(),
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
  .refine(
    (v) => v.transporter !== undefined || v.vehicleNumber !== undefined || v.lrNumber !== undefined,
    {
      message: 'At least one of transporter, vehicleNumber or lrNumber is required',
    },
  );

export const transporterAssignmentSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  transporterUserId: z.string().trim().min(1).nullable(),
}).strict();

export const assignedTransportQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(1024).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export const transporterOptionsQuerySchema = z.object({
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
}).strict();

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

// A4 (ISS-079/080): strict Style x Size attestation; per-source-line
// allocations are only meaningful (and required) for a partial receipt of a
// Style x Size spanning several Sale Order lines — enforced against the
// authoritative carton lines in the service, not here.
export const submitDistributorReceiptSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  acknowledged: z.literal(true, { error: 'Explicit final acknowledgement is required' }),
  remarks: z.string().trim().max(1000).optional().nullable(),
  groups: z
    .array(
      z.object({
        styleId: z.string().trim().min(1),
        sizeId: z.string().trim().min(1),
        receivedQuantity: z.number().int().nonnegative(),
        allocations: z
          .array(
            z.object({
              saleOrderLineId: z.string().trim().min(1),
              receivedQuantity: z.number().int().nonnegative(),
            }).strict(),
          )
          .max(500)
          .optional(),
      }).strict(),
    )
    .min(1, 'At least one Style / Size entry is required')
    .max(2000),
}).strict();

export const listErveDispatchesQuerySchema = z.object({
  saleOrderId: z.string().trim().optional(),
  distributorId: z.string().trim().optional(),
  status: z.enum(['DISPATCHED', 'DELIVERED']).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
