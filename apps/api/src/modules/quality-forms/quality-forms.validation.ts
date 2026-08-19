import { z } from 'zod';

export const qualityFormStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const qualityFormActivityTypeSchema = z.enum(['MEETING', 'INSPECTION']);
export const qualityFormExecutionScopeSchema = z.enum(['JOB_ORDER', 'SIZE']);

const codeSchema = z
  .string()
  .trim()
  .min(1, 'Code is required')
  .max(30)
  .transform((value) => value.toUpperCase().replace(/[\s-]+/g, '_'))
  .pipe(
    z
      .string()
      .regex(
        /^[A-Z][A-Z0-9_]*$/,
        'Code must start with a letter and contain only letters, numbers, and underscores',
      ),
  );
const requiredText = z.string().trim().min(1).max(160);
const optionalText = z.string().trim().max(500).optional().nullable();

export const createQualityFormSchema = z.object({
  code: codeSchema,
  name: requiredText,
  description: optionalText,
  activityType: qualityFormActivityTypeSchema,
  executionScope: qualityFormExecutionScopeSchema,
  status: qualityFormStatusSchema.optional(),
  sections: z.array(z.unknown()).optional(),
});

export const updateQualityFormSchema = createQualityFormSchema
  .pick({ code: true, name: true, description: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' });
export const updateQualityFormStatusSchema = z.object({ status: qualityFormStatusSchema });
export const listQualityFormsQuerySchema = z.object({
  search: z.string().trim().optional(),
  status: qualityFormStatusSchema.optional(),
  activityType: qualityFormActivityTypeSchema.optional(),
  executionScope: qualityFormExecutionScopeSchema.optional(),
});

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][A-Za-z0-9]*$/, 'Keys must use lower camel case');
const optionSchema = z.string().trim().min(1).max(80);
const systemContextSourceSchema = z.enum([
  'SUPPLIER_NAME',
  'FACTORY_NAME',
  'STYLE_NUMBER',
  'CUSTOMER_NAME',
  'PURCHASE_ORDER_NUMBER',
  'JOB_ORDER_NUMBER',
  'ORDER_QUANTITY',
  'REPORT_DATE',
  'ETD',
  'COLOUR',
  'SHIP_QUANTITY',
  'MERCHANDISER_NAME',
  'CUTTING_PLANNING_DATE',
  'SEWING_PLANNING_DATE',
  'MEETING_CONDUCTED_BY',
  'BATCH_INSPECTED_QUANTITY',
]);
const uniqueValues = (values: string[], context: z.RefinementCtx, message: string) => {
  if (new Set(values).size !== values.length) context.addIssue({ code: 'custom', message });
};
const fieldSchema = z
  .object({
    key: keySchema,
    label: requiredText,
    dataType: z.enum(['TEXT', 'NUMBER', 'DATE', 'BOOLEAN', 'SELECT']),
    required: z.boolean().optional(),
    source: z.enum(['SYSTEM', 'USER']).optional(),
    sourceKey: systemContextSourceSchema.optional(),
    options: z.array(optionSchema).min(1).optional(),
  })
  .superRefine((field, context) => {
    if (field.source === 'SYSTEM' && !field.sourceKey) {
      context.addIssue({
        code: 'custom',
        path: ['sourceKey'],
        message: 'System fields require a stable sourceKey',
      });
    }
    if (field.source !== 'SYSTEM' && field.sourceKey) {
      context.addIssue({
        code: 'custom',
        path: ['sourceKey'],
        message: 'sourceKey is only valid for system fields',
      });
    }
    if (field.dataType === 'SELECT' && !field.options?.length) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Select fields require options',
      });
    }
    if (field.dataType !== 'SELECT' && field.options) {
      context.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'Options are only valid for select fields',
      });
    }
    if (field.options) {
      uniqueValues(field.options, context, 'Field options must be unique');
    }
  });
const uniqueKeys = <T extends { key: string }>(items: T[], context: z.RefinementCtx) => {
  if (new Set(items.map((item) => item.key)).size !== items.length) {
    context.addIssue({ code: 'custom', message: 'Keys must be unique within a component' });
  }
};
const fieldsConfig = z
  .object({ fields: z.array(fieldSchema).min(1) })
  .superRefine(({ fields }, context) => uniqueKeys(fields, context));
