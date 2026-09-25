import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Role } from '@erve/types';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();
const definition = {
  sections: [
    {
      sequence: 1,
      title: 'Inspection',
      components: [
        {
          sequence: 1,
          type: 'CHECKLIST',
          title: 'Checks',
          config: {
            items: [{ key: 'workmanship', label: 'Workmanship' }],
            responseOptions: ['PASSED', 'FAILED', 'N/A'],
          },
        },
      ],
    },
  ],
};
const payload = {
  code: ' inline-report ',
  name: 'Inline Inspection Report',
  activityType: 'INSPECTION',
  executionScope: 'JOB_ORDER',
  ...definition,
};

beforeEach(resetDatabase);
afterAll(async () => prisma.$disconnect());
const auth = async (roles: Role[] = ['ADMIN']) =>
  createTestUserAndToken({
    email: `${roles[0]}-${Math.random()}@test.local`,
    password: 'password',
    roles,
  });
const create = async (token: string, body: object = payload) =>
  request(app).post('/quality-forms').set('Authorization', `Bearer ${token}`).send(body);

describe('Quality Form Master API', () => {
  it('creates a form with a normalized business code and initial draft version', async () => {
    const { token } = await auth();
    const response = await create(token);
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      code: 'INLINE_REPORT',
      activityType: 'INSPECTION',
      executionScope: 'JOB_ORDER',
      status: 'ACTIVE',
    });
    expect(response.body.data.versions).toMatchObject([{ versionNumber: 1, status: 'DRAFT' }]);
    expect(response.body.data.versions[0]).toMatchObject({
      activityType: 'INSPECTION',
      executionScope: 'JOB_ORDER',
    });
  });

  it('enforces code uniqueness and required name', async () => {
    const { token } = await auth();
    expect((await create(token)).status).toBe(201);
    expect((await create(token, { ...payload, code: 'INLINE REPORT' })).status).toBe(409);
    expect((await create(token, { ...payload, code: 'OTHER', name: ' ' })).status).toBe(400);
  });

  it('rejects unsupported activity types and execution scopes', async () => {
    const { token } = await auth();
    expect((await create(token, { ...payload, activityType: 'AUDIT' })).status).toBe(400);
    expect(
      (await create(token, { ...payload, code: 'LOT_FORM', executionScope: 'LOT' })).status,
    ).toBe(400);
  });

  it('rejects non-contiguous component ordering and malformed controlled config', async () => {
    const { token } = await auth();
    const badOrder = structuredClone(payload);
    badOrder.sections[0]!.components[0]!.sequence = 2;
    expect((await create(token, badOrder)).status).toBe(400);
    const badConfig = structuredClone(payload);
    badConfig.sections[0]!.components[0]!.config = { arbitrary: true } as never;
    expect((await create(token, badConfig)).status).toBe(400);
    const badSectionOrder = structuredClone(payload);
    badSectionOrder.sections[0]!.sequence = 2;
    expect((await create(token, badSectionOrder)).status).toBe(400);
  });

  it('applies discriminated component validation and rejects unsupported component types', async () => {
    const { token } = await auth();
    const invalidChecklist = structuredClone(payload);
    invalidChecklist.sections[0]!.components[0]!.config.responseOptions = ['PASSED'];
    expect((await create(token, invalidChecklist)).status).toBe(400);
    const duplicateChecklistItems = structuredClone(payload);
    duplicateChecklistItems.sections[0]!.components[0]!.config.items.push({
      key: 'workmanship',
      label: 'Duplicate workmanship',
    });
    expect((await create(token, duplicateChecklistItems)).status).toBe(400);
    const attendeeAsAql = structuredClone(payload);
    attendeeAsAql.sections[0]!.components[0]!.type = 'AQL_RESULT' as never;
    attendeeAsAql.sections[0]!.components[0]!.config = { roles: ['QA'] } as never;
    expect((await create(token, attendeeAsAql)).status).toBe(400);
    const invalidDefects = structuredClone(payload);
    invalidDefects.sections[0]!.components[0]!.type = 'DEFECT_LIST' as never;
    invalidDefects.sections[0]!.components[0]!.config = { severities: ['COSMETIC'] } as never;
    expect((await create(token, invalidDefects)).status).toBe(400);
    const manualSystemContext = structuredClone(payload);
    manualSystemContext.sections[0]!.components[0]!.type = 'SYSTEM_CONTEXT' as never;
    manualSystemContext.sections[0]!.components[0]!.config = {
      fields: [{ key: 'supplier', label: 'Supplier', dataType: 'TEXT', source: 'USER' }],
    } as never;
    expect((await create(token, manualSystemContext)).status).toBe(400);
    const unknown = structuredClone(payload);
    unknown.sections[0]!.components[0]!.type = 'GENERIC_FIELD' as never;
    expect((await create(token, unknown)).status).toBe(400);
  });

  it('creates subsequent versions by copying the prior definition', async () => {
    const { token } = await auth();
    const form = (await create(token)).body.data;
    const response = await request(app)
      .post(`/quality-forms/${form.id}/versions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ copyFromVersionId: form.versions[0].id });
    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ versionNumber: 2, status: 'DRAFT' });
    expect(response.body.data).toMatchObject({
      activityType: 'INSPECTION',
      executionScope: 'JOB_ORDER',
    });
    expect(response.body.data.sections[0].components[0].type).toBe('CHECKLIST');
  });

  it('publishes a complete draft, retires the former version, and makes published content immutable', async () => {
    const { token } = await auth();
    const form = (await create(token)).body.data;
    expect(
      (
        await request(app)
          .post(`/quality-form-versions/${form.versions[0].id}/publish`)
          .set('Authorization', `Bearer ${token}`)
      ).status,
    ).toBe(200);
    const immutable = await request(app)
      .put(`/quality-form-versions/${form.versions[0].id}/definition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...definition, activityType: 'INSPECTION', executionScope: 'JOB_ORDER' });
    expect(immutable.status).toBe(409);
    const mutableMeaning = await request(app)
      .patch(`/quality-forms/${form.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ activityType: 'MEETING' });
    expect(mutableMeaning.status).toBe(400);
    const v2 = (
      await request(app)
        .post(`/quality-forms/${form.id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sections: definition.sections,
          activityType: 'INSPECTION',
          executionScope: 'JOB_ORDER',
        })
    ).body.data;
    await request(app)
      .post(`/quality-form-versions/${v2.id}/publish`)
      .set('Authorization', `Bearer ${token}`);
    const v1 = await prisma.qualityFormVersion.findUniqueOrThrow({
      where: { id: form.versions[0].id },
    });
    expect(v1.status).toBe('RETIRED');
    const retiredImmutable = await request(app)
      .put(`/quality-form-versions/${v1.id}/definition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...definition, activityType: 'MEETING', executionScope: 'SIZE' });
    expect(retiredImmutable.status).toBe(409);
    expect(
      await prisma.auditLog.count({
        where: { action: 'QUALITY_FORM_VERSION_RETIRED', entityId: v1.id },
      }),
    ).toBe(1);
    const lifecycleActions = await prisma.auditLog.findMany({
      where: { entityType: { in: ['QualityForm', 'QualityFormVersion'] } },
      select: { action: true },
    });
    expect(lifecycleActions.map(({ action }) => action)).toEqual(
      expect.arrayContaining([
        'QUALITY_FORM_CREATED',
        'QUALITY_FORM_VERSION_PUBLISHED',
        'QUALITY_FORM_VERSION_CREATED',
        'QUALITY_FORM_VERSION_RETIRED',
      ]),
    );
  });

  it('updates a draft definition and active/inactive lifecycle with audit logs', async () => {
    const { token } = await auth();
    const form = (await create(token)).body.data;
    const changed = {
      activityType: 'INSPECTION',
      executionScope: 'JOB_ORDER',
      sections: [
        {
          title: 'Updated',
          components: [{ type: 'COMMENTS', title: 'Remarks', config: { required: true } }],
        },
      ],
    };
    expect(
      (
        await request(app)
          .put(`/quality-form-versions/${form.versions[0].id}/definition`)
          .set('Authorization', `Bearer ${token}`)
          .send(changed)
      ).body.data.sections[0].title,
    ).toBe('Updated');
    expect(
      (
        await request(app)
          .patch(`/quality-forms/${form.id}/status`)
          .set('Authorization', `Bearer ${token}`)
          .send({ status: 'INACTIVE' })
      ).body.data.status,
    ).toBe('INACTIVE');
    await request(app)
      .put(`/quality-form-versions/${form.versions[0].id}/definition`)
      .set('Authorization', `Bearer ${token}`)
      .send(changed);
    await request(app)
      .patch(`/quality-forms/${form.id}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' });
    expect(
      await prisma.auditLog.count({
        where: { entityType: { in: ['QualityForm', 'QualityFormVersion'] } },
      }),
    ).toBe(3);
  });

  it('keeps version numbers unique under concurrent creation', async () => {
    const { token } = await auth();
    const form = (await create(token)).body.data;
    const makeVersion = () =>
      request(app)
        .post(`/quality-forms/${form.id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ copyFromVersionId: form.versions[0].id });
    const responses = await Promise.all([makeVersion(), makeVersion()]);
    expect(responses.every((response) => [201, 409].includes(response.status))).toBe(true);
    const versions = await prisma.qualityFormVersion.findMany({
      where: { qualityFormId: form.id },
      select: { versionNumber: true },
    });
    expect(new Set(versions.map((version) => version.versionNumber)).size).toBe(versions.length);
  });

  it('lists and returns form detail with version presentation', async () => {
    const { token } = await auth();
    const form = (await create(token)).body.data;
    const list = await request(app)
      .get('/quality-forms?activityType=INSPECTION')
      .set('Authorization', `Bearer ${token}`);
    const detail = await request(app)
      .get(`/quality-forms/${form.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(detail.body.data.versions[0]).toMatchObject({ versionNumber: 1, status: 'DRAFT' });
  });

  it('uses the published version semantics for master-list filtering', async () => {
    const { token } = await auth();
    const form = (await create(token)).body.data;
    await request(app)
      .post(`/quality-form-versions/${form.versions[0].id}/publish`)
      .set('Authorization', `Bearer ${token}`);
    const draft = (
      await request(app)
        .post(`/quality-forms/${form.id}/versions`)
        .set('Authorization', `Bearer ${token}`)
        .send({ copyFromVersionId: form.versions[0].id })
    ).body.data;
    await request(app)
      .put(`/quality-form-versions/${draft.id}/definition`)
      .set('Authorization', `Bearer ${token}`)
      .send({ ...definition, activityType: 'MEETING', executionScope: 'SIZE' });
    const beforePublish = await request(app)
      .get('/quality-forms?activityType=MEETING')
      .set('Authorization', `Bearer ${token}`);
    expect(beforePublish.body.data).toHaveLength(0);
    await request(app)
      .post(`/quality-form-versions/${draft.id}/publish`)
      .set('Authorization', `Bearer ${token}`);
    const afterPublish = await request(app)
      .get('/quality-forms?activityType=MEETING&executionScope=SIZE')
      .set('Authorization', `Bearer ${token}`);
    expect(afterPublish.body.data).toMatchObject([
      { id: form.id, activityType: 'MEETING', executionScope: 'SIZE' },
    ]);
  });

  it('allows ADMIN and MERCHANDISER but denies operational roles and unauthenticated callers', async () => {
    const admin = await auth(['ADMIN']);
    const merch = await auth(['MERCHANDISER']);
    const qa = await auth(['QA_USER']);
    const factory = await auth(['FACTORY_USER']);
    const distributor = await auth(['DISTRIBUTOR']);
    expect((await create(admin.token, { ...payload, code: 'ADMIN_FORM' })).status).toBe(201);
    expect((await create(merch.token, { ...payload, code: 'MERCH_FORM' })).status).toBe(201);
    expect(
      (await request(app).get('/quality-forms').set('Authorization', `Bearer ${qa.token}`)).status,
    ).toBe(403);
    expect((await create(qa.token, { ...payload, code: 'QA_FORM' })).status).toBe(403);
    expect((await create(factory.token, { ...payload, code: 'FACTORY_FORM' })).status).toBe(403);
    expect((await create(distributor.token, { ...payload, code: 'DIST_FORM' })).status).toBe(403);
    expect((await request(app).get('/quality-forms')).status).toBe(401);
  });
});

