import { z } from 'zod';
import { optionalPageQueryFields } from '../../utils/pagination.js';
import { GSTIN_REGEX } from './master-data.validation.js';

const optionalText = z.string().trim().optional().nullable();

export const sellerRegistrationStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_REGEX, 'Enter a valid 15-character GSTIN (e.g., 22AAAAA0000A1Z5)');

// Indian PIN code: 6 digits, first digit 1-9.
export const PIN_CODE_REGEX = /^[1-9][0-9]{5}$/;
const pinCodeSchema = z
  .string()
  .trim()
  .regex(PIN_CODE_REGEX, 'Enter a valid 6-digit PIN code');

// GST state code: 2-digit numeric prefix. Cross-checked against the GSTIN's
// own leading 2 digits below so the two fields can never silently disagree.
export const STATE_CODE_REGEX = /^[0-9]{2}$/;
const stateCodeSchema = z
  .string()
  .trim()
  .regex(STATE_CODE_REGEX, 'Enter a valid 2-digit GST state code');

// Standard 11-character IFSC: 4-letter bank code, literal '0', 6-character
// alphanumeric branch code.
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ifscSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(IFSC_REGEX, 'Enter a valid 11-character IFSC code (e.g., HDFC0001234)');

const bankAccountNumberSchema = z
  .string()
  .trim()
  .min(4, 'Bank account number is required')
  .max(34, 'Bank account number is too long')
  .regex(/^[0-9A-Za-z]+$/, 'Bank account number may contain only letters and numbers');

const sellerRegistrationFieldsSchema = z.object({
  legalName: z.string().trim().min(1, 'Legal name is required'),
  tradeName: optionalText,
  branchCode: z.string().trim().min(1, 'Branch code is required'),
  gstin: gstinSchema,
  // e-invoice applicability indicator only — generating/filing e-invoices is
  // out of scope for this master.
  einvoiceApplicable: z.coerce.boolean().optional(),
  addressLine1: z.string().trim().min(1, 'Address line 1 is required'),
  addressLine2: optionalText,
  city: z.string().trim().min(1, 'City is required'),
  district: optionalText,
  state: z.string().trim().min(1, 'State is required'),
  stateCode: stateCodeSchema,
  postalCode: pinCodeSchema,
  country: z.string().trim().min(1).optional(),
  bankName: z.string().trim().min(1, 'Bank name is required'),
  bankAccountName: z.string().trim().min(1, 'Beneficiary name is required'),
  bankAccountNumber: bankAccountNumberSchema,
  bankIfsc: ifscSchema,
  bankBranchName: z.string().trim().min(1, 'Bank branch name is required'),
  bankAddress: optionalText,
  status: sellerRegistrationStatusSchema.optional(),
});

function assertGstinStateCodeConsistency(
  value: { gstin?: string; stateCode?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.gstin && value.stateCode && value.gstin.slice(0, 2) !== value.stateCode) {
    ctx.addIssue({
      code: 'custom',
      message: 'GST state code must match the first two digits of the GSTIN',
      path: ['stateCode'],
    });
  }
}

export const createSellerRegistrationSchema = sellerRegistrationFieldsSchema.superRefine(
  assertGstinStateCodeConsistency,
);

export const updateSellerRegistrationSchema = sellerRegistrationFieldsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' })
  .superRefine(assertGstinStateCodeConsistency);

export const updateSellerRegistrationStatusSchema = z.object({
  status: sellerRegistrationStatusSchema,
});

export const listSellerRegistrationsQuerySchema = z.object({
  status: z.string().trim().optional(),
  search: z.string().trim().optional(),
  ...optionalPageQueryFields,
});

// Bounded selector for future invoice-side consumers (AINV-002+): active
// registrations only, matched on branch code, legal name or GSTIN.
export const SELLER_REGISTRATION_OPTIONS_DEFAULT_LIMIT = 20;
export const SELLER_REGISTRATION_OPTIONS_MAX_LIMIT = 50;

export const sellerRegistrationOptionsQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SELLER_REGISTRATION_OPTIONS_MAX_LIMIT)
    .default(SELLER_REGISTRATION_OPTIONS_DEFAULT_LIMIT),
});
