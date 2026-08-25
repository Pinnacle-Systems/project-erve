import { createId } from '@erve/shared';
import { prisma, type RoleName } from '../src/db/prisma.js';
import { hashPassword } from '../src/auth/password.js';
import { qualityFormDefinitionSchema } from '../src/modules/quality-forms/quality-forms.validation.js';
import {
  CANONICAL_QUALITY_FORMS,
  type CanonicalQualityFormDefinition,
  type SeedComponent,
  type SeedSection,
} from '../src/cli/quality-bootstrap-definitions.js';

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

// Current Quality Form content (SAMPLE/PPM/INLINE/FINAL) lives in
// quality-bootstrap-definitions.ts and is shared with the production
// quality-bootstrap CLI so dev/test seeding and production installs never
// drift. Only the legacy, percentage-based Inline shape stays local here: it
// is a historical fixture kept solely so a dev/test database can reproduce
// an old, immutable Quality Form version, not part of the canonical set.
type SeededQualityFormVersion = CanonicalQualityFormDefinition & { versionNumber?: number };

const canonicalInline = CANONICAL_QUALITY_FORMS.find((definition) => definition.code === 'INLINE');
if (!canonicalInline) throw new Error('Canonical Inline Quality Form definition is required');

const legacyInlineProductionProgress: SeedComponent = {
  type: 'PRODUCTION_PROGRESS',
  title: 'Production status',
  config: {
    metrics: [
      { key: 'cutPercentage', label: '% Cut', source: 'SYSTEM', sourceActivityCode: 'CUTTING' },
      { key: 'sewnPercentage', label: '% Sewn', source: 'SYSTEM', sourceActivityCode: 'SEWING' },
      {
        key: 'finishPercentage',
        label: '% Finish',
        source: 'SYSTEM',
        sourceActivityCode: 'FINISHING',
      },
    ],
  },
};

// Historical-only dev/test fixture: the original Inline Inspection Report
// (version 1) carried this percentage-based PRODUCTION_PROGRESS component,
// inserted between the AQL and defect-list components. That workflow is no
// longer current — see quality-bootstrap-definitions.ts — but historical
// Quality Form versions must remain reproducible for local dev/test seeding.
const legacyInlineV1Sections: SeedSection[] = canonicalInline.sections.map((section) =>
  section.title === 'Inspection results'
    ? { ...section, components: [section.components[0]!, legacyInlineProductionProgress, section.components[1]!] }
    : section,
);

const SEEDED_QUALITY_FORM_VERSIONS: SeededQualityFormVersion[] = [
  ...CANONICAL_QUALITY_FORMS.filter((definition) => definition.code !== 'INLINE'),
  { ...canonicalInline, versionNumber: 1, sections: legacyInlineV1Sections },
  { ...canonicalInline, versionNumber: 2 },
];

