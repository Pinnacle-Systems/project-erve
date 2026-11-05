import { describe, expect, it } from 'vitest';
import { GstinApiEwayBillProvider } from '../../integrations/gst/gstin-api-eway-bill.provider.js';
import { createEwayBillOperationsService } from './eway-bill-operations.service.js';
import {
  NOW,
  accountant,
  admin,
  applicable,
  createHarness,
  merchandiser,
  notApplicable,
  otherAccountant,
  providerFailure,
  rejection,
  syntheticResult,
} from './test/eway-bill-operations-harness.js';
import { requestFacts } from './test/eway-bill-request-fixtures.js';

const movementBody = (over: Record<string, unknown> = {}) => ({
  expectedVersion: 1,
  transportMode: 'ROAD',
  vehicleNumber: 'tn01ab1234',
  vehicleType: 'REGULAR',
  approximateDistanceKm: 350,
  shipToArrangement: 'BILLED_PARTY',
  dispatchFromArrangement: 'SUPPLIER_REGISTERED_PREMISES',
  ...over,
});

describe('movement capture', () => {
  it('lets ADMIN and ACCOUNTANT read it and nobody else', async () => {
    const h = createHarness();
    expect((await h.service.getMovement(accountant, 'inv-1')).captured).toBe(true);
    expect((await h.service.getMovement(admin, 'inv-1')).version).toBe(1);
    expect((await rejection(h.service.getMovement(merchandiser, 'inv-1'))).statusCode).toBe(403);
  });

  it('lets only an ACCOUNTANT change it', async () => {
    const h = createHarness();
    expect((await rejection(h.service.saveMovement(admin, 'inv-1', movementBody()))).statusCode).toBe(403);
    expect((await rejection(h.service.saveMovement(merchandiser, 'inv-1', movementBody()))).statusCode).toBe(403);
    expect(h.state.audit).toHaveLength(0);
  });

  it('creates the first record from version 0 and bumps the version afterwards', async () => {
    const h = createHarness({ movement: null });
    const first = await h.service.saveMovement(accountant, 'inv-1', movementBody({ expectedVersion: 0 }));
    expect(first).toMatchObject({
      version: 1,
      captured: true,
      updatedBy: { id: 'acct-1' },
      movement: { vehicleNumber: 'TN01AB1234', approximateDistanceKm: 350 },
    });
    const second = await h.service.saveMovement(accountant, 'inv-1', movementBody({ expectedVersion: 1, approximateDistanceKm: 400 }));
    expect(second.version).toBe(2);
    expect(h.state.audit.map((entry) => entry.action)).toEqual([
      'EWAY_BILL_MOVEMENT_UPDATED',
      'EWAY_BILL_MOVEMENT_UPDATED',
    ]);
    expect(h.state.audit[1]!.metadata).toMatchObject({
      previousVersion: 1,
      version: 2,
      changes: { approximateDistanceKm: { from: 350, to: 400 } },
    });
  });

  it('rejects a stale version and reports the current one', async () => {
    const h = createHarness();
    const error = await rejection(h.service.saveMovement(accountant, 'inv-1', movementBody({ expectedVersion: 0 })));
    expect(error).toMatchObject({ statusCode: 409, code: 'STALE_VERSION', details: { currentVersion: 1 } });
    expect(h.state.movement.version).toBe(1);
  });

  it('of two concurrent saves from the same version, only one wins', async () => {
    const h = createHarness();
    const results = await Promise.allSettled([
      h.service.saveMovement(accountant, 'inv-1', movementBody({ approximateDistanceKm: 100 })),
      h.service.saveMovement(otherAccountant, 'inv-1', movementBody({ approximateDistanceKm: 200 })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(h.state.movement.version).toBe(2);
  });

  it('keeps a distance of 0 as a captured value', async () => {
    const h = createHarness({ movement: null });
    const saved = await h.service.saveMovement(accountant, 'inv-1', movementBody({ expectedVersion: 0, approximateDistanceKm: 0 }));
    expect(saved.movement.approximateDistanceKm).toBe(0);
  });

  it('accepts a partially captured movement and replaces rather than merges', async () => {
    const h = createHarness({ movement: null });
    const partial = await h.service.saveMovement(accountant, 'inv-1', { expectedVersion: 0, transportMode: 'RAIL' });
    expect(partial.movement).toMatchObject({
      transportMode: 'RAIL',
      vehicleNumber: null,
      approximateDistanceKm: null,
      shipToArrangement: null,
      dispatchFrom: null,
    });
    const replaced = await h.service.saveMovement(accountant, 'inv-1', { expectedVersion: 1, approximateDistanceKm: 5 });
    expect(replaced.movement.transportMode).toBeNull();
    expect(replaced.movement.approximateDistanceKm).toBe(5);
  });

  it('does not bump the version or write an audit row when nothing changed', async () => {
    const h = createHarness({ movement: null });
    await h.service.saveMovement(accountant, 'inv-1', movementBody({ expectedVersion: 0 }));
    const again = await h.service.saveMovement(accountant, 'inv-1', movementBody({ expectedVersion: 1 }));
    expect(again.version).toBe(1);
    expect(h.state.audit).toHaveLength(1);
  });

  it('rejects an arrangement that contradicts a captured dispatch-from address', async () => {
    const h = createHarness({ movement: null });
    const error = await rejection(
      h.service.saveMovement(
        accountant,
        'inv-1',
        movementBody({
          expectedVersion: 0,
          dispatchFromArrangement: 'SUPPLIER_REGISTERED_PREMISES',
          dispatchFrom: { addressLine1: 'Dock 4', city: 'Hosur', postalCode: '635109', stateCode: '33' },
        }),
      ),
    );
    expect(error).toMatchObject({ statusCode: 400, details: { reason: 'ARRANGEMENT_CONTRADICTS_DISPATCH_FROM' } });
  });

  it('treats an empty dispatch-from object as none', async () => {
    const h = createHarness({ movement: null });
    const saved = await h.service.saveMovement(
      accountant,
      'inv-1',
      movementBody({ expectedVersion: 0, dispatchFrom: { addressLine1: '  ', city: '' } }),
    );
    expect(saved.movement.dispatchFrom).toBeNull();
  });

  it.each(['PREPARED', 'DISPATCHED', 'UNCERTAIN'] as const)(
    'refuses a change that would invalidate an unfinished %s request',
    async (outcome) => {
      const h = createHarness();
      h.seedAttempt({ outcome });
      const error = await rejection(h.service.saveMovement(accountant, 'inv-1', movementBody({ approximateDistanceKm: 1 })));
      expect(error).toMatchObject({ statusCode: 409, details: { reason: 'EWAY_BILL_ATTEMPT_OPEN' } });
      expect(h.state.movement.version).toBe(1);
    },
  );

  it.each(['SUCCEEDED', 'REJECTED', 'CLOSED'] as const)('allows a change once the request is %s', async (outcome) => {
    const h = createHarness();
    h.seedAttempt({ outcome });
    const saved = await h.service.saveMovement(accountant, 'inv-1', movementBody({ approximateDistanceKm: 1 }));
    expect(saved.version).toBe(2);
  });

  it('refuses a change on a cancelled invoice and returns 404 for an unknown one', async () => {
    const cancelled = createHarness({ requestFacts: requestFacts({ invoice: { status: 'CANCELLED' } }) });
    expect(await rejection(cancelled.service.saveMovement(accountant, 'inv-1', movementBody()))).toMatchObject({
      statusCode: 409,
      details: { reason: 'INVOICE_CANCELLED' },
    });
    const h = createHarness();
    expect((await rejection(h.service.saveMovement(accountant, 'nope', movementBody()))).statusCode).toBe(404);
    expect((await rejection(h.service.getMovement(accountant, 'nope'))).statusCode).toBe(404);
  });
});

describe('generation preview', () => {
  it('reports a complete invoice as available, with Demo and Live status separate', async () => {
    const h = createHarness();
    const preview = await h.service.preview(accountant, 'inv-1');
    expect(preview).toMatchObject({
      taxInvoiceId: 'inv-1',
      invoiceStatus: 'FINALIZED',
      movementVersion: 1,
      acknowledgementRequired: true,
      applicability: { outcome: 'UNDETERMINED' },
      demo: { integrationMode: 'DEMO', available: true, blockers: [] },
      live: { available: false },
      request: {
        ready: true,
        blockers: [],
        classification: { transactionType: 1, shipTo: 'BILLED_PARTY', dispatchFrom: 'SUPPLIER_REGISTERED_PREMISES' },
        document: { type: 'INV', number: 'EI/26-27/0001', date: '2026-11-04' },
        itemCount: 2,
      },
    });
    expect(preview.live.blockers.map((b) => b.code)).toContain('LIVE_GENERATION_NOT_AUTHORIZED');
    expect(preview.request.assumptions.length).toBeGreaterThan(0);
  });

  it('never calls the provider and never creates an attempt or audit row', async () => {
    const h = createHarness();
    await h.service.preview(accountant, 'inv-1');
    await h.service.preview(admin, 'inv-1');
    expect(h.provider.generate).not.toHaveBeenCalled();
    expect(h.provider.lookup).not.toHaveBeenCalled();
    expect(h.state.attempts).toHaveLength(0);
    expect(h.state.audit).toHaveLength(0);
  });

  it('is readable by ADMIN and ACCOUNTANT only', async () => {
    const h = createHarness();
    expect((await rejection(h.service.preview(merchandiser, 'inv-1'))).statusCode).toBe(403);
    expect((await rejection(h.service.preview(accountant, 'nope'))).statusCode).toBe(404);
  });

  it.each([
    ['settings disabled', { settings: { ewayBillGenerationEnabled: false } }, 'EWAY_BILL_GENERATION_DISABLED'],
    ['Live mode', { settings: { integrationMode: 'LIVE' as const } }, 'EWAY_BILL_DEMO_REQUIRES_DEMO_MODE'],
    ['server not authorized', { authorized: false }, 'EWAY_BILL_DEMO_NOT_AUTHORIZED'],
    ['provider key missing', { providerConfigured: false }, 'EWAY_BILL_PROVIDER_NOT_CONFIGURED'],
  ])('reports %s as a Demo gate while the request itself stays ready', async (_name, options, code) => {
    const h = createHarness(options);
    const preview = await h.service.preview(accountant, 'inv-1');
    expect(preview.demo.available).toBe(false);
    expect(preview.demo.blockers.map((b) => b.code)).toEqual([code]);
    expect(preview.request.ready).toBe(true);
    expect(preview.live.available).toBe(false);
  });

  it('keeps Live unavailable even when the global mode is LIVE', async () => {
    const h = createHarness({ settings: { integrationMode: 'LIVE' } });
    const preview = await h.service.preview(accountant, 'inv-1');
    expect(preview.live.available).toBe(false);
    expect(preview.demo.available).toBe(false);
  });

  it('turns an unclassified arrangement into one typed blocker', async () => {
    const h = createHarness({
      movement: { ...(await createHarness().service.getMovement(accountant, 'inv-1')).movement, shipToArrangement: null },
    });
    const preview = await h.service.preview(accountant, 'inv-1');
    expect(preview.request.ready).toBe(false);
    expect(preview.request.blockers.filter((b) => b.code === 'TRANSACTION_ARRANGEMENT_NOT_CLASSIFIED')).toHaveLength(1);
    expect(preview.request.classification).toBeNull();
  });

  it('reports a missing movement without throwing', async () => {
    const h = createHarness({ movement: null });
    const preview = await h.service.preview(accountant, 'inv-1');
    expect(preview.movementVersion).toBeNull();
    expect(preview.request.blockers.map((b) => b.code)).toContain('MOVEMENT_NOT_CAPTURED');
  });

  it('returns typed blockers, not exceptions, for a legacy invoice with no snapshot data', async () => {
    const facts = requestFacts({
      invoice: { payableTotal: null, roundOffAdjustment: null },
      lines: [
        { id: 'l1', quantity: 3, hsnCode: '6109', taxableValue: '100000.000000', gstPercent: null, productName: null, productDescription: null },
      ],
    });
    const preview = await createHarness({ requestFacts: facts }).service.preview(accountant, 'inv-1');
    expect(preview.request.ready).toBe(false);
    const codes = preview.request.blockers.map((b) => b.code);
    expect(codes).toContain('ITEM_PRODUCT_NAME_MISSING');
    expect(codes).toContain('ITEM_GST_PERCENT_MISSING');
    expect(preview.demo.available).toBe(false);
  });

  it('blocks a draft invoice and never reads anything about physical dispatch', async () => {
    const h = createHarness({
      requestFacts: requestFacts({ invoice: { status: 'DRAFT', invoiceNumber: null, finalizedAt: null } }),
    });
    const preview = await h.service.preview(accountant, 'inv-1');
    expect(preview.invoiceStatus).toBe('DRAFT');
    expect(preview.request.blockers.map((b) => b.code)).toContain('INVOICE_NOT_FINALIZED');
    expect(JSON.stringify(preview)).not.toMatch(/erveDispatch|lrNumber/i);
  });

  it('surfaces the e-invoice restriction on the Live side only', async () => {
    const h = createHarness({ requestFacts: requestFacts({ invoice: { sellerEinvoiceApplicable: true } }) });
    const preview = await h.service.preview(accountant, 'inv-1');
    expect(preview.live.blockers.map((b) => b.code)).toContain('EINVOICE_ENABLED_SUPPLIER_DIRECT_GENERATION_RESTRICTED');
    expect(preview.demo.available).toBe(true);
  });

  it('reports an existing Demo bill and an open Demo attempt as separate gates', async () => {
    const withBill = createHarness();
    withBill.seedBill();
    const billPreview = await withBill.service.preview(accountant, 'inv-1');
    expect(billPreview.demo.blockers.map((b) => b.code)).toEqual(['EWAY_BILL_DEMO_BILL_EXISTS']);
    expect(billPreview.linkage.syntheticRecords.demoBill).toMatchObject({ verificationStatus: 'SYNTHETIC_DEMO' });
    expect(billPreview.linkage.satisfiesStatutoryClearance).toBe(false);

    const withAttempt = createHarness();
    withAttempt.seedAttempt({ outcome: 'UNCERTAIN' });
    expect((await withAttempt.service.preview(accountant, 'inv-1')).demo.blockers.map((b) => b.code)).toEqual([
      'EWAY_BILL_DEMO_ATTEMPT_OPEN',
    ]);
  });

  it('classifies OUTRIGHT and SALE_RETURN identically as outward sales', async () => {
    const previews = await Promise.all(
      (['OUTRIGHT', 'SALE_RETURN'] as const).map((purchaseMode) =>
        createHarness({ requestFacts: requestFacts({ invoice: { purchaseMode } }) }).service.preview(accountant, 'inv-1'),
      ),
    );
    expect(previews[0]!.request).toEqual(previews[1]!.request);
  });
});

describe('Demo generation — gates', () => {
  it('is ACCOUNTANT only and does nothing for anyone else', async () => {
    const h = createHarness();
    expect((await rejection(h.generate(admin))).statusCode).toBe(403);
    expect((await rejection(h.generate(merchandiser))).statusCode).toBe(403);
    expect(h.provider.generate).not.toHaveBeenCalled();
    expect(h.state.attempts).toHaveLength(0);
  });

  it.each([
    ['settings disabled', { settings: { ewayBillGenerationEnabled: false } }],
    ['Live integration mode', { settings: { integrationMode: 'LIVE' as const } }],
    ['server flag off', { authorized: false }],
    ['provider key missing', { providerConfigured: false }],
  ])('refuses when %s: no attempt, no provider call', async (_name, options) => {
    const h = createHarness(options);
    const error = await rejection(h.generate());
    expect(error).toMatchObject({ statusCode: 409, details: { reason: 'EWAY_BILL_GENERATION_NOT_PERMITTED' } });
    expect(h.provider.generate).not.toHaveBeenCalled();
    expect(h.state.attempts).toHaveLength(0);
  });

  it('refuses a NOT_APPLICABLE invoice', async () => {
    const h = createHarness({ applicability: notApplicable });
    const error = await rejection(h.generate());
    expect(error.statusCode).toBe(409);
    expect(JSON.stringify(error.details)).toContain('EWAY_BILL_NOT_APPLICABLE');
    expect(h.provider.generate).not.toHaveBeenCalled();
  });

  it('needs the explicit acknowledgement only while applicability is UNDETERMINED', async () => {
    const undetermined = createHarness();
    const error = await rejection(undetermined.generate(accountant, { acknowledgeApplicabilityUndetermined: false }));
    expect(error).toMatchObject({ statusCode: 400, code: 'APPLICABILITY_ACKNOWLEDGEMENT_REQUIRED' });
    expect(undetermined.state.attempts).toHaveLength(0);
    expect(undetermined.provider.generate).not.toHaveBeenCalled();

    const decided = createHarness({ applicability: applicable });
    const result = await decided.service.generateDemo(accountant, 'inv-1', { expectedMovementVersion: 1 });
    expect(result.outcome).toBe('SUCCEEDED');
  });

  it('rejects a stale movement version before persisting anything', async () => {
    const h = createHarness();
    const error = await rejection(h.generate(accountant, { expectedMovementVersion: 7 }));
    expect(error).toMatchObject({ statusCode: 409, code: 'STALE_VERSION', details: { currentVersion: 1 } });
    expect(h.state.attempts).toHaveLength(0);
  });

  it('refuses with typed blockers when the request cannot be built', async () => {
    const h = createHarness({ movement: null });
    const error = await rejection(h.service.generateDemo(accountant, 'inv-1', { expectedMovementVersion: 0, acknowledgeApplicabilityUndetermined: true }));
    expect(error.statusCode).toBe(422);
    expect(error.code).toBe('EWAY_BILL_REQUEST_NOT_READY');
    expect(JSON.stringify(error.details)).toContain('MOVEMENT_NOT_CAPTURED');
    expect(h.state.attempts).toHaveLength(0);
  });

  it.each([
    ['unknown mode field', { mode: 'LIVE' }],
    ['test_mode', { test_mode: false }],
    ['credentials', { gstin_username: 'u', password: 'p' }],
    ['integrationMode', { integrationMode: 'LIVE' }],
  ])('rejects a client-supplied %s', async (_name, extra) => {
    const h = createHarness();
    await expect(h.generate(accountant, extra)).rejects.toThrow();
    expect(h.provider.generate).not.toHaveBeenCalled();
    expect(h.state.attempts).toHaveLength(0);
  });
});

describe('Demo generation — lifecycle', () => {
  it('prepares, claims, calls the provider once and records a synthetic bill atomically', async () => {
    const h = createHarness();
    const result = await h.generate();

    expect(result.outcome).toBe('SUCCEEDED');
    expect(result.failure).toBeNull();
    expect(result.alreadyExisted).toBe(false);
    expect(result.ewayBill).toMatchObject({
      integrationMode: 'DEMO',
      source: 'PROVIDER_GENERATED',
      status: 'ACTIVE',
      verificationStatus: 'SYNTHETIC_DEMO',
      verifiedAt: null,
      ewayBillNumber: 'TEST-100000000001',
      requestAttemptId: result.attempt.id,
    });
    expect(result.attempt).toMatchObject({
      integrationMode: 'DEMO',
      outcome: 'SUCCEEDED',
      open: false,
      movementVersion: 1,
      settingsVersion: 3,
      document: { type: 'INV', number: 'EI/26-27/0001', date: '2026-11-04' },
      actor: { id: 'acct-1' },
      ewayBillId: result.ewayBill!.id,
    });
    expect(h.provider.generate).toHaveBeenCalledTimes(1);
    expect(h.state.audit.map((entry) => entry.action)).toEqual([
      'EWAY_BILL_DEMO_ATTEMPT_PREPARED',
      'EWAY_BILL_DEMO_ATTEMPT_DISPATCHED',
      'EWAY_BILL_DEMO_ATTEMPT_SUCCEEDED',
    ]);
  });

  it('sends an outward-sale, PCS, Demo-classified payload for either purchase mode', async () => {
    for (const purchaseMode of ['OUTRIGHT', 'SALE_RETURN'] as const) {
      const h = createHarness({ requestFacts: requestFacts({ invoice: { purchaseMode } }) });
      await h.generate();
      const payload = h.provider.generate.mock.calls[0]![0];
      expect(payload).toMatchObject({ supplyType: 'O', docType: 'INV', docNo: 'EI/26-27/0001', transactionType: 1 });
      expect(payload.itemList.every((item) => item.qtyUnit === 'PCS')).toBe(true);
    }
  });

  it('classifies a different consignee and dispatch place from the captured arrangement', async () => {
    const base = (await createHarness().service.getMovement(accountant, 'inv-1')).movement;
    const h = createHarness({
      movement: {
        ...base,
        shipToArrangement: 'BILLED_PARTY',
        dispatchFromArrangement: 'DIFFERENT_PLACE',
        dispatchFrom: { addressLine1: 'Dock 4', addressLine2: null, city: 'Hosur', state: 'Tamil Nadu', stateCode: '33', postalCode: '635109' },
      },
    });
    await h.generate();
    expect(h.provider.generate.mock.calls[0]![0].transactionType).toBe(3);
  });

  it('never issues a second request for an invoice that already has a Demo bill', async () => {
    const h = createHarness();
    await h.generate();
    const error = await rejection(h.generate());
    expect(error).toMatchObject({ statusCode: 409, details: { reason: 'EWAY_BILL_GENERATION_NOT_PERMITTED' } });
    expect(JSON.stringify(error.details)).toContain('EWAY_BILL_DEMO_BILL_EXISTS');
    expect(h.provider.generate).toHaveBeenCalledTimes(1);
    expect(h.state.bills).toHaveLength(1);
  });

  it('serializes concurrent duplicate submissions: exactly one provider call and one bill', async () => {
    const h = createHarness();
    h.provider.generate.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return syntheticResult();
    });
    const results = await Promise.allSettled([h.generate(), h.generate(), h.generate(accountant)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(2);
    expect(h.provider.generate).toHaveBeenCalledTimes(1);
    expect(h.state.bills).toHaveLength(1);
    expect(h.state.attempts).toHaveLength(1);
    expect(h.stats.maxConcurrentLockHolders).toBe(1);
  });

  it('does not hold the invoice lock while the provider call is in flight', async () => {
    const h = createHarness();
    let duringCall: Promise<unknown> | null = null;
    h.provider.generate.mockImplementation(async () => {
      // A read-only preview needs no lock, and a movement write must not be
      // starved by a slow provider: it is rejected (open attempt), not hung.
      duringCall = h.service.saveMovement(accountant, 'inv-1', movementBody({ approximateDistanceKm: 9 }));
      await duringCall.catch(() => undefined);
      return syntheticResult();
    });
    const result = await h.generate();
    expect(result.outcome).toBe('SUCCEEDED');
    await expect(duringCall).rejects.toMatchObject({ statusCode: 409, details: { reason: 'EWAY_BILL_ATTEMPT_OPEN' } });
  });

  it('records a definitive rejection as REJECTED and then allows a corrected request', async () => {
    const h = createHarness();
    h.provider.generate.mockRejectedValueOnce(providerFailure('INVALID_REQUEST', false));
    const rejected = await h.generate();
    expect(rejected).toMatchObject({
      outcome: 'REJECTED',
      ewayBill: null,
      failure: { code: 'INVALID_REQUEST', message: 'The provider rejected the request as invalid.' },
      attempt: { outcome: 'REJECTED', open: false, failureCode: 'INVALID_REQUEST', completedAt: NOW.toISOString() },
    });
    expect(h.state.bills).toHaveLength(0);

    const retry = await h.generate();
    expect(retry.outcome).toBe('SUCCEEDED');
    expect(h.provider.generate).toHaveBeenCalledTimes(2);
  });

  it.each(['TIMEOUT', 'NETWORK', 'UNAVAILABLE', 'UNEXPECTED_RESPONSE', 'NOT_SYNTHETIC_RESPONSE'] as const)(
    'keeps the attempt open as UNCERTAIN after %s and never retries',
    async (code) => {
      const h = createHarness();
      h.provider.generate.mockRejectedValueOnce(providerFailure(code, true));
      const result = await h.generate();
      expect(result).toMatchObject({
        outcome: 'UNCERTAIN',
        ewayBill: null,
        failure: { code },
        attempt: { outcome: 'UNCERTAIN', open: true, requiresReview: true, failureCode: code },
      });
      expect(h.provider.generate).toHaveBeenCalledTimes(1);
      expect(h.state.bills).toHaveLength(0);

      const again = await rejection(h.generate());
      expect(again.statusCode).toBe(409);
      expect(JSON.stringify(again.details)).toContain('EWAY_BILL_DEMO_ATTEMPT_OPEN');
      expect(h.provider.generate).toHaveBeenCalledTimes(1);
    },
  );

  it('treats an unknown error from the provider as UNCERTAIN, never as a rejection', async () => {
    const h = createHarness();
    h.provider.generate.mockRejectedValueOnce(new Error('boom: raw provider detail'));
    const result = await h.generate();
    expect(result).toMatchObject({ outcome: 'UNCERTAIN', failure: { code: 'RESULT_NOT_RECORDED' } });
    expect(JSON.stringify(result)).not.toContain('raw provider detail');
  });

  it('treats a result that is not marked synthetic as UNCERTAIN', async () => {
    const h = createHarness();
    h.provider.generate.mockResolvedValueOnce({ ...syntheticResult(), synthetic: false } as never);
    expect((await h.generate()).outcome).toBe('UNCERTAIN');
    expect(h.state.bills).toHaveLength(0);
  });

  it('keeps the attempt UNCERTAIN when the result cannot be persisted after dispatch', async () => {
    const h = createHarness();
    h.faults.createDemoBill = new Error('database went away');
    const result = await h.generate();
    expect(result).toMatchObject({
      outcome: 'UNCERTAIN',
      ewayBill: null,
      failure: { code: 'RESULT_NOT_RECORDED' },
      attempt: { outcome: 'UNCERTAIN', open: true },
    });
    // The failed transaction rolled back: no bill, and nothing is SUCCEEDED.
    expect(h.state.bills).toHaveLength(0);
    expect(h.state.attempts.map((a) => a.outcome)).toEqual(['UNCERTAIN']);
    h.faults.createDemoBill = undefined;
    expect((await rejection(h.generate())).statusCode).toBe(409);
    expect(h.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('leaves the attempt DISPATCHED (still open) and says so when even the failure cannot be recorded', async () => {
    const h = createHarness();
    h.provider.generate.mockRejectedValueOnce(providerFailure('TIMEOUT', true));
    h.faults.transitionTo = { UNCERTAIN: new Error('database went away') };
    const error = await rejection(h.generate());
    expect(error).toMatchObject({ statusCode: 502, code: 'EWAY_BILL_OUTCOME_UNRECORDED' });
    expect(h.state.attempts.map((a) => a.outcome)).toEqual(['DISPATCHED']);
    h.faults.transitionTo = undefined;
    expect((await rejection(h.generate())).statusCode).toBe(409);
    expect(h.provider.generate).toHaveBeenCalledTimes(1);
  });

  it('never releases a stalled DISPATCHED attempt on its own, however much time passes', async () => {
    const h = createHarness();
    h.seedAttempt({
      outcome: 'DISPATCHED',
      dispatchedAt: new Date(NOW.getTime() - 60_000),
      reviewAfter: new Date(NOW.getTime() + 60_000),
    });
    expect((await rejection(h.generate())).statusCode).toBe(409);
    h.advance(30 * 24 * 3_600_000);
    const preview = await h.service.preview(accountant, 'inv-1');
    expect(preview.demo.blockers.map((b) => b.code)).toEqual(['EWAY_BILL_DEMO_ATTEMPT_OPEN']);
    expect((await rejection(h.generate())).statusCode).toBe(409);
    expect(h.provider.generate).not.toHaveBeenCalled();
    expect(h.state.attempts.map((a) => a.outcome)).toEqual(['DISPATCHED']);
    const history = await h.service.history(accountant, 'inv-1');
    expect(history.attempts[0]).toMatchObject({ outcome: 'DISPATCHED', open: true, requiresReview: true });
  });

  it('flags a DISPATCHED attempt for review only after its review time', async () => {
    const h = createHarness();
    h.seedAttempt({ outcome: 'DISPATCHED', reviewAfter: new Date(NOW.getTime() + 60_000) });
    expect((await h.service.history(accountant, 'inv-1')).attempts[0]!.requiresReview).toBe(false);
    h.advance(61_000);
    expect((await h.service.history(accountant, 'inv-1')).attempts[0]!.requiresReview).toBe(true);
  });

  it('records already_existed as a synthetic Demo bill, never a statutory association', async () => {
    const h = createHarness();
    h.provider.generate.mockResolvedValueOnce(syntheticResult({ alreadyExisted: true }));
    const result = await h.generate();
    expect(result).toMatchObject({
      outcome: 'SUCCEEDED',
      alreadyExisted: true,
      ewayBill: { integrationMode: 'DEMO', verificationStatus: 'SYNTHETIC_DEMO' },
    });
    expect(h.state.audit.at(-1)!.metadata).toMatchObject({ alreadyExisted: true, synthetic: true });
    const preview = await h.service.preview(accountant, 'inv-1');
    expect(preview.linkage).toMatchObject({
      state: 'NONE',
      ewayBill: null,
      satisfiesStatutoryClearance: false,
      syntheticRecords: { activeDemoBills: 1 },
    });
  });

  it('stores a repeated synthetic number without it being treated as a duplicate', async () => {
    const first = createHarness();
    const second = createHarness();
    const a = await first.generate();
    const b = await second.generate();
    expect(a.ewayBill!.ewayBillNumber).toBe(b.ewayBill!.ewayBillNumber);
    expect(a.ewayBill!.integrationMode).toBe('DEMO');
  });

  it('rejects, without sending, a request that changes between prepare and claim', async () => {
    const h = createHarness();
    // Settings are turned off by someone else right after the attempt is prepared.
    const original = h.repository.withInvoiceLock.bind(h.repository);
    let calls = 0;
    h.repository.withInvoiceLock = async (id, work) => {
      const result = await original(id, work);
      calls += 1;
      if (calls === 1) h.state.settings.ewayBillGenerationEnabled = false;
      return result;
    };
    const error = await rejection(h.generate());
    expect(error).toMatchObject({ statusCode: 409, details: { reason: 'EWAY_BILL_REQUEST_CHANGED' } });
    expect(error.message).toContain('Nothing was sent');
    expect(h.provider.generate).not.toHaveBeenCalled();
    expect(h.state.attempts.map((a) => [a.outcome, a.failureCode])).toEqual([['REJECTED', 'CLAIM_REVALIDATION_FAILED']]);
  });

  it('does not let a Live reference on the invoice block or satisfy Demo generation', async () => {
    const h = createHarness();
    await h.service.linkExisting(accountant, 'inv-1', { ewayBillNumber: '123456789012' });
    const result = await h.generate();
    expect(result.outcome).toBe('SUCCEEDED');
    expect(h.state.bills.map((b) => [b.integrationMode, b.verificationStatus])).toEqual([
      ['LIVE', 'UNVERIFIED_REFERENCE'],
      ['DEMO', 'SYNTHETIC_DEMO'],
    ]);
  });

  it('sends test_mode=true through the real adapter and no Live endpoint', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(
        JSON.stringify({ success: true, ewaybill_no: 'TEST-100000000009', billed_to: 'test', doc_no: 'EI/26-27/0001' }),
        { status: 200 },
      );
    }) as typeof fetch;
    const h = createHarness();
    const service = createEwayBillOperationsService({
      repository: h.repository,
      provider: new GstinApiEwayBillProvider({ apiKey: 'k', timeoutMs: 1000 }, fetcher),
      config: { demoGenerationAuthorized: () => true, providerConfigured: () => true, providerTimeoutMs: 1000 },
      now: () => NOW,
    });
    const result = await service.generateDemo(accountant, 'inv-1', {
      expectedMovementVersion: 1,
      acknowledgeApplicabilityUndetermined: true,
    });
    expect(result.outcome).toBe('SUCCEEDED');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://www.gstinapi.in/v1/ewaybill');
    expect(calls[0]!.body.test_mode).toBe(true);
  });
});

describe('closing a Demo attempt by hand', () => {
  const close = (h: ReturnType<typeof createHarness>, attemptId: string, over: Record<string, unknown> = {}, actor = accountant) =>
    h.service.closeDemoAttempt(actor, 'inv-1', attemptId, {
      expectedOutcome: 'UNCERTAIN',
      reason: 'Provider confirmed nothing was filed',
      ...over,
    });

  it('closes an UNCERTAIN attempt with actor, time and reason, calls no provider, and frees the invoice', async () => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome: 'UNCERTAIN' });
    const closed = await close(h, attempt.id);
    expect(closed.attempt).toMatchObject({
      outcome: 'CLOSED',
      open: false,
      requiresReview: false,
      completedAt: NOW.toISOString(),
      resolution: { by: { id: 'acct-1' }, at: NOW.toISOString(), reason: 'Provider confirmed nothing was filed' },
    });
    expect(h.state.audit.at(-1)).toMatchObject({
      action: 'EWAY_BILL_DEMO_ATTEMPT_CLOSED',
      actorId: 'acct-1',
      metadata: { attemptId: attempt.id, previousOutcome: 'UNCERTAIN', reason: 'Provider confirmed nothing was filed' },
    });
    expect(h.provider.generate).not.toHaveBeenCalled();
    expect(h.provider.lookup).not.toHaveBeenCalled();
    expect(h.state.bills).toHaveLength(0);
    expect((await h.generate()).outcome).toBe('SUCCEEDED');
  });

  it('is ACCOUNTANT only', async () => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome: 'UNCERTAIN' });
    expect((await rejection(close(h, attempt.id, {}, admin))).statusCode).toBe(403);
    expect(h.state.attempts[0]!.outcome).toBe('UNCERTAIN');
  });

  it('requires a real reason', async () => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome: 'UNCERTAIN' });
    await expect(close(h, attempt.id, { reason: 'ok' })).rejects.toThrow();
    await expect(close(h, attempt.id, { reason: '           ' })).rejects.toThrow();
    expect(h.state.attempts[0]!.outcome).toBe('UNCERTAIN');
  });

  it('rejects a close based on an outcome the attempt no longer has', async () => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome: 'SUCCEEDED' });
    const error = await rejection(close(h, attempt.id));
    expect(error).toMatchObject({ statusCode: 409, details: { reason: 'ATTEMPT_OUTCOME_CHANGED', currentOutcome: 'SUCCEEDED' } });
  });

  it.each(['SUCCEEDED', 'REJECTED', 'CLOSED'] as const)('cannot close an attempt that is already %s', async (outcome) => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome });
    await expect(close(h, attempt.id, { expectedOutcome: outcome })).rejects.toThrow();
    expect(h.state.attempts[0]!.outcome).toBe(outcome);
  });

  it('will not close a DISPATCHED attempt before its review time, then will', async () => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome: 'DISPATCHED', reviewAfter: new Date(NOW.getTime() + 120_000) });
    const early = await rejection(close(h, attempt.id, { expectedOutcome: 'DISPATCHED' }));
    expect(early).toMatchObject({ statusCode: 409, details: { reason: 'ATTEMPT_STILL_IN_PROGRESS' } });
    expect(h.state.attempts[0]!.outcome).toBe('DISPATCHED');
    h.advance(121_000);
    const closed = await close(h, attempt.id, { expectedOutcome: 'DISPATCHED' });
    expect(closed.attempt.outcome).toBe('CLOSED');
  });

  it('will not close a PREPARED attempt before its review time', async () => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome: 'PREPARED', reviewAfter: new Date(NOW.getTime() + 60_000) });
    expect((await rejection(close(h, attempt.id, { expectedOutcome: 'PREPARED' }))).statusCode).toBe(409);
  });

  it('never closes a LIVE attempt and leaves it untouched', async () => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome: 'UNCERTAIN', integrationMode: 'LIVE' });
    const error = await rejection(close(h, attempt.id));
    expect(error).toMatchObject({ statusCode: 409, details: { reason: 'LIVE_ATTEMPT_NOT_CLOSABLE' } });
    expect(h.state.attempts[0]!.outcome).toBe('UNCERTAIN');
  });

  it('returns 404 for an unknown attempt or one on another invoice', async () => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome: 'UNCERTAIN', taxInvoiceId: 'inv-other' });
    expect((await rejection(close(h, 'missing'))).statusCode).toBe(404);
    expect((await rejection(close(h, attempt.id))).statusCode).toBe(404);
    expect(h.state.attempts[0]!.outcome).toBe('UNCERTAIN');
  });

  it('of two concurrent closes, exactly one succeeds', async () => {
    const h = createHarness();
    const attempt = h.seedAttempt({ outcome: 'UNCERTAIN' });
    const results = await Promise.allSettled([close(h, attempt.id), close(h, attempt.id, {}, otherAccountant)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(h.state.audit.filter((entry) => entry.action === 'EWAY_BILL_DEMO_ATTEMPT_CLOSED')).toHaveLength(1);
  });

  it('never alters a Live bill or any bill', async () => {
    const h = createHarness();
    const live = h.seedBill({ integrationMode: 'LIVE', source: 'EXTERNALLY_LINKED', verificationStatus: 'UNVERIFIED_REFERENCE', ewayBillNumber: '123456789012' });
    const attempt = h.seedAttempt({ outcome: 'UNCERTAIN' });
    const before = structuredClone(h.state.bills);
    await close(h, attempt.id);
    expect(h.state.bills).toEqual(before);
    expect(h.state.bills[0]!.id).toBe(live.id);
  });
});

