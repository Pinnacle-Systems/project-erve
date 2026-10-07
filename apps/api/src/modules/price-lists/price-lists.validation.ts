import { z } from 'zod';
import { distributorStatusSchema } from '../master-data/master-data.validation.js';
import { optionalPageQueryFields } from '../../utils/pagination.js';

// Price-list effective dates are day-granular (the columns are @db.Date), so
// inputs are plain YYYY-MM-DD strings — accepting full timestamps here would
// only invite timezone drift in "which price applies on this date" checks.
const dateOnly = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date');

// Same bound as Style.royaltyPercentage, the existing percentage-field
// convention (Decimal(5,2), 0-100) — no new commercial limit is invented here.
const percentageOfMrp = z.coerce.number().min(0).max(100);

export const priceListStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'EXPIRED']);

export const listPriceListsQuerySchema = z.object({
  search: z.string().trim().optional(),
  distributorId: z.string().trim().optional(),
  status: priceListStatusSchema.optional(),
  effectiveOn: dateOnly.optional(),
  ...optionalPageQueryFields,
});

export const createPriceListSchema = z.object({
  distributorId: z.string().trim().min(1),
  name: z.string().trim().min(1),
  percentageOfMrp,
  effectiveFrom: dateOnly.optional().nullable(),
  effectiveTo: dateOnly.optional().nullable(),
});

export const updatePriceListSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    percentageOfMrp: percentageOfMrp.optional(),
    effectiveFrom: dateOnly.optional().nullable(),
    effectiveTo: dateOnly.optional().nullable(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const priceLookupQuerySchema = z.object({
  distributorId: z.string().trim().min(1),
  date: dateOnly,
});

// Minimal option lookup for the Price List Distributor selector. Deliberately
// reuses the master-data status enum (not the broad master endpoint itself)
// so ACCOUNTANT — permitted on Price Lists but not on the Distributor
// master — can populate this selector without a grant to browse it.
// P1L8: `search`/`limit` let the Price List Distributor lookup run a bounded
// search. Omitting `limit` keeps the original complete option set.
export const PRICE_LIST_DISTRIBUTOR_OPTIONS_MAX_LIMIT = 50;

export const priceListDistributorOptionsQuerySchema = z.object({
  status: distributorStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(PRICE_LIST_DISTRIBUTOR_OPTIONS_MAX_LIMIT).optional(),
});
