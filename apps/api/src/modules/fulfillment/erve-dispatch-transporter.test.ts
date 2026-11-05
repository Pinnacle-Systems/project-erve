// PostgreSQL integration coverage for PR CI. Do not run against shared local databases.
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase, createTestUser } from '../../test/helpers.js';
import * as audit from '../../audit/audit.service.js';
import {
  consolidateAndDispatch,
  createSingleFactoryApprovedSaleOrder,
  createFactoryUserToken,
  createRoleToken,
  packAndFinalize,
} from './fulfillment-test-helpers.js';
const app = createApp();
beforeEach(resetDatabase);
afterAll(() => prisma.$disconnect());
async function fixture() {
  const source = await createSingleFactoryApprovedSaleOrder(app, 20);
  const factoryToken = await createFactoryUserToken(source.stock.factoryId);
  const packed = await packAndFinalize(
    app,
    factoryToken,
    source.saleOrder.id,
    source.saleOrderLineId,
    source.saleOrder.destinations[0]!.id,
    20,
  );
  const dispatch = await consolidateAndDispatch(app, source.merchToken, [packed.cartonId]);
  const first = await createRoleToken('TRANSPORTER');
  const second = await createRoleToken('TRANSPORTER');
  return { source, dispatch, first, second };
}
it('keeps historical dispatches unassigned and enforces assignment, redaction, reassignment and clear', async () => {
  const { source, dispatch, first, second } = await fixture();
  const path = `/erve-dispatches/${dispatch.id}`;
  expect(
    (await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } })).transporterUserId,
  ).toBeNull();
  await request(app)
    .get(`${path}/transport`)
    .set('Authorization', `Bearer ${first.token}`)
    .expect(404);
  const assigned = await request(app)
    .patch(`${path}/transporter-assignment`)
    .set('Authorization', `Bearer ${source.merchToken}`)
    .send({ expectedVersion: dispatch.version, transporterUserId: first.userId })
    .expect(200);
  const version = assigned.body.data.version;
  const updated = await request(app)
    .patch(`${path}/lr`)
    .set('Authorization', `Bearer ${first.token}`)
    .send({ expectedVersion: version, lrNumber: 'LR-078', transporter: 'Historical carrier text' })
    .expect(200);
  expect(updated.body.data).not.toHaveProperty('invoiceHandoffs');
  expect(updated.body.data).not.toHaveProperty('distributor');
  expect(updated.body.data).not.toHaveProperty('transporterAssignment');
  expect(updated.body.data.version).toBe(version + 1);
  await request(app)
    .get(`${path}/transport`)
    .set('Authorization', `Bearer ${second.token}`)
    .expect(404);
  const replaced = await request(app)
    .patch(`${path}/transporter-assignment`)
    .set('Authorization', `Bearer ${source.merchToken}`)
    .send({ expectedVersion: updated.body.data.version, transporterUserId: second.userId })
    .expect(200);
  await request(app)
    .patch(`${path}/lr`)
    .set('Authorization', `Bearer ${first.token}`)
    .send({ expectedVersion: version, lrNumber: 'stale' })
    .expect(404);
  await request(app)
    .patch(`${path}/transporter-assignment`)
    .set('Authorization', `Bearer ${source.merchToken}`)
    .send({ expectedVersion: replaced.body.data.version, transporterUserId: null })
    .expect(200);
  const persisted = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
  expect(persisted.transporter).toBe('Historical carrier text');
  expect(persisted.status).toBe('DISPATCHED');
  expect(
    await prisma.auditLog.count({
      where: { entityId: dispatch.id, action: 'ERVE_DISPATCH_TRANSPORTER_ASSIGNED' },
    }),
  ).toBe(3);
});
it('rolls back the transport write and version when audit fails', async () => {
  const { source, dispatch } = await fixture();
  const before = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
  const spy = vi
    .spyOn(audit, 'recordAuditLog')
    .mockRejectedValueOnce(new Error('forced audit failure'));
  try {
    await request(app)
      .patch(`/erve-dispatches/${dispatch.id}/lr`)
      .set('Authorization', `Bearer ${source.merchToken}`)
      .send({ expectedVersion: dispatch.version, lrNumber: 'must rollback' })
      .expect(500);
    const after = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    expect(after.version).toBe(before.version);
    expect(after.lrNumber).toBe(before.lrNumber);
  } finally {
    spy.mockRestore();
  }
});
it('denies Transporter full dispatch, packing, financial, sales and return surfaces', async () => {
  const first = await createRoleToken('TRANSPORTER');
  for (const path of [
    '/erve-dispatches',
    '/erve-dispatches/other',
    '/erve-packing-lists',
    '/factory-dispatches',
    '/factory-invoices',
    '/tax-invoices',
    '/tax-invoices/other/eway-bill-readiness',
    '/invoice-handoffs',
    '/distributor-sales-reports',
    '/distributor-returns',
  ]) {
    await request(app).get(path).set('Authorization', `Bearer ${first.token}`).expect(403);
  }
  await request(app)
    .post('/erve-dispatches')
    .set('Authorization', `Bearer ${first.token}`)
    .send({})
    .expect(403);
  await request(app)
    .patch('/erve-dispatches/other/delivery')
    .set('Authorization', `Bearer ${first.token}`)
    .send({})
    .expect(403);
  for (const path of ['/distributor-sales-reports', '/distributor-returns'])
    await request(app)
      .post(path)
      .set('Authorization', `Bearer ${first.token}`)
      .send({})
      .expect(403);
});
it('rejects concurrent incompatible role assignments and revokes on deactivation or role removal', async () => {
  const admin = await createRoleToken('ADMIN');
  const first = await createRoleToken('TRANSPORTER');
  const blank = await createTestUser({
    email: 'concurrent-roles@example.test',
    password: 'password1',
  });
  const grants = await Promise.all(
    ['TRANSPORTER', 'ACCOUNTANT'].map((roleName) =>
      request(app)
        .post(`/users/${blank}/roles`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ roleName }),
    ),
  );
  expect(grants.map((result) => result.status).sort()).toEqual([200, 400]);
  await request(app)
    .post(`/users/${first.userId}/roles`)
    .set('Authorization', `Bearer ${admin.token}`)
    .send({ roleName: 'ACCOUNTANT' })
    .expect(400);
  await prisma.user.update({ where: { id: first.userId }, data: { status: 'INACTIVE' } });
  await request(app)
    .get('/erve-dispatches/assigned-transport')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(401);
  await prisma.user.update({ where: { id: first.userId }, data: { status: 'ACTIVE' } });
  await prisma.userRole.deleteMany({ where: { userId: first.userId } });
  await request(app)
    .get('/erve-dispatches/assigned-transport')
    .set('Authorization', `Bearer ${first.token}`)
    .expect(403);
});
