import { createId } from '@erve/shared';
import { QA_CHECKLIST_ITEMS } from '@erve/types';
import { prisma, type RoleName } from '../src/db/prisma.js';
import { hashPassword } from '../src/auth/password.js';
import { qualityFormDefinitionSchema } from '../src/modules/quality-forms/quality-forms.validation.js';

// Transporter delivery access is handled later via tokenized public
// delivery links, not a normal logged-in role — do not add it here.
const DEFAULT_ROLES: Array<{ name: RoleName; description: string }> = [
  { name: 'ADMIN', description: 'Full administrative access' },
  { name: 'MERCHANDISER', description: 'Manages styles, price lists, and process flows' },
  { name: 'FACTORY_USER', description: 'Records production progress at a factory' },
  { name: 'QA_USER', description: 'Performs quality inspection and approval' },
  { name: 'ACCOUNTANT', description: 'Manages invoicing and financial records' },
  { name: 'DISTRIBUTOR', description: 'Manages distributor-facing orders and stock' },
  { name: 'SENIOR_MANAGEMENT', description: 'Cross-functional oversight and reporting' },
];

async function seedRoles(): Promise<void> {
  for (const role of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description },
      create: { id: createId(), name: role.name, description: role.description },
    });
  }
}

// Dev-only bootstrap account so the first ADMIN can sign in and create
// real users via the API. Override via env before seeding anywhere
// other than local development, and rotate the password immediately.
const DEFAULT_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@erve.local';
const DEFAULT_ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';

async function seedDefaultAdminUser(): Promise<void> {
  const existing = await prisma.user.findUnique({ where: { email: DEFAULT_ADMIN_EMAIL } });
  if (existing) {
    return;
  }

  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
  const passwordHash = await hashPassword(DEFAULT_ADMIN_PASSWORD);

  await prisma.user.create({
    data: {
      id: createId(),
      email: DEFAULT_ADMIN_EMAIL,
      name: 'Default Admin',
      passwordHash,
      userRoles: { create: { id: createId(), roleId: adminRole.id } },
    },
  });

  console.log(
    `Seeded bootstrap admin "${DEFAULT_ADMIN_EMAIL}" — change this password outside local development.`,
  );
}

// Sizes are individual values, not ranges, so future categories (mens
// alpha sizes, numeric, waist, free size) are just more Size rows of a
// different sizeType — kidswear age sizes aren't special-cased anywhere.
const DEFAULT_SIZES = Array.from({ length: 12 }, (_, index) => {
  const age = index + 3; // AGE_3 .. AGE_14
  return {
    code: `AGE_${age}`,
    label: String(age),
    sizeType: 'AGE' as const,
    sortOrder: age,
  };
});

async function seedSizes(): Promise<void> {
  for (const size of DEFAULT_SIZES) {
    await prisma.size.upsert({
      where: { code: size.code },
      update: { label: size.label, sizeType: size.sizeType, sortOrder: size.sortOrder },
      create: { id: createId(), ...size },
    });
  }
}

const DEFAULT_FACTORIES = [
  { code: 'GREEN_WAY', name: 'Green Way' },
  { code: 'MASS_KNIT', name: 'Mass Knit' },
  { code: 'CLIFTON', name: 'Clifton' },
];

async function seedFactories(): Promise<void> {
  for (const factory of DEFAULT_FACTORIES) {
    await prisma.factory.upsert({
      where: { code: factory.code },
      update: { name: factory.name },
      create: { id: createId(), ...factory },
    });
  }
}

interface SeedStyleInput {
  styleNumber: string;
  styleName: string;
  description: string;
  categoryDescription: string;
  itemNameGroup: string;
  ipName: string;
  licensor: string;
  colour: string;
  lmixNumber: string;
  hsnCode: string;
  hsnDescription: string;
  finalMrp: string;
  royaltyPercentage: string;
  factoryCode: string;
  exFactoryPrice: string;
  importedSizeRangeLabel: string;
  validSizeCodes: string[];
}