const systemFieldsConfig = z
  .object({
    fields: z
      .array(
        fieldSchema.refine((field) => field.source === 'SYSTEM', {
          path: ['source'],
          message: 'System context fields must use the SYSTEM source',
        }),
      )
      .min(1),
  })
  .superRefine(({ fields }, context) => uniqueKeys(fields, context));
const columnsConfig = z
  .object({
    columns: z
      .array(
        z.object({
          key: keySchema,
          label: requiredText,
          dataType: z.enum(['TEXT', 'NUMBER', 'DATE', 'SELECT']),
          options: z.array(optionSchema).min(1).optional(),
          required: z.boolean().optional(),
        }),
      )
      .min(1),
  })
  .superRefine(({ columns }, context) => {
    uniqueKeys(columns, context);
    columns.forEach((column, index) => {
      if (column.dataType === 'SELECT' && !column.options?.length) {
        context.addIssue({
          code: 'custom',
          path: ['columns', index, 'options'],
          message: 'Select columns require options',
        });
      }
      if (column.dataType !== 'SELECT' && column.options) {
        context.addIssue({
          code: 'custom',
          path: ['columns', index, 'options'],
          message: 'Options are only valid for select columns',
        });
      }
      if (column.options) {
        uniqueValues(column.options, context, 'Column options must be unique');
      }
    });
  });

const checklistConfig = z
  .object({
    items: z.array(z.object({ key: keySchema, label: requiredText })).min(1),
    responseOptions: z.array(optionSchema).min(2),
  })
  .superRefine(({ items, responseOptions }, context) => {
    uniqueKeys(items, context);
    uniqueValues(responseOptions, context, 'Checklist response options must be unique');
  });

const componentBase = {
  title: requiredText,
  description: optionalText,
  sequence: z.coerce.number().int().positive().optional(),
};
export const qualityFormComponentSchema = z.discriminatedUnion('type', [
  z.object({ ...componentBase, type: z.literal('SYSTEM_CONTEXT'), config: systemFieldsConfig }),
  z.object({ ...componentBase, type: z.literal('FIELD_GROUP'), config: fieldsConfig }),
  z.object({
    ...componentBase,
    type: z.literal('ATTENDEE_LIST'),
    config: z
      .object({ roles: z.array(optionSchema).min(1), allowOther: z.boolean().optional() })
      .superRefine(({ roles }, context) =>
        uniqueValues(roles, context, 'Attendee roles must be unique'),
      ),
  }),
  z.object({ ...componentBase, type: z.literal('ACTION_LIST'), config: columnsConfig }),
  z.object({
    ...componentBase,
    type: z.literal('CHECKLIST'),
    config: checklistConfig,
  }),
  z.object({
    ...componentBase,
    type: z.literal('AQL_RESULT'),
    config: z
      .object({
        inspectionLevel: requiredText.optional(),
        criteria: z
          .array(
            z.object({
              severity: z.enum(['CRITICAL', 'MAJOR', 'MINOR']),
              aql: z.number().min(0).max(100),
            }),
          )
          .min(1),
      })
      .superRefine(({ criteria }, context) =>
        uniqueValues(
          criteria.map((criterion) => criterion.severity),
          context,
          'AQL severities must be unique',
        ),
      ),
  }),
  z.object({
    ...componentBase,
    type: z.literal('PRODUCTION_PROGRESS'),
    config: z
      .object({
        metrics: z
          .array(
            z.object({
              key: keySchema,
              label: requiredText,
              source: z.literal('SYSTEM'),
              sourceActivityCode: codeSchema,
            }),
          )
          .min(1),
      })
      .superRefine(({ metrics }, context) => uniqueKeys(metrics, context)),
  }),
  z.object({
    ...componentBase,
    type: z.literal('DEFECT_LIST'),
    config: z
      .object({
        severities: z.array(z.enum(['CRITICAL', 'MAJOR', 'MINOR'])).min(1),
        captureQuantity: z.boolean().optional(),
      })
      .superRefine(({ severities }, context) =>
        uniqueValues(severities, context, 'Defect severities must be unique'),
      ),
  }),
  z.object({ ...componentBase, type: z.literal('CORRECTIVE_ACTIONS'), config: columnsConfig }),
  z.object({
    ...componentBase,
    type: z.literal('TEST_RESULTS'),
    config: z
      .object({
        tests: z
          .array(
            z.object({
              key: keySchema,
              label: requiredText,
              responseOptions: z.array(optionSchema).min(2),
            }),
          )
          .min(1),
      })
      .superRefine(({ tests }, context) => {
        uniqueKeys(tests, context);
        tests.forEach((test) =>
          uniqueValues(test.responseOptions, context, 'Test response options must be unique'),
        );
      }),
  }),
  z.object({
    ...componentBase,
    type: z.literal('COMMENTS'),
    config: z.object({
      required: z.boolean().optional(),
      maxLength: z.number().int().positive().max(10000).optional(),
    }),
  }),
  z.object({
    ...componentBase,
    type: z.literal('ATTACHMENTS'),
    config: z
      .object({
        requirements: z
          .array(
            z
              .object({
                key: keySchema,
                label: requiredText,
                required: z.boolean().optional(),
                requiredWhen: z.enum(['ALWAYS', 'INSPECTION_FAILED']).optional(),
              })
              .refine((item) => !(item.required && item.requiredWhen === 'INSPECTION_FAILED'), {
                message: 'Use either required or requiredWhen',
              }),
          )
          .min(1),
      })
      .superRefine(({ requirements }, context) => uniqueKeys(requirements, context)),
  }),
  z.object({
    ...componentBase,
    type: z.literal('SIGNATURES'),
    config: z
      .object({
        roles: z
          .array(
            z.object({ key: keySchema, label: requiredText, required: z.boolean().optional() }),
          )
          .min(1),
      })
      .superRefine(({ roles }, context) => uniqueKeys(roles, context)),
  }),
  z.object({ ...componentBase, type: z.literal('QUANTITY_RECONCILIATION'), config: fieldsConfig }),
  z.object({
    ...componentBase,
    type: z.literal('INSPECTION_OUTCOME'),
    config: z.object({
      allowedOutcomes: z
        .array(z.enum(['PASS', 'FAIL']))
        .min(2)
        .max(2)
        .refine((values) => new Set(values).size === values.length, {
          message: 'Inspection outcomes must be unique',
        }),
      remarksRequiredWhen: z.enum(['FAIL']).optional(),
    }),
  }),
]);

