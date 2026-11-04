import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createId } from '@erve/shared';
import type { CurrentUser } from '../../auth/current-user.js';
import { createApp } from '../../app.js';
import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import {
  EwayBillProviderError,
  type EwayBillProvider,
} from '../../integrations/gst/eway-bill-provider.js';
import { createTestTaxInvoice, createTestUserAndToken, resetDatabase } from '../../test/helpers.js';
import type {
  EwayBillMutationTx,
  EwayBillOperationsRepository,
  EwayBillSnapshot,
} from './eway-bill-operations.port.js';
import { ewayBillOperationsRepository } from './eway-bill-operations.repository.js';
import { createEwayBillOperationsService } from './eway-bill-operations.service.js';
import { syntheticResult } from './test/eway-bill-operations-harness.js';
import { requestFacts } from './test/eway-bill-request-fixtures.js';

// Disposable-Postgres tests for what unit tests cannot prove: the advisory
// lock, the partial unique indexes, the CHECK constraints, transaction
// rollback and the real read models. The provider is always a test double;
// nothing here can reach a network.

const provider = {
  generate: vi.fn<EwayBillProvider['generate']>(),
  lookup: vi.fn<EwayBillProvider['lookup']>(async () => {
    throw new Error('lookup must never be called');
  }),
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const FIXED_NOW = new Date('2026-11-05T06:00:00.000Z');

let accountantId: string;
let accountantToken: string;
let adminToken: string;
let merchandiserToken: string;
let app: ReturnType<typeof createApp>;
let invoiceId: string;
let otherInvoiceId: string;
const clock = { current: FIXED_NOW };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const base = (id = invoiceId) => `/tax-invoices/${id}/eway-bill`;

beforeEach(async () => {
  await resetDatabase();
  provider.generate.mockReset();
  provider.generate.mockImplementation(async () => syntheticResult());
  provider.lookup.mockClear();
  clock.current = FIXED_NOW;

  ({ userId: accountantId, token: accountantToken } = await createTestUserAndToken({
    email: 'eway-accountant@example.test',
    password: 'SyntheticTestOnly!',
    roles: ['ACCOUNTANT'],
  }));
  ({ token: adminToken } = await createTestUserAndToken({
    email: 'eway-admin@example.test',
    password: 'SyntheticTestOnly!',
    roles: ['ADMIN'],
  }));
  ({ token: merchandiserToken } = await createTestUserAndToken({
    email: 'eway-merch@example.test',
    password: 'SyntheticTestOnly!',
    roles: ['MERCHANDISER'],
  }));
  await prisma.gstComplianceSettings.create({
    data: {
      scope: 'APPLICATION',
      integrationMode: 'DEMO',
      ewayBillGenerationEnabled: true,
      updatedById: accountantId,
    },
  });
  const first = await createTestTaxInvoice({ createdById: accountantId });
  invoiceId = first.id;
  otherInvoiceId = (
    await createTestTaxInvoice({
      createdById: accountantId,
      sellerRegistrationId: first.sellerRegistrationId,
      invoiceNumber: 'EI/26-27/0002',
    })
  ).id;

  env.EWAY_BILL_DEMO_GENERATION_AUTHORIZED = true;
  env.GST_VERIFICATION_API_KEY = 'synthetic-mock-key-no-real-network';
  app = createApp({ ewayBillProvider: provider });
});

afterAll(() => {
  env.EWAY_BILL_DEMO_GENERATION_AUTHORIZED = false;
  env.GST_VERIFICATION_API_KEY = '';
});

const bill = (over: Record<string, unknown> = {}) => ({
  id: createId(),
  taxInvoiceId: invoiceId,
  source: 'PROVIDER_GENERATED' as const,
  integrationMode: 'DEMO' as const,
  verificationStatus: 'SYNTHETIC_DEMO' as const,
  ewayBillNumber: 'TEST-100000000001',
  createdById: accountantId,
  ...over,
});
const attempt = (over: Record<string, unknown> = {}) => ({
  id: createId(),
  taxInvoiceId: invoiceId,
  integrationMode: 'DEMO' as const,
  actorId: accountantId,
  documentType: 'INV',
  documentNumber: 'EI/26-27/0001',
  documentDate: new Date('2026-11-04T00:00:00.000Z'),
  requestFingerprint: 'f'.repeat(64),
  settingsVersion: 1,
  ...over,
});

describe('database guarantees', () => {
  it('lets two invoices carry the same synthetic Demo number', async () => {
    await prisma.ewayBill.create({ data: bill() });
    await expect(prisma.ewayBill.create({ data: bill({ taxInvoiceId: otherInvoiceId }) })).resolves.toBeTruthy();
  });

  it('keeps a Live number unique across invoices, but not across Demo and Live', async () => {
    const live = (over: Record<string, unknown>) =>
      bill({ integrationMode: 'LIVE', source: 'EXTERNALLY_LINKED', verificationStatus: 'UNVERIFIED_REFERENCE', ewayBillNumber: '123456789012', ...over });
    await prisma.ewayBill.create({ data: live({}) });
    await expect(prisma.ewayBill.create({ data: live({ taxInvoiceId: otherInvoiceId }) })).rejects.toThrow();
    await expect(
      prisma.ewayBill.create({ data: bill({ taxInvoiceId: otherInvoiceId, ewayBillNumber: '123456789012' }) }),
    ).resolves.toBeTruthy();
  });

  it('allows at most one ACTIVE bill per invoice and mode', async () => {
    await prisma.ewayBill.create({ data: bill() });
    await expect(prisma.ewayBill.create({ data: bill({ ewayBillNumber: 'TEST-2' }) })).rejects.toThrow();
    await expect(
      prisma.ewayBill.create({
        data: bill({ integrationMode: 'LIVE', source: 'EXTERNALLY_LINKED', verificationStatus: 'UNVERIFIED_REFERENCE', ewayBillNumber: '123456789012' }),
      }),
    ).resolves.toBeTruthy();
  });

  it.each([
    ['a DEMO bill that is not synthetic', { verificationStatus: 'UNVERIFIED_REFERENCE' }],
    ['a LIVE bill marked synthetic', { integrationMode: 'LIVE', source: 'EXTERNALLY_LINKED', ewayBillNumber: '123456789012' }],
    ['PROVIDER_VERIFIED without a verification time', { integrationMode: 'LIVE', source: 'EXTERNALLY_LINKED', verificationStatus: 'PROVIDER_VERIFIED', ewayBillNumber: '123456789012' }],
    ['a verification time on an unverified bill', { integrationMode: 'LIVE', source: 'EXTERNALLY_LINKED', verificationStatus: 'UNVERIFIED_REFERENCE', verifiedAt: new Date(), ewayBillNumber: '123456789012' }],
  ])('rejects %s', async (_name, over) => {
    await expect(prisma.ewayBill.create({ data: bill(over) })).rejects.toThrow();
  });

  it('defaults an unspecified verification status to the weakest, so a Demo row must say so', async () => {
    const live = await prisma.ewayBill.create({
      data: {
        id: createId(),
        taxInvoiceId: invoiceId,
        source: 'EXTERNALLY_LINKED',
        integrationMode: 'LIVE',
        ewayBillNumber: '123456789012',
        createdById: accountantId,
      },
    });
    expect(live.verificationStatus).toBe('UNVERIFIED_REFERENCE');
    await expect(
      prisma.ewayBill.create({
        data: { id: createId(), taxInvoiceId: otherInvoiceId, source: 'PROVIDER_GENERATED', integrationMode: 'DEMO', ewayBillNumber: 'TEST-1', createdById: accountantId },
      }),
    ).rejects.toThrow();
  });

  it('allows one open attempt per invoice and mode, and a new one once it is closed', async () => {
    const first = await prisma.ewayBillRequestAttempt.create({ data: attempt({ outcome: 'UNCERTAIN' }) });
    await expect(prisma.ewayBillRequestAttempt.create({ data: attempt() })).rejects.toThrow();
    await expect(
      prisma.ewayBillRequestAttempt.create({ data: attempt({ integrationMode: 'LIVE' }) }),
    ).resolves.toBeTruthy();
    await prisma.ewayBillRequestAttempt.update({
      where: { id: first.id },
      data: { outcome: 'CLOSED', resolvedById: accountantId, resolvedAt: new Date(), resolutionReason: 'Demo only; nothing real was filed' },
    });
    await expect(prisma.ewayBillRequestAttempt.create({ data: attempt() })).resolves.toBeTruthy();
  });

  it('requires actor, time and reason together for a manual resolution', async () => {
    const created = await prisma.ewayBillRequestAttempt.create({ data: attempt({ outcome: 'UNCERTAIN' }) });
    await expect(
      prisma.ewayBillRequestAttempt.update({ where: { id: created.id }, data: { resolvedById: accountantId } }),
    ).rejects.toThrow();
  });

  it('stores a partially captured movement and a zero distance', async () => {
    const row = await prisma.ewayBillMovement.create({
      data: { id: createId(), taxInvoiceId: invoiceId, approximateDistanceKm: 0, createdById: accountantId, updatedById: accountantId },
    });
    expect(row).toMatchObject({ approximateDistanceKm: 0, transportMode: null, shipToArrangement: null, version: 1 });
  });
});

describe('repository transactions', () => {
  it('serializes callers on the invoice lock', async () => {
    const events: string[] = [];
    const run = (name: string) =>
      ewayBillOperationsRepository.withInvoiceLock(invoiceId, async () => {
        events.push(`${name}:start`);
        await sleep(60);
        events.push(`${name}:end`);
      });
    await Promise.all([run('a'), run('b')]);
    expect(events[0]!.endsWith(':start')).toBe(true);
    expect(events[1]).toBe(events[0]!.replace('start', 'end'));
    expect(events[2]!.endsWith(':start')).toBe(true);
    expect(events[3]).toBe(events[2]!.replace('start', 'end'));
  });

  it('rolls everything back when the callback throws', async () => {
    await expect(
      ewayBillOperationsRepository.withInvoiceLock(invoiceId, async (tx) => {
        await tx.createDemoAttempt({
          actorId: accountantId, documentType: 'INV', documentNumber: 'EI/26-27/0001', documentDate: '2026-11-04',
          requestFingerprint: 'a'.repeat(64), settingsVersion: 1, movementVersion: 1, reviewAfter: new Date(),
        });
        await tx.audit({ actorId: accountantId, action: 'EWAY_BILL_TEST', metadata: {} });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await prisma.ewayBillRequestAttempt.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'EWAY_BILL_TEST' } })).toBe(0);
  });

  it('applies an attempt transition only from an expected outcome', async () => {
    const created = await prisma.ewayBillRequestAttempt.create({ data: attempt({ outcome: 'DISPATCHED' }) });
    const [first, second] = await Promise.all([
      ewayBillOperationsRepository.withInvoiceLock(invoiceId, (tx) =>
        tx.transitionAttempt({ attemptId: created.id, from: ['DISPATCHED'], to: 'SUCCEEDED' }),
      ),
      ewayBillOperationsRepository.withInvoiceLock(invoiceId, (tx) =>
        tx.transitionAttempt({ attemptId: created.id, from: ['DISPATCHED'], to: 'UNCERTAIN' }),
      ),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('refuses a duplicate open attempt and a second Demo bill with typed conflicts', async () => {
    const open = (tx: EwayBillMutationTx) =>
      tx.createDemoAttempt({
        actorId: accountantId, documentType: 'INV', documentNumber: 'EI/26-27/0001', documentDate: '2026-11-04',
        requestFingerprint: 'a'.repeat(64), settingsVersion: 1, movementVersion: 1, reviewAfter: new Date(),
      });
    await ewayBillOperationsRepository.withInvoiceLock(invoiceId, open);
    await expect(ewayBillOperationsRepository.withInvoiceLock(invoiceId, open)).rejects.toMatchObject({
      statusCode: 409,
      details: { reason: 'EWAY_BILL_ATTEMPT_ALREADY_OPEN' },
    });
    await prisma.ewayBill.create({ data: bill() });
    await expect(
      ewayBillOperationsRepository.withInvoiceLock(invoiceId, (tx) =>
        tx.createDemoBill({ attemptId: 'x', actorId: accountantId, ewayBillNumber: 'TEST-2', generatedAt: null, validUntil: null, providerReference: 'TEST-2' }),
      ),
    ).rejects.toBeTruthy();
  });

  it('loads a legacy invoice (no document snapshot, no payable total) without throwing', async () => {
    const snapshot = await ewayBillOperationsRepository.loadSnapshot(invoiceId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.requestFacts.invoice.payableTotal).toBeNull();
    expect(snapshot!.requestFacts.lines).toEqual([]);
    expect(snapshot!.movementVersion).toBe(0);
    expect(snapshot!.settings).toMatchObject({ integrationMode: 'DEMO', ewayBillGenerationEnabled: true });
    expect(await ewayBillOperationsRepository.loadSnapshot('missing')).toBeNull();
  });
});

// The invoice fixtures here are minimal, so request-building would be blocked
// by missing line data. This decorator substitutes a complete invoice for the
// request facts ONLY, keeping the real movement, bills, attempts, settings, the
// real lock, the real unique indexes and the real transactions.
function withReadyInvoice(overrides: Partial<EwayBillOperationsRepository> = {}): EwayBillOperationsRepository {
  const ready = (snapshot: EwayBillSnapshot | null): EwayBillSnapshot | null =>
    snapshot && {
      ...snapshot,
      requestFacts: {
        ...requestFacts({ invoice: { id: snapshot.requestFacts.invoice.id } }),
        movement: snapshot.requestFacts.movement,
      },
    };
  return {
    ...ewayBillOperationsRepository,
    loadSnapshot: async (id) => ready(await ewayBillOperationsRepository.loadSnapshot(id)),
    withInvoiceLock: (id, work) =>
      ewayBillOperationsRepository.withInvoiceLock(id, (tx) =>
        work({ ...tx, loadSnapshot: async () => ready(await tx.loadSnapshot()) }),
      ),
    ...overrides,
  };
}

const makeService = (repository: EwayBillOperationsRepository = withReadyInvoice()) =>
  createEwayBillOperationsService({
    repository,
    provider,
    config: { demoGenerationAuthorized: () => true, providerConfigured: () => true, providerTimeoutMs: 20_000 },
    now: () => clock.current,
  });

const actor = (): CurrentUser => ({
  id: accountantId,
  email: 'eway-accountant@example.test',
  mobile: null,
  name: 'Accountant',
  status: 'ACTIVE',
  authVersion: 1,
  roles: ['ACCOUNTANT'],
  distributorIds: [],
  factoryIds: [],
});

const movement = (id: string, expectedVersion = 0) =>
  makeService().saveMovement(actor(), id, {
    expectedVersion,
    transportMode: 'ROAD',
    vehicleNumber: 'TN01AB1234',
    vehicleType: 'REGULAR',
    approximateDistanceKm: 350,
    shipToArrangement: 'BILLED_PARTY',
    dispatchFromArrangement: 'SUPPLIER_REGISTERED_PREMISES',
  });

const generate = (service = makeService(), id = invoiceId, version = 1) =>
  service.generateDemo(actor(), id, {
    expectedMovementVersion: version,
    acknowledgeApplicabilityUndetermined: true,
  });

describe('Demo generation against Postgres', () => {
  it('runs the full lifecycle and records a synthetic bill, attempt and audit trail', async () => {
    await movement(invoiceId);
    const result = await generate();

    expect(result.outcome).toBe('SUCCEEDED');
    const attempts = await prisma.ewayBillRequestAttempt.findMany();
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      outcome: 'SUCCEEDED',
      integrationMode: 'DEMO',
      movementVersion: 1,
      settingsVersion: 1,
      documentType: 'INV',
      documentNumber: 'EI/26-27/0001',
      actorId: accountantId,
    });
    const bills = await prisma.ewayBill.findMany();
    expect(bills).toHaveLength(1);
    expect(bills[0]).toMatchObject({
      integrationMode: 'DEMO',
      source: 'PROVIDER_GENERATED',
      verificationStatus: 'SYNTHETIC_DEMO',
      verifiedAt: null,
      requestAttemptId: attempts[0]!.id,
    });
    // Compared as a set: consecutive audit rows can share a millisecond and
    // ids are not ordered within one, so order would make this flaky.
    const actions = (
      await prisma.auditLog.findMany({ where: { entityType: 'TaxInvoiceEwayBill', entityId: invoiceId } })
    ).map((row) => row.action);
    expect([...actions].sort()).toEqual(
      [
        'EWAY_BILL_MOVEMENT_UPDATED',
        'EWAY_BILL_DEMO_ATTEMPT_PREPARED',
        'EWAY_BILL_DEMO_ATTEMPT_DISPATCHED',
        'EWAY_BILL_DEMO_ATTEMPT_SUCCEEDED',
      ].sort(),
    );
  });

  it('turns concurrent duplicate submissions into one provider call and one bill', async () => {
    await movement(invoiceId);
    provider.generate.mockImplementation(async () => {
      await sleep(80);
      return syntheticResult();
    });
    const service = makeService();
    const results = await Promise.allSettled([generate(service), generate(service), generate(service)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(await prisma.ewayBill.count()).toBe(1);
    expect(await prisma.ewayBillRequestAttempt.count()).toBe(1);
  });

  it('accepts the same synthetic number on two invoices', async () => {
    await movement(invoiceId);
    await movement(otherInvoiceId);
    expect((await generate(makeService(), invoiceId)).outcome).toBe('SUCCEEDED');
    expect((await generate(makeService(), otherInvoiceId)).outcome).toBe('SUCCEEDED');
    const numbers = (await prisma.ewayBill.findMany()).map((row) => row.ewayBillNumber);
    expect(numbers).toEqual(['TEST-100000000001', 'TEST-100000000001']);
  });

  it('keeps an uncertain attempt open across requests until it is closed by hand', async () => {
    await movement(invoiceId);
    const service = makeService();
    provider.generate.mockRejectedValueOnce(new EwayBillProviderError('TIMEOUT', true));
    const uncertain = await generate(service);
    expect(uncertain.outcome).toBe('UNCERTAIN');
    expect((await prisma.ewayBillRequestAttempt.findMany()).map((a) => a.outcome)).toEqual(['UNCERTAIN']);

    await expect(generate(service)).rejects.toMatchObject({ statusCode: 409 });
    expect(provider.generate).toHaveBeenCalledTimes(1);

    const closed = await service.closeDemoAttempt(actor(), invoiceId, uncertain.attempt.id, {
      expectedOutcome: 'UNCERTAIN',
      reason: 'Demo run; confirmed nothing real was filed',
    });
    expect(closed.attempt).toMatchObject({ outcome: 'CLOSED', resolution: { by: { id: accountantId } } });
    const row = await prisma.ewayBillRequestAttempt.findUniqueOrThrow({ where: { id: uncertain.attempt.id } });
    expect(row).toMatchObject({ outcome: 'CLOSED', resolvedById: accountantId, resolutionReason: 'Demo run; confirmed nothing real was filed' });
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect(await prisma.ewayBill.count()).toBe(0);

    expect((await generate(service)).outcome).toBe('SUCCEEDED');
  });

  it('rolls back the success transaction and leaves the attempt UNCERTAIN when the bill cannot be saved', async () => {
    await movement(invoiceId);
    const repository = withReadyInvoice({
      withInvoiceLock: (id, work) =>
        withReadyInvoice().withInvoiceLock(id, (tx) =>
          work({
            ...tx,
            createDemoBill: async () => {
              throw new Error('simulated persistence failure');
            },
          }),
        ),
    });
    const result = await generate(makeService(repository));
    expect(result).toMatchObject({ outcome: 'UNCERTAIN', ewayBill: null, failure: { code: 'RESULT_NOT_RECORDED' } });
    expect(await prisma.ewayBill.count()).toBe(0);
    expect((await prisma.ewayBillRequestAttempt.findMany()).map((a) => a.outcome)).toEqual(['UNCERTAIN']);
    await expect(generate(makeService())).rejects.toMatchObject({ statusCode: 409 });
  });

  it('never releases a stalled DISPATCHED attempt on its own', async () => {
    await movement(invoiceId);
    await prisma.ewayBillRequestAttempt.create({
      data: attempt({ outcome: 'DISPATCHED', dispatchedAt: new Date('2026-11-05T05:00:00.000Z'), reviewAfter: new Date('2026-11-05T05:02:00.000Z') }),
    });
    clock.current = new Date('2026-12-30T00:00:00.000Z');
    await expect(generate()).rejects.toMatchObject({ statusCode: 409 });
    expect(provider.generate).not.toHaveBeenCalled();
    expect((await prisma.ewayBillRequestAttempt.findMany()).map((a) => a.outcome)).toEqual(['DISPATCHED']);
  });
});

describe('HTTP contract against Postgres', () => {
  it('lets ADMIN and ACCOUNTANT read and nobody else', async () => {
    for (const path of ['movement', 'generation-preview', 'attempts']) {
      await request(app).get(`${base()}/${path}`).set(auth(accountantToken)).expect(200);
      await request(app).get(`${base()}/${path}`).set(auth(adminToken)).expect(200);
      await request(app).get(`${base()}/${path}`).set(auth(merchandiserToken)).expect(403);
      await request(app).get(`${base()}/${path}`).expect(401);
    }
  });

  it('keeps every mutation ACCOUNTANT-only and does nothing for an ADMIN', async () => {
    await request(app).put(`${base()}/movement`).set(auth(adminToken)).send({ expectedVersion: 0 }).expect(403);
    await request(app).post(`${base()}/generate`).set(auth(adminToken)).send({ expectedMovementVersion: 0 }).expect(403);
    await request(app).post(`${base()}/link`).set(auth(adminToken)).send({ ewayBillNumber: '123456789012' }).expect(403);
    await request(app).post(`${base()}/attempts/x/close-demo`).set(auth(adminToken)).send({ expectedOutcome: 'UNCERTAIN', reason: 'a long enough reason' }).expect(403);
    expect(await prisma.ewayBillMovement.count()).toBe(0);
    expect(await prisma.ewayBill.count()).toBe(0);
    expect(await prisma.ewayBillRequestAttempt.count()).toBe(0);
  });

  it('captures a movement with optimistic concurrency', async () => {
    const saved = await request(app)
      .put(`${base()}/movement`)
      .set(auth(accountantToken))
      .send({ expectedVersion: 0, transportMode: 'RAIL', transportDocumentNumber: 'RR-1', approximateDistanceKm: 0 })
      .expect(200);
    expect(saved.body.data).toMatchObject({ version: 1, captured: true, movement: { approximateDistanceKm: 0 } });
    const stale = await request(app).put(`${base()}/movement`).set(auth(accountantToken)).send({ expectedVersion: 0 }).expect(409);
    expect(stale.body.error).toMatchObject({ code: 'STALE_VERSION' });
    const read = await request(app).get(`${base()}/movement`).set(auth(adminToken)).expect(200);
    expect(read.body.data.version).toBe(1);
  });

  it('returns typed blockers, not an error, for a legacy invoice', async () => {
    const preview = await request(app).get(`${base()}/generation-preview`).set(auth(accountantToken)).expect(200);
    expect(preview.body.data.request.ready).toBe(false);
    expect(preview.body.data.demo.available).toBe(false);
    expect(preview.body.data.live.available).toBe(false);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(await prisma.ewayBillRequestAttempt.count()).toBe(0);
  });

  it('refuses generation when the setting is off, and when the request is not ready', async () => {
    const body = { expectedMovementVersion: 0, acknowledgeApplicabilityUndetermined: true };
    const notReady = await request(app).post(`${base()}/generate`).set(auth(accountantToken)).send(body).expect(422);
    expect(notReady.body.error.code).toBe('EWAY_BILL_REQUEST_NOT_READY');
    await prisma.gstComplianceSettings.update({ where: { scope: 'APPLICATION' }, data: { ewayBillGenerationEnabled: false } });
    const gated = await request(app).post(`${base()}/generate`).set(auth(accountantToken)).send(body).expect(409);
    expect(gated.body.error.details.reason).toBe('EWAY_BILL_GENERATION_NOT_PERMITTED');
    expect(provider.generate).not.toHaveBeenCalled();
    expect(await prisma.ewayBillRequestAttempt.count()).toBe(0);
  });

  it('refuses generation in Live mode even with every other gate open', async () => {
    await prisma.gstComplianceSettings.update({ where: { scope: 'APPLICATION' }, data: { integrationMode: 'LIVE' } });
    const response = await request(app)
      .post(`${base()}/generate`)
      .set(auth(accountantToken))
      .send({ expectedMovementVersion: 0, acknowledgeApplicabilityUndetermined: true })
      .expect(409);
    expect(JSON.stringify(response.body)).toContain('EWAY_BILL_DEMO_REQUIRES_DEMO_MODE');
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('links an existing bill as an unverified Live reference, without the Demo setting', async () => {
    await prisma.gstComplianceSettings.update({ where: { scope: 'APPLICATION' }, data: { ewayBillGenerationEnabled: false } });
    env.EWAY_BILL_DEMO_GENERATION_AUTHORIZED = false;
    const linked = await request(app)
      .post(`${base()}/link`)
      .set(auth(accountantToken))
      .send({ ewayBillNumber: '123456789012' })
      .expect(201);
    expect(linked.body.data.ewayBill).toMatchObject({
      integrationMode: 'LIVE',
      source: 'EXTERNALLY_LINKED',
      verificationStatus: 'UNVERIFIED_REFERENCE',
    });
    const row = await prisma.ewayBill.findFirstOrThrow();
    expect(row).toMatchObject({ integrationMode: 'LIVE', verificationStatus: 'UNVERIFIED_REFERENCE', verifiedAt: null, createdById: accountantId });
    expect(await prisma.auditLog.count({ where: { action: 'EWAY_BILL_REFERENCE_LINKED' } })).toBe(1);

    const readiness = await request(app).get(`/tax-invoices/${invoiceId}/eway-bill-readiness`).set(auth(adminToken)).expect(200);
    expect(readiness.body.data.linkage).toMatchObject({ state: 'LINKED_UNVERIFIED', satisfiesStatutoryClearance: false, ewayBill: null });
    expect(readiness.body.data.capabilities).toMatchObject({ externalLinkAvailable: true, liveGenerationAvailable: false });

    await request(app).post(`${base()}/link`).set(auth(accountantToken)).send({ ewayBillNumber: '999988887777' }).expect(409);
    await request(app).post(`${base(otherInvoiceId)}/link`).set(auth(accountantToken)).send({ ewayBillNumber: '123456789012' }).expect(409);
    await request(app).post(`${base(otherInvoiceId)}/link`).set(auth(accountantToken)).send({ ewayBillNumber: 'TEST-100000000001' }).expect(400);
    expect(await prisma.ewayBill.count()).toBe(1);
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it('closes a Demo attempt over HTTP and exposes the history without sensitive fields', async () => {
    const created = await prisma.ewayBillRequestAttempt.create({
      data: attempt({ outcome: 'UNCERTAIN', failureCode: 'TIMEOUT', failureMessage: 'The provider did not answer in time. The outcome is unknown.' }),
    });
    const closed = await request(app)
      .post(`${base()}/attempts/${created.id}/close-demo`)
      .set(auth(accountantToken))
      .send({ expectedOutcome: 'UNCERTAIN', reason: 'Demo run; nothing real was filed' })
      .expect(200);
    expect(closed.body.data.attempt).toMatchObject({ outcome: 'CLOSED', resolution: { reason: 'Demo run; nothing real was filed' } });
    await request(app)
      .post(`${base()}/attempts/${created.id}/close-demo`)
      .set(auth(accountantToken))
      .send({ expectedOutcome: 'UNCERTAIN', reason: 'Demo run; nothing real was filed' })
      .expect(409);

    const history = await request(app).get(`${base()}/attempts`).set(auth(adminToken)).expect(200);
    expect(history.body.data.attempts).toHaveLength(1);
    expect(history.body.data.events.map((e: { action: string }) => e.action)).toContain('EWAY_BILL_DEMO_ATTEMPT_CLOSED');
    expect(JSON.stringify(history.body)).not.toContain('f'.repeat(64));
    expect(provider.generate).not.toHaveBeenCalled();
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it('never closes a Live attempt or one that belongs to another invoice', async () => {
    const live = await prisma.ewayBillRequestAttempt.create({ data: attempt({ integrationMode: 'LIVE', outcome: 'UNCERTAIN' }) });
    await request(app)
      .post(`${base()}/attempts/${live.id}/close-demo`)
      .set(auth(accountantToken))
      .send({ expectedOutcome: 'UNCERTAIN', reason: 'Trying to close a live attempt' })
      .expect(409);
    await request(app)
      .post(`${base(otherInvoiceId)}/attempts/${live.id}/close-demo`)
      .set(auth(accountantToken))
      .send({ expectedOutcome: 'UNCERTAIN', reason: 'Wrong invoice for this attempt' })
      .expect(404);
    expect((await prisma.ewayBillRequestAttempt.findUniqueOrThrow({ where: { id: live.id } })).outcome).toBe('UNCERTAIN');
  });
});
