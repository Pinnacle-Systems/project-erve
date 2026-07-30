import { z } from 'zod';

const expectedVersion = z.number().int().positive();
const defectCategory = z.enum([
  'STITCHING',
  'FABRIC',
  'PRINT_EMBROIDERY',
  'MEASUREMENT',
  'FINISHING',
  'PACKAGING',
  'OTHER',
]);

export const qaQueueQuerySchema = z.object({
  filter: z
    .enum([
      'AWAITING_FIRST_INSPECTION',
      'IN_PROGRESS',
      'REWORK_REQUIRED',
      'READY_FOR_REINSPECTION',
      'COMPLETED',
    ])
    .optional(),
  factoryId: z.string().min(1).optional(),
  search: z.string().trim().max(100).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const startInspectionSchema = z.object({
  expectedVersion,
  sourceReworkTaskIds: z.array(z.string().min(1)).max(100).default([]),
});

export const saveInspectionSchema = z.object({
  expectedVersion,
  notes: z.string().trim().max(2000).nullable().optional(),
  lines: z
    .array(
      z
        .object({
          jobOrderLineSizeId: z.string().min(1),
          sourceReworkTaskId: z.string().min(1).nullable().optional(),
          inspectedQuantity: z.number().int().min(0),
          acceptedQuantity: z.number().int().min(0),
          reworkQuantity: z.number().int().min(0),
          permanentlyRejectedQuantity: z.number().int().min(0),
          defectCategory: defectCategory.nullable().optional(),
          defectNotes: z.string().trim().max(2000).nullable().optional(),
        })
        .superRefine((line, context) => {
          if (
            line.inspectedQuantity !==
            line.acceptedQuantity + line.reworkQuantity + line.permanentlyRejectedQuantity
          ) {
            context.addIssue({
              code: 'custom',
              message: 'Inspected quantity must equal accepted + rework + permanently rejected',
            });
          }
          if (
            (line.reworkQuantity > 0 || line.permanentlyRejectedQuantity > 0) &&
            !line.defectCategory
          ) {
            context.addIssue({ code: 'custom', message: 'A defect category is required' });
          }
        }),
    )
    .min(1)
    .max(500),
});

export const versionSchema = z.object({ expectedVersion });
export const reopenSchema = z.object({
  expectedVersion,
  reason: z.string().trim().min(3).max(1000),
});
export const reworkActionSchema = z.object({
  expectedVersion,
  notes: z.string().trim().max(1000).nullable().optional(),
});
