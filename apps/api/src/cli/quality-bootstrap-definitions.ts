// Canonical, current Quality Form and Process Flow definitions for the Erve
// Production + Quality workflow. Pure configuration only: no Prisma import,
// no database access at import time. Consumed by both the dev/test seed
// (apps/api/prisma/seed.ts) and the production quality-bootstrap CLI
// (quality-bootstrap.ts) so the two never drift.
//
// These are deliberately the *current* shapes only. Historical/superseded
// definitions (e.g. the legacy Inline Inspection Report that carried a
// percentage-based PRODUCTION_PROGRESS component) are not represented here —
// they remain reproducible as local, clearly-marked fixtures in seed.ts,
// since a "canonical" module by definition holds one current shape per code.
import { QA_CHECKLIST_ITEMS } from '@erve/types';

export type QualityFormComponentType =
  | 'SYSTEM_CONTEXT'
  | 'FIELD_GROUP'
  | 'ATTENDEE_LIST'
  | 'ACTION_LIST'
  | 'CHECKLIST'
  | 'AQL_RESULT'
  | 'PRODUCTION_PROGRESS'
  | 'DEFECT_LIST'
  | 'CORRECTIVE_ACTIONS'
  | 'TEST_RESULTS'
  | 'COMMENTS'
  | 'ATTACHMENTS'
  | 'SIGNATURES'
  | 'QUANTITY_RECONCILIATION'
  | 'INSPECTION_OUTCOME';

export type SeedComponent = {
  type: QualityFormComponentType;
  title: string;
  config: object;
};
export type SeedSection = { title: string; components: SeedComponent[] };

export const definitionKey = (label: string) =>
  label
    .replace(/&/g, ' and ')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((part, index) =>
      index === 0
        ? part.toLowerCase()
        : `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`,
    )
    .join('');

export const CONTEXT_SOURCES: Record<string, string> = {
  Supplier: 'SUPPLIER_NAME',
  'Supplier Name': 'SUPPLIER_NAME',
  'Factory Name': 'FACTORY_NAME',
  Style: 'STYLE_NUMBER',
  Customer: 'CUSTOMER_NAME',
  'Purchase Order': 'PURCHASE_ORDER_NUMBER',
  'Order Number': 'PURCHASE_ORDER_NUMBER',
  'Order Qty': 'ORDER_QUANTITY',
  Quantity: 'ORDER_QUANTITY',
  'Report Date': 'REPORT_DATE',
  'Meeting Date': 'REPORT_DATE',
  ETD: 'ETD',
  'Delivery Date': 'ETD',
  Color: 'COLOUR',
  'Ship Qty': 'SHIP_QUANTITY',
  Merchandiser: 'MERCHANDISER_NAME',
  'Cutting Planning Date': 'CUTTING_PLANNING_DATE',
  'Sewing Planning Date': 'SEWING_PLANNING_DATE',
  'Meeting Conducted By': 'MEETING_CONDUCTED_BY',
};

export const context = (fields: string[]): SeedComponent => ({
  type: 'SYSTEM_CONTEXT',
  title: 'System context',
  config: {
    fields: fields.map((label) => ({
      key: definitionKey(label),
      label,
      dataType: label.includes('Date')
        ? 'DATE'
        : label.includes('Quantity') || label.includes('Qty')
          ? 'NUMBER'
          : label === 'ETD'
            ? 'DATE'
            : 'TEXT',
      source: 'SYSTEM',
      sourceKey: CONTEXT_SOURCES[label],
    })),
  },
});

export const signatures = (roles: string[]): SeedComponent => ({
  type: 'SIGNATURES',
  title: 'Sign-off',
  config: {
    roles: roles.map((label) => ({
      key: definitionKey(label),
      label,
      required: true,
    })),
  },
});

export const aql: SeedComponent = {
  type: 'AQL_RESULT',
  title: 'AQL defect summary',
  config: {
    inspectionLevel: 'General Inspection Level II',
    criteria: [
      { severity: 'CRITICAL', aql: 0 },
      { severity: 'MAJOR', aql: 2.5 },
      { severity: 'MINOR', aql: 4 },
    ],
  },
};

