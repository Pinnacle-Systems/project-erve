import { createId } from '@erve/shared';
import type { RoleName } from '@prisma/client';
import { prisma } from '../src/db/prisma.js';

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

const DEFAULT_SIZE_RANGES = [
  {
    code: 'KIDS_2_14',
    name: 'Kids 2-14Y',
    description: 'Standard kidswear size range',
    sizes: ['2-3Y', '3-4Y', '4-5Y', '5-6Y', '6-7Y', '7-8Y', '9-10Y', '11-12Y', '13-14Y'],
  },
  {
    code: 'ADULT_S_XXL',
    name: 'Adult S-XXL',
    description: 'Standard adult size range',
    sizes: ['S', 'M', 'L', 'XL', 'XXL'],
  },
];

async function seedSizeRanges(): Promise<void> {
  for (const sizeRange of DEFAULT_SIZE_RANGES) {
    await prisma.sizeRange.upsert({
      where: { code: sizeRange.code },
      update: {
        name: sizeRange.name,
        description: sizeRange.description,
        sizes: sizeRange.sizes,
      },
      create: { id: createId(), ...sizeRange },
    });
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
  await seedSizeRanges();
  await seedDefaultProcessFlow();
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
