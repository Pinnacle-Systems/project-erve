import { z } from 'zod';
import { GSTIN_REGEX } from './master-data.validation.js';
import { optionalPageQueryFields } from '../../utils/pagination.js';

const text = z.string().trim().min(1);
const optionalText = z.preprocess(
  (v) => (typeof v === 'string' && !v.trim() ? null : v),
  z.string().trim().nullable().optional(),
);
export const retailStoreStatusSchema = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) });
export const createRetailStoreSchema = z
  .object({
    distributorId: text,
    code: text,
    name: text,
    addressLine1: text,
    addressLine2: optionalText,
    city: text,
    state: text,
    country: text.default('India'),
    postalCode: text,
    gstin: z.preprocess(
      (v) => (typeof v === 'string' && !v.trim() ? null : v),
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN')
        .nullable()
        .optional(),
    ),
    contactName: optionalText,
    contactEmail: z.preprocess(
      (v) => (typeof v === 'string' && !v.trim() ? null : v),
      z.email().nullable().optional(),
    ),
    contactPhone: optionalText,
    status: retailStoreStatusSchema.shape.status.default('ACTIVE'),
  })
  .strict();
export const updateRetailStoreSchema = createRetailStoreSchema
  .omit({ distributorId: true })
  .partial()
  // Zod applies defaults inside optional fields: PATCH must never reset an
  // inactive Store or a saved country merely because those keys are absent.
  .extend({ country: text.optional(), status: retailStoreStatusSchema.shape.status.optional() })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'At least one field must be supplied');
export const listRetailStoresSchema = z.object({
  ...optionalPageQueryFields,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  distributorId: text.optional(),
  status: retailStoreStatusSchema.shape.status.optional(),
  search: z.string().trim().max(100).optional(),
});
export const retailStoreOptionsSchema = z.object({
  distributorId: text,
  search: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