export const defects: SeedComponent = {
  type: 'DEFECT_LIST',
  title: 'Workmanship defects',
  config: { severities: ['CRITICAL', 'MAJOR', 'MINOR'], captureQuantity: true },
};

export interface CanonicalQualityFormDefinition {
  code: string;
  name: string;
  activityType: 'MEETING' | 'INSPECTION';
  executionScope: 'JOB_ORDER' | 'SIZE';
  sections: SeedSection[];
}

const SAMPLE: CanonicalQualityFormDefinition = {
  code: 'SAMPLE',
  name: 'QA Sample Checklist',
  activityType: 'INSPECTION',
  executionScope: 'SIZE',
  sections: [
    {
      title: 'Existing QA checklist',
      components: [
        {
          type: 'CHECKLIST',
          title: 'Sample checklist',
          config: {
            items: QA_CHECKLIST_ITEMS.map(({ code, label }) => ({
              key: definitionKey(code),
              label,
            })),
            responseOptions: ['YES', 'NO'],
          },
        },
        defects,
        { type: 'COMMENTS', title: 'Inspection remarks', config: { maxLength: 5000 } },
        {
          type: 'ATTACHMENTS',
          title: 'Evidence',
          config: { requirements: [{ key: 'inspectionEvidence', label: 'Inspection evidence' }] },
        },
      ],
    },
  ],
};

const PPM: CanonicalQualityFormDefinition = {
  code: 'PPM',
  name: 'Pre-Production Meeting Report',
  activityType: 'MEETING',
  executionScope: 'JOB_ORDER',
  sections: [
    {
      title: 'Meeting context',
      components: [
        context(['Supplier Name', 'Factory Name', 'Style', 'Customer', 'Order Number', 'Quantity']),
        {
          type: 'FIELD_GROUP',
          title: 'Meeting details',
          config: {
            fields: [
              {
                key: 'meetingDate',
                label: 'Meeting Date',
                dataType: 'DATE',
                source: 'USER',
                required: true,
              },
              {
                key: 'meetingConductedBy',
                label: 'Meeting Conducted By',
                dataType: 'TEXT',
                source: 'USER',
                required: true,
              },
              { key: 'deliveryDate', label: 'Delivery Date', dataType: 'DATE', source: 'USER' },
              {
                key: 'cuttingPlanningDate',
                label: 'Cutting Planning Date',
                dataType: 'DATE',
                source: 'USER',
              },
              {
                key: 'sewingPlanningDate',
                label: 'Sewing Planning Date',
                dataType: 'DATE',
                source: 'USER',
              },
            ],
          },
        },
      ],
    },
    {
      title: 'People and follow-up',
      components: [
        {
          type: 'ATTENDEE_LIST',
          title: 'Attendees',
          config: {
            roles: [
              'Merchandiser',
              'Sample Man',
              'Fabric',
              'Cutting',
              'Molding',
              'Sewing',
              'Outward Processing',
              'Finishing',
              'QA',
              'Mechanic',
              'Washing',
              'Others',
            ],
            allowOther: true,
          },
        },
        {
          type: 'ACTION_LIST',
          title: 'Follow-up actions',
          config: {
            columns: [
              { key: 'action', label: 'Comments / action', dataType: 'TEXT', required: true },
              {
                key: 'followUpPerson',
                label: 'Follow-up person',
                dataType: 'TEXT',
                required: true,
              },
              { key: 'settleDate', label: 'Settle date', dataType: 'DATE' },
            ],
          },
        },
      ],
    },
    { title: 'Approval', components: [signatures(['Inspector', 'QA Manager', 'Supplier'])] },
  ],
};

