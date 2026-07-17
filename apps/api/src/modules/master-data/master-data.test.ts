import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import {
  createTestDistributor,
  createTestFactory,
  createTestUserAndToken,
  resetDatabase,
} from '../../test/helpers.js';
import { assertProcessFlowVersionMutable } from './master-data.service.js';

const app = createApp();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createSize(code = 'AGE_3') {
  return prisma.size.create({
    data: { id: createId(), code, label: code.replace('_', ' '), sizeType: 'AGE', sortOrder: 3 },
  });
}

async function createStyle(token: string, overrides?: Record<string, unknown>) {
  return request(app)
    .post('/styles')
    .set('Authorization', `Bearer ${token}`)
    .send({
      styleNumber: 'ST-001',
      styleName: 'Boys Regular T-Shirt',
      finalMrp: 849,
      hsnCode: '61091000',
      royaltyPercentage: 12,
      ...overrides,
    });
}

describe('styles API', () => {
  it('allows ADMIN and MERCHANDISER to create styles', async () => {
    const { token: adminToken } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const { token: merchandiserToken } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });

    const adminRes = await createStyle(adminToken, { styleNumber: 'ST-ADMIN' });
    const merchRes = await createStyle(merchandiserToken, { styleNumber: 'ST-MERCH' });

    expect(adminRes.status).toBe(201);
    expect(merchRes.status).toBe(201);
    expect(adminRes.body.data.hsnCode).toBe('61091000');
  });

  it('rejects unauthorized roles from creating styles', async () => {
    const { token } = await createTestUserAndToken({
      email: 'qa@test.local',
      password: 'qa-password',
      roles: ['QA_USER'],
    });

    const res = await createStyle(token);

    expect(res.status).toBe(403);
  });

  it('validates style number uniqueness and monetary fields', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    const created = await createStyle(token);
    expect(created.status).toBe(201);

    const duplicate = await createStyle(token);
    const badMrp = await createStyle(token, { styleNumber: 'ST-002', finalMrp: 0 });
    const badRoyalty = await createStyle(token, { styleNumber: 'ST-003', royaltyPercentage: 101 });

    expect(duplicate.status).toBe(409);
    expect(badMrp.status).toBe(400);
    expect(badRoyalty.status).toBe(400);
  });

  it('adds and removes style sizes without allowing duplicates', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const size = await createSize();
    const style = await createStyle(token).then((res) => res.body.data);

    const added = await request(app)
      .post(`/styles/${style.id}/sizes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeId: size.id });
    const duplicate = await request(app)
      .post(`/styles/${style.id}/sizes`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sizeId: size.id });
    const removed = await request(app)
      .delete(`/styles/${style.id}/sizes/${size.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(added.status).toBe(200);
    expect(added.body.data.sizes).toHaveLength(1);
    expect(duplicate.status).toBe(409);
    expect(removed.status).toBe(200);
    expect(removed.body.data.sizes).toHaveLength(0);
  });

  it('adds and removes style factory mappings without allowing duplicates', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
    const factory = await createTestFactory({ code: 'FAC-001', name: 'Acme Factory' });
    const style = await createStyle(token).then((res) => res.body.data);

    const added = await request(app)
      .post(`/styles/${style.id}/factories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ factoryId: factory.id, exFactoryPrice: 188 });
    const duplicate = await request(app)
      .post(`/styles/${style.id}/factories`)
      .set('Authorization', `Bearer ${token}`)
      .send({ factoryId: factory.id, exFactoryPrice: 188 });
    const removed = await request(app)
      .delete(`/styles/${style.id}/factories/${factory.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(added.status).toBe(200);
    expect(added.body.data.factories).toHaveLength(1);
    expect(duplicate.status).toBe(409);
    expect(removed.status).toBe(200);
    expect(removed.body.data.factories).toHaveLength(0);
  });
});

describe('sizes API', () => {
  it('validates unique size code', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    await request(app)
      .post('/sizes')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'AGE_3', label: '3', sizeType: 'AGE', sortOrder: 3 })
      .expect(201);

    const duplicate = await request(app)
      .post('/sizes')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'AGE_3', label: 'Three', sizeType: 'AGE', sortOrder: 4 });

    expect(duplicate.status).toBe(409);
  });
});

