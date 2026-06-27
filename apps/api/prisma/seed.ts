import { createId } from '@erve/shared';
import { prisma, type RoleName } from '../src/db/prisma.js';
import { hashPassword } from '../src/auth/password.js';

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

async function main(): Promise<void> {
  await seedRoles();
  await seedDefaultAdminUser();
  await seedSizes();
  await seedFactories();
  await seedDefaultProcessFlow();
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