// Sample item-master rows. Royalty % and ex-factory price come from the
// import sheet's FACTORY/Royalty %/Final MRP columns; the "SIZE RANGE"
// column (e.g. "3-8 YEARS") is kept only as display metadata on each
// StyleSize row, not as the size model itself.
const DEFAULT_STYLES: SeedStyleInput[] = [
  {
    styleNumber: '39026006',
    styleName: 'BOYS REGULAR TSHIRT',
    description: 'BOYS REGULAR TSHIRT',
    categoryDescription: 'Boys Regular T-Shirt',
    itemNameGroup: 'BOYS REGULAR TSHIRT-39026006',
    ipName: 'HOT WHEELS',
    licensor: 'MATTEL',
    colour: 'HIGH RISK RED',
    lmixNumber: 'LMIX39026006',
    hsnCode: '61091000',
    hsnDescription: 'BOYS REGULAR TSHIRT-39026006',
    finalMrp: '849',
    royaltyPercentage: '12',
    factoryCode: 'GREEN_WAY',
    exFactoryPrice: '188',
    importedSizeRangeLabel: '3-8 YEARS',
    validSizeCodes: ['AGE_3', 'AGE_4', 'AGE_5', 'AGE_6', 'AGE_7', 'AGE_8'],
  },
  {
    styleNumber: '25426015',
    styleName: 'GIRLS REGULAR T SHIRTS',
    description: 'GIRLS REGULAR T SHIRTS',
    categoryDescription: 'Girls Regular T-Shirt',
    itemNameGroup: 'GIRLS REGULAR T SHIRTS-25426015',
    ipName: 'MINIONS',
    licensor: 'UNIVERSAL',
    colour: 'AURORA',
    lmixNumber: 'LMIX25426015',
    hsnCode: '61091000',
    hsnDescription: 'GIRLS REGULAR T SHIRTS-25426015',
    finalMrp: '799',
    royaltyPercentage: '14',
    factoryCode: 'MASS_KNIT',
    exFactoryPrice: '177',
    importedSizeRangeLabel: '3-8 YEARS',
    validSizeCodes: ['AGE_3', 'AGE_4', 'AGE_5', 'AGE_6', 'AGE_7', 'AGE_8'],
  },
  {
    styleNumber: '25426009',
    styleName: 'BOYS REGULAR TSHIRT',
    description: 'BOYS REGULAR TSHIRT',
    categoryDescription: 'Boys Regular T-Shirt',
    itemNameGroup: 'BOYS REGULAR TSHIRT-25426009',
    ipName: 'MINIONS',
    licensor: 'UNIVERSAL',
    colour: 'AURORA',
    lmixNumber: 'LMIX25426009',
    hsnCode: '61091000',
    hsnDescription: 'BOYS REGULAR TSHIRT-25426009',
    finalMrp: '849',
    royaltyPercentage: '14',
    factoryCode: 'CLIFTON',
    exFactoryPrice: '188',
    importedSizeRangeLabel: '3-8 YEARS',
    validSizeCodes: ['AGE_3', 'AGE_4', 'AGE_5', 'AGE_6', 'AGE_7', 'AGE_8'],
  },
];

async function seedStyles(): Promise<void> {
  for (const input of DEFAULT_STYLES) {
    const styleFields = {
      styleName: input.styleName,
      description: input.description,
      categoryDescription: input.categoryDescription,
      itemNameGroup: input.itemNameGroup,
      ipName: input.ipName,
      licensor: input.licensor,
      colour: input.colour,
      lmixNumber: input.lmixNumber,
      hsnCode: input.hsnCode,
      hsnDescription: input.hsnDescription,
      finalMrp: input.finalMrp,
      royaltyPercentage: input.royaltyPercentage,
    };

    const style = await prisma.style.upsert({
      where: { styleNumber: input.styleNumber },
      update: styleFields,
      create: { id: createId(), styleNumber: input.styleNumber, ...styleFields },
    });

    const factory = await prisma.factory.findUniqueOrThrow({
      where: { code: input.factoryCode },
    });

    await prisma.styleFactoryMapping.upsert({
      where: { styleId_factoryId: { styleId: style.id, factoryId: factory.id } },
      update: { exFactoryPrice: input.exFactoryPrice },
      create: {
        id: createId(),
        styleId: style.id,
        factoryId: factory.id,
        exFactoryPrice: input.exFactoryPrice,
      },
    });

    const sizes = await prisma.size.findMany({ where: { code: { in: input.validSizeCodes } } });

    for (const size of sizes) {
      await prisma.styleSize.upsert({
        where: { styleId_sizeId: { styleId: style.id, sizeId: size.id } },
        update: { importedSizeRangeLabel: input.importedSizeRangeLabel },
        create: {
          id: createId(),
          styleId: style.id,
          sizeId: size.id,
          importedSizeRangeLabel: input.importedSizeRangeLabel,
        },
      });
    }
  }
}

const DEFAULT_PROCESS_STAGES = ['Cutting', 'Printing', 'Sewing', 'Finishing'];

async function seedDefaultProcessFlow(): Promise<void> {
  const processFlow = await prisma.processFlow.upsert({
    where: { code: 'DEFAULT_PRODUCTION' },
    update: {},
    create: {
      id: createId(),
      code: 'DEFAULT_PRODUCTION',
      name: 'Default Production Flow',
      description: 'Standard cut-to-finish production flow',
    },
  });

  const version = await prisma.processFlowVersion.upsert({
    where: {
      processFlowId_versionNumber: { processFlowId: processFlow.id, versionNumber: 1 },
    },
    update: {},
    create: {
      id: createId(),
      processFlowId: processFlow.id,
      versionNumber: 1,
      status: 'ACTIVE',
      effectiveFrom: new Date(),
    },
  });

  for (const [index, name] of DEFAULT_PROCESS_STAGES.entries()) {
    const sequence = index + 1;
    await prisma.processFlowVersionStage.upsert({
      where: {
        processFlowVersionId_sequence: { processFlowVersionId: version.id, sequence },
      },
      update: { name },
      create: { id: createId(), processFlowVersionId: version.id, sequence, name },
    });
  }
}