describe('factories API', () => {
  it('validates unique factory code and name', async () => {
    const { token } = await createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });

    await request(app)
      .post('/factories')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FAC-001', name: 'Acme Factory' })
      .expect(201);

    const duplicateCode = await request(app)
      .post('/factories')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FAC-001', name: 'Other Factory' });
    const duplicateName = await request(app)
      .post('/factories')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: 'FAC-002', name: 'Acme Factory' });

    expect(duplicateCode.status).toBe(409);
    expect(duplicateName.status).toBe(409);
  });
});

describe('process flow API', () => {
  async function createManager(role: 'ADMIN' | 'MERCHANDISER' = 'ADMIN') {
    return createTestUserAndToken({
      email: `${role.toLowerCase()}@test.local`,
      password: 'test-password',
      roles: [role],
    });
  }

  function createFlow(token: string, suffix = '', overrides?: Record<string, unknown>) {
    return request(app)
      .post('/process-flows')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: `PROD${suffix}`,
        name: `Production${suffix}`,
        description: 'Main production flow',
        stages: [
          { sequence: 1, name: 'Cutting' },
          { sequence: 2, name: 'Sewing' },
        ],
        ...overrides,
      });
  }

  async function holdProcessFlowLock(processFlowId: string) {
    let signalAcquired!: () => void;
    let signalRelease!: () => void;
    const acquired = new Promise<void>((resolve) => {
      signalAcquired = resolve;
    });
    const release = new Promise<void>((resolve) => {
      signalRelease = resolve;
    });
    const transaction = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('process_flow:' || ${processFlowId}, 0))::text`;
        signalAcquired();
        await release;
      },
      { timeout: 10_000 },
    );

    await acquired;
    return async () => {
      signalRelease();
      await transaction;
    };
  }

  async function waitForAdvisoryLockWaiters(expected: number) {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const [result] = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*)::bigint AS count
        FROM pg_stat_activity
        WHERE pid <> pg_backend_pid()
          AND wait_event_type = 'Lock'
          AND query LIKE '%pg_advisory_xact_lock%'
      `;
      if (Number(result?.count ?? 0) >= expected) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${expected} advisory-lock waiter(s)`);
  }

  it('creates a flow with an initial draft, normalizes stages, and records an audit log', async () => {
    const { token, userId } = await createManager('MERCHANDISER');
    const response = await createFlow(token).expect(201);
    const flow = response.body.data;
    const version = await request(app)
      .get(`/process-flow-versions/${flow.versions[0].id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(flow.versions[0]).toMatchObject({ versionNumber: 1, status: 'DRAFT' });
    expect(
      version.body.data.stages.map((stage: { sequence: number; name: string }) => [
        stage.sequence,
        stage.name,
      ]),
    ).toEqual([
      [1, 'Cutting'],
      [2, 'Sewing'],
    ]);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_CREATED' } }),
    ).toMatchObject({
      actorId: userId,
      entityId: flow.id,
    });
  });

  it('validates creation, rejects duplicate code or name, and enforces mutation roles', async () => {
    const { token } = await createManager();
    await request(app)
      .post('/process-flows')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '', name: '', stages: [] })
      .expect(400);
    await createFlow(token).expect(201);
    await createFlow(token, '-CODE', {
      code: 'PROD',
      name: 'Other',
      stages: [{ name: 'Cutting' }],
    }).expect(409);
    await createFlow(token, '-NAME', {
      code: 'OTHER',
      name: 'production',
      stages: [{ name: 'Cutting' }],
    }).expect(409);

    const { token: factoryToken } = await createTestUserAndToken({
      email: 'factory@test.local',
      password: 'test-password',
      roles: ['FACTORY_USER'],
    });
    await createFlow(factoryToken, '-FORBIDDEN').expect(403);
    await request(app).post('/process-flows').send({}).expect(401);
  });

  it('creates empty and copied versions without changing source stages', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const sourceId = flow.versions[0].id;

    const empty = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    expect(empty.body.data).toMatchObject({ versionNumber: 2, status: 'DRAFT', stages: [] });

    const copied = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ copyFromVersionId: sourceId })
      .expect(201);
    expect(copied.body.data.versionNumber).toBe(3);
    expect(copied.body.data.stages.map((stage: { name: string }) => stage.name)).toEqual([
      'Cutting',
      'Sewing',
    ]);

    await request(app)
      .put(`/process-flow-versions/${copied.body.data.id}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Packing' }] })
      .expect(200);
    const source = await request(app)
      .get(`/process-flow-versions/${sourceId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(source.body.data.stages.map((stage: { name: string }) => stage.name)).toEqual([
      'Cutting',
      'Sewing',
    ]);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_VERSION_COPIED' } }),
    ).not.toBeNull();
  });

  it('atomically adds, removes, and reorders draft stages with full-list validation', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const versionId = flow.versions[0].id;

    const replaced = await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Sewing' }, { name: 'Packing' }, { name: 'Cutting' }] })
      .expect(200);
    expect(
      replaced.body.data.stages.map((stage: { sequence: number; name: string }) => [
        stage.sequence,
        stage.name,
      ]),
    ).toEqual([
      [1, 'Sewing'],
      [2, 'Packing'],
      [3, 'Cutting'],
    ]);

    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Cutting' }, { name: ' cutting ' }] })
      .expect(400);
    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: '   ' }] })
      .expect(400);
    await request(app)
      .put(`/process-flow-versions/${versionId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        stages: [
          { sequence: 2, name: 'Cutting' },
          { sequence: 1, name: 'Sewing' },
        ],
      })
      .expect(400);

    const persisted = await prisma.processFlowVersionStage.findMany({
      where: { processFlowVersionId: versionId },
      orderBy: { sequence: 'asc' },
    });
    expect(persisted.map((stage) => stage.name)).toEqual(['Sewing', 'Packing', 'Cutting']);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_DRAFT_STAGES_REPLACED' } }),
    ).not.toBeNull();
  });

  it('activates draft process flow versions and retires the previous active version', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const version1 = flow.versions[0];

    await request(app)
      .post(`/process-flow-versions/${version1.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const version2 = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        stages: [{ name: 'Cutting' }, { name: 'Sewing' }, { name: 'Packing' }],
      })
      .then((res) => res.body.data);

    await request(app)
      .post(`/process-flow-versions/${version2.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [first, second] = await Promise.all([
      prisma.processFlowVersion.findUniqueOrThrow({ where: { id: version1.id } }),
      prisma.processFlowVersion.findUniqueOrThrow({ where: { id: version2.id } }),
    ]);

    expect(first.status).toBe('RETIRED');
    expect(second.status).toBe('ACTIVE');
    expect(
      await prisma.processFlowVersion.count({
        where: { processFlowId: flow.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_VERSION_RETIRED' } }),
    ).not.toBeNull();
    expect(
      await prisma.auditLog.findFirst({ where: { action: 'PROCESS_FLOW_VERSION_ACTIVATED' } }),
    ).not.toBeNull();
  });

  it('rejects empty activation and makes active and retired stages immutable', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const version1Id = flow.versions[0].id;
    const empty = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .then((response) => response.body.data);
    await request(app)
      .post(`/process-flow-versions/${empty.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    await request(app)
      .post(`/process-flow-versions/${version1Id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .put(`/process-flow-versions/${version1Id}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Changed' }] })
      .expect(409);

    const version2 = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ copyFromVersionId: version1Id })
      .then((response) => response.body.data);
    await request(app)
      .post(`/process-flow-versions/${version2.id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .put(`/process-flow-versions/${version1Id}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Changed' }] })
      .expect(409);
  });

  it('serializes concurrent version creation and activation', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const requests = [1, 2].map(() =>
      request(app)
        .post(`/process-flows/${flow.id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stages: [{ name: 'Cutting' }] }),
    );
    const results = await Promise.all(requests);
    expect(results.map((result) => result.status)).toEqual([201, 201]);
    const versionNumbers = await prisma.processFlowVersion.findMany({
      where: { processFlowId: flow.id },
      orderBy: { versionNumber: 'asc' },
      select: { versionNumber: true },
    });
    expect(versionNumbers.map(({ versionNumber }) => versionNumber)).toEqual([1, 2, 3]);

    const draftId = results[0]!.body.data.id;
    const activations = await Promise.all(
      [1, 2].map(() =>
        request(app)
          .post(`/process-flow-versions/${draftId}/activate`)
          .set('Authorization', `Bearer ${token}`),
      ),
    );
    expect(activations.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(
      await prisma.processFlowVersion.count({
        where: { processFlowId: flow.id, status: 'ACTIVE' },
      }),
    ).toBe(1);
  });

  it('rejects one of two competing draft activations without retiring the winner', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const previousActiveId = flow.versions[0].id as string;
    await request(app)
      .post(`/process-flow-versions/${previousActiveId}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const drafts = await Promise.all(
      ['Packing', 'Dispatch'].map((name) =>
        request(app)
          .post(`/process-flows/${flow.id}/versions`)
          .set('Authorization', `Bearer ${token}`)
          .send({ stages: [{ name }] })
          .expect(201),
      ),
    );
    const draftIds = drafts.map((response) => response.body.data.id as string);

    const releaseLock = await holdProcessFlowLock(flow.id);
    const activationsPromise = Promise.all(
      draftIds.map((draftId) =>
        request(app)
          .post(`/process-flow-versions/${draftId}/activate`)
          .set('Authorization', `Bearer ${token}`),
      ),
    );
    try {
      await waitForAdvisoryLockWaiters(2);
    } finally {
      await releaseLock();
    }
    const activations = await activationsPromise;

    expect(activations.map(({ status }) => status).sort()).toEqual([200, 409]);
    const winnerId = activations.find(({ status }) => status === 200)!.body.data.id as string;
    const loserId = draftIds.find((draftId) => draftId !== winnerId)!;
    const versions = await prisma.processFlowVersion.findMany({
      where: { processFlowId: flow.id },
      select: { id: true, status: true },
    });
    const statusById = new Map(versions.map((version) => [version.id, version.status]));

    expect(statusById.get(winnerId)).toBe('ACTIVE');
    expect(statusById.get(loserId)).toBe('DRAFT');
    expect(statusById.get(previousActiveId)).toBe('RETIRED');
    expect(versions.filter(({ status }) => status === 'ACTIVE')).toHaveLength(1);
    expect(
      await prisma.auditLog.count({
        where: {
          action: 'PROCESS_FLOW_VERSION_ACTIVATED',
          entityId: { in: draftIds },
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'PROCESS_FLOW_VERSION_RETIRED', entityId: previousActiveId },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'PROCESS_FLOW_VERSION_ACTIVATED', entityId: loserId },
      }),
    ).toBe(0);
  });

  it('allows two pre-existing drafts to be activated deliberately in sequence', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    await request(app)
      .post(`/process-flow-versions/${flow.versions[0].id}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const draftIds: string[] = [];
    for (const name of ['Packing', 'Dispatch']) {
      const response = await request(app)
        .post(`/process-flows/${flow.id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ stages: [{ name }] })
        .expect(201);
      draftIds.push(response.body.data.id as string);
    }

    await request(app)
      .post(`/process-flow-versions/${draftIds[0]}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app)
      .post(`/process-flow-versions/${draftIds[1]}/activate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [first, second] = await Promise.all(
      draftIds.map((draftId) =>
        prisma.processFlowVersion.findUniqueOrThrow({ where: { id: draftId } }),
      ),
    );
    expect(first!.status).toBe('RETIRED');
    expect(second!.status).toBe('ACTIVE');
  });

  it('serializes draft-stage replacement against activation of that draft', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const draftId = flow.versions[0].id as string;
    const replacementStages = [{ name: 'Printing' }, { name: 'Packing' }];

    const releaseLock = await holdProcessFlowLock(flow.id);
    const replacementPromise = request(app)
      .put(`/process-flow-versions/${draftId}/stages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: replacementStages });
    const activationPromise = request(app)
      .post(`/process-flow-versions/${draftId}/activate`)
      .set('Authorization', `Bearer ${token}`);
    const resultsPromise = Promise.all([replacementPromise, activationPromise]);
    try {
      await waitForAdvisoryLockWaiters(2);
    } finally {
      await releaseLock();
    }
    const [replacement, activation] = await resultsPromise;

    expect(activation.status).toBe(200);
    expect([200, 409]).toContain(replacement.status);
    const persisted = await prisma.processFlowVersion.findUniqueOrThrow({
      where: { id: draftId },
      include: { stages: { orderBy: { sequence: 'asc' } } },
    });
    expect(persisted.status).toBe('ACTIVE');
    const persistedStageNames = persisted.stages.map(({ name }) => name);
    const replacementWon = replacement.status === 200;
    expect(persistedStageNames).toEqual(
      replacementWon ? ['Printing', 'Packing'] : ['Cutting', 'Sewing'],
    );
    expect(
      await prisma.auditLog.count({
        where: { action: 'PROCESS_FLOW_DRAFT_STAGES_REPLACED', entityId: draftId },
      }),
    ).toBe(replacementWon ? 1 : 0);
    const activationAudit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'PROCESS_FLOW_VERSION_ACTIVATED', entityId: draftId },
    });
    expect(
      (activationAudit.metadata as { stages: Array<{ name: string }> }).stages.map(
        ({ name }) => name,
      ),
    ).toEqual(persistedStageNames);
  });

  it('keeps the partial unique index as an independent single-active backstop', async () => {
    const { token } = await createManager();
    const flow = (await createFlow(token).expect(201)).body.data;
    const firstId = flow.versions[0].id as string;
    const second = await request(app)
      .post(`/process-flows/${flow.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ stages: [{ name: 'Packing' }] })
      .expect(201);
    const secondId = second.body.data.id as string;

    await prisma.processFlowVersion.update({
      where: { id: firstId },
      data: { status: 'ACTIVE' },
    });
    await expect(
      prisma.processFlowVersion.update({
        where: { id: secondId },
        data: { status: 'ACTIVE' },
      }),
    ).rejects.toThrow();

    expect(
      await prisma.processFlowVersion.findMany({
        where: { processFlowId: flow.id },
        orderBy: { versionNumber: 'asc' },
        select: { status: true },
      }),
    ).toEqual([{ status: 'ACTIVE' }, { status: 'DRAFT' }]);
  });

  it('treats active and retired process flow versions as immutable business objects', () => {
    expect(() => assertProcessFlowVersionMutable('DRAFT')).not.toThrow();
    expect(() => assertProcessFlowVersionMutable('ACTIVE')).toThrow(
      'ACTIVE and RETIRED process flow versions are immutable',
    );
    expect(() => assertProcessFlowVersionMutable('RETIRED')).toThrow(
      'ACTIVE and RETIRED process flow versions are immutable',
    );
  });
});

