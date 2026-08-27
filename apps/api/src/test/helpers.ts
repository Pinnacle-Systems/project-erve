import { createId } from '@erve/shared';
import type { Role } from '@erve/types';
import { prisma, type UserStatus, type DocumentType } from '../db/prisma.js';
import { hashPassword } from '../auth/password.js';
import { signAccessToken } from '../auth/jwt.js';
import { ensureFinancialYear } from '../modules/master-data/financial-year.service.js';
import { allocateDocumentSerial } from '../modules/master-data/document-sequence.service.js';

// Test fixtures use the real ensureFinancialYear/allocateDocumentSerial
// production logic rather than fabricating financialYearId/serial values, so
// fixtures stay correct under the same invariants (idempotent-by-code,
// collision-free per FY) production code relies on.
export async function createTestFinancialYear(date: Date = new Date()) {
  return ensureFinancialYear(prisma, date);
}

export async function allocateTestDocumentSerial(
  documentType: DocumentType,
  financialYearId: string,
): Promise<number> {
  return prisma.$transaction((tx) => allocateDocumentSerial(tx, documentType, financialYearId));
}

// Test users/roles live on top of the seeded reference data (roles), so
// only the per-test rows need clearing between tests.
export async function resetDatabase(): Promise<void> {
  // Integration tests must be self-contained after a fresh migration replay;
  // do not rely on development seeding for authorization reference data.
  for (const name of [
    'ADMIN',
    'MERCHANDISER',
    'FACTORY_USER',
    'QA_USER',
    'ACCOUNTANT',
    'DISTRIBUTOR',
    'SENIOR_MANAGEMENT',
  ] as const) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { id: createId(), name, description: `Integration test ${name} role` },
    });
  }
  await prisma.auditLog.deleteMany();
  // Sale Order rows must go before the QA-release/PO truncation below —
  // StockAllocation.qaReleaseLineId and SaleOrderLine.purchaseOrderLineSizeId
  // are onDelete: Restrict, so they'd otherwise block those deletes.
  await prisma.stockAllocation.deleteMany();
  await prisma.saleOrderLine.deleteMany();
  await prisma.saleOrder.deleteMany();
  // Repeated rework intentionally forms a historical chain where a reinspection
  // form points to cycle N and cycle N+1 points back to that form. PostgreSQL
  // cannot DELETE either side first, so the disposable test database clears the
  // related QA tables atomically. Production FKs remain restrictive.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "qa_inspection_sessions", "qa_size_inspection_forms", "qa_rework_tasks" CASCADE',
  );
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "qa_release_lines", "qa_releases", "quality_activity_executions", "final_quality_batch_allocations", "final_quality_batches" CASCADE',
  );
  await prisma.jobOrderStageStatus.deleteMany();
  await prisma.jobOrderLineSize.deleteMany();
  await prisma.jobOrderLine.deleteMany();
  await prisma.jobOrder.deleteMany();
  await prisma.distributorPurchaseOrderLineSize.deleteMany();
  await prisma.distributorPurchaseOrderLine.deleteMany();
  await prisma.distributorPurchaseOrder.deleteMany();
  await prisma.processFlowVersionStage.deleteMany();
  await prisma.processFlowVersion.deleteMany();
  await prisma.processFlow.deleteMany();
  await prisma.qualityFormComponent.deleteMany();
  await prisma.qualityFormSection.deleteMany();
  await prisma.qualityFormVersion.deleteMany();
  await prisma.qualityForm.deleteMany();
  await prisma.priceListLine.deleteMany();
  await prisma.priceList.deleteMany();
  await prisma.styleFactoryMapping.deleteMany();
  await prisma.styleSize.deleteMany();
  await prisma.styleImage.deleteMany();
  await prisma.file.deleteMany();
  await prisma.style.deleteMany();
  await prisma.season.deleteMany();
  // PO/JO/Season above all FK-reference financialYearId with onDelete:
  // Restrict, so document_sequences and financial_years can only be cleared
  // once those are gone. Full isolation between tests/runs — without this,
  // a fixed test date (e.g. "2034-06-01") resolves to the same FinancialYear
  // row and DocumentSequence state across every test and every prior run
  // against this persistent database, since FY rows are otherwise meant to
  // be stable, never-deleted reference data.
  await prisma.documentSequence.deleteMany();
  await prisma.financialYear.deleteMany();
  await prisma.size.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.userRole.deleteMany();
  await prisma.userDistributor.deleteMany();
  await prisma.userFactory.deleteMany();
  await prisma.user.deleteMany();
  await prisma.factory.deleteMany();
  await prisma.distributor.deleteMany();
}

export interface CreateTestUserOptions {
  email: string;
  mobile?: string;
  password: string;
  roles?: Role[];
  status?: UserStatus;
  authVersion?: number;
}