type SeedComponent = {
  type:
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
  title: string;
  config: object;
};
type SeedSection = { title: string; components: SeedComponent[] };
const definitionKey = (label: string) =>
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
const CONTEXT_SOURCES: Record<string, string> = {
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
const context = (fields: string[]): SeedComponent => ({
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
const signatures = (roles: string[]): SeedComponent => ({
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
const aql: SeedComponent = {
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
const defects: SeedComponent = {
  type: 'DEFECT_LIST',
  title: 'Workmanship defects',
  config: { severities: ['CRITICAL', 'MAJOR', 'MINOR'], captureQuantity: true },
};

const DEFAULT_QUALITY_FORMS: Array<{
  code: string;
  name: string;
  activityType: 'MEETING' | 'INSPECTION';
  executionScope: 'JOB_ORDER' | 'SIZE';
  sections: SeedSection[];
}> = [
  {
    code: 'PPM',
    name: 'Pre-Production Meeting Report',
    activityType: 'MEETING',
    executionScope: 'JOB_ORDER',
    sections: [
      {
        title: 'Meeting context',
        components: [
          context([
            'Supplier Name',
            'Factory Name',
            'Style',
            'Customer',
            'Order Number',
            'Quantity',
          ]),
          {
            type: 'FIELD_GROUP',
            title: 'Meeting details',
            config: {
              fields: [
                { key: 'meetingDate', label: 'Meeting Date', dataType: 'DATE', source: 'USER', required: true },
                { key: 'meetingConductedBy', label: 'Meeting Conducted By', dataType: 'TEXT', source: 'USER', required: true },
                { key: 'deliveryDate', label: 'Delivery Date', dataType: 'DATE', source: 'USER' },
                { key: 'cuttingPlanningDate', label: 'Cutting Planning Date', dataType: 'DATE', source: 'USER' },
                { key: 'sewingPlanningDate', label: 'Sewing Planning Date', dataType: 'DATE', source: 'USER' },
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
  },
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
              items: QA_CHECKLIST_ITEMS.map(({ code, label }) => ({
                key: definitionKey(code),
                label,
              })),
              responseOptions: ['YES', 'NO', 'AVAILABLE'],
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
          context(['Supplier', 'Style', 'Purchase Order', 'Customer', 'Report Date', 'ETD']),
        ],
      },
      {
        title: 'Inspection results',
        components: [
          aql,
          {
            type: 'PRODUCTION_PROGRESS',
            title: 'Production status',
            config: {
              metrics: [
                {
                  key: 'cutPercentage',
                  label: '% Cut',
                  source: 'SYSTEM',
                  sourceActivityCode: 'CUTTING',
                },
                {
                  key: 'sewnPercentage',
                  label: '% Sewn',
                  source: 'SYSTEM',
                  sourceActivityCode: 'SEWING',
                },
                {
                  key: 'finishPercentage',
                  label: '% Finish',
                  source: 'SYSTEM',
                  sourceActivityCode: 'FINISHING',
                },
              ],
            },
          },
          defects,
        ],
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
  },
];

async function seedQualityForms(): Promise<void> {
  for (const definition of DEFAULT_QUALITY_FORMS) {
    const parsedDefinition = qualityFormDefinitionSchema.parse({ sections: definition.sections });
    const form = await prisma.qualityForm.upsert({
      where: { code: definition.code },
      update: {},
      create: {
        id: createId(),
        code: definition.code,
        name: definition.name,
      },
    });
    const existing = await prisma.qualityFormVersion.findUnique({
      where: { qualityFormId_versionNumber: { qualityFormId: form.id, versionNumber: 1 } },
    });
    if (existing) continue;
    await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: form.id,
        versionNumber: 1,
        activityType: definition.activityType,
        executionScope: definition.executionScope,
        status: 'PUBLISHED',
        publishedAt: new Date(),
        sections: {
          create: parsedDefinition.sections.map((section, sectionIndex) => ({
            id: createId(),
            sequence: sectionIndex + 1,
            title: section.title,
            components: {
              create: section.components.map((component, componentIndex) => ({
                id: createId(),
                sequence: componentIndex + 1,
                type: component.type,
                title: component.title,
                config: component.config,
              })),
            },
          })),
        },
      },
    });
  }
}

async function main(): Promise<void> {
  await seedRoles();
  await seedDefaultAdminUser();
  await seedSizes();
  await seedFactories();
  await seedDefaultProcessFlow();
  await seedQualityForms();
  await seedStyles();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
