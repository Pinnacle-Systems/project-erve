import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentUser } from '../../auth/current-user.js';
import { errorHandler } from '../../middleware/error-handler.js';
import { createEwayBillEligibilityService, type EwayBillFactsRepository } from './eway-bill-eligibility.service.js';
import { createEwayBillRouter } from './eway-bill.routes.js';
import { finalizedFacts } from './test/eway-bill-fixtures.js';
import { createHarness, providerFailure, type Harness } from './test/eway-bill-operations-harness.js';

// Authentication is the boundary double; no app/db/config module is loaded.
vi.mock('../../auth/auth.middleware.js', () => ({
  requireAuth: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const role = req.headers['x-test-role'];
    if (!role) {
      res.status(401).end();
      return;
    }
    req.user = { id: 'acct-1', name: 'User', roles: [role] } as CurrentUser;
    next();
  },
}));

const loadFacts = vi.fn<EwayBillFactsRepository['loadFacts']>();
let app: express.Express;
let harness: Harness;

beforeEach(() => {
  loadFacts.mockReset();
  loadFacts.mockImplementation(async (id) => (id === 'inv-1' ? finalizedFacts() : null));
  harness = createHarness();
  app = express();
  app.use(express.json());
  app.use(
    '/tax-invoices',
    createEwayBillRouter(
      createEwayBillEligibilityService({ repository: { loadFacts } }),
      harness.service,
    ),
  );
  app.use(errorHandler);
});

const VIEWERS = ['ADMIN', 'ACCOUNTANT'];
const NON_VIEWERS = ['MERCHANDISER', 'SENIOR_MANAGEMENT', 'DISTRIBUTOR', 'FACTORY_USER', 'QA_USER'];

describe('GET /tax-invoices/:id/eway-bill-readiness', () => {
  it('requires authentication', async () => {
    await request(app).get('/tax-invoices/inv-1/eway-bill-readiness').expect(401);
    expect(loadFacts).not.toHaveBeenCalled();
  });

  it.each(VIEWERS)('lets %s read the readiness contract', async (role) => {
    const response = await request(app).get('/tax-invoices/inv-1/eway-bill-readiness').set('x-test-role', role).expect(200);
    expect(response.body.data).toMatchObject({
      taxInvoiceId: 'inv-1',
      invoiceStatus: 'FINALIZED',
      applicability: { outcome: 'UNDETERMINED' },
      linkage: { state: 'NONE', satisfiesStatutoryClearance: false },
      readiness: { outcome: 'READY', requirementsVerification: 'PARTIAL' },
      capabilities: {
        demoGenerationAvailable: false,
        liveGenerationAvailable: false,
        externalLinkAvailable: true,
      },
    });
    expect(loadFacts).toHaveBeenCalledTimes(1);
    expect(loadFacts).toHaveBeenCalledWith('inv-1');
  });

  it.each(NON_VIEWERS)('rejects %s before any invoice data is loaded', async (role) => {
    await request(app).get('/tax-invoices/inv-1/eway-bill-readiness').set('x-test-role', role).expect(403);
    expect(loadFacts).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown invoice without leaking another invoice', async () => {
    await request(app).get('/tax-invoices/other/eway-bill-readiness').set('x-test-role', 'ACCOUNTANT').expect(404);
    expect(loadFacts).toHaveBeenCalledTimes(1);
    expect(loadFacts).toHaveBeenCalledWith('other');
  });

  it('is itself read-only', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      await request(app)[method]('/tax-invoices/inv-1/eway-bill-readiness').set('x-test-role', 'ACCOUNTANT').expect(404);
    }
    expect(loadFacts).not.toHaveBeenCalled();
  });

  it('does not depend on an Erve Dispatch: facts carry none and the response is still complete', async () => {
    const response = await request(app).get('/tax-invoices/inv-1/eway-bill-readiness').set('x-test-role', 'ACCOUNTANT').expect(200);
    expect(Object.keys(response.body.data)).not.toContain('erveDispatch');
    expect(loadFacts).toHaveBeenCalledTimes(1);
  });
});

