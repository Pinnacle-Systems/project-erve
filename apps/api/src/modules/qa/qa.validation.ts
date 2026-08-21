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
const checklistItemCode = z.enum([
  'FABRIC_COLOUR_QUALITY',
  'TRIMS_CARD',
  'FABRIC_GSM',
  'MEASUREMENTS_REPORT',
  'GARMENT_CONSTRUCTION',
  'GENERAL_QUALITY_PRESENTATION',
  'LABELLING_POSITION',
  'FIT_SAMPLE_BUYER_COMMENTS',
  'SPI',
  'SAMPLE_TAG',
  'DATA_SHEET_PULL_TEST_PINCH_SETTING',
  'METAL_DETECTION',
  'P_AND_P',
  'PP_SAMPLE_FIT_COMMENTS',
  'SOURCE_DECLARATION_FORM',
]);
const checklistStatus = z.enum(['YES', 'NO', 'AVAILABLE']);

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

// A size form is the unit of editing.
export const saveSizeInspectionFormSchema = z
  .object({
    expectedVersion,
    sampleQuantity: z.number().int().min(0).max(2_147_483_647).nullable().optional(),
    inspectionRemarks: z.string().trim().max(2000).nullable().optional(),
    checklist: z
      .array(
        z.object({
          itemCode: checklistItemCode,
          status: checklistStatus.nullable(),
          remarks: z.string().trim().max(2000).nullable(),
        }),
      )
      .length(15)
      .superRefine((items, context) => {
        if (new Set(items.map((item) => item.itemCode)).size !== items.length)
          context.addIssue({
            code: 'custom',
            message: 'Duplicate checklist items are not allowed',
          });
      }),
    inspectedQuantity: z.number().int().min(0).optional(),
    acceptedQuantity: z.number().int().min(0).optional(),
    reworkQuantity: z.number().int().min(0).optional(),
    permanentlyRejectedQuantity: z.number().int().min(0).optional(),
    defectCategory: defectCategory.nullable().optional(),
    otherDefectDetails: z.string().trim().min(1).max(2000).nullable().optional(),
    defectNotes: z.string().trim().max(2000).nullable().optional(),
  })
  .superRefine((form, context) => {
    const dispositions = [
      form.inspectedQuantity,
      form.acceptedQuantity,
      form.reworkQuantity,
      form.permanentlyRejectedQuantity,
    ];
    if (
      dispositions.some((quantity) => quantity !== undefined) &&
      dispositions.some((quantity) => quantity === undefined)
    )
      context.addIssue({
        code: 'custom',
        message: 'All disposition quantities must be supplied together',
      });
    else if (
      dispositions.every((quantity) => quantity !== undefined) &&
      form.inspectedQuantity !==
        form.acceptedQuantity! + form.reworkQuantity! + form.permanentlyRejectedQuantity!
    )
      context.addIssue({
        code: 'custom',
        message: 'Inspected quantity must equal accepted + rework + permanently rejected',
      });
    if (form.defectCategory !== 'OTHER' && form.otherDefectDetails)
      context.addIssue({ code: 'custom', message: 'Other defect details only apply to OTHER' });
  });

export const versionSchema = z.object({ expectedVersion });
export const finalizeSizeInspectionSchema = z.object({
  expectedVersion,
  ppSampleDecision: z.enum(['PASS', 'FAIL']).optional(),
});
export const reopenSchema = z.object({
  expectedVersion,
  reason: z.string().trim().min(3).max(1000),
});
export const reworkActionSchema = z.object({
  expectedVersion,
  notes: z.string().trim().max(1000).nullable().optional(),
});
export const reworkNotesSchema = z.object({
  expectedVersion,
  notes: z.string().trim().max(1000).nullable(),
});
