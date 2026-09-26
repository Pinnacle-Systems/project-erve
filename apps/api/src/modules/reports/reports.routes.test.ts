import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { createTestUserAndToken, resetDatabase } from '../../test/helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());

describe('/reports RBAC and wiring (RPT0/RPT1)', () => {
  it('requires authentication', async () => {
    await request(app).get('/reports/operations/summary').expect(401);
  });

  it('rejects a non-reporting role', async () => {
    const { token } = await createTestUserAndToken({
      email: 'qa-reports@test.local',
      password: 'pass',
      roles: ['QA_USER'],
    });
    await request(app)
      .get('/reports/operations/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
    'allows %s to reach every report endpoint',
    async (role) => {
      const { token } = await createTestUserAndToken({
        email: `report-${role.toLowerCase()}@test.local`,
        password: 'pass',
        roles: [role],
      });
      for (const path of [
        '/reports/operations/summary',
        '/reports/production',
        '/reports/fulfillment',
        '/reports/sale-or-return',
        '/reports/distributor-returns',
      ]) {
        const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
        expect(res.status).toBe(200);
      }
    },
  );

  it('rejects an unrecognized recordOrigin filter value', async () => {
    const { token } = await createTestUserAndToken({
      email: 'report-admin-2@test.local',
      password: 'pass',
      roles: ['ADMIN'],
    });
    await request(app)
      .get('/reports/operations/summary')
      .query({ recordOrigin: 'NOT_REAL' })
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('lets SENIOR_MANAGEMENT read season filter options without granting general master-data access', async () => {
    const { token } = await createTestUserAndToken({
      email: 'senior-management-seasons@test.local',
      password: 'pass',
      roles: ['SENIOR_MANAGEMENT'],
    });
    await request(app).get('/reports/season-options').set('Authorization', `Bearer ${token}`).expect(200);
    // The general master-data endpoint stays exactly as restricted as before.
    await request(app).get('/seasons/options').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('operations summary defaults Record Origin to LIVE_WORKFLOW and echoes filtersApplied', async () => {
    const { token } = await createTestUserAndToken({
      email: 'report-admin-3@test.local',
      password: 'pass',
      roles: ['ADMIN'],
    });
    const res = await request(app)
      .get('/reports/operations/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.data.filtersApplied).toEqual({});
    expect(res.body.data.generatedAt).toBeTruthy();
    expect(res.body.data.businessDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
