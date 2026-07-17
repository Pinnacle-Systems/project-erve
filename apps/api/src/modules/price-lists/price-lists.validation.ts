import { z } from 'zod';

// Price-list effective dates are day-granular (the columns are @db.Date), so
// inputs are plain YYYY-MM-DD strings — accepting full timestamps here would
// only invite timezone drift in "which price applies on this date" checks.
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

const positiveMoney = z.coerce.number().positive();

export const priceListStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'EXPIRED']);

export const listPriceListsQuerySchema = z.object({
  search: z.string().trim().optional(),
  distributorId: z.string().trim().optional(),
  status: priceListStatusSchema.optional(),
  effectiveOn: dateOnly.optional(),
});

export const createPriceListSchema = z.object({
  distributorId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  effectiveFrom: dateOnly.optional().nullable(),
  effectiveTo: dateOnly.optional().nullable(),
});

export const updatePriceListSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    effectiveFrom: dateOnly.optional().nullable(),
    effectiveTo: dateOnly.optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const createPriceListLineSchema = z.object({
  styleId: z.string().trim().min(1),
  unitPrice: positiveMoney,
});

export const updatePriceListLineSchema = z.object({
  unitPrice: positiveMoney,
});

export const priceLookupQuerySchema = z.object({
  distributorId: z.string().trim().min(1),
  styleId: z.string().trim().min(1),
  date: dateOnly,
});
