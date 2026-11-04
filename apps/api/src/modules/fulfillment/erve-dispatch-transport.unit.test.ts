import { beforeEach, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';
const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  erveDispatch: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));
vi.mock('../../db/prisma.js', () => ({ prisma: db }));
vi.mock('../../audit/audit.service.js', () => ({ recordAuditLog: vi.fn() }));
import { recordAuditLog } from '../../audit/audit.service.js';
import {
  getDispatchTransport,
  listAssignedTransport,
  listTransporterOptions,
  assignDispatchTransporter,
  updateDispatchTransport,
} from './erve-dispatch-transport.service.js';
const actor = (role = 'TRANSPORTER') =>
  ({ id: 't1', roles: [role], status: 'ACTIVE', authVersion: 1 }) as CurrentUser;
const date = new Date('2026-11-01');
const record = () => ({
  id: 'ed',
  erveDispatchNumber: 'ED1',
  dispatchDate: date,
  status: 'DISPATCHED',
  transporterUserId: 't1',
  transporter: 'Historical text',
  vehicleNumber: null,
  lrNumber: null,
  lrUpdatedAt: null,
  version: 3,
  distributor: { secret: true },
  invoiceHandoffs: ['secret'],
});
beforeEach(() => {
  vi.resetAllMocks();
  db.user.findUnique.mockResolvedValue({
    id: 't1',
    name: 'Carrier',
    status: 'ACTIVE',
    authVersion: 1,
    userRoles: [{ role: { name: 'TRANSPORTER' } }],
  });
  db.erveDispatch.findFirst.mockResolvedValue(record());
  db.erveDispatch.findUnique.mockResolvedValue(record());
  db.erveDispatch.findMany.mockResolvedValue([record()]);
  db.erveDispatch.updateMany.mockResolvedValue({ count: 1 });
  db.$transaction.mockImplementation(async (fn) => fn(db));
});
it('returns an explicit minimal DTO and scopes the database query to identity', async () => {
  const result = await getDispatchTransport(actor(), 'ed');
  expect(Object.keys(result).sort()).toEqual(
    [
      'id',
      'erveDispatchNumber',
      'dispatchDate',
      'status',
      'transporter',
      'vehicleNumber',
      'lrNumber',
      'version',
      'lrUpdatedAt',
    ].sort(),
  );
  expect(db.erveDispatch.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'ed', transporterUserId: 't1' } }),
  );
});
it.each([null, { ...record(), transporterUserId: 't2' }, { ...record(), transporterUserId: null }])(
  'fails unavailable for missing, foreign or historical unassigned dispatches',
  async (record) => {
    db.erveDispatch.findFirst.mockResolvedValue(record);
    await expect(getDispatchTransport(actor(), 'ed')).rejects.toMatchObject({ statusCode: 404 });
  },
);
it.each(['INACTIVE', 'SUSPENDED', 'REMOVED', 'MIXED'])(
  'rejects fresh account state %s, ignoring stale actor claims',
  async (state) => {
    db.user.findUnique.mockResolvedValue({
      status: state,
      authVersion: 1,
      userRoles:
        state === 'REMOVED'
          ? []
          : [
              { role: { name: 'TRANSPORTER' } },
              ...(state === 'MIXED' ? [{ role: { name: 'ADMIN' } }] : []),
            ],
    });
    await expect(getDispatchTransport(actor(), 'ed')).rejects.toMatchObject({ statusCode: 403 });
  },
);
it('bounds list pagination and never accepts a caller assignment filter', async () => {
  const result = await listAssignedTransport(actor(), { limit: 1 });
  expect(result.items).toHaveLength(1);
  expect(db.erveDispatch.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ transporterUserId: 't1' }),
      take: 2,
    }),
  );
});
it('checks assignment before revealing a stale version and performs no write or audit', async () => {
  db.erveDispatch.findUnique.mockResolvedValue({ ...record(), transporterUserId: 't2' });
  await expect(
    updateDispatchTransport(actor(), 'ed', { expectedVersion: 0, lrNumber: 'LR' }),
  ).rejects.toMatchObject({ statusCode: 404 });
  expect(db.erveDispatch.updateMany).not.toHaveBeenCalled();
  expect(recordAuditLog).not.toHaveBeenCalled();
});
it('preserves version locking, audit and assignment in the conditional transport write', async () => {
  await updateDispatchTransport(actor(), 'ed', { expectedVersion: 3, lrNumber: 'LR' });
  expect(db.$executeRaw).toHaveBeenCalled();
  expect(db.erveDispatch.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: 'ed', version: 3, transporterUserId: 't1' },
      data: expect.objectContaining({
        lrNumber: 'LR',
        lrUpdatedById: 't1',
        version: { increment: 1 },
      }),
    }),
  );
  expect(recordAuditLog).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'ERVE_DISPATCH_LR_UPDATED' }),
    db,
  );
});
it('rejects stale versions without writing', async () => {
  await expect(
    updateDispatchTransport(actor(), 'ed', { expectedVersion: 2, lrNumber: 'LR' }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(db.erveDispatch.updateMany).not.toHaveBeenCalled();
});
it('revalidates assignment before returning an update response', async () => {
  db.erveDispatch.findFirst.mockResolvedValue(null);
  await expect(
    updateDispatchTransport(actor(), 'ed', { expectedVersion: 3, lrNumber: 'LR' }),
  ).rejects.toMatchObject({ statusCode: 404 });
});
it('does not record success if the conditional write loses a race', async () => {
  db.erveDispatch.updateMany.mockResolvedValue({ count: 0 });
  await expect(
    updateDispatchTransport(actor(), 'ed', { expectedVersion: 3, lrNumber: 'LR' }),
  ).rejects.toMatchObject({ statusCode: 409 });
  expect(recordAuditLog).not.toHaveBeenCalled();
});
it('rejects Transporter attempts to manage assignments or enumerate accounts', async () => {
  await expect(
    assignDispatchTransporter(actor(), 'ed', { expectedVersion: 3, transporterUserId: null }),
  ).rejects.toMatchObject({ statusCode: 403 });
  await expect(listTransporterOptions(actor(), { limit: 10 })).rejects.toMatchObject({
    statusCode: 403,
  });
});
it.each(['ADMIN', 'MERCHANDISER'])(
  'allows %s to replace and clear assignments while preserving historical text',
  async (role) => {
    db.user.findUnique.mockImplementation(async ({ where }) => ({
      id: where.id,
      name: 'Carrier',
      status: 'ACTIVE',
      authVersion: 1,
      userRoles: [{ role: { name: where.id === 't1' ? role : 'TRANSPORTER' } }],
    }));
    await assignDispatchTransporter(actor(role), 'ed', {
      expectedVersion: 3,
      transporterUserId: 't2',
    });
    expect(db.erveDispatch.updateMany).toHaveBeenCalledWith({
      where: { id: 'ed', version: 3 },
      data: { transporterUserId: 't2', version: { increment: 1 } },
    });
    expect(recordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ERVE_DISPATCH_TRANSPORTER_ASSIGNED',
        metadata: expect.objectContaining({ from: 't1', to: 't2' }),
      }),
      db,
    );
    await assignDispatchTransporter(actor(role), 'ed', {
      expectedVersion: 3,
      transporterUserId: null,
    });
    expect(db.erveDispatch.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'ed', version: 3 },
      data: { transporterUserId: null, version: { increment: 1 } },
    });
  },
);
it.each(['INACTIVE', 'MIXED', 'MISSING', 'WRONG_ROLE'])(
  'rejects ineligible assignment %s',
  async (state) => {
    db.user.findUnique.mockImplementation(async ({ where }) =>
      where.id === 't1'
        ? { status: 'ACTIVE', authVersion: 1, userRoles: [{ role: { name: 'ADMIN' } }] }
        : state === 'MISSING'
          ? null
          : {
              status: state === 'INACTIVE' ? state : 'ACTIVE',
              userRoles: [
                { role: { name: state === 'WRONG_ROLE' ? 'ACCOUNTANT' : 'TRANSPORTER' } },
                ...(state === 'MIXED' ? [{ role: { name: 'ADMIN' } }] : []),
              ],
            },
    );
    await expect(
      assignDispatchTransporter(actor('ADMIN'), 'ed', {
        expectedVersion: 3,
        transporterUserId: 't2',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(db.erveDispatch.updateMany).not.toHaveBeenCalled();
  },
);
it('propagates audit failure from inside the write transaction', async () => {
  vi.mocked(recordAuditLog).mockRejectedValue(new Error('audit failure'));
  await expect(
    updateDispatchTransport(actor(), 'ed', { expectedVersion: 3, lrNumber: 'LR' }),
  ).rejects.toThrow('audit failure');
  expect(db.erveDispatch.findFirst).not.toHaveBeenCalled();
});

it('bounds the account picker and selects only eligible account ID and name', async () => {
  db.user.findUnique.mockResolvedValue({
    status: 'ACTIVE',
    authVersion: 1,
    userRoles: [{ role: { name: 'MERCHANDISER' } }],
  });
  await listTransporterOptions(actor('MERCHANDISER'), { search: 'Carrier', limit: 1000 });
  expect(db.user.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      take: 50,
      select: { id: true, name: true },
      where: expect.objectContaining({
        status: 'ACTIVE',
        userRoles: {
          some: { role: { name: 'TRANSPORTER' } },
          every: { role: { name: 'TRANSPORTER' } },
        },
      }),
    }),
  );
});

it('handles an unchanged assignment idempotently without a new audit event', async () => {
  db.user.findUnique.mockImplementation(async ({ where }) => ({
    status: 'ACTIVE',
    authVersion: 1,
    userRoles: [{ role: { name: where.id === 'admin' ? 'ADMIN' : 'TRANSPORTER' } }],
  }));
  await assignDispatchTransporter({ ...actor('ADMIN'), id: 'admin' }, 'ed', {
    expectedVersion: 3,
    transporterUserId: 't1',
  });
  expect(db.erveDispatch.updateMany).not.toHaveBeenCalled();
  expect(recordAuditLog).not.toHaveBeenCalled();
});

it('rejects role removal during response revalidation', async () => {
  db.user.findUnique
    .mockResolvedValueOnce({
      status: 'ACTIVE',
      authVersion: 1,
      userRoles: [{ role: { name: 'TRANSPORTER' } }],
    })
    .mockResolvedValue({ status: 'ACTIVE', authVersion: 1, userRoles: [] });
  await expect(getDispatchTransport(actor(), 'ed')).rejects.toMatchObject({ statusCode: 403 });
});

it('does not return a record reassigned while response permissions were being revalidated', async () => {
  db.erveDispatch.findFirst.mockResolvedValueOnce(record()).mockResolvedValue(null);
  await expect(getDispatchTransport(actor(), 'ed')).rejects.toMatchObject({ statusCode: 404 });
  expect(db.erveDispatch.findFirst).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        transporterUserId: 't1',
        transporterUser: {
          is: {
            id: 't1',
            status: 'ACTIVE',
            authVersion: 1,
            userRoles: {
              some: { role: { name: 'TRANSPORTER' } },
              every: { role: { name: 'TRANSPORTER' } },
            },
          },
        },
      }),
    }),
  );
});

it('checks account eligibility together with assignment in the final list query', async () => {
  db.erveDispatch.findMany.mockImplementation(async ({ where }) =>
    where.transporterUser ? [] : [record()],
  );
  expect((await listAssignedTransport(actor(), { limit: 25 })).items).toEqual([]);
  expect(db.erveDispatch.findMany).toHaveBeenLastCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        transporterUserId: 't1',
        transporterUser: expect.objectContaining({
          is: expect.objectContaining({ status: 'ACTIVE', authVersion: 1 }),
        }),
      }),
    }),
  );
});