describe('distributors API', () => {
  async function createAdmin() {
    return createTestUserAndToken({
      email: 'admin@test.local',
      password: 'admin-password',
      roles: ['ADMIN'],
    });
  }

  async function createDistributorViaApi(token: string, overrides?: Record<string, unknown>) {
    return request(app)
      .post('/distributors')
      .set('Authorization', `Bearer ${token}`)
      .send({
        code: 'DIST-001',
        name: 'Acme Distribution',
        contactName: 'Asha Nair',
        contactEmail: 'asha@acme.test',
        city: 'Kochi',
        ...overrides,
      });
  }

  it('allows ADMIN to create a distributor and records an audit log', async () => {
    const { userId, token } = await createAdmin();

    const res = await createDistributorViaApi(token);

    expect(res.status).toBe(201);
    expect(res.body.data.code).toBe('DIST-001');
    expect(res.body.data.status).toBe('ACTIVE');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'DISTRIBUTOR_CREATED', entityId: res.body.data.id },
    });
    expect(audit).not.toBeNull();
    expect(audit?.actorId).toBe(userId);
  });

  it('rejects non-ADMIN roles from creating, updating, or changing distributor status', async () => {
    const { token: merchToken } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const distributor = await createTestDistributor();

    const created = await createDistributorViaApi(merchToken);
    const updated = await request(app)
      .patch(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ name: 'Renamed' });
    const statusChanged = await request(app)
      .patch(`/distributors/${distributor.id}/status`)
      .set('Authorization', `Bearer ${merchToken}`)
      .send({ status: 'INACTIVE' });

    expect(created.status).toBe(403);
    expect(updated.status).toBe(403);
    expect(statusChanged.status).toBe(403);
  });

  it('validates required fields and rejects duplicate code or name', async () => {
    const { token } = await createAdmin();

    const created = await createDistributorViaApi(token);
    expect(created.status).toBe(201);

    const missingName = await createDistributorViaApi(token, { code: 'DIST-002', name: '' });
    const duplicateCode = await createDistributorViaApi(token, { name: 'Other Distribution' });
    const duplicateName = await createDistributorViaApi(token, { code: 'DIST-003' });

    expect(missingName.status).toBe(400);
    expect(duplicateCode.status).toBe(409);
    expect(duplicateName.status).toBe(409);
  });

  it('updates a distributor, records an audit log, and rejects unknown ids', async () => {
    const { userId, token } = await createAdmin();
    const distributor = await createTestDistributor({
      code: 'DIST-001',
      name: 'Acme Distribution',
    });

    const updated = await request(app)
      .patch(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Acme Distribution South', city: 'Chennai' });
    const unknown = await request(app)
      .patch('/distributors/does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });

    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Acme Distribution South');
    expect(updated.body.data.city).toBe('Chennai');
    expect(unknown.status).toBe(404);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'DISTRIBUTOR_UPDATED', entityId: distributor.id },
    });
    expect(audit?.actorId).toBe(userId);
  });

  it('rejects renaming a distributor to an existing name', async () => {
    const { token } = await createAdmin();
    await createTestDistributor({ code: 'D1', name: 'Dist One' });
    const second = await createTestDistributor({ code: 'D2', name: 'Dist Two' });

    const res = await request(app)
      .patch(`/distributors/${second.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Dist One' });

    expect(res.status).toBe(409);
  });

  it('deactivates and reactivates a distributor with audit metadata', async () => {
    const { token } = await createAdmin();
    const distributor = await createTestDistributor();

    const deactivated = await request(app)
      .patch(`/distributors/${distributor.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });

    expect(deactivated.status).toBe(200);
    expect(deactivated.body.data.status).toBe('INACTIVE');

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'DISTRIBUTOR_STATUS_CHANGED', entityId: distributor.id },
    });
    expect(audit?.metadata).toEqual({ from: 'ACTIVE', to: 'INACTIVE' });

    const reactivated = await request(app)
      .patch(`/distributors/${distributor.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' });
    expect(reactivated.body.data.status).toBe('ACTIVE');
  });

  it('excludes inactive distributors from status=ACTIVE listing used by the PO form', async () => {
    const { token } = await createAdmin();
    await createTestDistributor({ code: 'D-ACT', name: 'Active Dist' });
    await createTestDistributor({ code: 'D-INA', name: 'Inactive Dist', status: 'INACTIVE' });

    const res = await request(app)
      .get('/distributors')
      .query({ status: 'ACTIVE' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((d: { code: string }) => d.code)).toEqual(['D-ACT']);
  });

  it('supports searching distributors by code or name', async () => {
    const { token } = await createAdmin();
    await createTestDistributor({ code: 'D-100', name: 'North Traders' });
    await createTestDistributor({ code: 'D-200', name: 'South Traders' });

    const res = await request(app)
      .get('/distributors')
      .query({ search: 'north' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('North Traders');
  });

  it('limits DISTRIBUTOR users to their mapped distributor in list and detail', async () => {
    const { userId: distUserId, token: distToken } = await createTestUserAndToken({
      email: 'dist@test.local',
      password: 'dist-password',
      roles: ['DISTRIBUTOR'],
    });
    const own = await createTestDistributor({ code: 'D-OWN', name: 'Own Dist' });
    const other = await createTestDistributor({ code: 'D-OTHER', name: 'Other Dist' });
    await prisma.userDistributor.create({
      data: { id: createId(), userId: distUserId, distributorId: own.id },
    });

    const list = await request(app)
      .get('/distributors')
      .set('Authorization', `Bearer ${distToken}`);
    const ownDetail = await request(app)
      .get(`/distributors/${own.id}`)
      .set('Authorization', `Bearer ${distToken}`);
    const otherDetail = await request(app)
      .get(`/distributors/${other.id}`)
      .set('Authorization', `Bearer ${distToken}`);

    expect(list.status).toBe(200);
    expect(list.body.data.map((d: { id: string }) => d.id)).toEqual([own.id]);
    expect(ownDetail.status).toBe(200);
    expect(otherDetail.status).toBe(403);
  });

  it('fails closed for a DISTRIBUTOR user with no distributor mapping', async () => {
    const { token: distToken } = await createTestUserAndToken({
      email: 'dist@test.local',
      password: 'dist-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributor = await createTestDistributor();

    const list = await request(app)
      .get('/distributors')
      .set('Authorization', `Bearer ${distToken}`);
    const detail = await request(app)
      .get(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${distToken}`);

    expect(list.status).toBe(403);
    expect(list.body.error.message).toBe('No distributor is mapped to your account');
    expect(detail.status).toBe(403);
  });

  it('allows ADMIN and MERCHANDISER to read any distributor detail', async () => {
    const { token: adminToken } = await createAdmin();
    const { token: merchToken } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const distributor = await createTestDistributor();

    const adminRes = await request(app)
      .get(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const merchRes = await request(app)
      .get(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${merchToken}`);

    expect(adminRes.status).toBe(200);
    expect(merchRes.status).toBe(200);
  });

  it('rejects unauthenticated and factory-role access to distributors', async () => {
    const { token: factoryToken } = await createTestUserAndToken({
      email: 'factory@test.local',
      password: 'factory-password',
      roles: ['FACTORY_USER'],
    });
    const distributor = await createTestDistributor();

    const anonymous = await request(app).get('/distributors');
    const factoryList = await request(app)
      .get('/distributors')
      .set('Authorization', `Bearer ${factoryToken}`);
    const factoryDetail = await request(app)
      .get(`/distributors/${distributor.id}`)
      .set('Authorization', `Bearer ${factoryToken}`);

    expect(anonymous.status).toBe(401);
    expect(factoryList.status).toBe(403);
    expect(factoryDetail.status).toBe(403);
  });

  it('lists users mapped to a distributor for ADMIN only', async () => {
    const { token: adminToken } = await createAdmin();
    const { token: merchToken } = await createTestUserAndToken({
      email: 'merch@test.local',
      password: 'merch-password',
      roles: ['MERCHANDISER'],
    });
    const { userId: distUserId } = await createTestUserAndToken({
      email: 'dist@test.local',
      password: 'dist-password',
      roles: ['DISTRIBUTOR'],
    });
    const distributor = await createTestDistributor();
    await prisma.userDistributor.create({
      data: { id: createId(), userId: distUserId, distributorId: distributor.id },
    });

    const adminRes = await request(app)
      .get(`/distributors/${distributor.id}/users`)
      .set('Authorization', `Bearer ${adminToken}`);
    const merchRes = await request(app)
      .get(`/distributors/${distributor.id}/users`)
      .set('Authorization', `Bearer ${merchToken}`);
    const unknownRes = await request(app)
      .get('/distributors/does-not-exist/users')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(adminRes.status).toBe(200);
    expect(adminRes.body.data).toHaveLength(1);
    expect(adminRes.body.data[0]).toMatchObject({
      id: distUserId,
      email: 'dist@test.local',
      roles: ['DISTRIBUTOR'],
    });
    expect(merchRes.status).toBe(403);
    expect(unknownRes.status).toBe(404);
  });
});
