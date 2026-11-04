import { z } from 'zod';
import {
  MAX_DISTANCE_KM,
  TRANSPORTER_ID,
  TRANSPORT_DOCUMENT_NUMBER,
  VEHICLE_NUMBER,
} from './eway-bill-request.mapper.js';

// ---------------------------------------------------------------------------
// Request schemas for the B2B E-Way Bill operations. Every body is STRICT:
// an unknown key (notably mode, test_mode, credentials, integrationMode,
// source, verificationStatus, outcome) is a 400, never silently ignored, so a
// client can never ask for a Live operation or choose a verification status.
//
// Movement capture validates the FORMAT of whatever is supplied (reusing the
// request mapper's rules so capture and request-building cannot drift) but
// never requires completeness: a partially captured movement is valid, and
// completeness is judged by the generation preview.
// ---------------------------------------------------------------------------

export const taxInvoiceParamsSchema = z.object({ id: z.string().trim().min(1).max(128) });
export const attemptParamsSchema = taxInvoiceParamsSchema.extend({
  attemptId: z.string().trim().min(1).max(128),
});

const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim().length === 0 ? null : value;

/** Optional free text: trimmed, a blank string becomes null, absent becomes null. */
const optionalText = (max: number) =>
  z.preprocess(blankToNull, z.string().trim().min(1).max(max).nullable().optional()).transform(
    (value) => value ?? null,
  );

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'Not a real calendar date');

const dispatchFromSchema = z
  .object({
    addressLine1: optionalText(120),
    addressLine2: optionalText(120),
    city: optionalText(50),
    state: optionalText(60),
    stateCode: z.preprocess(blankToNull, z.string().trim().regex(/^\d{2}$/, 'A 2-digit GST state code').nullable().optional()).transform((value) => value ?? null),
    postalCode: z.preprocess(blankToNull, z.string().trim().regex(/^\d{6}$/, 'A 6-digit pincode').nullable().optional()).transform((value) => value ?? null),
  })
  .strict();

const vehicleNumberSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(20)
    .transform((value) => value.toUpperCase())
    .refine((value) => VEHICLE_NUMBER.test(value.replace(/[\s-]/g, '')), {
      message: 'A vehicle number is 7 to 15 letters or digits (spaces and hyphens are ignored)',
    })
    .nullable()
    .optional(),
).transform((value) => value ?? null);

const transporterIdSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => TRANSPORTER_ID.test(value), {
      message: 'A transporter ID is 15 characters: two digits then 13 letters or digits',
    })
    .nullable()
    .optional(),
).transform((value) => value ?? null);

const transportDocumentNumberSchema = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .refine((value) => TRANSPORT_DOCUMENT_NUMBER.test(value), {
      message: 'A transport document number is at most 15 letters, digits, "/" or "-"',
    })
    .nullable()
    .optional(),
).transform((value) => value ?? null);

export const updateEwayBillMovementSchema = z
  .object({
    expectedVersion: z.number().int().min(0).max(2147483646),
    transportMode: z.enum(['ROAD', 'RAIL', 'AIR', 'SHIP']).nullable().optional(),
    vehicleNumber: vehicleNumberSchema,
    vehicleType: z.enum(['REGULAR', 'OVER_DIMENSIONAL']).nullable().optional(),
    transporterId: transporterIdSchema,
    transporterName: optionalText(100),
    transportDocumentNumber: transportDocumentNumberSchema,
    transportDocumentDate: z.preprocess(blankToNull, isoDate.nullable().optional()),
    // 0 is a valid, captured value (NIC derives the distance); null = not captured.
    approximateDistanceKm: z.number().int().min(0).max(MAX_DISTANCE_KM).nullable().optional(),
    shipToArrangement: z.enum(['BILLED_PARTY', 'DIFFERENT_PARTY']).nullable().optional(),
    dispatchFromArrangement: z
      .enum(['SUPPLIER_REGISTERED_PREMISES', 'DIFFERENT_PLACE'])
      .nullable()
      .optional(),
    dispatchFrom: dispatchFromSchema.nullable().optional(),
  })
  .strict();
export type UpdateEwayBillMovementInput = z.infer<typeof updateEwayBillMovementSchema>;

export const generateEwayBillDemoSchema = z
  .object({
    expectedMovementVersion: z.number().int().min(0).max(2147483646),
    acknowledgeApplicabilityUndetermined: z.boolean().optional(),
  })
  .strict();
export type GenerateEwayBillDemoInput = z.infer<typeof generateEwayBillDemoSchema>;

export const closeEwayBillDemoAttemptSchema = z
  .object({
    expectedOutcome: z.enum(['PREPARED', 'DISPATCHED', 'UNCERTAIN']),
    reason: z.string().trim().min(10, 'Give a reason of at least 10 characters').max(500),
  })
  .strict();
export type CloseEwayBillDemoAttemptInput = z.infer<typeof closeEwayBillDemoAttemptSchema>;

// A statutory E-Way Bill number is 12 digits. A provider's synthetic "TEST-"
// reference can never be recorded as a Live bill.
export const linkEwayBillSchema = z
  .object({
    ewayBillNumber: z
      .string()
      .trim()
      .refine((value) => !/^test-/i.test(value), 'A synthetic TEST- reference cannot be linked as a live E-Way Bill')
      .refine((value) => /^\d{12}$/.test(value), 'An E-Way Bill number is exactly 12 digits'),
  })
  .strict();
export type LinkEwayBillInput = z.infer<typeof linkEwayBillSchema>;
