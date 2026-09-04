import { z } from 'zod';

export const listDistributorReturnsQuerySchema = z.object({
  distributorId: z.string().trim().optional(),
  status: z.enum(['SUBMITTED', 'APPROVED', 'REJECTED', 'RECEIVED', 'CANCELLED']).optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const submitDistributorReturnSchema = z.object({
  distributorId: z.string().trim().min(1),
  returnDate: z.string().trim().min(1),
  returnReason: z.string().trim().min(1, 'A return reason is required').max(1000),
  remarks: z.string().trim().max(1000).optional().nullable(),
  lines: z
    .array(
      z.object({
        erveDispatchId: z.string().trim().min(1),
        saleOrderLineId: z.string().trim().min(1),
        requestedQuantity: z.number().int().positive(),
      }),
    )
    .min(1, 'A return must have at least one line'),
});

export const approveDistributorReturnSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  lines: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        approvedQuantity: z.number().int().nonnegative(),
      }),
    )
    .min(1, 'At least one line is required'),
  approvalRemarks: z.string().trim().max(1000).optional().nullable(),
});

export const rejectDistributorReturnSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  rejectionReason: z.string().trim().min(1, 'A rejection reason is required').max(1000),
});

export const recordDistributorReturnCreditNoteSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  creditNoteReference: z.string().trim().min(1, 'A credit note reference is required').max(200),
  creditNoteDate: z.string().trim().min(1),
});

export const receiveDistributorReturnSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  lines: z
    .array(
      z.object({
        id: z.string().trim().min(1),
        receivedQuantity: z.number().int().nonnegative(),
      }),
    )
    .min(1, 'At least one line is required'),
});

export const cancelDistributorReturnSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
});