// Current Inline Inspection Report. Deliberately contains no
// PRODUCTION_PROGRESS component and no percentage-completion field of any
// kind — Inline receives Production lifecycle/context, never a calculated
// Production completion percentage. See CANONICAL_PROCESS_FLOW's INLINE
// stage for how it is associated with the Sewing lifecycle instead.
const INLINE: CanonicalQualityFormDefinition = {
  code: 'INLINE',
  name: 'Inline Inspection Report',
  activityType: 'INSPECTION',
  executionScope: 'JOB_ORDER',
  sections: [
    {
      title: 'Inspection context',
      components: [
        context(['Supplier', 'Style', 'Purchase Order', 'Customer', 'Report Date', 'ETD']),
      ],
    },
    {
      title: 'Inspection results',
      components: [aql, defects],
    },
    {
      title: 'Packing and corrective action',
      components: [
        {
          type: 'CHECKLIST',
          title: 'Pre-packing check',
          config: {
            items: [{ key: 'packing', label: 'Packing and carton information is correct' }],
            responseOptions: ['YES', 'NO', 'N/A'],
          },
        },
        {
          type: 'CORRECTIVE_ACTIONS',
          title: 'Corrective actions',
          config: {
            columns: [
              {
                key: 'defectSpecification',
                label: 'Defect specifications',
                dataType: 'TEXT',
                required: true,
              },
              { key: 'action', label: 'Actions to be taken', dataType: 'TEXT', required: true },
            ],
          },
        },
        { type: 'COMMENTS', title: 'Conclusion and remarks', config: { maxLength: 5000 } },
        {
          type: 'INSPECTION_OUTCOME',
          title: 'Inspection conclusion',
          config: { allowedOutcomes: ['PASS', 'FAIL'], remarksRequiredWhen: 'FAIL' },
        },
        signatures(['Quality Controller', 'Supplier']),
      ],
    },
  ],
};

const FINAL: CanonicalQualityFormDefinition = {
  code: 'FINAL',
  name: 'Final Inspection Report',
  activityType: 'INSPECTION',
  executionScope: 'JOB_ORDER',
  sections: [
    {
      title: 'Inspection context',
      components: [
        context([
          'Supplier',
          'Style',
          'Customer',
          'Purchase Order',
          'Color',
          'Order Qty',
          'Ship Qty',
          'Merchandiser',
          'Report Date',
        ]),
      ],
    },
    {
      title: 'Evidence and sampling',
      components: [
        {
          type: 'ATTACHMENTS',
          title: 'Required evidence',
          config: {
            requirements: [
              { key: 'measurementSheet', label: 'Measurement Sheet', required: true },
              { key: 'washingReport', label: 'Washing Report', required: true },
              {
                key: 'failedPartEvidence',
                label: 'Failed Part Evidence',
                requiredWhen: 'INSPECTION_FAILED',
              },
            ],
          },
        },
        {
          type: 'QUANTITY_RECONCILIATION',
          title: 'Inspection and shipment sampling',
          config: {
            fields: [
              {
                key: 'totalOrderQuantity',
                label: 'Total Order Quantity',
                dataType: 'NUMBER',
                source: 'SYSTEM',
                sourceKey: 'ORDER_QUANTITY',
                required: true,
              },
              {
                key: 'quantityInspected',
                label: 'Quantity Inspected',
                dataType: 'NUMBER',
                source: 'SYSTEM',
                sourceKey: 'BATCH_INSPECTED_QUANTITY',
                required: true,
              },
              { key: 'numberOfBoxes', label: 'Number of Boxes', dataType: 'NUMBER' },
              { key: 'openCartons', label: 'Open Cartons', dataType: 'NUMBER' },
            ],
          },
        },
        aql,
      ],
    },
    {
      title: 'Checks and tests',
      components: [
        {
          type: 'CHECKLIST',
          title: 'Summary inspection checklist',
          config: {
            items: [
              'Conformity as per reference sample',
              'Workmanship',
              'Measurements',
              'GSM',
              'EAN Code',
              'Packing & Labelling',
              'Assortment',
              'Test Results',
              'Safety Requirements',
            ].map((label) => ({
              key: definitionKey(label),
              label,
            })),
            responseOptions: ['PASSED', 'FAILED', 'N/A'],
          },
        },
        {
          type: 'CHECKLIST',
          title: 'Packing and labelling',
          config: {
            items: [
              { key: 'packingAndLabelling', label: 'Packing and labelling requirements are met' },
            ],
            responseOptions: ['YES', 'NO', 'N/A'],
          },
        },
        defects,
        {
          type: 'TEST_RESULTS',
          title: 'On-site tests',
          config: {
            tests: ['GSM', 'Metal Detection', 'Needle Policy', 'Pull Test'].map((label) => ({
              key: definitionKey(label),
              label,
              responseOptions: ['PASSED', 'FAILED', 'N/A'],
            })),
          },
        },
      ],
    },
    {
      title: 'Conclusion',
      components: [
        { type: 'COMMENTS', title: 'Comments', config: { maxLength: 5000 } },
        {
          type: 'INSPECTION_OUTCOME',
          title: 'Inspection conclusion',
          config: { allowedOutcomes: ['PASS', 'FAIL'] },
        },
        signatures(['Quality Controller', 'Supplier']),
      ],
    },
  ],
};