describe('linking an existing bill', () => {
  const link = (h: ReturnType<typeof createHarness>, body: unknown = { ewayBillNumber: '123456789012' }, actor = accountant) =>
    h.service.linkExisting(actor, 'inv-1', body);

  it('records an unverified LIVE reference with forced mode and source, and calls no provider', async () => {
    const h = createHarness();
    const { ewayBill } = await link(h);
    expect(ewayBill).toMatchObject({
      integrationMode: 'LIVE',
      source: 'EXTERNALLY_LINKED',
      status: 'ACTIVE',
      verificationStatus: 'UNVERIFIED_REFERENCE',
      verifiedAt: null,
      ewayBillNumber: '123456789012',
      requestAttemptId: null,
      createdBy: { id: 'acct-1' },
    });
    expect(h.state.audit.at(-1)).toMatchObject({
      action: 'EWAY_BILL_REFERENCE_LINKED',
      actorId: 'acct-1',
      metadata: { verificationStatus: 'UNVERIFIED_REFERENCE', integrationMode: 'LIVE' },
    });
    expect(h.provider.generate).not.toHaveBeenCalled();
    expect(h.provider.lookup).not.toHaveBeenCalled();
  });

  it('reports the invoice as LINKED_UNVERIFIED, distinct from generated, verified and unresolved states', async () => {
    const h = createHarness();
    await link(h);
    const { linkage, request } = await h.service.preview(accountant, 'inv-1');
    expect(linkage).toMatchObject({
      state: 'LINKED_UNVERIFIED',
      ewayBill: null,
      satisfiesStatutoryClearance: false,
      unverifiedReference: { verificationStatus: 'UNVERIFIED_REFERENCE', ewayBillNumber: '123456789012' },
    });
    expect(request.ready).toBe(true);
  });

  it('is available independently of the Demo-generation setting, server flag, key and mode', async () => {
    for (const options of [
      { settings: { ewayBillGenerationEnabled: false } },
      { settings: { integrationMode: 'LIVE' as const } },
      { authorized: false },
      { providerConfigured: false },
    ]) {
      const h = createHarness(options);
      expect((await link(h)).ewayBill.verificationStatus).toBe('UNVERIFIED_REFERENCE');
    }
  });

  it('is ACCOUNTANT only', async () => {
    const h = createHarness();
    expect((await rejection(link(h, undefined, admin))).statusCode).toBe(403);
    expect((await rejection(link(h, undefined, merchandiser))).statusCode).toBe(403);
    expect(h.state.bills).toHaveLength(0);
  });

  it.each([
    ['a synthetic TEST- reference', { ewayBillNumber: 'TEST-100000000001' }],
    ['a lowercase test- reference', { ewayBillNumber: 'test-1' }],
    ['too few digits', { ewayBillNumber: '12345678901' }],
    ['too many digits', { ewayBillNumber: '1234567890123' }],
    ['letters', { ewayBillNumber: '12345678901A' }],
    ['no number', {}],
    ['a client-supplied mode', { ewayBillNumber: '123456789012', integrationMode: 'DEMO' }],
    ['a client-supplied verification status', { ewayBillNumber: '123456789012', verificationStatus: 'PROVIDER_VERIFIED' }],
    ['a client-supplied source', { ewayBillNumber: '123456789012', source: 'PROVIDER_GENERATED' }],
    ['a test_mode flag', { ewayBillNumber: '123456789012', test_mode: true }],
  ])('rejects %s', async (_name, body) => {
    const h = createHarness();
    await expect(link(h, body)).rejects.toThrow();
    expect(h.state.bills).toHaveLength(0);
  });

  it('rejects a second live bill on the invoice and a number already recorded', async () => {
    const h = createHarness();
    await link(h);
    expect(await rejection(link(h, { ewayBillNumber: '999988887777' }))).toMatchObject({
      statusCode: 409,
      details: { reason: 'EWAY_BILL_ALREADY_ASSOCIATED' },
    });
    const other = createHarness();
    other.seedBill({ integrationMode: 'LIVE', status: 'CANCELLED', verificationStatus: 'UNVERIFIED_REFERENCE', source: 'EXTERNALLY_LINKED', ewayBillNumber: '123456789012' });
    expect(await rejection(link(other))).toMatchObject({
      statusCode: 409,
      details: { reason: 'EWAY_BILL_NUMBER_ALREADY_RECORDED' },
    });
  });

  it('is refused for a draft or cancelled invoice and while a live attempt is unreconciled', async () => {
    const draft = createHarness({ requestFacts: requestFacts({ invoice: { status: 'DRAFT', invoiceNumber: null, finalizedAt: null } }) });
    expect(await rejection(link(draft))).toMatchObject({ statusCode: 409, details: { reason: 'INVOICE_NOT_FINALIZED' } });
    const cancelled = createHarness({ requestFacts: requestFacts({ invoice: { status: 'CANCELLED' } }) });
    expect(await rejection(link(cancelled))).toMatchObject({ statusCode: 409, details: { reason: 'INVOICE_CANCELLED' } });
    const pending = createHarness();
    pending.seedAttempt({ outcome: 'UNCERTAIN', integrationMode: 'LIVE' });
    expect(await rejection(link(pending))).toMatchObject({ statusCode: 409, details: { reason: 'UNRECONCILED_ATTEMPT_PENDING' } });
    expect((await rejection(h404())).statusCode).toBe(404);
    function h404() {
      return createHarness().service.linkExisting(accountant, 'nope', { ewayBillNumber: '123456789012' });
    }
  });

  it('keeps Demo and Live strictly separate: a Demo bill neither blocks nor is replaced by a link', async () => {
    const h = createHarness();
    await h.generate();
    await link(h);
    const { linkage } = await h.service.preview(accountant, 'inv-1');
    expect(linkage.state).toBe('LINKED_UNVERIFIED');
    expect(linkage.syntheticRecords.demoBill).toMatchObject({ integrationMode: 'DEMO' });
    expect(h.state.bills.map((b) => b.integrationMode).sort()).toEqual(['DEMO', 'LIVE']);
  });
});

