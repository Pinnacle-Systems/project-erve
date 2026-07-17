import { z } from 'zod';

const optionalText = z.string().trim().optional().nullable();
const positiveMoney = z.coerce.number().positive();
const nonNegativeMoney = z.coerce.number().nonnegative();

export const styleStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const sizeStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const factoryStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const processFlowStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const processFlowVersionStatusSchema = z.enum(['DRAFT', 'ACTIVE', 'RETIRED']);

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
});

export const updateStyleSchema = createStyleSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

export const updateStyleStatusSchema = z.object({ status: styleStatusSchema });

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

export const updateSizeSchema = createSizeSchema.partial().refine((value) => Object.keys(value).length > 0, {
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
  sequence: z.coerce.number().int().positive(),
  name: z.string().trim().min(1),
  code: optionalText,
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const createProcessFlowSchema = z.object({
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  description: optionalText,
  status: processFlowStatusSchema.optional(),
  stages: z.array(processStageSchema).min(1).optional(),
});

export const createProcessFlowVersionSchema = z.object({
  stages: z.array(processStageSchema).min(1),
  effectiveFrom: z.coerce.date().optional().nullable(),
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
