import { z } from 'zod';
import { optionalPageQueryFields } from '../../utils/pagination.js';

const dateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

const nonNegativeAmount = z.coerce.number().nonnegative();
const gstPercentValue = z.coerce.number().min(0).max(100);

export const gstRuleSetStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const gstRuleSetVersionStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'EXPIRED']);

export const createGstRuleSetSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  status: gstRuleSetStatusSchema.optional(),
});

export const updateGstRuleSetSchema = createGstRuleSetSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const listGstRuleSetsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: gstRuleSetStatusSchema.optional(),
  ...optionalPageQueryFields,
});

// A DRAFT version's effective window is mutable up until activation — this
// schema backs both "create version" (window optional, can be filled in
// later) and "update DRAFT version" (same fields, PATCH-style).
export const draftVersionWindowSchema = z.object({
  effectiveFrom: dateOnlySchema.optional().nullable(),
  effectiveTo: dateOnlySchema.optional().nullable(),
});

export const createGstValueBandSchema = z.object({
  // null = open-ended at that bound. minValue is always EXCLUSIVE, maxValue
  // always INCLUSIVE (see GstValueBand doc comment in schema.prisma).
  minValue: nonNegativeAmount.optional().nullable(),
  maxValue: nonNegativeAmount.optional().nullable(),
  gstPercent: gstPercentValue,
});

export const updateGstValueBandSchema = createGstValueBandSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const resolveGstRuleQuerySchema = z
  .object({
    hsnId: z.string().trim().min(1).optional(),
    hsnCode: z.string().trim().min(1).optional(),
    date: dateOnlySchema,
    value: z.coerce.number().positive(),
  })
  .refine((value) => Boolean(value.hsnId || value.hsnCode), {
    message: 'Either hsnId or hsnCode is required',
  });