// PAG7: the Process Stage editor's selector options.
describe('GET /quality-forms/options (PAG7)', () => {
  it('returns ACTIVE forms with only their PUBLISHED versions, slim', async () => {
    const { token } = await auth();
    const active = await create(token, { ...payload, code: 'OPT_ACTIVE' });
    const inactive = await create(token, { ...payload, code: 'OPT_INACTIVE' });
    expect(active.status).toBe(201);
    await prisma.qualityFormVersion.updateMany({
      where: { qualityFormId: { in: [active.body.data.id, inactive.body.data.id] } },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    await prisma.qualityForm.update({ where: { id: inactive.body.data.id }, data: { status: 'INACTIVE' } });

    const res = await request(app).get('/quality-forms/options').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((form: { code: string }) => form.code)).toEqual(['OPT_ACTIVE']);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['code', 'id', 'name', 'status', 'versions']);
    expect(res.body.data[0].versions).toEqual([
      { id: active.body.data.versions[0].id, versionNumber: 1, status: 'PUBLISHED' },
    ]);
  });

  it('excludes DRAFT versions and follows the Quality Form permission', async () => {
    const { token } = await auth();
    await create(token, { ...payload, code: 'OPT_DRAFT' });
    const res = await request(app).get('/quality-forms/options').set('Authorization', `Bearer ${token}`);
    expect(res.body.data).toEqual([expect.objectContaining({ code: 'OPT_DRAFT', versions: [] })]);

    const { token: qa } = await auth(['QA_USER']);
    expect((await request(app).get('/quality-forms/options').set('Authorization', `Bearer ${qa}`)).status).toBe(403);
  });
});

