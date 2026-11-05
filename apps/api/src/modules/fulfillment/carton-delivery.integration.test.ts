// Real PostgreSQL races and FK/transaction invariants. CI's disposable test DB only.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
vi.hoisted(() => {
  vi.stubEnv('CARTON_DELIVERY_ENABLED', 'true');
  vi.stubEnv('CARTON_DELIVERY_PUBLIC_ORIGIN', 'https://delivery.example');
  vi.stubEnv('CARTON_DELIVERY_ACTIVE_KEY', 'test-v1');
  vi.stubEnv('CARTON_DELIVERY_KEYS', JSON.stringify({ 'test-v1': Buffer.alloc(32, 9).toString('base64') }));
});
import { createApp } from '../../app.js';
import { prisma } from '../../db/prisma.js';
import { resetDatabase } from '../../test/helpers.js';
import * as audit from '../../audit/audit.service.js';
import {
  consolidateAndDispatch,
  createSingleFactoryApprovedSaleOrder,
  createFactoryUserToken,
  createRoleToken,
  ensureStyleFactoryRate,
} from './fulfillment-test-helpers.js';

const app = createApp();
beforeEach(resetDatabase);
afterAll(async () => { vi.unstubAllEnvs(); await prisma.$disconnect(); });
const today = () => new Date().toISOString().slice(0, 10);
const payload = () => ({
  recipientName: 'Recipient',
  deliveredAt: new Date().toISOString(),
  timezone: 'UTC',
  offsetMinutes: 0,
  remarks: 'Received intact',
  confirmed: true,
  idempotencyKey: randomUUID(),
});
async function fixture(finalize = true) {
  const source = await createSingleFactoryApprovedSaleOrder(app, 20);
  const factoryToken = await createFactoryUserToken(source.stock.factoryId);
  const created = await request(app)
    .post(`/sale-orders/${source.saleOrder.id}/packing-list/cartons`)
    .set('Authorization', `Bearer ${factoryToken}`)
    .send({
      cartonNumber: 'C1',
      destinationId: source.saleOrder.destinations[0]!.id,
      netWeight: 5,
      grossWeight: 6,
      dimensions: '40 x 30 x 20 cm',
      lines: [{ saleOrderLineId: source.saleOrderLineId, quantity: 20 }],
    })
    .expect(200);
  const factoryDispatchId = created.body.data.factoryDispatch.id as string;
  const cartonId = created.body.data.destinations[0].cartons[0].id as string;
  const qa = await createRoleToken('QA_USER');
  await request(app)
    .post(`/factory-dispatches/${factoryDispatchId}/cartons/${cartonId}/audit`)
    .set('Authorization', `Bearer ${qa.token}`)
    .send({})
    .expect(200);
  if (finalize) {
    await ensureStyleFactoryRate(source.stock.styleId, source.stock.factoryId);
    await request(app)
      .post(`/factory-dispatches/${factoryDispatchId}/actions/finalize`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: created.body.data.factoryDispatch.version })
      .expect(200);
  }
  const prepare = () =>
    request(app)
      .post(`/carton-delivery/labels/${cartonId}/prepare`)
      .set('Authorization', `Bearer ${factoryToken}`)
      .send({ expectedVersion: 1 });
  return { source, factoryToken, factoryDispatchId, cartonId, prepare };
}
function publicCall(operation: 'resolve' | 'confirm', token: string, input: object = {}) {
  return request(app)
    .post(`/public/carton-delivery/${operation}`)
    .set('Origin', 'https://delivery.example')
    .set('X-Carton-Delivery-Token', token)
    .send(input);
}

