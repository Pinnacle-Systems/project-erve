import { describe, expect, it } from 'vitest';
import {
  evaluateEwayBillReadiness,
  type EwayBillApplicabilityEvaluator,
  type EwayBillFacts,
} from './eway-bill-eligibility.js';
import { completeMovement, finalizedFacts } from './test/eway-bill-fixtures.js';

const NOW = () => new Date('2026-11-05T00:00:00.000Z');
const evaluate = (facts: EwayBillFacts, applicability?: EwayBillApplicabilityEvaluator) =>
  evaluateEwayBillReadiness(facts, { now: NOW, applicability });
const codes = (facts: EwayBillFacts) => evaluate(facts).readiness.blockers.map((b) => b.code);

describe('invoice status gates', () => {
  it('reports a DRAFT invoice as NOT_EVALUATED with an explicit blocker', () => {
    const result = evaluate(finalizedFacts({ invoice: { status: 'DRAFT', invoiceNumber: null, finalizedAt: null } }));
    expect(result.applicability.outcome).toBe('NOT_EVALUATED');
    expect(result.readiness.outcome).toBe('NOT_READY');
    expect(result.readiness.blockers.map((b) => b.code)).toEqual(['INVOICE_NOT_FINALIZED']);
  });

  it('blocks a CANCELLED invoice explicitly and does not call it exempt', () => {
    const result = evaluate(finalizedFacts({ invoice: { status: 'CANCELLED' } }));
    expect(result.applicability.outcome).toBe('NOT_EVALUATED');
    expect(result.applicability.outcome).not.toBe('NOT_APPLICABLE');
    expect(result.applicability.reasons[0]?.code).toBe('INVOICE_CANCELLED');
    expect(result.readiness.outcome).toBe('NOT_READY');
    expect(result.readiness.blockers.map((b) => b.code)).toEqual(['INVOICE_CANCELLED']);
  });

  it('never consults the applicability evaluator for a draft or cancelled invoice', () => {
    let calls = 0;
    const spy: EwayBillApplicabilityEvaluator = () => {
      calls += 1;
      return { outcome: 'NOT_APPLICABLE', reasons: [], ruleSetVersion: 'x' };
    };
    evaluate(finalizedFacts({ invoice: { status: 'DRAFT' } }), spy);
    evaluate(finalizedFacts({ invoice: { status: 'CANCELLED' } }), spy);
    expect(calls).toBe(0);
  });

  it('flags a live bill still attached to a cancelled invoice for review', () => {
    const result = evaluate(
      finalizedFacts({
        invoice: { status: 'CANCELLED' },
        bills: [
          { id: 'b1', source: 'PROVIDER_GENERATED', status: 'ACTIVE', integrationMode: 'LIVE', ewayBillNumber: '111122223333', generatedAt: null, validUntil: null },
        ],
      }),
    );
    expect(result.reviewFlags.map((f) => f.code)).toEqual(['LIVE_EWAY_BILL_ON_CANCELLED_INVOICE']);
    expect(result.linkage.state).toBe('GENERATED');
  });
});

describe('applicability', () => {
  it('is UNDETERMINED for a finalized invoice when no verified rule set exists', () => {
    const result = evaluate(finalizedFacts());
    expect(result.applicability).toMatchObject({
      outcome: 'UNDETERMINED',
      ruleSetVersion: null,
      reasons: [{ code: 'STATUTORY_RULES_NOT_CONFIGURED' }],
    });
  });

  it.each(['APPLICABLE', 'NOT_APPLICABLE', 'UNDETERMINED'] as const)(
    'passes through an injected %s decision without affecting readiness',
    (outcome) => {
      const result = evaluate(finalizedFacts(), () => ({ outcome, reasons: [{ code: 'R', message: 'm' }], ruleSetVersion: 'v1' }));
      expect(result.applicability).toMatchObject({ outcome, ruleSetVersion: 'v1' });
      expect(result.readiness.outcome).toBe('READY');
    },
  );
});

