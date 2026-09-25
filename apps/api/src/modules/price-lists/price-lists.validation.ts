import { z } from 'zod';
import { distributorStatusSchema, styleStatusSchema } from '../master-data/master-data.validation.js';
import { optionalPageQueryFields } from '../../utils/pagination.js';

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
  ...optionalPageQueryFields,
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

// Minimal option lookups for the Price List Distributor/Style selectors.
// Deliberately reuses the master-data status enums (not the broad master
// endpoints themselves) so ACCOUNTANT — permitted on Price Lists but not on
// the Style/Distributor masters — can populate these selectors without a
// grant to browse either master.
// P1L8: `search`/`limit` let the Price List Distributor lookups run a
// bounded search. Omitting `limit` keeps the original complete option set.
export const PRICE_LIST_DISTRIBUTOR_OPTIONS_MAX_LIMIT = 50;

export const priceListDistributorOptionsQuerySchema = z.object({
  status: distributorStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(PRICE_LIST_DISTRIBUTOR_OPTIONS_MAX_LIMIT).optional(),
});

export const priceListStyleOptionsQuerySchema = z.object({
  status: styleStatusSchema.optional(),
});

// Price List "Add Style" lookup (P1L2): a bounded server-side search over the
// Styles this price list can still price, never the full Style master. No
// status filter is accepted — eligibility (ACTIVE, not already priced here)
// is the server's rule, not the caller's choice.
export const PRICE_LIST_STYLE_CANDIDATES_DEFAULT_LIMIT = 20;
export const PRICE_LIST_STYLE_CANDIDATES_MAX_LIMIT = 50;

export const priceListStyleCandidatesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PRICE_LIST_STYLE_CANDIDATES_MAX_LIMIT)
    .default(PRICE_LIST_STYLE_CANDIDATES_DEFAULT_LIMIT),
});
