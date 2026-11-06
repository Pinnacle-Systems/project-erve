import { z } from 'zod';

// Largest values the persisted columns can hold (Decimal(12,2) unit rate,
// Decimal(14,2) GST) — beyond these Postgres would raise a numeric overflow
// (a 500) instead of a clean validation error.
const MAX_UNIT_RATE = 9_999_999_999.99;
const MAX_GST_AMOUNT = 999_999_999_999.99;

// Amounts are stored to two decimal places; a value with more would be
// silently rounded by the column while line amounts were computed from the
// unrounded input, so reject it up front instead.
const hasAtMostTwoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7;
const TWO_DECIMAL_MESSAGE = 'Amount can have at most 2 decimal places';

// Matches StyleFactoryMapping.exFactoryPrice's own validation
// (master-data.validation.ts) — a unit rate follows the same master-data
// rule (positive, stored to 2 decimals) rather than a stricter one invented
// for this module.
const unitRateMoney = z.coerce.number().positive().max(MAX_UNIT_RATE).refine(hasAtMostTwoDecimals, TWO_DECIMAL_MESSAGE);
// GST is a manually entered, free-edit INR amount (never calculated) — zero
// is a valid "no GST" state, so this allows it.
const gstMoney = z.coerce.number().nonnegative().max(MAX_GST_AMOUNT).refine(hasAtMostTwoDecimals, TWO_DECIMAL_MESSAGE);

// Factory confirmation is of one specific saved invoice version: the version
// the Factory User actually reviewed, so a concurrent Accountant save can
// never be confirmed unseen.
export const confirmFactoryInvoiceSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export const updateFactoryInvoiceFinancialsSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    lines: z
      .array(
        z.object({
          id: z.string().trim().min(1),
          unitRate: unitRateMoney,
        }),
      )
      .optional(),
    gstAmount: gstMoney.optional(),
    remarks: z.string().trim().max(2000).optional().nullable(),
  })
  .strict();

export const listFactoryInvoicesQuerySchema = z.object({
  status: z.enum(['GENERATED', 'FACTORY_CONFIRMED', 'FINALIZED']).optional(),
  factoryId: z.string().trim().optional(),
  cursor: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