describe('readiness', () => {
  it('is READY for complete data but always declares partially verified requirements', () => {
    const result = evaluate(finalizedFacts());
    expect(result.readiness.outcome).toBe('READY');
    expect(result.readiness.blockers).toEqual([]);
    expect(result.readiness.requirementsVerification).toBe('PARTIAL');
    expect(result.readiness.unverifiedRequirements.map((r) => r.code)).toContain('STATUTORY_APPLICABILITY');
    expect(result.evaluatedAt).toBe('2026-11-05T00:00:00.000Z');
  });

  it('advertises that generation and external linking are not available in B1', () => {
    const result = evaluate(finalizedFacts({ settings: { ewayBillGenerationEnabled: true } }));
    expect(result.capabilities).toEqual({
      providerGenerationEnabled: true,
      providerGenerationAvailable: false,
      externalLinkAvailable: false,
    });
  });

  describe('movement', () => {
    it('requires movement information to be captured', () => {
      expect(codes(finalizedFacts({ movement: null }))).toEqual(['MOVEMENT_NOT_CAPTURED']);
    });

    it('requires a distance, accepts 0 and rejects negatives', () => {
      expect(codes(finalizedFacts({ movement: completeMovement({ approximateDistanceKm: null }) }))).toEqual(['MOVEMENT_DISTANCE_MISSING']);
      expect(codes(finalizedFacts({ movement: completeMovement({ approximateDistanceKm: 0 }) }))).toEqual([]);
      expect(codes(finalizedFacts({ movement: completeMovement({ approximateDistanceKm: -1 }) }))).toEqual(['MOVEMENT_DISTANCE_INVALID']);
    });

    it('requires a vehicle number for road transport', () => {
      expect(codes(finalizedFacts({ movement: completeMovement({ vehicleNumber: '  ' }) }))).toEqual(['MOVEMENT_VEHICLE_NUMBER_REQUIRED']);
    });

    it.each(['RAIL', 'AIR', 'SHIP'] as const)('requires a transport document for %s, not a vehicle', (transportMode) => {
      const base = { transportMode, vehicleNumber: null };
      expect(codes(finalizedFacts({ movement: completeMovement(base) }))).toEqual(['MOVEMENT_TRANSPORT_DOCUMENT_REQUIRED']);
      expect(codes(finalizedFacts({ movement: completeMovement({ ...base, transportDocumentNumber: 'LR-1' }) }))).toEqual([]);
    });

    it('rejects a transport document dated before the invoice (business date)', () => {
      expect(codes(finalizedFacts({ movement: completeMovement({ transportDocumentDate: '2026-11-03' }) }))).toEqual([
        'MOVEMENT_TRANSPORT_DOCUMENT_DATE_BEFORE_DOCUMENT_DATE',
      ]);
      expect(codes(finalizedFacts({ movement: completeMovement({ transportDocumentDate: '2026-11-04' }) }))).toEqual([]);
    });

    it('uses the IST business date of the invoice, not the UTC date', () => {
      // 2026-11-03T20:00Z is already 2026-11-04 in IST.
      const facts = finalizedFacts({
        invoice: { finalizedAt: new Date('2026-11-03T20:00:00.000Z') },
        movement: completeMovement({ transportDocumentDate: '2026-11-03' }),
      });
      expect(codes(facts)).toEqual(['MOVEMENT_TRANSPORT_DOCUMENT_DATE_BEFORE_DOCUMENT_DATE']);
    });

    it('validates a dispatch-from override but defaults to the seller address', () => {
      expect(
        codes(finalizedFacts({ movement: completeMovement({ dispatchFrom: { addressLine1: 'x', addressLine2: null, city: 'c', state: 's', stateCode: '3', postalCode: '12' } }) })).sort(),
      ).toEqual(['DISPATCH_FROM_POSTAL_CODE_INVALID', 'DISPATCH_FROM_STATE_CODE_INVALID']);
      expect(codes(finalizedFacts({ invoice: { seller: { gstin: '33ABCDE1234F1Z5', stateCode: '33', postalCode: null } } }))).toEqual(['DISPATCH_FROM_POSTAL_CODE_INVALID']);
    });
  });

  describe('parties and conditional GST information', () => {
    it('requires a recipient GSTIN, but accepts the explicit unregistered marker', () => {
      const withBillTo = (gstin: string | null) =>
        finalizedFacts({ invoice: { billTo: { gstin, stateCode: '29', postalCode: '560001' } } });
      expect(codes(withBillTo(null))).toEqual(['RECIPIENT_GSTIN_MISSING']);
      expect(codes(withBillTo('  '))).toEqual(['RECIPIENT_GSTIN_MISSING']);
      expect(codes(withBillTo('NOT-A-GSTIN'))).toEqual(['RECIPIENT_GSTIN_INVALID']);
      expect(codes(withBillTo('urp'))).toEqual([]);
    });

    it('never accepts the unregistered marker for the supplier', () => {
      const facts = finalizedFacts({ invoice: { seller: { gstin: 'URP', stateCode: '33', postalCode: '600001' } } });
      expect(codes(facts)).toEqual(['SUPPLIER_GSTIN_INVALID']);
    });

    it('requires the tax components that match the invoice GST treatment', () => {
      const intra = (cgst: string | null, sgst: string | null) =>
        finalizedFacts({ invoice: { gstTreatment: 'INTRA', totalCgst: cgst, totalSgst: sgst, totalIgst: null } });
      expect(codes(intra('2500', '2500'))).toEqual([]);
      expect(codes(intra('2500', null))).toEqual(['CGST_SGST_TOTALS_MISSING']);
      expect(codes(finalizedFacts({ invoice: { gstTreatment: 'INTER', totalIgst: null } }))).toEqual(['IGST_TOTAL_MISSING']);
      expect(codes(finalizedFacts({ invoice: { gstTreatment: null } }))).toEqual(['GST_TREATMENT_MISSING']);
    });

    it('resolves the ship-to state only by exact canonical name', () => {
      const shipTo = (state: string | null, postalCode: string | null = '560002') =>
        finalizedFacts({ invoice: { shipTo: { state, postalCode } } });
      expect(codes(shipTo('  karnataka '))).toEqual([]);
      expect(codes(shipTo('Karnatka'))).toEqual(['SHIP_TO_STATE_UNRESOLVED']);
      expect(codes(shipTo(null))).toEqual(['SHIP_TO_STATE_MISSING']);
      expect(codes(shipTo('Karnataka', '56000'))).toEqual(['SHIP_TO_POSTAL_CODE_INVALID']);
    });

    it('requires recipient state code and pincode', () => {
      const facts = finalizedFacts({ invoice: { billTo: { gstin: '29ABCDE1234F1Z5', stateCode: null, postalCode: null } } });
      expect(codes(facts).sort()).toEqual(['RECIPIENT_POSTAL_CODE_INVALID', 'RECIPIENT_STATE_CODE_INVALID']);
    });
  });

  describe('document and items', () => {
    it('validates the document number and date', () => {
      expect(codes(finalizedFacts({ invoice: { invoiceNumber: 'EI/26-27/0001' } }))).toEqual([]);
      expect(codes(finalizedFacts({ invoice: { invoiceNumber: 'EI/26-27/00000001X' } }))).toEqual(['DOCUMENT_NUMBER_INVALID']);
      expect(codes(finalizedFacts({ invoice: { invoiceNumber: 'EI 26 0001' } }))).toEqual(['DOCUMENT_NUMBER_INVALID']);
      expect(codes(finalizedFacts({ invoice: { invoiceNumber: null } }))).toEqual(['DOCUMENT_NUMBER_INVALID']);
      expect(codes(finalizedFacts({ invoice: { finalizedAt: null } }))).toEqual(['DOCUMENT_DATE_MISSING']);
    });

    it('reports line-level gaps with the affected line ids', () => {
      const result = evaluate(
        finalizedFacts({
          lines: [
            { id: 'ok', quantity: 1, hsnCode: '6109', taxableValue: '10' },
            { id: 'no-hsn', quantity: 1, hsnCode: null, taxableValue: '10' },
            { id: 'no-value', quantity: 1, hsnCode: '6109', taxableValue: null },
          ],
        }),
      );
      expect(result.readiness.blockers).toEqual([
        expect.objectContaining({ code: 'ITEM_HSN_MISSING', lineIds: ['no-hsn'] }),
        expect.objectContaining({ code: 'ITEM_TAXABLE_VALUE_MISSING', lineIds: ['no-value'] }),
      ]);
    });

    it('requires at least one item', () => {
      expect(codes(finalizedFacts({ lines: [] }))).toEqual(['ITEMS_MISSING']);
    });
  });

  it('preserves legacy finalized invoices with incomplete snapshots: reports gaps and never throws', () => {
    const legacy = finalizedFacts({
      invoice: {
        subtotal: null,
        totalCgst: null,
        totalSgst: null,
        totalIgst: null,
        gstTreatment: null,
        billTo: { gstin: '29ABCDE1234F1Z5', stateCode: null, postalCode: null },
        shipTo: { state: null, postalCode: null },
      },
      lines: [{ id: 'l1', quantity: 3, hsnCode: null, taxableValue: null }],
      movement: null,
    });
    const before = structuredClone(legacy);
    const result = evaluate(legacy);
    expect(result.readiness.outcome).toBe('NOT_READY');
    expect(result.readiness.blockers.length).toBeGreaterThan(5);
    expect(result.invoiceStatus).toBe('FINALIZED');
    expect(legacy).toEqual(before); // facts are never mutated
  });
});