async function seedQualityForms(): Promise<void> {
  for (const definition of SEEDED_QUALITY_FORM_VERSIONS) {
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
    const versionNumber = definition.versionNumber ?? 1;
    const isLatestSeededVersion = !SEEDED_QUALITY_FORM_VERSIONS.some(
      (candidate) =>
        candidate.code === definition.code && (candidate.versionNumber ?? 1) > versionNumber,
    );
    const existing = await prisma.qualityFormVersion.findUnique({
      where: { qualityFormId_versionNumber: { qualityFormId: form.id, versionNumber } },
    });
    if (existing) {
      await prisma.qualityFormVersion.update({
        where: { id: existing.id },
        data: {
          status: isLatestSeededVersion ? 'PUBLISHED' : 'RETIRED',
          publishedAt: existing.publishedAt ?? new Date(),
        },
      });
      continue;
    }
    await prisma.qualityFormVersion.create({
      data: {
        id: createId(),
        qualityFormId: form.id,
        versionNumber,
        activityType: definition.activityType,
        executionScope: definition.executionScope,
        status: isLatestSeededVersion ? 'PUBLISHED' : 'RETIRED',
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

async function seedErveProductionQualityFlow(): Promise<void> {
  const forms = await prisma.qualityForm.findMany({
    where: { code: { in: ['SAMPLE', 'PPM', 'INLINE', 'FINAL'] } },
    include: { versions: true },
  });
  const formVersion = new Map(
    forms.flatMap((form) =>
      form.versions.map(
        (version) => [`${form.code}:${version.versionNumber}`, version.id] as const,
      ),
    ),
  );
  for (const key of ['SAMPLE:1', 'PPM:1', 'INLINE:1', 'INLINE:2', 'FINAL:1']) {
    if (!formVersion.get(key)) throw new Error(`Seeded ${key} Quality Form version is required`);
  }

  const flow = await prisma.processFlow.upsert({
    where: { code: 'ERVE_PRODUCTION_QUALITY' },
    update: {},
    create: {
      id: createId(),
      code: 'ERVE_PRODUCTION_QUALITY',
      name: 'Erve Production + Quality',
      description: 'Confirmed Erve pre-production, Production, Inline, and Final workflow',
    },
  });
  const seedVersion = async (versionNumber: number, inlineFormVersion: number) => {
    const existing = await prisma.processFlowVersion.findUnique({
      where: { processFlowId_versionNumber: { processFlowId: flow.id, versionNumber } },
      include: { stages: true },
    });
    if (existing?.stages.length) return existing.id; // Published definitions remain immutable.

    return prisma.$transaction(async (tx) => {
      const version =
        existing ??
        (await tx.processFlowVersion.create({
          data: {
            id: createId(),
            processFlowId: flow.id,
            versionNumber,
            status: versionNumber === 3 ? 'ACTIVE' : 'RETIRED',
            effectiveFrom: new Date(),
          },
        }));
      const cuttingId = createId();
      const printingId = createId();
      const sewingId = createId();
      const finishingId = createId();
      await tx.processFlowVersionStage.createMany({
        data: [
          {
            id: cuttingId,
            processFlowVersionId: version.id,
            sequence: 3,
            name: 'CUTTING',
            code: 'CUTTING',
          },
          {
            id: printingId,
            processFlowVersionId: version.id,
            sequence: 4,
            name: 'PRINTING',
            code: 'PRINTING',
          },
          {
            id: sewingId,
            processFlowVersionId: version.id,
            sequence: 5,
            name: 'SEWING',
            code: 'SEWING',
          },
          {
            id: finishingId,
            processFlowVersionId: version.id,
            sequence: 7,
            name: 'FINISHING',
            code: 'FINISHING',
          },
        ],
      });
      await tx.processFlowVersionStage.createMany({
        data: [
          {
            id: createId(),
            processFlowVersionId: version.id,
            sequence: 1,
            name: 'PP SAMPLE CHECKLIST',
            code: 'PP_SAMPLE',
            activityType: 'QUALITY',
            qualityFormVersionId: formVersion.get('SAMPLE:1')!,
            qualityExecutionMode: 'SEQUENTIAL_GATE',
            gateSatisfactionRequirement: 'OUTCOME_PASS',
            executionMultiplicity: 'SINGLE',
          },
          {
            id: createId(),
            processFlowVersionId: version.id,
            sequence: 2,
            name: 'SIZE SET / PRE-PRODUCTION REPORT',
            code: 'PPM',
            activityType: 'QUALITY',
            qualityFormVersionId: formVersion.get('PPM:1')!,
            qualityExecutionMode: 'SEQUENTIAL_GATE',
            gateSatisfactionRequirement: 'FINALIZED',
            executionMultiplicity: 'SINGLE',
          },
          {
            id: createId(),
            processFlowVersionId: version.id,
            sequence: 6,
            name: 'INLINE INSPECTION',
            code: 'INLINE',
            activityType: 'QUALITY',
            qualityFormVersionId: formVersion.get(`INLINE:${inlineFormVersion}`)!,
            qualityExecutionMode: 'IN_PROCESS',
            associatedProductionActivityId: sewingId,
            qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
            executionMultiplicity: 'SINGLE',
          },
          {
            id: createId(),
            processFlowVersionId: version.id,
            sequence: 8,
            name: 'FINAL INSPECTION',
            code: 'FINAL',
            activityType: 'QUALITY',
            qualityFormVersionId: formVersion.get('FINAL:1')!,
            qualityExecutionMode: 'IN_PROCESS',
            associatedProductionActivityId: versionNumber >= 3 ? finishingId : sewingId,
            qualityAvailabilityPolicy:
              versionNumber >= 3
                ? 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE'
                : 'AFTER_ASSOCIATED_ACTIVITY_COMPLETES',
            executionMultiplicity: 'BATCHED',
            coverageTarget: 'PREPARED_QUANTITY',
          },
        ],
      });
      return version.id;
    });
  };

  await seedVersion(1, 1);
  await seedVersion(2, 2);
  const activeVersionId = await seedVersion(3, 2);
  await prisma.$transaction([
    prisma.processFlowVersion.updateMany({
      where: { processFlowId: flow.id, id: { not: activeVersionId }, status: 'ACTIVE' },
      data: { status: 'RETIRED' },
    }),
    prisma.processFlowVersion.update({
      where: { id: activeVersionId },
      data: { status: 'ACTIVE' },
    }),
  ]);
}

async function main(): Promise<void> {
  await seedRoles();
  await seedDefaultAdminUser();
  await seedSizes();
  await seedFactories();
  await seedDefaultProcessFlow();
  await seedQualityForms();
  await seedErveProductionQualityFlow();
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
