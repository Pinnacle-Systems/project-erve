import { z } from 'zod';
import { optionalPageQueryFields } from '../../utils/pagination.js';

const optionalText = z.string().trim().optional().nullable();

// Same shape already enforced on Style.hsnCode (master-data.validation.ts):
// exactly 8 numeric digits, kept as a string so leading zeroes survive.
const hsnCodeSchema = z.string().trim().regex(/^\d{8}$/, 'HSN Code must be exactly 8 digits');

export const hsnStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createHsnSchema = z.object({
  code: hsnCodeSchema,
  description: optionalText,
  status: hsnStatusSchema.optional(),
  gstRuleSetId: z.string().trim().min(1).optional().nullable(),
});

export const updateHsnSchema = createHsnSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const listHsnsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: hsnStatusSchema.optional(),
  gstRuleSetId: z.string().trim().optional(),
  ...optionalPageQueryFields,
});