describe('linkage and DEMO/LIVE separation', () => {
  const bill = (over: Partial<EwayBillFacts['bills'][number]> = {}): EwayBillFacts['bills'][number] => ({
    id: 'b1',
    source: 'PROVIDER_GENERATED',
    status: 'ACTIVE',
    integrationMode: 'LIVE',
    ewayBillNumber: '111122223333',
    generatedAt: new Date('2026-11-04T07:00:00.000Z'),
    validUntil: new Date('2026-11-05T23:59:00.000Z'),
    ...over,
  });

  it.each([
    ['PROVIDER_GENERATED', 'GENERATED'],
    ['EXTERNALLY_LINKED', 'LINKED_EXTERNAL'],
  ] as const)('reports an active LIVE %s bill as %s and blocks a new request', (source, state) => {
    const result = evaluate(finalizedFacts({ bills: [bill({ source })] }));
    expect(result.linkage.state).toBe(state);
    expect(result.linkage.ewayBill).toMatchObject({ ewayBillNumber: '111122223333', integrationMode: 'LIVE' });
    expect(result.readiness.blockers.map((b) => b.code)).toEqual(['EWAY_BILL_ALREADY_ASSOCIATED']);
  });

  it('does not let an active DEMO bill satisfy or block a LIVE bill', () => {
    const result = evaluate(finalizedFacts({ bills: [bill({ integrationMode: 'DEMO', ewayBillNumber: 'TEST-1' })] }));
    expect(result.linkage.state).toBe('NONE');
    expect(result.linkage.ewayBill).toBeNull();
    expect(result.linkage.syntheticRecords).toEqual({ activeDemoBills: 1, openDemoAttempts: 0 });
    expect(result.readiness.outcome).toBe('READY');
  });

  it('ignores cancelled bills', () => {
    const result = evaluate(finalizedFacts({ bills: [bill({ status: 'CANCELLED' })] }));
    expect(result.linkage.state).toBe('NONE');
    expect(result.readiness.outcome).toBe('READY');
  });

  it.each(['PREPARED', 'DISPATCHED', 'UNCERTAIN'] as const)('blocks on an open LIVE %s attempt', (outcome) => {
    const result = evaluate(finalizedFacts({ attempts: [{ id: 'a1', integrationMode: 'LIVE', outcome }] }));
    expect(result.linkage.state).toBe('UNRECONCILED_ATTEMPT');
    expect(result.readiness.blockers.map((b) => b.code)).toEqual(['UNRECONCILED_ATTEMPT_PENDING']);
  });

  it.each(['SUCCEEDED', 'REJECTED'] as const)('does not block on a finished LIVE %s attempt', (outcome) => {
    const result = evaluate(finalizedFacts({ attempts: [{ id: 'a1', integrationMode: 'LIVE', outcome }] }));
    expect(result.linkage.state).toBe('NONE');
    expect(result.readiness.outcome).toBe('READY');
  });

  it('counts an open DEMO attempt as synthetic without blocking a LIVE request', () => {
    const result = evaluate(finalizedFacts({ attempts: [{ id: 'a1', integrationMode: 'DEMO', outcome: 'UNCERTAIN' }] }));
    expect(result.linkage.state).toBe('NONE');
    expect(result.linkage.syntheticRecords.openDemoAttempts).toBe(1);
    expect(result.readiness.outcome).toBe('READY');
  });
});
