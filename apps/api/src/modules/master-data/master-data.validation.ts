import { z } from 'zod';

const optionalText = z.string().trim().optional().nullable();
const positiveMoney = z.coerce.number().positive();
const nonNegativeMoney = z.coerce.number().nonnegative();
// A Style's HSN is optional, but when entered must be exactly 8 numeric
// digits — kept as a string (never coerced to a number) so leading zeroes
// survive.
const hsnCodeSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .refine((value) => !value || /^\d{8}$/.test(value), {
    message: 'HSN Code must be exactly 8 digits',
  });

export const styleStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const sizeStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const factoryStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const processFlowStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const processFlowVersionStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'RETIRED']);
export const seasonStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
const seasonIdsSchema = z
  .array(z.string().trim().min(1))
  .min(1, 'At least one Season is required')
  .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate Season identifiers are not allowed' });
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
  hsnCode: hsnCodeSchema,
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
  code: z
    .string()
    .trim()
    .min(1, 'Season code is required')
    .max(20)
    .regex(
      /^[A-Za-z0-9/-]+$/,
      'Season code may contain letters, numbers, hyphens, and slashes only',
    )
    .transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1, 'Season name is required').max(80),
  // References the shared Financial Year master — not arbitrary free text.
  // Existence is validated server-side against the FinancialYear table.
  financialYearId: z.string().trim().min(1, 'Financial Year is required'),
  status: seasonStatusSchema.optional(),
});
export const createSeasonSchema = seasonFieldsSchema;
export const updateSeasonSchema = seasonFieldsSchema
  .omit({ status: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });
export const updateSeasonStatusSchema = z.object({ status: seasonStatusSchema });
export const listSeasonsQuerySchema = z.object({
  status: z.string().trim().optional(),
  search: z.string().trim().optional(),
  financialYearId: z.string().trim().optional(),
});

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

// Standard 15-character Indian GSTIN: 2-digit state code, 10-character PAN,
// 1-digit entity number, literal 'Z', 1 alphanumeric checksum.
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN (e.g., 22AAAAA0000A1Z5)');

export const createDistributorSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  gstin: gstinSchema,
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

const processActivityBaseSchema = z.object({
  activityKey: z.string().trim().min(1).max(100).optional(),
  sequence: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1, 'Stage name is required').max(120),
  code: z.string().trim().max(50).optional().nullable(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const productionActivitySchema = processActivityBaseSchema
  .extend({
    activityType: z.literal('PRODUCTION').optional().default('PRODUCTION'),
  })
  .strict();

const sequentialQualityActivitySchema = processActivityBaseSchema
  .extend({
    activityType: z.literal('QUALITY'),
    qualityFormVersionId: z.string().trim().min(1, 'Quality Form version is required'),
    qualityExecutionMode: z.literal('SEQUENTIAL_GATE'),
    gateSatisfactionRequirement: z.enum(['FINALIZED', 'OUTCOME_PASS']).optional().default('FINALIZED'),
    executionMultiplicity: z.literal('SINGLE').optional().default('SINGLE'),
  })
  .strict();

const inProcessQualityActivitySchema = processActivityBaseSchema
  .extend({
    activityType: z.literal('QUALITY'),
    qualityFormVersionId: z.string().trim().min(1, 'Quality Form version is required'),
    qualityExecutionMode: z.literal('IN_PROCESS'),
    associatedProductionActivityKey: z
      .string()
      .trim()
      .min(1, 'Associated Production activity is required'),
    qualityAvailabilityPolicy: z.enum([
      'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      'AFTER_ASSOCIATED_ACTIVITY_COMPLETES',
      'PROGRESS_PERCENTAGE',
    ]),
    progressThresholdPercent: z.coerce.number().gt(0).max(100).optional(),
    executionMultiplicity: z.enum(['SINGLE', 'BATCHED']).optional().default('SINGLE'),
    coverageTarget: z.literal('PREPARED_QUANTITY').optional(),
  })
  .strict()
  .superRefine((activity, context) => {
    if (
      activity.qualityAvailabilityPolicy === 'PROGRESS_PERCENTAGE' &&
      activity.progressThresholdPercent === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Progress threshold is required for production progress percentage',
        path: ['progressThresholdPercent'],
      });
    }
    if (
      activity.qualityAvailabilityPolicy !== 'PROGRESS_PERCENTAGE' &&
      activity.progressThresholdPercent !== undefined
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Progress threshold is only allowed for percentage availability',
        path: ['progressThresholdPercent'],
      });
    }
    if (activity.executionMultiplicity === 'BATCHED' && !activity.coverageTarget) {
      context.addIssue({
        code: 'custom',
        message: 'Batched Quality activities require a coverage target',
        path: ['coverageTarget'],
      });
    }
    if (activity.executionMultiplicity === 'SINGLE' && activity.coverageTarget) {
      context.addIssue({
        code: 'custom',
        message: 'Coverage targets are only valid for batched Quality activities',
        path: ['coverageTarget'],
      });
    }
  });

const processStageSchema = z.union([
  productionActivitySchema,
  sequentialQualityActivitySchema,
  inProcessQualityActivitySchema,
]);

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

  const keys = new Map(
    stages.map((stage, index) => [stage.activityKey ?? `activity-${index + 1}`, stage]),
  );
  if (keys.size !== stages.length) {
    context.addIssue({ code: 'custom', message: 'Activity keys must be unique' });
  }
  stages.forEach((stage, index) => {
    if (stage.activityType !== 'QUALITY' || stage.qualityExecutionMode !== 'IN_PROCESS') return;
    const ownKey = stage.activityKey ?? `activity-${index + 1}`;
    if (stage.associatedProductionActivityKey === ownKey) {
      context.addIssue({
        code: 'custom',
        message: 'A Quality activity cannot associate with itself',
        path: [index, 'associatedProductionActivityKey'],
      });
      return;
    }
    const associated = keys.get(stage.associatedProductionActivityKey);
    if (!associated) {
      context.addIssue({
        code: 'custom',
        message: 'Associated Production activity must belong to this Process Flow version',
        path: [index, 'associatedProductionActivityKey'],
      });
    } else if (associated.activityType !== 'PRODUCTION') {
      context.addIssue({
        code: 'custom',
        message: 'In-process Quality activities must associate with a Production activity',
        path: [index, 'associatedProductionActivityKey'],
      });
    }
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