describe('history and information safety', () => {
  it('returns attempts newest first, bills and audit events to ADMIN and ACCOUNTANT only', async () => {
    const h = createHarness();
    h.provider.generate.mockRejectedValueOnce(providerFailure('TIMEOUT', true));
    const uncertain = await h.generate();
    await h.service.closeDemoAttempt(accountant, 'inv-1', uncertain.attempt.id, {
      expectedOutcome: 'UNCERTAIN',
      reason: 'Demo only; nothing real was filed',
    });
    await h.generate();

    for (const actor of [accountant, admin]) {
      const history = await h.service.history(actor, 'inv-1');
      expect(history.attempts.map((a) => a.outcome)).toEqual(['SUCCEEDED', 'CLOSED']);
      expect(history.ewayBills).toHaveLength(1);
      expect(history.events.map((e) => e.action)).toContain('EWAY_BILL_DEMO_ATTEMPT_CLOSED');
    }
    expect((await rejection(h.service.history(merchandiser, 'inv-1'))).statusCode).toBe(403);
    expect((await rejection(h.service.history(accountant, 'nope'))).statusCode).toBe(404);
  });

  it('never exposes the payload, the request fingerprint, credentials or provider text', async () => {
    const h = createHarness();
    h.provider.generate.mockRejectedValueOnce(
      Object.assign(providerFailure('UNEXPECTED_RESPONSE', true), { providerBody: 'SECRET-RAW-PROVIDER-BODY' }),
    );
    const failed = await h.generate();
    await h.generate().catch(() => undefined);
    const preview = await h.service.preview(accountant, 'inv-1');
    const history = await h.service.history(accountant, 'inv-1');
    const everything = JSON.stringify({ failed, preview, history, audit: h.state.audit });
    expect(everything).not.toContain('SECRET-RAW-PROVIDER-BODY');
    expect(everything).not.toMatch(/[0-9a-f]{64}/); // no request fingerprint
    expect(everything).not.toContain(h.state.attempts[0]!.requestFingerprint);
    expect(everything).not.toMatch(/password|api[_-]?key|gstin_username|x-api-key/i);
    expect(everything).not.toContain('33ABCDE1234F1Z5'); // the supplier GSTIN is payload data
  });
});