describe('B2B read routes', () => {
  const reads = [
    '/tax-invoices/inv-1/eway-bill/movement',
    '/tax-invoices/inv-1/eway-bill/generation-preview',
    '/tax-invoices/inv-1/eway-bill/attempts',
  ];

  it.each(reads)('%s requires authentication', async (path) => {
    await request(app).get(path).expect(401);
  });

  it.each(reads.flatMap((path) => VIEWERS.map((role) => [path, role] as const)))('%s lets %s read', async (path, role) => {
    const response = await request(app).get(path).set('x-test-role', role).expect(200);
    expect(response.body.data).toBeTruthy();
  });

  it.each(reads.flatMap((path) => NON_VIEWERS.map((role) => [path, role] as const)))('%s rejects %s', async (path, role) => {
    await request(app).get(path).set('x-test-role', role).expect(403);
  });

  it.each(reads)('%s returns 404 for an unknown invoice', async (path) => {
    await request(app).get(path.replace('inv-1', 'nope')).set('x-test-role', 'ACCOUNTANT').expect(404);
  });

  it('serves the movement, the preview and the history with their documented shapes', async () => {
    const movement = await request(app).get(reads[0]!).set('x-test-role', 'ADMIN').expect(200);
    expect(movement.body.data).toMatchObject({ version: 1, captured: true, movement: { shipToArrangement: 'BILLED_PARTY' } });
    const preview = await request(app).get(reads[1]!).set('x-test-role', 'ADMIN').expect(200);
    expect(preview.body.data).toMatchObject({ demo: { available: true }, live: { available: false } });
    const history = await request(app).get(reads[2]!).set('x-test-role', 'ADMIN').expect(200);
    expect(history.body.data).toMatchObject({ attempts: [], ewayBills: [], events: [] });
    expect(harness.provider.generate).not.toHaveBeenCalled();
  });
});