export async function createTestUser(options: CreateTestUserOptions): Promise<string> {
  const passwordHash = await hashPassword(options.password);
  const userId = createId();

  const roles = options.roles?.length
    ? await prisma.role.findMany({ where: { name: { in: options.roles } } })
    : [];

  await prisma.user.create({
    data: {
      id: userId,
      email: options.email,
      mobile: options.mobile,
      name: 'Test User',
      passwordHash,
      status: options.status ?? 'ACTIVE',
      authVersion: options.authVersion ?? 1,
      userRoles: roles.length
        ? { create: roles.map((role) => ({ id: createId(), roleId: role.id })) }
        : undefined,
    },
  });

  return userId;
}

// Issues a valid access token directly for a given user/roles, bypassing
// the HTTP login round trip — useful for tests that only need an
// authenticated caller, not to exercise login itself.
export async function createTestUserAndToken(
  options: CreateTestUserOptions,
): Promise<{ userId: string; token: string }> {
  const userId = await createTestUser(options);
  const token = signAccessToken({
    sub: userId,
    roles: options.roles ?? [],
    authVersion: options.authVersion ?? 1,
  });
  return { userId, token };
}

export async function createTestDistributor(overrides?: {
  code?: string;
  name?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}): Promise<{ id: string; code: string; name: string }> {
  const id = createId();
  const code = overrides?.code ?? `DIST-${id}`;
  const name = overrides?.name ?? 'Test Distributor';
  await prisma.distributor.create({
    data: { id, code, name, status: overrides?.status ?? 'ACTIVE' },
  });
  return { id, code, name };
}

export async function createTestFactory(overrides?: {
  code?: string;
  name?: string;
}): Promise<{ id: string; code: string; name: string }> {
  const id = createId();
  const code = overrides?.code ?? `FAC-${id}`;
  const name = overrides?.name ?? 'Test Factory';
  await prisma.factory.create({ data: { id, code, name } });
  return { id, code, name };
}

export interface CreateReleasedQaStockOptions {
  distributorId?: string;
  factoryId?: string;
  styleId?: string;
  sizeId?: string;
  quantity: number;
  releasedAt?: Date;
}

export interface ReleasedQaStock {
  distributorId: string;
  factoryId: string;
  styleId: string;
  sizeId: string;
  purchaseOrderId: string;
  poNumber: string;
  purchaseOrderLineSizeId: string;
  jobOrderId: string;
  jobOrderLineSizeId: string;
  qaReleaseId: string;
  qaReleaseLineId: string;
  quantity: number;
}

