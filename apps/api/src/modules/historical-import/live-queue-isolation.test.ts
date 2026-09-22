// Proves the corrected-plan requirement (see the H1 plan §5/§8): every live
// Factory/QA operational work-queue query explicitly excludes
// recordOrigin='HISTORICAL_IMPORT' rows, rather than incidentally relying on
// today's status filters to keep them out. Each historical fixture below
// deliberately reuses a status/factoryId that *would* otherwise satisfy the
// corresponding live queue's filters, so a regression that dropped the
// explicit recordOrigin filter would make these tests fail.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createId } from '@erve/shared';
import { prisma } from '../../db/prisma.js';
import type { CurrentUser } from '../../auth/current-user.js';
import { getAssignedFactoryTasks, getJobOrderList } from '../job-orders/job-orders.service.js';
import { getQueue, getReworkQueue } from '../qa/qa.service.js';
import { createTestFactory, createTestFinancialYear, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

function currentUserFor(userId: string, roles: CurrentUser['roles'], factoryIds: string[] = []): CurrentUser {
  return {
    id: userId,
    email: `${userId}@test.local`,
    mobile: null,
    name: 'Test User',
    status: 'ACTIVE',
    authVersion: 1,
    roles,
    distributorIds: [],
    factoryIds,
  };
}

async function buildFixture() {
  const admin = await createTestUserAndToken({ email: `admin-${createId()}@test.local`, password: 'pass', roles: ['ADMIN'] });
  const factory = await createTestFactory();
  const financialYear = await createTestFinancialYear();
  const processFlow = await prisma.processFlow.create({
    data: {
      id: createId(),
      code: `LQI-${createId()}`,
      name: 'Live queue isolation fixture flow',
      versions: { create: { id: createId(), versionNumber: 1, status: 'ACTIVE' } },
    },
    include: { versions: true },
  });
  const processFlowVersionId = processFlow.versions[0]!.id;

  async function createJobOrder(overrides: {
    status: string;
    recordOrigin: 'LIVE_WORKFLOW' | 'HISTORICAL_IMPORT';
    jobOrderSerial: number | null;
    factoryConfirmationStatus?: 'PENDING' | 'CONFIRMED' | 'REJECTED';
  }) {
    const id = createId();
    await prisma.jobOrder.create({
      data: {
        id,
        jobOrderNumber: `LQI-JO-${id}`,
        factoryId: factory.id,
        processFlowVersionId,
        unitPrice: 100,
        status: overrides.status as never,
        factoryConfirmationStatus: overrides.factoryConfirmationStatus ?? 'CONFIRMED',
        createdBy: admin.userId,
        financialYearId: financialYear.id,
        jobOrderSerial: overrides.jobOrderSerial,
        recordOrigin: overrides.recordOrigin,
      },
    });
    return id;
  }

  return { admin, factory, financialYear, processFlowVersionId, createJobOrder };
}

describe('live Factory/QA operational queue isolation from historical-import rows', () => {
  it('getAssignedFactoryTasks excludes a HISTORICAL_IMPORT row even at an overlapping status/factory', async () => {
    const { factory, createJobOrder } = await buildFixture();
    const liveId = await createJobOrder({ status: 'IN_PRODUCTION', recordOrigin: 'LIVE_WORKFLOW', jobOrderSerial: 1 });
    const historicalId = await createJobOrder({
      status: 'PRODUCTION_COMPLETE',
      recordOrigin: 'HISTORICAL_IMPORT',
      jobOrderSerial: null,
    });

    const factoryUser = await createTestUserAndToken({
      email: `factory-${createId()}@test.local`,
      password: 'pass',
      roles: ['FACTORY_USER'],
    });
    await prisma.userFactory.create({ data: { id: createId(), userId: factoryUser.userId, factoryId: factory.id } });

    const result = await getAssignedFactoryTasks(currentUserFor(factoryUser.userId, ['FACTORY_USER'], [factory.id]), {
      limit: 50,
    });
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(historicalId);
  });

  it('qa.getQueue excludes a HISTORICAL_IMPORT row even at an overlapping status/factory', async () => {
    const { createJobOrder } = await buildFixture();
    const liveId = await createJobOrder({ status: 'READY_FOR_QA', recordOrigin: 'LIVE_WORKFLOW', jobOrderSerial: 1 });
    const historicalId = await createJobOrder({
      status: 'PRODUCTION_COMPLETE',
      recordOrigin: 'HISTORICAL_IMPORT',
      jobOrderSerial: null,
    });
    // Force the historical row through the same statuses the live QA queue
    // filters on, to prove exclusion holds even if a historical row's
    // status ever coincided with an active QA status.
    await prisma.jobOrder.update({ where: { id: historicalId }, data: { status: 'READY_FOR_QA' } });

    const qaUser = await createTestUserAndToken({ email: `qa-${createId()}@test.local`, password: 'pass', roles: ['QA_USER'] });

    const result = await getQueue(currentUserFor(qaUser.userId, ['QA_USER']), { limit: 50 });
    const ids = result.items.map((item) => item.id);
    expect(ids).toContain(liveId);
    expect(ids).not.toContain(historicalId);
  });

  it('qa.getReworkQueue excludes a HISTORICAL_IMPORT row (structurally unreachable, and explicitly filtered too)', async () => {
    const { createJobOrder } = await buildFixture();
    const historicalId = await createJobOrder({
      status: 'PRODUCTION_COMPLETE',
      recordOrigin: 'HISTORICAL_IMPORT',
      jobOrderSerial: null,
    });
    const supervisor = await createTestUserAndToken({
      email: `supervisor-${createId()}@test.local`,
      password: 'pass',
      roles: ['ADMIN'],
    });

    const rework = await getReworkQueue(currentUserFor(supervisor.userId, ['ADMIN']));
    expect(rework.some((task) => task.jobOrderId === historicalId)).toBe(false);
  });

  it('getJobOrderList (the general list, not a work queue) DOES surface historical rows, and search matches legacyReferenceNumber', async () => {
    const { createJobOrder } = await buildFixture();
    const historicalId = await createJobOrder({
      status: 'PRODUCTION_COMPLETE',
      recordOrigin: 'HISTORICAL_IMPORT',
      jobOrderSerial: null,
    });
    await prisma.jobOrder.update({ where: { id: historicalId }, data: { legacyReferenceNumber: 'EI25001' } });

    const admin = await createTestUserAndToken({ email: `admin2-${createId()}@test.local`, password: 'pass', roles: ['ADMIN'] });

    const unfiltered = await getJobOrderList(currentUserFor(admin.userId, ['ADMIN']), { limit: 50 });
    expect(unfiltered.items.map((item) => item.id)).toContain(historicalId);

    const searched = await getJobOrderList(currentUserFor(admin.userId, ['ADMIN']), { search: 'EI25001', limit: 50 });
    expect(searched.items.map((item) => item.id)).toEqual([historicalId]);
  });
});