describe('B2B mutation routes', () => {
  const generate = { expectedMovementVersion: 1, acknowledgeApplicabilityUndetermined: true };
  const mutations = [
    { name: 'PUT movement', method: 'put', path: '/tax-invoices/inv-1/eway-bill/movement', body: { expectedVersion: 1, transportMode: 'ROAD' } },
    { name: 'POST generate', method: 'post', path: '/tax-invoices/inv-1/eway-bill/generate', body: generate },
    {
      name: 'POST close-demo',
      method: 'post',
      path: '/tax-invoices/inv-1/eway-bill/attempts/attempt-x/close-demo',
      body: { expectedOutcome: 'UNCERTAIN', reason: 'Closing after review' },
    },
    { name: 'POST link', method: 'post', path: '/tax-invoices/inv-1/eway-bill/link', body: { ewayBillNumber: '123456789012' } },
  ] as const;

  it.each(mutations)('$name requires authentication', async ({ method, path, body }) => {
    await request(app)[method](path).send(body).expect(401);
  });

  it.each(
    mutations.flatMap((m) => ['ADMIN', ...NON_VIEWERS].map((role) => [m.name, m, role] as const)),
  )('%s is ACCOUNTANT-only: %s is rejected and nothing runs', async (_name, mutation, role) => {
    await request(app)[mutation.method](mutation.path).set('x-test-role', role).send(mutation.body).expect(403);
    expect(harness.provider.generate).not.toHaveBeenCalled();
    expect(harness.state.attempts).toHaveLength(0);
    expect(harness.state.bills).toHaveLength(0);
    expect(harness.state.movement.version).toBe(1);
    expect(harness.state.audit).toHaveLength(0);
  });

  it('lets an ACCOUNTANT save the movement', async () => {
    const response = await request(app)
      .put(mutations[0].path)
      .set('x-test-role', 'ACCOUNTANT')
      .send({ expectedVersion: 1, transportMode: 'RAIL', transportDocumentNumber: 'RR-1', approximateDistanceKm: 0 })
      .expect(200);
    expect(response.body.data).toMatchObject({ version: 2, movement: { transportMode: 'RAIL', approximateDistanceKm: 0 } });
  });

  it('answers a stale movement version with 409 STALE_VERSION', async () => {
    const response = await request(app).put(mutations[0].path).set('x-test-role', 'ACCOUNTANT').send({ expectedVersion: 0 }).expect(409);
    expect(response.body.error).toMatchObject({ code: 'STALE_VERSION', details: { currentVersion: 1 } });
  });

  it('generates a synthetic bill: 201 with a SYNTHETIC_DEMO record', async () => {
    const response = await request(app).post(mutations[1].path).set('x-test-role', 'ACCOUNTANT').send(generate).expect(201);
    expect(response.body.data).toMatchObject({
      outcome: 'SUCCEEDED',
      ewayBill: { integrationMode: 'DEMO', verificationStatus: 'SYNTHETIC_DEMO' },
    });
    expect(harness.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('answers an unknown provider outcome with 202 and a definitive refusal with 200', async () => {
    harness.provider.generate.mockRejectedValueOnce(providerFailure('TIMEOUT', true));
    const uncertain = await request(app).post(mutations[1].path).set('x-test-role', 'ACCOUNTANT').send(generate).expect(202);
    expect(uncertain.body.data).toMatchObject({ outcome: 'UNCERTAIN', attempt: { open: true } });

    const attemptId = uncertain.body.data.attempt.id as string;
    await request(app)
      .post(`/tax-invoices/inv-1/eway-bill/attempts/${attemptId}/close-demo`)
      .set('x-test-role', 'ACCOUNTANT')
      .send({ expectedOutcome: 'UNCERTAIN', reason: 'Demo test; nothing real was filed' })
      .expect(200);

    harness.provider.generate.mockRejectedValueOnce(providerFailure('INVALID_REQUEST', false));
    const rejected = await request(app).post(mutations[1].path).set('x-test-role', 'ACCOUNTANT').send(generate).expect(200);
    expect(rejected.body.data).toMatchObject({ outcome: 'REJECTED', ewayBill: null });
  });

  it('links an existing bill: 201 and an UNVERIFIED_REFERENCE', async () => {
    const response = await request(app).post(mutations[3].path).set('x-test-role', 'ACCOUNTANT').send(mutations[3].body).expect(201);
    expect(response.body.data.ewayBill).toMatchObject({
      integrationMode: 'LIVE',
      source: 'EXTERNALLY_LINKED',
      verificationStatus: 'UNVERIFIED_REFERENCE',
    });
  });

  it.each([
    ['generate with mode', mutations[1].path, { ...generate, mode: 'LIVE' }],
    ['generate with test_mode', mutations[1].path, { ...generate, test_mode: false }],
    ['generate with credentials', mutations[1].path, { ...generate, gstin_username: 'u', password: 'p' }],
    ['generate without a movement version', mutations[1].path, {}],
    ['link with a TEST- number', mutations[3].path, { ewayBillNumber: 'TEST-1' }],
    ['link with a mode', mutations[3].path, { ewayBillNumber: '123456789012', integrationMode: 'DEMO' }],
    ['movement with an unknown field', mutations[0].path, { expectedVersion: 1, mode: 'LIVE' }],
    ['movement with a negative distance', mutations[0].path, { expectedVersion: 1, approximateDistanceKm: -1 }],
    ['close-demo with a short reason', '/tax-invoices/inv-1/eway-bill/attempts/a/close-demo', { expectedOutcome: 'UNCERTAIN', reason: 'no' }],
  ])('rejects %s with 400 and does nothing', async (_name, path, body) => {
    const method = path.endsWith('movement') ? 'put' : 'post';
    await request(app)[method](path).set('x-test-role', 'ACCOUNTANT').send(body).expect(400);
    expect(harness.provider.generate).not.toHaveBeenCalled();
    expect(harness.state.attempts).toHaveLength(0);
    expect(harness.state.bills).toHaveLength(0);
  });

  it('exposes no lookup, reconciliation, cancellation or Part-B route', async () => {
    const base = '/tax-invoices/inv-1/eway-bill';
    for (const [method, path] of [
      ['get', `${base}/lookup`],
      ['post', `${base}/lookup`],
      ['post', `${base}/reconcile`],
      ['post', `${base}/cancel`],
      ['post', `${base}/part-b`],
      ['delete', `${base}/link`],
      ['patch', `${base}/movement`],
      ['delete', `${base}/movement`],
      ['put', `${base}/generate`],
      ['get', `${base}/generate`],
    ] as const) {
      await request(app)[method](path).set('x-test-role', 'ACCOUNTANT').send({}).expect(404);
    }
    expect(harness.provider.generate).not.toHaveBeenCalled();
    expect(harness.provider.lookup).not.toHaveBeenCalled();
  });
});
