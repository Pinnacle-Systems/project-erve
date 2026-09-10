import { z } from 'zod';

const componentId = z.string().trim().min(1);
const key = z.string().trim().min(1).max(80);
const optionalRemarks = z.string().max(5000).optional().nullable();

export const startQualityExecutionSchema = z
  .object({
    sampleJobOrderLineSizeId: z.string().trim().min(1).optional(),
    sampleQuantity: z.number().int().positive().max(2_147_483_647).optional(),
    allocations: z
      .array(
        z.object({
          jobOrderLineSizeId: z.string().trim().min(1),
          quantity: z.number().int().positive().max(2_147_483_647),
        }),
      )
      .min(1)
      .optional(),
  })
  .superRefine((input, context) => {
    if (Boolean(input.sampleJobOrderLineSizeId) !== Boolean(input.sampleQuantity)) {
      context.addIssue({
        code: 'custom',
        message: 'PP Sample size and quantity must be supplied together',
      });
    }
    if (input.allocations) {
      const ids = input.allocations.map((allocation) => allocation.jobOrderLineSizeId);
      if (new Set(ids).size !== ids.length) {
        context.addIssue({
          code: 'custom',
          path: ['allocations'],
          message: 'Duplicate Final batch size allocations are not allowed',
        });
      }
    }
  });

export const finalBatchActionSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});

export const qualityExecutionPayloadSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    checklistResponses: z
      .array(
        z.object({
          componentId,
          itemKey: key,
          response: z.string().trim().min(1).max(80),
          remarks: optionalRemarks,
        }),
      )
      .default([]),
    aqlResults: z
      .array(
        z.object({
          componentId,
          severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR']),
          maxAllowed: z.number().int().nonnegative().optional().nullable(),
          found: z.number().int().nonnegative().optional().nullable(),
        }),
      )
      .default([]),
    defects: z
      .array(
        z.object({
          componentId,
          description: z.string().trim().min(1).max(1000),
          severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR']),
          quantity: z.number().int().nonnegative().optional().nullable(),
        }),
      )
      .default([]),
    correctiveActions: z
      .array(
        z.object({
          componentId,
          values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        }),
      )
      .default([]),
    testResults: z
      .array(
        z.object({
          componentId,
          testKey: key,
          response: z.string().trim().min(1).max(80),
          remarks: optionalRemarks,
        }),
      )
      .default([]),
    quantities: z
      .array(z.object({ componentId, fieldKey: key, value: z.number().finite().nonnegative() }))
      .default([]),
    comments: z.array(z.object({ componentId, value: z.string().max(10000) })).default([]),
    fieldResponses: z
      .array(z.object({ componentId, fieldKey: key, value: z.string().max(5000) }))
      .default([]),
    attendees: z
      .array(
        z.object({ componentId, roleKey: key, attendeeName: z.string().trim().min(1).max(160) }),
      )
      .default([]),
    actions: z
      .array(
        z.object({
          componentId,
          values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
        }),
      )
      .default([]),
    signoffs: z
      .array(
        z.object({ componentId, roleKey: key, signatoryName: z.string().trim().min(1).max(160) }),
      )
      .default([]),
    outcome: z
      .object({ componentId, value: z.enum(['PASS', 'FAIL']), remarks: optionalRemarks })
      .optional()
      .nullable(),
  })
  .superRefine((input, context) => {
    const unique = (values: string[], path: string) => {
      if (new Set(values).size !== values.length)
        context.addIssue({
          code: 'custom',
          path: [path],
          message: 'Duplicate responses are not allowed',
        });
    };
    unique(
      input.checklistResponses.map((x) => `${x.componentId}:${x.itemKey}`),
      'checklistResponses',
    );
    unique(
      input.aqlResults.map((x) => `${x.componentId}:${x.severity}`),
      'aqlResults',
    );
    unique(
      input.testResults.map((x) => `${x.componentId}:${x.testKey}`),
      'testResults',
    );
    unique(
      input.quantities.map((x) => `${x.componentId}:${x.fieldKey}`),
      'quantities',
    );
    unique(
      input.comments.map((x) => x.componentId),
      'comments',
    );
    unique(
      input.fieldResponses.map((x) => `${x.componentId}:${x.fieldKey}`),
      'fieldResponses',
    );
    unique(
      input.attendees.map((x) => `${x.componentId}:${x.roleKey}:${x.attendeeName}`),
      'attendees',
    );
    unique(
      input.signoffs.map((x) => `${x.componentId}:${x.roleKey}`),
      'signoffs',
    );
  });

export const attachmentParamsSchema = z.object({
  componentId: z.string().trim().min(1),
  requirementKey: key,
});

export type QualityExecutionPayload = z.infer<typeof qualityExecutionPayloadSchema>;
