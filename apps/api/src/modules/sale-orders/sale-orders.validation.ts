import { z } from 'zod';

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
});

const dispatchLineSchema = z.object({
  id: z.string().trim().min(1).optional(),
  destinationClientKey: z.string().trim().min(1),
  styleId: z.string().trim().min(1),
  sizeId: z.string().trim().min(1),
  quantity: z.number().int().positive(),
});

export const createDispatchOrderSchema = z.object({
  distributorId: z.string().trim().min(1),
  factoryId: z.string().trim().min(1),
  soDate: z.string().trim().min(1),
  remarks: z.string().trim().min(1).optional().nullable(),
  destinations: z.array(destinationSchema).min(1),
  lines: z.array(dispatchLineSchema).min(1),
});

export const updateDispatchOrderSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    distributorId: z.string().trim().min(1).optional(),
    factoryId: z.string().trim().min(1).optional(),
    soDate: z.string().trim().min(1).optional(),
    remarks: z.string().trim().min(1).optional().nullable(),
    destinations: z.array(destinationSchema).min(1).optional(),
    lines: z.array(dispatchLineSchema).min(1).optional(),
  })
  .refine(
    (value) =>
      value.distributorId !== undefined ||
      value.factoryId !== undefined ||
      value.soDate !== undefined ||
      value.remarks !== undefined ||
      value.destinations !== undefined ||
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