describe('carton delivery PostgreSQL invariants', () => {
  it('concurrent preparation issues once; identical carton numbers stay distinct; pre-Dispatch submission is forbidden', async () => {
    const first = await fixture();
    const [a, b] = await Promise.all([first.prepare(), first.prepare()]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.data.url).toBe(b.body.data.url);
    expect(await prisma.cartonDeliveryToken.count({ where: { cartonId: first.cartonId } })).toBe(1);
    const token = new URL(a.body.data.url).hash.slice(1);
    const info = await publicCall('resolve', token).expect(200);
    expect(info.body.data.state).toBe('AWAITING_DISPATCH');
    expect(Object.keys(info.body.data).sort()).toEqual(['cartonNumber', 'labelReference', 'state']);
    await publicCall('confirm', token, payload()).expect(409);
    const second = await fixture();
    const other = await second.prepare().expect(200);
    expect(other.body.data.source.carton.cartonNumber).toBe('C1');
    expect(other.body.data.url).not.toBe(a.body.data.url);
    await request(app)
      .post(`/carton-delivery/labels/${first.cartonId}/prepare`)
      .set('Authorization', `Bearer ${second.factoryToken}`)
      .send({ expectedVersion: 1 })
      .expect(403);
  }, 60000);

  it('accepts one competing confirmation and retries idempotently without changing Dispatch or receipt', async () => {
    const data = await fixture();
    const dispatch = await consolidateAndDispatch(
      app,
      data.source.merchToken,
      [data.cartonId],
      today(),
    );
    const prepared = await data.prepare().expect(200);
    const token = new URL(prepared.body.data.url).hash.slice(1);
    const before = await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } });
    const receipts = await prisma.erveDispatchDeliveryLine.findMany({
      where: { erveDispatchId: dispatch.id },
    });
    const inputs = [payload(), payload(), payload()];
    const results = await Promise.all(inputs.map((body) => publicCall('confirm', token, body)));
    expect(results.map((result) => result.status).sort()).toEqual([200, 409, 409]);
    const winner = results.findIndex((result) => result.status === 200);
    expect((await publicCall('confirm', token, inputs[winner]!).expect(200)).body).toEqual(
      results[winner]!.body,
    );
    await publicCall('confirm', token, { ...inputs[winner], recipientName: 'Changed' }).expect(409);
    expect(
      await prisma.cartonDeliveryConfirmation.count({ where: { cartonId: data.cartonId } }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: { action: 'CARTON_DELIVERY_CONFIRMED', entityId: data.cartonId, actorId: null },
      }),
    ).toBe(1);
    expect(await prisma.erveDispatch.findUniqueOrThrow({ where: { id: dispatch.id } })).toEqual(
      before,
    );
    expect(
      await prisma.erveDispatchDeliveryLine.findMany({ where: { erveDispatchId: dispatch.id } }),
    ).toEqual(receipts);
    const summary = await request(app)
      .get(`/carton-delivery/dispatches/${dispatch.id}?limit=1`)
      .set('Authorization', `Bearer ${data.source.merchToken}`)
      .expect(200);
    expect(summary.body.data).toMatchObject({
      totalCartons: 1,
      confirmedCartons: 1,
      pendingCartons: 0,
    });
    const transporter = await createRoleToken('TRANSPORTER');
    await request(app)
      .get(`/carton-delivery/dispatches/${dispatch.id}`)
      .set('Authorization', `Bearer ${transporter.token}`)
      .expect(403);
    await expect(
      prisma.cartonDeliveryConfirmation.update({
        where: { cartonId: data.cartonId },
        data: { recipientName: 'Overwrite' },
      }),
    ).rejects.toThrow();
  }, 60000);

  it('extends the same expired QR, reissues explicitly, and serializes revocation with confirmation', async () => {
    const data = await fixture();
    const dispatch = await consolidateAndDispatch(
      app,
      data.source.merchToken,
      [data.cartonId],
      today(),
    );
    const prepared = await data.prepare().expect(200);
    const token = new URL(prepared.body.data.url).hash.slice(1);
    const credential = await prisma.cartonDeliveryToken.findFirstOrThrow({
      where: { cartonId: data.cartonId },
    });
    await prisma.erveDispatch.update({
      where: { id: dispatch.id },
      data: { dispatchedAt: new Date(Date.now() - 181 * 86_400_000) },
    });
    await publicCall('resolve', token).expect(404);
    const manage = (body: object) =>
      request(app)
        .post(`/carton-delivery/credentials/${data.cartonId}`)
        .set('Authorization', `Bearer ${data.source.merchToken}`)
        .send(body);
    await manage({
      action: 'extend',
      reason: 'Delayed transport',
      expectedTokenId: credential.id,
      extendedUntil: new Date(Date.now() + 86_400_000).toISOString(),
    }).expect(200);
    expect((await data.prepare().expect(200)).body.data.url).toBe(prepared.body.data.url);
    const [revoked, submitted] = await Promise.all([
      manage({ action: 'revoke', reason: 'Lost label', expectedTokenId: credential.id }),
      publicCall('confirm', token, payload()),
    ]);
    expect(revoked.status).toBe(200);
    expect([200, 404]).toContain(submitted.status);
    expect(await prisma.cartonDeliveryConfirmation.count()).toBe(submitted.status === 200 ? 1 : 0);
    await publicCall('resolve', token).expect(404);
    await data.prepare().expect(409);
    await manage({
      action: 'reissue',
      reason: 'Replace attached label',
      expectedTokenId: credential.id,
      acknowledgeReplacement: true,
    }).expect(200);
    // Active identity wins even when timestamps tie/drift across credential history.
    await prisma.cartonDeliveryToken.update({
      where: { id: credential.id },
      data: { issuedAt: new Date(Date.now() + 86_400_000) },
    });
    const replacement = await data.prepare().expect(200);
    expect(replacement.body.data.url).not.toBe(prepared.body.data.url);
    await publicCall('resolve', new URL(replacement.body.data.url).hash.slice(1)).expect(200);
  }, 60000);

  it('retains unusable tombstones after draft deletion and rolls back evidence when audit fails', async () => {
    const draft = await fixture(false);
    const prepared = await draft.prepare().expect(200);
    const token = new URL(prepared.body.data.url).hash.slice(1);
    const current = await prisma.factoryDispatch.findUniqueOrThrow({
      where: { id: draft.factoryDispatchId },
    });
    await request(app)
      .delete(`/factory-dispatches/${draft.factoryDispatchId}`)
      .set('Authorization', `Bearer ${draft.factoryToken}`)
      .send({ expectedVersion: current.version })
      .expect(204);
    expect((await prisma.cartonDeliveryToken.findFirstOrThrow()).cartonId).toBeNull();
    await publicCall('resolve', token).expect(404);
    const active = await fixture();
    await consolidateAndDispatch(app, active.source.merchToken, [active.cartonId], today());
    const label = await active.prepare().expect(200);
    const implementation = audit.recordAuditLog;
    const spy = vi.spyOn(audit, 'recordAuditLog').mockImplementation(async (entry, tx) => {
      if (entry.action === 'CARTON_DELIVERY_CONFIRMED') throw new Error('Simulated audit outage');
      return implementation(entry, tx);
    });
    try {
      await publicCall('confirm', new URL(label.body.data.url).hash.slice(1), payload()).expect(
        500,
      );
      expect(
        await prisma.cartonDeliveryConfirmation.count({ where: { cartonId: active.cartonId } }),
      ).toBe(0);
    } finally {
      spy.mockRestore();
    }
  }, 60000);
});