// PAG8: opt-in cursor pagination for the Quality Form list.
describe('GET /quality-forms pagination (PAG8)', () => {
  it('pages every form exactly once in code order; legacy array unchanged', async () => {
    const { token } = await auth();
    for (const code of ['PG_C', 'PG_A', 'PG_B']) expect((await create(token, { ...payload, code })).status).toBe(201);

    const legacy = await request(app).get('/quality-forms').set('Authorization', `Bearer ${token}`);
    expect(Array.isArray(legacy.body.data)).toBe(true);
    const first = await request(app).get('/quality-forms').query({ limit: 2 }).set('Authorization', `Bearer ${token}`);
    const second = await request(app)
      .get('/quality-forms')
      .query({ limit: 2, cursor: first.body.data.pageInfo.nextCursor })
      .set('Authorization', `Bearer ${token}`);

    const paged = [...first.body.data.items, ...second.body.data.items].map((form: { code: string }) => form.code);
    expect(paged).toEqual(['PG_A', 'PG_B', 'PG_C']);
    expect(paged).toEqual(legacy.body.data.map((form: { code: string }) => form.code));
    expect(second.body.data.pageInfo.hasMore).toBe(false);
  });

  it('refuses the in-memory activityType/executionScope filters in paginated mode, keeps them in legacy mode', async () => {
    const { token } = await auth();
    await create(token);
    const paged = await request(app)
      .get('/quality-forms')
      .query({ limit: 10, activityType: 'INSPECTION' })
      .set('Authorization', `Bearer ${token}`);
    const legacy = await request(app)
      .get('/quality-forms')
      .query({ activityType: 'INSPECTION' })
      .set('Authorization', `Bearer ${token}`);
    expect(paged.status).toBe(400);
    expect(legacy.status).toBe(200);
    expect(legacy.body.data).toHaveLength(1);
  });
});
