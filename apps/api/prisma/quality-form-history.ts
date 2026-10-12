// Frozen pre-DEMO-007 definitions for historical dev/test fixtures.
import type { CanonicalQualityFormDefinition } from '../src/cli/quality-bootstrap-definitions.js';
export const HISTORICAL_QUALITY_FORMS = [
  {
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
              items: [
                {
                  key: 'fabricColourQuality',
                  label:
                    'Confirm fabric has been checked and is correct colour and quality (approved shade band / bulk hanger)',
                },
                {
                  key: 'trimsCard',
                  label: 'Confirm trims is available and checked as per trims card',
                },
                {
                  key: 'fabricGsm',
                  label: 'Confirm fabric GSM is correct',
                },
                {
                  key: 'measurementsReport',
                  label:
                    'Confirm all measurements are within tolerance and measurement report is attached',
                },
                {
                  key: 'garmentConstruction',
                  label:
                    'Confirm garment construction is correct and as per all previous samples comment',
                },
                {
                  key: 'generalQualityPresentation',
                  label: 'Confirm samples general quality and presentation are acceptable',
                },
                {
                  key: 'labellingPosition',
                  label: 'Confirm labelling position has been checked and correct',
                },
                {
                  key: 'fitSampleBuyerComments',
                  label: 'Fit sample made based on buyer comments',
                },
                {
                  key: 'spi',
                  label:
                    'Confirm SPI is correct (outside 11–12 per inch and inside 12–13 per inch)',
                },
                {
                  key: 'sampleTag',
                  label: 'Confirm sample tag with details',
                },
                {
                  key: 'dataSheetPullTestPinchSetting',
                  label:
                    'Confirm all Data Sheet / Pull Test / Pinch Setting have been checked and are correct',
                },
                {
                  key: 'metalDetection',
                  label: 'Confirm Metal Detection have been checked and are correct',
                },
                {
                  key: 'pAndP',
                  label: 'Confirm P&P have been checked and are correct',
                },
                {
                  key: 'ppSampleFitComments',
                  label: 'Confirm PP sample made based on fit comments',
                },
                {
                  key: 'sourceDeclarationForm',
                  label: 'Source declaration form available',
                },
              ],
              responseOptions: ['YES', 'NO'],
            },
          },
          {
            type: 'DEFECT_LIST',
            title: 'Workmanship defects',
            config: {
              severities: ['CRITICAL', 'MAJOR', 'MINOR'],
              captureQuantity: true,
            },
          },
          {
            type: 'COMMENTS',
            title: 'Inspection remarks',
            config: {
              maxLength: 5000,
            },
          },
          {
            type: 'ATTACHMENTS',
            title: 'Evidence',
            config: {
              requirements: [
                {
                  key: 'inspectionEvidence',
                  label: 'Inspection evidence',
                },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    code: 'PPM',
    name: 'Pre-Production Meeting Report',
    activityType: 'MEETING',
    executionScope: 'JOB_ORDER',
    sections: [
      {
        title: 'Meeting context',
        components: [
          {
            type: 'SYSTEM_CONTEXT',
            title: 'System context',
            config: {
              fields: [
                {
                  key: 'supplierName',
                  label: 'Supplier Name',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'SUPPLIER_NAME',
                },
                {
                  key: 'factoryName',
                  label: 'Factory Name',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'FACTORY_NAME',
                },
                {
                  key: 'style',
                  label: 'Style',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'STYLE_NUMBER',
                },
                {
                  key: 'customer',
                  label: 'Customer',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'CUSTOMER_NAME',
                },
                {
                  key: 'orderNumber',
                  label: 'Order Number',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'PURCHASE_ORDER_NUMBER',
                },
                {
                  key: 'quantity',
                  label: 'Quantity',
                  dataType: 'NUMBER',
                  source: 'SYSTEM',
                  sourceKey: 'ORDER_QUANTITY',
                },
              ],
            },
          },
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
                {
                  key: 'deliveryDate',
                  label: 'Delivery Date',
                  dataType: 'DATE',
                  source: 'USER',
                },
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
                {
                  key: 'action',
                  label: 'Comments / action',
                  dataType: 'TEXT',
                  required: true,
                },
                {
                  key: 'followUpPerson',
                  label: 'Follow-up person',
                  dataType: 'TEXT',
                  required: true,
                },
                {
                  key: 'settleDate',
                  label: 'Settle date',
                  dataType: 'DATE',
                },
              ],
            },
          },
        ],
      },
      {
        title: 'Approval',
        components: [
          {
            type: 'SIGNATURES',
            title: 'Sign-off',
            config: {
              roles: [
                {
                  key: 'inspector',
                  label: 'Inspector',
                  required: true,
                },
                {
                  key: 'qaManager',
                  label: 'QA Manager',
                  required: true,
                },
                {
                  key: 'supplier',
                  label: 'Supplier',
                  required: true,
                },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    code: 'INLINE',
    name: 'Inline Inspection Report',
    activityType: 'INSPECTION',
    executionScope: 'JOB_ORDER',
    sections: [
      {
        title: 'Inspection context',
        components: [
          {
            type: 'SYSTEM_CONTEXT',
            title: 'System context',
            config: {
              fields: [
                {
                  key: 'supplier',
                  label: 'Supplier',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'SUPPLIER_NAME',
                },
                {
                  key: 'style',
                  label: 'Style',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'STYLE_NUMBER',
                },
                {
                  key: 'purchaseOrder',
                  label: 'Purchase Order',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'PURCHASE_ORDER_NUMBER',
                },
                {
                  key: 'customer',
                  label: 'Customer',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'CUSTOMER_NAME',
                },
                {
                  key: 'reportDate',
                  label: 'Report Date',
                  dataType: 'DATE',
                  source: 'SYSTEM',
                  sourceKey: 'REPORT_DATE',
                },
                {
                  key: 'etd',
                  label: 'ETD',
                  dataType: 'DATE',
                  source: 'SYSTEM',
                  sourceKey: 'ETD',
                },
              ],
            },
          },
        ],
      },
      {
        title: 'Inspection results',
        components: [
          {
            type: 'AQL_RESULT',
            title: 'AQL defect summary',
            config: {
              inspectionLevel: 'General Inspection Level II',
              criteria: [
                {
                  severity: 'CRITICAL',
                  aql: 0,
                },
                {
                  severity: 'MAJOR',
                  aql: 1.5,
                },
                {
                  severity: 'MINOR',
                  aql: 2.5,
                },
              ],
            },
          },
          {
            type: 'DEFECT_LIST',
            title: 'Workmanship defects',
            config: {
              severities: ['CRITICAL', 'MAJOR', 'MINOR'],
              captureQuantity: true,
            },
          },
        ],
      },
      {
        title: 'Packing and corrective action',
        components: [
          {
            type: 'CHECKLIST',
            title: 'Pre-packing check',
            config: {
              items: [
                {
                  key: 'packing',
                  label: 'Packing and carton information is correct',
                },
              ],
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
                {
                  key: 'action',
                  label: 'Actions to be taken',
                  dataType: 'TEXT',
                  required: true,
                },
              ],
            },
          },
          {
            type: 'COMMENTS',
            title: 'Conclusion and remarks',
            config: {
              maxLength: 5000,
            },
          },
          {
            type: 'INSPECTION_OUTCOME',
            title: 'Inspection conclusion',
            config: {
              allowedOutcomes: ['PASS', 'FAIL'],
              remarksRequiredWhen: 'FAIL',
            },
          },
          {
            type: 'SIGNATURES',
            title: 'Sign-off',
            config: {
              roles: [
                {
                  key: 'qualityController',
                  label: 'Quality Controller',
                  required: true,
                },
                {
                  key: 'supplier',
                  label: 'Supplier',
                  required: true,
                },
              ],
            },
          },
        ],
      },
    ],
  },
  {
    code: 'FINAL',
    name: 'Final Inspection Report',
    activityType: 'INSPECTION',
    executionScope: 'JOB_ORDER',
    sections: [
      {
        title: 'Inspection context',
        components: [
          {
            type: 'SYSTEM_CONTEXT',
            title: 'System context',
            config: {
              fields: [
                {
                  key: 'supplier',
                  label: 'Supplier',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'SUPPLIER_NAME',
                },
                {
                  key: 'style',
                  label: 'Style',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'STYLE_NUMBER',
                },
                {
                  key: 'customer',
                  label: 'Customer',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'CUSTOMER_NAME',
                },
                {
                  key: 'purchaseOrder',
                  label: 'Purchase Order',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'PURCHASE_ORDER_NUMBER',
                },
                {
                  key: 'color',
                  label: 'Color',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'COLOUR',
                },
                {
                  key: 'orderQty',
                  label: 'Order Qty',
                  dataType: 'NUMBER',
                  source: 'SYSTEM',
                  sourceKey: 'ORDER_QUANTITY',
                },
                {
                  key: 'shipQty',
                  label: 'Ship Qty',
                  dataType: 'NUMBER',
                  source: 'SYSTEM',
                  sourceKey: 'SHIP_QUANTITY',
                },
                {
                  key: 'merchandiser',
                  label: 'Merchandiser',
                  dataType: 'TEXT',
                  source: 'SYSTEM',
                  sourceKey: 'MERCHANDISER_NAME',
                },
                {
                  key: 'reportDate',
                  label: 'Report Date',
                  dataType: 'DATE',
                  source: 'SYSTEM',
                  sourceKey: 'REPORT_DATE',
                },
              ],
            },
          },
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
                {
                  key: 'measurementSheet',
                  label: 'Measurement Sheet',
                  required: true,
                },
                {
                  key: 'washingReport',
                  label: 'Washing Report',
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
                {
                  key: 'numberOfBoxes',
                  label: 'Number of Boxes',
                  dataType: 'NUMBER',
                },
                {
                  key: 'openCartons',
                  label: 'Open Cartons',
                  dataType: 'NUMBER',
                },
              ],
            },
          },
          {
            type: 'AQL_RESULT',
            title: 'AQL defect summary',
            config: {
              inspectionLevel: 'General Inspection Level II',
              criteria: [
                {
                  severity: 'CRITICAL',
                  aql: 0,
                },
                {
                  severity: 'MAJOR',
                  aql: 1.5,
                },
                {
                  severity: 'MINOR',
                  aql: 2.5,
                },
              ],
            },
          },
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
                {
                  key: 'conformityAsPerReferenceSample',
                  label: 'Conformity as per reference sample',
                },
                {
                  key: 'workmanship',
                  label: 'Workmanship',
                },
                {
                  key: 'measurements',
                  label: 'Measurements',
                },
                {
                  key: 'gsm',
                  label: 'GSM',
                },
                {
                  key: 'eanCode',
                  label: 'Bar Code',
                },
                {
                  key: 'packingAndLabelling',
                  label: 'Packing & Labelling',
                },
                {
                  key: 'assortment',
                  label: 'Assortment',
                },
                {
                  key: 'testResults',
                  label: 'Test Results',
                },
                {
                  key: 'safetyRequirements',
                  label: 'Safety Requirements',
                },
              ],
              responseOptions: ['PASSED', 'FAILED', 'N/A'],
            },
          },
          {
            type: 'CHECKLIST',
            title: 'Packing and labelling',
            config: {
              items: [
                {
                  key: 'packingAndLabelling',
                  label: 'Packing and labelling requirements are met',
                },
              ],
              responseOptions: ['YES', 'NO', 'N/A'],
            },
          },
          {
            type: 'DEFECT_LIST',
            title: 'Workmanship defects',
            config: {
              severities: ['CRITICAL', 'MAJOR', 'MINOR'],
              captureQuantity: true,
            },
          },
          {
            type: 'TEST_RESULTS',
            title: 'On-site tests',
            config: {
              tests: [
                {
                  key: 'gsm',
                  label: 'GSM',
                  responseOptions: ['PASSED', 'FAILED', 'N/A'],
                },
                {
                  key: 'metalDetection',
                  label: 'Metal Detection',
                  responseOptions: ['PASSED', 'FAILED', 'N/A'],
                },
                {
                  key: 'needlePolicy',
                  label: 'Needle Policy',
                  responseOptions: ['PASSED', 'FAILED', 'N/A'],
                },
                {
                  key: 'pullTest',
                  label: 'Pull Test',
                  responseOptions: ['PASSED', 'FAILED', 'N/A'],
                },
              ],
            },
          },
        ],
      },
      {
        title: 'Conclusion',
        components: [
          {
            type: 'COMMENTS',
            title: 'Comments',
            config: {
              maxLength: 5000,
            },
          },
          {
            type: 'INSPECTION_OUTCOME',
            title: 'Inspection conclusion',
            config: {
              allowedOutcomes: ['PASS', 'FAIL'],
            },
          },
          {
            type: 'SIGNATURES',
            title: 'Sign-off',
            config: {
              roles: [
                {
                  key: 'qualityController',
                  label: 'Quality Controller',
                  required: true,
                },
                {
                  key: 'supplier',
                  label: 'Supplier',
                  required: true,
                },
              ],
            },
          },
        ],
      },
    ],
  },
] satisfies CanonicalQualityFormDefinition[];
