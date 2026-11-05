import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';
import { parseDeliveryConfig, digest } from './carton-delivery.security.js';

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  $executeRaw: vi.fn(),
  $queryRaw: vi.fn(),
  factoryPackingCarton: { findUnique: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  cartonDeliveryToken: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  cartonDeliveryConfirmation: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn() },
  erveDispatch: { findUnique: vi.fn() },
}));
vi.mock('../../db/prisma.js', () => ({ prisma: db }));
vi.mock('../../config/env.js', () => ({ env: {} }));
vi.mock('../../audit/audit.service.js', () => ({ recordAuditLog: vi.fn() }));
vi.mock('./factory-dispatch.service.js', () => ({ getFactoryDispatchDetail: vi.fn() }));
import { createCartonDeliveryService } from './carton-delivery.service.js';
import { recordAuditLog } from '../../audit/audit.service.js';
import { getFactoryDispatchDetail } from './factory-dispatch.service.js';

const now = new Date('2026-11-05T07:00:00Z');
const config = parseDeliveryConfig({
  enabled: true,
  origin: 'https://deliver.example',
  activeKey: 'v1',
  keys: JSON.stringify({ v1: Buffer.alloc(32, 7).toString('base64') }),
  validityDays: 180,
});
const actor = (
  role: CurrentUser['roles'][number],
  factoryIds = ['factory-1'],
  distributorIds = ['dist-1'],
): CurrentUser => ({
  id: 'user-1',
  name: 'User',
  email: 'u@test.local',
  mobile: null,
  status: 'ACTIVE',
  authVersion: 1,
  roles: [role],
  factoryIds,
  distributorIds,
});
const carton = () => ({
  id: 'carton-1',
  cartonNumber: 'C1',
  version: 1,
  retiredAt: null,
  factoryDispatchId: 'fd-1',
  destinationId: 'dest-1',
  ervePackingListId: 'pl-1',
  factoryDispatch: { factoryId: 'factory-1', saleOrderId: 'so-1', status: 'READY_FOR_ERVE' },
  destination: { saleOrderDistributor: { distributorId: 'dist-1' } },
  audits: [{ cartonVersion: 1 }],
  _count: { lines: 1 },
  ervePackingList: {
    id: 'pl-1',
    status: 'DISPATCHED',
    distributorId: 'dist-1',
    dispatch: {
      id: 'dispatch-1',
      distributorId: 'dist-1',
      dispatchDate: new Date('2026-11-05T00:00:00Z'),
      dispatchedAt: now,
    },
  },
});
const input = {
  recipientName: 'Recipient',
  deliveredAt: '2026-11-05T12:30:00+05:30',
  timezone: 'Asia/Kolkata',
  offsetMinutes: 330,
  remarks: '',
  confirmed: true as const,
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
};
const service = () => createCartonDeliveryService(config, db as never, () => now);
beforeEach(() => {
  vi.resetAllMocks();
  db.$transaction.mockImplementation(async (fn: (client: typeof db) => unknown) => fn(db));
  db.factoryPackingCarton.findUnique.mockResolvedValue(carton());
  db.cartonDeliveryToken.findFirst.mockResolvedValue(null);
  db.cartonDeliveryToken.create.mockImplementation(async ({ data }) => data);
  db.cartonDeliveryToken.update.mockImplementation(async ({ data }) => data);
  db.cartonDeliveryConfirmation.findUnique.mockResolvedValue(null);
  db.cartonDeliveryConfirmation.create.mockImplementation(async ({ data }) => ({
    ...data,
    submittedAt: now,
  }));
  db.$queryRaw.mockResolvedValue([{ requests: 1 }]);
  vi.mocked(getFactoryDispatchDetail).mockResolvedValue({
    saleOrderNumber: 'DO1',
    factory: { name: 'Secret Factory' },
    factoryDispatch: { factoryDispatchNumber: 'FD1' },
    destinations: [
      {
        id: 'dest-1',
        cartons: [{ id: 'carton-1', version: 1, auditState: 'INSPECTED', retired: false }],
      },
    ],
  } as never);
});
async function issued() {
  const label = await service().prepareLabel(actor('FACTORY_USER'), 'carton-1', 1);
  if (!label.enabled) throw new Error();
  const token = new URL(label.url).hash.slice(1);
  const record = db.cartonDeliveryToken.create.mock.calls.at(-1)![0].data;
  db.cartonDeliveryToken.findUnique.mockResolvedValue(record);
  db.cartonDeliveryToken.findFirst.mockResolvedValue(record);
  return { label, token, record };
}
describe('carton delivery lifecycle and authorization', () => {
  it('issues before Dispatch and reuses exactly the same credential on reprint', async () => {
    db.factoryPackingCarton.findUnique.mockResolvedValue({
      ...carton(),
      ervePackingListId: null,
      ervePackingList: null,
    });
    const { label } = await issued();
    expect(getFactoryDispatchDetail).toHaveBeenLastCalledWith(expect.anything(), 'fd-1', db);
    const reprint = await service().prepareLabel(actor('FACTORY_USER'), 'carton-1', 1);
    expect(reprint).toMatchObject({
      enabled: true,
      url: label.url,
      labelReference: label.labelReference,
    });
    expect(db.cartonDeliveryToken.create).toHaveBeenCalledTimes(1);
    expect(db.cartonDeliveryToken.create.mock.calls[0]![0].data).not.toHaveProperty('token');
  });
  it('never issues for stale inspection, retirement, wrong Factory or stale version', async () => {
    for (const changes of [
      { retiredAt: now },
      { audits: [{ cartonVersion: 0 }] },
      { version: 2 },
    ]) {
      db.factoryPackingCarton.findUnique.mockResolvedValue({ ...carton(), ...changes });
      await expect(
        service().prepareLabel(actor('FACTORY_USER'), 'carton-1', 1),
      ).rejects.toBeTruthy();
    }
    db.factoryPackingCarton.findUnique.mockResolvedValue(carton());
    await expect(
      service().prepareLabel(actor('FACTORY_USER', ['other']), 'carton-1', 1),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(db.cartonDeliveryToken.create).not.toHaveBeenCalled();
  });
  it('blocks pre-Dispatch submission and returns minimal pre-Dispatch identification', async () => {
    const { token } = await issued();
    db.factoryPackingCarton.findUnique.mockResolvedValue({
      ...carton(),
      ervePackingListId: null,
      ervePackingList: null,
    });
    expect(await service().resolve(token)).toMatchObject({
      state: 'AWAITING_DISPATCH',
      cartonNumber: 'C1',
    });
    await expect(service().confirm(token, input)).rejects.toMatchObject({ statusCode: 409 });
    expect(db.cartonDeliveryConfirmation.create).not.toHaveBeenCalled();
  });
  it('persists one evidence record and a nullable-actor audit, without changing Dispatch or receipt', async () => {
    const { token, record } = await issued();
    const ack = await service().confirm(token, input);
    expect(ack).toMatchObject({ state: 'CONFIRMED', submittedAt: now.toISOString() });
    expect(db.cartonDeliveryConfirmation.create.mock.calls[0]![0].data).toMatchObject({
      cartonId: 'carton-1',
      dispatchId: 'dispatch-1',
      tokenId: record.id,
      recipientName: 'Recipient',
    });
    expect(recordAuditLog).toHaveBeenLastCalledWith(
      expect.objectContaining({ actorId: null, action: 'CARTON_DELIVERY_CONFIRMED' }),
      db,
    );
    expect(JSON.stringify(ack)).not.toMatch(/Recipient|Secret Factory|dist-1/);
  });
  it('returns original acknowledgement for retries but conflicts on changed or competing payloads', async () => {
    const { token } = await issued();
    await service().confirm(token, input);
    const evidence = {
      ...db.cartonDeliveryConfirmation.create.mock.calls[0]![0].data,
      submittedAt: now,
    };
    db.cartonDeliveryConfirmation.findUnique.mockResolvedValue(evidence);
    expect(await service().confirm(token, input)).toEqual({
      state: 'CONFIRMED',
      submittedAt: now.toISOString(),
    });
    await expect(
      service().confirm(token, { ...input, recipientName: 'Changed' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      service().confirm(token, {
        ...input,
        idempotencyKey: '223e4567-e89b-42d3-a456-426614174000',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(db.cartonDeliveryConfirmation.create).toHaveBeenCalledTimes(1);
    expect(await service().resolve(token)).toEqual(expect.objectContaining({ state: 'CONFIRMED' }));
    expect(JSON.stringify(await service().resolve(token))).not.toContain('Recipient');
  });
  it('rejects invalid, expired, revoked, retired and orphaned credentials with the same error', async () => {
    const { token, record } = await issued();
    for (const changes of [
      { revokedAt: now },
      { cartonId: null },
      { validForDays: 1, extendedUntil: new Date('2026-01-01') },
    ]) {
      db.cartonDeliveryToken.findUnique.mockResolvedValue({ ...record, ...changes });
      if ('validForDays' in changes)
        db.factoryPackingCarton.findUnique.mockResolvedValue({
          ...carton(),
          ervePackingList: {
            ...carton().ervePackingList,
            dispatch: {
              ...carton().ervePackingList.dispatch,
              dispatchedAt: new Date('2026-01-01'),
            },
          },
        });
      await expect(service().resolve(token)).rejects.toMatchObject({
        statusCode: 404,
        message: 'Carton delivery link is unavailable',
      });
    }
    db.cartonDeliveryToken.findUnique.mockResolvedValue(record);
    db.factoryPackingCarton.findUnique.mockResolvedValue({ ...carton(), retiredAt: now });
    await expect(service().confirm(token, input)).rejects.toMatchObject({ statusCode: 404 });
  });
  it('does not silently reissue revoked credentials and restricts administration', async () => {
    const { record } = await issued();
    db.cartonDeliveryToken.findFirst.mockResolvedValue({ ...record, revokedAt: now });
    await expect(
      service().prepareLabel(actor('FACTORY_USER'), 'carton-1', 1),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(
      service().manage(actor('TRANSPORTER'), 'carton-1', {
        action: 'revoke',
        reason: 'Lost label',
        expectedTokenId: record.id,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    db.cartonDeliveryToken.findFirst.mockResolvedValue(record);
    const reissued = await service().manage(actor('ADMIN'), 'carton-1', {
      action: 'reissue',
      reason: 'Lost label',
      expectedTokenId: record.id,
      acknowledgeReplacement: true,
    });
    expect(reissued).toMatchObject({ replaceAttachedLabels: true });
    expect(db.cartonDeliveryToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revokedAt: now }) }),
    );
    expect(db.cartonDeliveryToken.create.mock.calls.at(-1)![0].data.tokenDigest).not.toBe(
      record.tokenDigest,
    );
  });
  it('extends expiry without changing the QR and gives an explicitly reissued expired credential usable validity', async () => {
    const { record, token } = await issued();
    const oldCarton = {
      ...carton(),
      ervePackingList: {
        ...carton().ervePackingList,
        dispatch: {
          ...carton().ervePackingList.dispatch,
          dispatchedAt: new Date('2026-01-01T00:00:00Z'),
        },
      },
    };
    db.factoryPackingCarton.findUnique.mockResolvedValue(oldCarton);
    await service().manage(actor('MERCHANDISER'), 'carton-1', {
      action: 'extend',
      reason: 'Delayed shipment',
      expectedTokenId: record.id,
      extendedUntil: '2026-12-01T00:00:00Z',
    });
    expect(db.cartonDeliveryToken.update.mock.calls.at(-1)![0].data).toMatchObject({
      extendedUntil: new Date('2026-12-01T00:00:00Z'),
    });
    expect(db.cartonDeliveryToken.create).toHaveBeenCalledTimes(1);
    db.cartonDeliveryToken.findFirst.mockResolvedValue({
      ...record,
      extendedUntil: new Date('2026-12-01T00:00:00Z'),
    });
    expect(await service().prepareLabel(actor('FACTORY_USER'), 'carton-1', 1)).toMatchObject({
      url: `https://deliver.example/delivery/carton#${token}`,
    });
    await service().manage(actor('ADMIN'), 'carton-1', {
      action: 'reissue',
      reason: 'Expired attached label',
      expectedTokenId: record.id,
      acknowledgeReplacement: true,
    });
    expect(
      db.cartonDeliveryToken.create.mock.calls.at(-1)![0].data.extendedUntil.getTime(),
    ).toBeGreaterThan(now.getTime());
  });
  it('uses shared database buckets for IP and token, rejecting saturated limits', async () => {
    await service().rateLimit('192.0.2.1', 'opaque', 'confirm');
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
    const sqlArguments = JSON.stringify(db.$queryRaw.mock.calls);
    expect(sqlArguments).not.toContain('192.0.2.1');
    expect(sqlArguments).toContain(digest('opaque'));
    db.$queryRaw.mockResolvedValue([{ requests: 10000 }]);
    await expect(service().rateLimit('192.0.2.1', 'opaque', 'confirm')).rejects.toMatchObject({
      statusCode: 429,
    });
  });
  it('counts authoritative cartons independently of the page and enforces distributor scope', async () => {
    db.erveDispatch.findUnique.mockResolvedValue({
      id: 'dispatch-1',
      ervePackingListId: 'pl-1',
      distributorId: 'dist-1',
    });
    db.factoryPackingCarton.count.mockResolvedValue(20);
    db.cartonDeliveryConfirmation.count.mockResolvedValue(3);
    db.factoryPackingCarton.findMany.mockResolvedValue([
      { id: 'carton-1', cartonNumber: 'C1', deliveryTokens: [], deliveryConfirmation: null },
    ]);
    const result = await service().summary(actor('DISTRIBUTOR'), 'dispatch-1', { limit: 1 });
    expect(result).toMatchObject({
      totalCartons: 20,
      confirmedCartons: 3,
      pendingCartons: 17,
      items: [{ cartonNumber: 'C1', evidence: null }],
    });
    await expect(
      service().summary(actor('DISTRIBUTOR', [], ['other']), 'dispatch-1', { limit: 1 }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(
      service().summary(actor('TRANSPORTER'), 'dispatch-1', { limit: 1 }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});