export const qualityFormSectionSchema = z.object({
  sequence: z.coerce.number().int().positive().optional(),
  title: requiredText,
  description: optionalText,
  components: z
    .array(qualityFormComponentSchema)
    .min(1, 'Each section requires at least one component'),
});

export const qualityFormDefinitionSchema = z
  .object({
    sections: z.array(qualityFormSectionSchema).min(1, 'At least one section is required'),
  })
  .superRefine(({ sections }, context) => {
    const validateOrder = (values: Array<{ sequence?: number }>, path: Array<string | number>) => {
      const supplied = values.map((value) => value.sequence);
      if (supplied.some((value) => value !== undefined)) {
        if (
          supplied.some((value) => value === undefined) ||
          supplied.some((value, index) => value !== index + 1)
        ) {
          context.addIssue({
            code: 'custom',
            path,
            message: 'Sequences must be contiguous starting at 1',
          });
        }
      }
    };
    validateOrder(sections, ['sections']);
    sections.forEach((section, index) =>
      validateOrder(section.components, ['sections', index, 'components']),
    );
  });

export const createQualityFormVersionSchema = z
  .object({
    copyFromVersionId: z.string().trim().min(1).optional(),
    sections: qualityFormDefinitionSchema.shape.sections.optional(),
    activityType: qualityFormActivityTypeSchema.optional(),
    executionScope: qualityFormExecutionScopeSchema.optional(),
  })
  .superRefine((input, context) => {
    if (input.copyFromVersionId && (input.sections || input.activityType || input.executionScope)) {
      context.addIssue({
        code: 'custom',
        message: 'A copied version inherits its definition, activity type, and scope',
      });
    }
    if (
      !input.copyFromVersionId &&
      (!input.sections || !input.activityType || !input.executionScope)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'New definitions require sections, activity type, and execution scope',
      });
    }
  });

export const replaceQualityFormDefinitionSchema = qualityFormDefinitionSchema.extend({
  activityType: qualityFormActivityTypeSchema,
  executionScope: qualityFormExecutionScopeSchema,
});

export type QualityFormDefinitionInput = z.infer<typeof qualityFormDefinitionSchema>;