// Seeds a full, minimal PO -> JobOrder -> Final QA release chain directly via
// Prisma (bypassing the real quality-executions API), the same shortcut
// final-batching.test.ts uses for its own fixture chain. Every Sale Order
// approval/allocation test builds its inventory from 1-3 calls to this.
export async function createReleasedQaStock(
  options: CreateReleasedQaStockOptions,
): Promise<ReleasedQaStock> {
  const quantity = options.quantity;
  const distributor = options.distributorId
    ? { id: options.distributorId }
    : await createTestDistributor();
  const factory = options.factoryId ? { id: options.factoryId } : await createTestFactory();
  const actorId = await createTestUser({
    email: `qa-stock-${createId()}@test.local`,
    password: 'pass',
    roles: ['ADMIN'],
  });

  const style = options.styleId
    ? { id: options.styleId }
    : await prisma.style.create({
        data: {
          id: createId(),
          styleNumber: `SO-${createId()}`,
          styleName: 'Sale order fixture style',
          finalMrp: 100,
        },
      });
  const size = options.sizeId
    ? { id: options.sizeId }
    : await prisma.size.create({
        data: { id: createId(), code: `SZ-${createId()}`, label: 'M', sizeType: 'ALPHA', sortOrder: 1 },
      });

  const financialYear = await createTestFinancialYear();
  const poSerial = await allocateTestDocumentSerial('PURCHASE_ORDER', financialYear.id);
  const poNumber = `PO-${createId()}`;
  const po = await prisma.distributorPurchaseOrder.create({
    data: {
      id: createId(),
      poNumber,
      distributorId: distributor.id,
      poDate: new Date(),
      purchaseMode: 'OUTRIGHT',
      status: 'SUBMITTED',
      createdBy: actorId,
      financialYearId: financialYear.id,
      poSerial,
      lines: {
        create: {
          id: createId(),
          styleId: style.id,
          sizes: { create: [{ id: createId(), sizeId: size.id, orderedQuantity: quantity * 4 + 100 }] },
        },
      },
    },
    include: { lines: { include: { sizes: true } } },
  });
  const purchaseOrderLineSizeId = po.lines[0]!.sizes[0]!.id;

  const form = await prisma.qualityForm.create({
    data: {
      id: createId(),
      code: `SO_FINAL_${createId()}`,
      name: 'Sale order fixture Final Inspection',
      versions: {
        create: {
          id: createId(),
          versionNumber: 1,
          activityType: 'INSPECTION',
          executionScope: 'JOB_ORDER',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      },
    },
    include: { versions: true },
  });
  const flow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: `SO-FLOW-${createId()}`,
      name: 'Sale order fixture flow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const finishingStage = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 1,
      name: 'Finishing',
      code: 'FINISHING',
    },
  });
  const finalStage = await prisma.processFlowVersionStage.create({
    data: {
      id: createId(),
      processFlowVersionId: flow.versions[0]!.id,
      sequence: 2,
      name: 'Final Inspection',
      code: 'FINAL',
      activityType: 'QUALITY',
      qualityFormVersionId: form.versions[0]!.id,
      qualityExecutionMode: 'IN_PROCESS',
      associatedProductionActivityId: finishingStage.id,
      qualityAvailabilityPolicy: 'WHILE_ASSOCIATED_ACTIVITY_ACTIVE',
      executionMultiplicity: 'BATCHED',
      coverageTarget: 'PREPARED_QUANTITY',
    },
  });

  const jobOrderSerial = await allocateTestDocumentSerial('JOB_ORDER', financialYear.id);
  const job = await prisma.jobOrder.create({
    data: {
      id: createId(),
      jobOrderNumber: `JO-${createId()}`,
      purchaseOrderId: po.id,
      factoryId: factory.id,
      processFlowVersionId: flow.versions[0]!.id,
      unitPrice: 10,
      status: 'IN_PRODUCTION',
      factoryConfirmationStatus: 'CONFIRMED',
      preparedQuantityTotal: quantity,
      createdBy: actorId,
      financialYearId: financialYear.id,
      jobOrderSerial,
      lines: {
        create: {
          id: createId(),
          purchaseOrderLineId: po.lines[0]!.id,
          styleId: style.id,
          orderedQuantityTotal: quantity,
          preparedQuantityTotal: quantity,
          sizes: {
            create: [
              {
                id: createId(),
                purchaseOrderLineSizeId,
                sizeId: size.id,
                orderedQuantity: quantity,
                preparedQuantity: quantity,
              },
            ],
          },
        },
      },
    },
    include: { lines: { include: { sizes: true } } },
  });
  const jobOrderLineSizeId = job.lines[0]!.sizes[0]!.id;

  // The batch's disposition can only flip to RELEASED once a QaRelease row
  // referencing it exists — enforced by a DEFERRED constraint trigger
  // (final_quality_batch_release_guard) that checks at transaction commit.
  // A bare, unwrapped prisma call is its own single-statement transaction,
  // so creating the batch as RELEASED directly (or updating it outside a
  // transaction that also inserts the QaRelease) fails that check. All of
  // batch -> execution -> release -> released-disposition must therefore
  // commit together, exactly like quality-executions.service.ts does it.
  const qaReleaseId = createId();
  const qaReleaseLineId = createId();
  const batchId = createId();
  const executionId = createId();
  await prisma.$transaction(async (tx) => {
    await tx.finalQualityBatch.create({
      data: {
        id: batchId,
        jobOrderId: job.id,
        processFlowActivityId: finalStage.id,
        batchNumber: 1,
        physicalQuantity: quantity,
        disposition: 'DRAFT',
        createdById: actorId,
        allocations: { create: { id: createId(), jobOrderLineSizeId, quantity } },
      },
    });
    await tx.qualityActivityExecution.create({
      data: {
        id: executionId,
        jobOrderId: job.id,
        processFlowActivityId: finalStage.id,
        qualityFormVersionId: form.versions[0]!.id,
        inspectedQuantity: quantity,
        finalQualityBatchId: batchId,
        status: 'FINALIZED',
        startedById: actorId,
        finalizedById: actorId,
        finalizedAt: new Date(),
        outcome: 'PASS',
      },
    });
    await tx.qaRelease.create({
      data: {
        id: qaReleaseId,
        jobOrderId: job.id,
        sourceQualityExecutionId: executionId,
        finalQualityBatchId: batchId,
        releasedById: actorId,
        releasedAt: options.releasedAt ?? new Date(),
        lines: {
          create: { id: qaReleaseLineId, jobOrderLineSizeId, purchaseOrderLineSizeId, quantity },
        },
      },
    });
    await tx.finalQualityBatch.update({
      where: { id: batchId },
      data: { disposition: 'RELEASED', terminalById: actorId, terminalAt: new Date() },
    });
    await tx.distributorPurchaseOrderLineSize.update({
      where: { id: purchaseOrderLineSizeId },
      data: { qaPassedQuantity: { increment: quantity } },
    });
  });

  return {
    distributorId: distributor.id,
    factoryId: factory.id,
    styleId: style.id,
    sizeId: size.id,
    purchaseOrderId: po.id,
    poNumber,
    purchaseOrderLineSizeId,
    jobOrderId: job.id,
    jobOrderLineSizeId,
    qaReleaseId,
    qaReleaseLineId,
    quantity,
  };
}
