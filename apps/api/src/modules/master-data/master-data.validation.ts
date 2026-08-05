import { z } from 'zod';

const optionalText = z.string().trim().optional().nullable();
const positiveMoney = z.coerce.number().positive();
const nonNegativeMoney = z.coerce.number().nonnegative();

export const styleStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const sizeStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const factoryStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const processFlowStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const processFlowVersionStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'RETIRED']);
export const seasonStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
const seasonIdsSchema = z.array(z.string().trim().min(1)).min(1, 'At least one Season is required').superRefine((ids, ctx) => {
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate Season identifiers are not allowed' });
});

export const createStyleSchema = z.object({
  styleNumber: z.string().trim().min(1),
  styleName: z.string().trim().min(1),
  description: optionalText,
  categoryDescription: optionalText,
  itemNameGroup: optionalText,
  ipName: optionalText,
  licensor: optionalText,
  colour: optionalText,
  lmixNumber: optionalText,
  hsnCode: optionalText,
  hsnDescription: optionalText,
  finalMrp: positiveMoney,
  royaltyPercentage: z.coerce.number().min(0).max(100).optional().nullable(),
  status: styleStatusSchema.optional(),
  seasonIds: seasonIdsSchema,
});

export const updateStyleSchema = createStyleSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const updateStyleStatusSchema = z.object({ status: styleStatusSchema });
const seasonFieldsSchema = z.object({
  code: z.string().trim().min(1, 'Season code is required').max(20).regex(/^[A-Za-z0-9/-]+$/, 'Season code may contain letters, numbers, hyphens, and slashes only').transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, 'Season name is required').max(80),
  financialYear: z.string().trim().regex(/^\d{2}-\d{2}$/, 'Financial year must use YY-YY format'),
  status: seasonStatusSchema.optional(),
});
const hasConsecutiveFinancialYear = (financialYear: string) => {
  const [start = Number.NaN, end = Number.NaN] = financialYear.split('-').map(Number);
  return (start + 1) % 100 === end;
};
export const createSeasonSchema = seasonFieldsSchema.refine(({ financialYear }) => hasConsecutiveFinancialYear(financialYear), { message: 'Financial year must contain consecutive years', path: ['financialYear'] });
export const updateSeasonSchema = seasonFieldsSchema.omit({ status: true }).partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })
  .refine((value) => value.financialYear === undefined || hasConsecutiveFinancialYear(value.financialYear), { message: 'Financial year must contain consecutive years', path: ['financialYear'] });
export const updateSeasonStatusSchema = z.object({ status: seasonStatusSchema });

export const styleSizeSchema = z.object({
  sizeId: z.string().trim().min(1),
  importedSizeRangeLabel: optionalText,
});

export const styleFactorySchema = z.object({
  factoryId: z.string().trim().min(1),
  exFactoryPrice: positiveMoney,
});

export const createSizeSchema = z.object({
  code: z.string().trim().min(1),
  label: z.string().trim().min(1),
  sizeType: z.enum(['AGE', 'ALPHA', 'NUMERIC', 'WAIST', 'FREE_SIZE']),
  sortOrder: z.coerce.number().int(),
  status: sizeStatusSchema.optional(),
});

export const updateSizeSchema = createSizeSchema
  .omit({ status: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  });

export const updateSizeStatusSchema = z.object({ status: sizeStatusSchema });

export const createFactorySchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  contactName: optionalText,
  contactEmail: z.string().trim().pipe(z.email()).optional().nullable(),
  contactPhone: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  country: optionalText,
  postalCode: optionalText,
  status: factoryStatusSchema.optional(),
});

export const updateFactorySchema = createFactorySchema
  .omit({ status: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const updateFactoryStatusSchema = z.object({ status: factoryStatusSchema });

export const distributorStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const createDistributorSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  contactName: optionalText,
  contactEmail: z.string().trim().pipe(z.email()).optional().nullable(),
  contactPhone: optionalText,
  addressLine1: optionalText,
  addressLine2: optionalText,
  city: optionalText,
  state: optionalText,
  country: optionalText,
  postalCode: optionalText,
  status: distributorStatusSchema.optional(),
});

export const updateDistributorSchema = createDistributorSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });

export const updateDistributorStatusSchema = z.object({ status: distributorStatusSchema });

const processStageSchema = z.object({
  sequence: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1, 'Stage name is required').max(120),
  code: z.string().trim().max(50).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const processStagesSchema = z.array(processStageSchema).superRefine((stages, context) => {
  const names = new Set<string>();
  stages.forEach((stage, index) => {
    const normalizedName = stage.name.toLocaleLowerCase();
    if (names.has(normalizedName)) {
      context.addIssue({
        code: 'custom',
        message: 'Stage names must be unique within a version',
        path: [index, 'name'],
      });
    }
    names.add(normalizedName);
  });

  const suppliedSequences = stages.flatMap((stage) =>
    stage.sequence === undefined ? [] : [stage.sequence],
  );
  if (suppliedSequences.length > 0) {
    const uniqueSequences = new Set(suppliedSequences);
    if (suppliedSequences.length !== stages.length || uniqueSequences.size !== stages.length) {
      context.addIssue({
        code: 'custom',
        message: 'Stage sequences must be unique and supplied for every stage',
      });
    } else if ([...uniqueSequences].some((sequence, index) => sequence !== index + 1)) {
      context.addIssue({
        code: 'custom',
        message: 'Stage sequences must be contiguous starting at 1',
      });
    }
  }
});

export const createProcessFlowSchema = z.object({
  code: z.string().trim().min(1).max(50),
  name: z.string().trim().min(1).max(120),
  description: optionalText,
  status: processFlowStatusSchema.optional(),
  stages: processStagesSchema.min(1, 'At least one stage is required'),
});

export const createProcessFlowVersionSchema = z
  .object({
    stages: processStagesSchema.optional(),
    copyFromVersionId: z.string().trim().min(1).optional(),
    effectiveFrom: z.coerce.date().optional().nullable(),
  })
  .refine((input) => !(input.copyFromVersionId && input.stages), {
    message: 'Provide either copyFromVersionId or stages, not both',
  });

export const replaceProcessFlowVersionStagesSchema = z.object({
  stages: processStagesSchema,
});

export const listStylesQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: styleStatusSchema.optional(),
  ipName: z.string().trim().optional(),
  licensor: z.string().trim().optional(),
});

export const listStatusQuerySchema = z.object({
  status: z.string().trim().optional(),
  search: z.string().trim().optional(),
});

export const nonNegativePriceSchema = nonNegativeMoney;