// Order matters only for CLI reporting; the bootstrap resolves forms by code.
export const CANONICAL_QUALITY_FORMS: CanonicalQualityFormDefinition[] = [SAMPLE, PPM, INLINE, FINAL];

export interface CanonicalProcessFlowStage {
  sequence: number;
  name: string;
  code: string;
  activityType: 'PRODUCTION' | 'QUALITY';
  qualityFormCode?: string;
  qualityExecutionMode?: 'SEQUENTIAL_GATE' | 'IN_PROCESS';
  gateSatisfactionRequirement?: 'FINALIZED' | 'OUTCOME_PASS';
  executionMultiplicity?: 'SINGLE' | 'BATCHED';
  associatedProductionActivityCode?: string;
  qualityAvailabilityPolicy?:
    | 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'
    | 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES'
    | 'PROGRESS_PERCENTAGE';
  coverageTarget?: 'PREPARED_QUANTITY';
}

export interface CanonicalProcessFlowDefinition {
  code: string;
  name: string;
  description: string;
  stages: CanonicalProcessFlowStage[];
}

// Production stages (CUTTING/PRINTING/SEWING/FINISHING) are plain lifecycle
// activities: no percentage/threshold/coverage configuration of any kind.
// Inline is associated with Sewing's lifecycle only (not a calculated Sewing
// completion percentage); Final is associated with Finishing's lifecycle and
// draws its physical inspection capacity from Prepared Quantity, which is
// tracked and reconciled entirely by the existing job-orders/quality-executions
// runtime — this definition only points Final at that mechanism, it does not
// reimplement it.
export const CANONICAL_PROCESS_FLOW: CanonicalProcessFlowDefinition = {
  code: 'ERVE_PRODUCTION_QUALITY',
  name: 'Erve Production + Quality',
  description: 'Confirmed Erve pre-production, Production, Inline, and Final workflow',
  stages: [
    {
      sequence: 1,
      name: 'PP SAMPLE CHECKLIST',
      code: 'PP_SAMPLE',
      activityType: 'QUALITY',
      qualityFormCode: 'SAMPLE',
      qualityExecutionMode: 'SEQUENTIAL_GATE',
      gateSatisfactionRequirement: 'OUTCOME_PASS',
      executionMultiplicity: 'SINGLE',
    },
    {
      sequence: 2,
      name: 'SIZE SET / PRE-PRODUCTION REPORT',
      code: 'PPM',
      activityType: 'QUALITY',
      qualityFormCode: 'PPM',
      qualityExecutionMode: 'SEQUENTIAL_GATE',
      gateSatisfactionRequirement: 'FINALIZED',
      executionMultiplicity: 'SINGLE',
    },
    { sequence: 3, name: 'CUTTING', code: 'CUTTING', activityType: 'PRODUCTION' },
    { sequence: 4, name: 'PRINTING', code: 'PRINTING', activityType: 'PRODUCTION' },
    { sequence: 5, name: 'SEWING', code: 'SEWING', activityType: 'PRODUCTION' },
    {
      sequence: 6,
      name: 'INLINE INSPECTION',
      code: 'INLINE',
      activityType: 'QUALITY',
      qualityFormCode: 'INLINE',
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityCode: 'SEWING',
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      executionMultiplicity: 'SINGLE',
    },
    { sequence: 7, name: 'FINISHING', code: 'FINISHING', activityType: 'PRODUCTION' },
    {
      sequence: 8,
      name: 'FINAL INSPECTION',
      code: 'FINAL',
      activityType: 'QUALITY',
      qualityFormCode: 'FINAL',
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityCode: 'FINISHING',
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      executionMultiplicity: 'BATCHED',
      coverageTarget: 'PREPARED_QUANTITY',
    },
  ],
};
