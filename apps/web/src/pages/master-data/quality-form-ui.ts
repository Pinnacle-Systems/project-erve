import { isAxiosError } from 'axios';
import type { QualityFormComponentType, QualityFormSection } from './types.js';

export const QUALITY_COMPONENT_TYPES: QualityFormComponentType[] = [
  'SYSTEM_CONTEXT',
  'FIELD_GROUP',
  'ATTENDEE_LIST',
  'ACTION_LIST',
  'CHECKLIST',
  'AQL_RESULT',
  'PRODUCTION_PROGRESS',
  'DEFECT_LIST',
  'CORRECTIVE_ACTIONS',
  'TEST_RESULTS',
  'COMMENTS',
  'ATTACHMENTS',
  'SIGNATURES',
  'QUANTITY_RECONCILIATION',
  'INSPECTION_OUTCOME',
];
export const componentLabel = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
export const defaultConfig = (type: QualityFormComponentType): Record<string, unknown> =>
  ({
    SYSTEM_CONTEXT: {
      fields: [{ key: 'contextValue', label: 'Context value', dataType: 'TEXT', source: 'SYSTEM', sourceKey: 'JOB_ORDER_NUMBER' }],
    },
    FIELD_GROUP: { fields: [{ key: 'fieldValue', label: 'Field value', dataType: 'TEXT' }] },
    ATTENDEE_LIST: { roles: ['Attendee'], allowOther: true },
    ACTION_LIST: {
      columns: [{ key: 'action', label: 'Action', dataType: 'TEXT', required: true }],
    },
    CHECKLIST: {
      items: [{ key: 'checkItem', label: 'Check item' }],
      responseOptions: ['PASSED', 'FAILED', 'N/A'],
    },
    AQL_RESULT: {
      criteria: [
        { severity: 'CRITICAL', aql: 0 },
        { severity: 'MAJOR', aql: 2.5 },
        { severity: 'MINOR', aql: 4 },
      ],
    },
    PRODUCTION_PROGRESS: {
      metrics: [{ key: 'progress', label: 'Production progress', source: 'SYSTEM', sourceActivityCode: 'SEWING' }],
    },
    DEFECT_LIST: { severities: ['CRITICAL', 'MAJOR', 'MINOR'], captureQuantity: true },
    CORRECTIVE_ACTIONS: {
      columns: [{ key: 'action', label: 'Action', dataType: 'TEXT', required: true }],
    },
    TEST_RESULTS: {
      tests: [{ key: 'test', label: 'Test', responseOptions: ['PASSED', 'FAILED', 'N/A'] }],
    },
    COMMENTS: { maxLength: 5000 },
    ATTACHMENTS: { requirements: [{ key: 'evidence', label: 'Evidence' }] },
    SIGNATURES: { roles: [{ key: 'inspector', label: 'Inspector', required: true }] },
    QUANTITY_RECONCILIATION: {
      fields: [{ key: 'quantity', label: 'Quantity', dataType: 'NUMBER', required: true }],
    },
    INSPECTION_OUTCOME: {
      allowedOutcomes: ['PASS', 'FAIL'],
      remarksRequiredWhen: 'FAIL',
    },
  })[type];
export const emptyDefinition = (): QualityFormSection[] => [
  {
    sequence: 1,
    title: 'Form details',
    description: null,
    components: [
      {
        sequence: 1,
        type: 'COMMENTS',
        title: 'Comments',
        description: null,
        config: defaultConfig('COMMENTS'),
      },
    ],
  },
];
export function qualityFormError(caught: unknown, fallback: string) {
  if (isAxiosError(caught))
    return (caught.response?.data?.error?.message as string | undefined) ?? fallback;
  return caught instanceof Error ? caught.message : fallback;
}
