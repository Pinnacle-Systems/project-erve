import { describe, expect, it } from 'vitest';
import type { EwayBillRequestPreparation } from './eway-bill-request.mapper.js';
import { prepareEwayBillRequest } from './eway-bill-request.mapper.js';
import { toPaiseHalfUp } from './eway-bill-money.js';
import { completeMovement } from './test/eway-bill-fixtures.js';
import { requestFacts } from './test/eway-bill-request-fixtures.js';

const now = () => new Date('2026-11-05T00:00:00.000Z');
const prepare = (facts = requestFacts()) => prepareEwayBillRequest(facts, { now });

function ready(result: EwayBillRequestPreparation) {
  if (!result.ok) throw new Error(`expected ready, got blockers: ${result.blockers.map((b) => b.code).join(', ')}`);
  return result;
}
function blocked(result: EwayBillRequestPreparation) {
  if (result.ok) throw new Error('expected blockers');
  return result;
}
const codes = (result: EwayBillRequestPreparation) =>
  result.ok ? [] : result.blockers.map((entry) => entry.code);

describe('toPaiseHalfUp', () => {
  it('rounds half up on the exact decimal string', () => {
    expect(toPaiseHalfUp('1.005')).toBe(101n);
    expect(toPaiseHalfUp('1.0049999')).toBe(100n);
    expect(toPaiseHalfUp('-1.005')).toBe(-101n);
    expect(toPaiseHalfUp('60000.000000')).toBe(6_000_000n);
    expect(toPaiseHalfUp('5')).toBe(500n);
    expect(toPaiseHalfUp('0.1')).toBe(10n);
  });
  it('rejects non-decimal text', () => {
    expect(toPaiseHalfUp('')).toBeNull();
    expect(toPaiseHalfUp('1e3')).toBeNull();
    expect(toPaiseHalfUp('12,5')).toBeNull();
  });
});

describe('prepareEwayBillRequest — happy path', () => {
  it('maps a finalized inter-state OUTRIGHT invoice to the NIC outward-sale request', () => {
    const { payload, document, classification } = ready(prepare());
    expect(document).toEqual({ type: 'INV', number: 'EI/26-27/0001', date: '2026-11-04' });
    expect(classification.transactionType).toBe(1);
    expect(payload).toMatchObject({
      supplyType: 'O',
      subSupplyType: '1',
      docType: 'INV',
      docNo: 'EI/26-27/0001',
      docDate: '04/11/2026',
      fromGstin: '33ABCDE1234F1Z5',
      fromTrdName: 'Erve India',
      fromAddr1: '1 Mount Road',
      fromAddr2: 'Anna Salai',
      fromPlace: 'Chennai',
      fromPincode: 600001,
      actFromStateCode: 33,
      fromStateCode: 33,
      toGstin: '29ABCDE1234F1Z5',
      toTrdName: 'Bengaluru Distributor LLP',
      toAddr1: '22 Brigade Road',
      toPlace: 'Bengaluru',
      toPincode: 560001,
      actToStateCode: 29,
      toStateCode: 29,
      transactionType: 1,
      totalValue: 100000,
      cgstValue: 0,
      sgstValue: 0,
      igstValue: 5000,
      otherValue: 0,
      totInvValue: 105000,
      transMode: '1',
      transDistance: '350',
      vehicleNo: 'TN01AB1234',
      vehicleType: 'R',
    });
    expect(payload.toAddr2).toBeUndefined();
    expect(payload.itemList).toEqual([
      {
        productName: 'Round Neck Tee',
        productDesc: 'Cotton jersey',
        hsnCode: 6109,
        quantity: 10,
        qtyUnit: 'PCS',
        cgstRate: 0,
        sgstRate: 0,
        igstRate: 5,
        cessRate: 0,
        cessNonadvol: 0,
        taxableAmount: 60000,
      },
      expect.objectContaining({ productName: 'Polo Tee', qtyUnit: 'PCS', taxableAmount: 40000 }),
    ]);
    expect(payload.itemList[1]).not.toHaveProperty('productDesc');
  });

  it('splits the rate for an intra-state invoice', () => {
    const facts = requestFacts({
      invoice: {
        gstTreatment: 'INTRA',
        totalCgst: '2500.00000000000',
        totalSgst: '2500.00000000000',
        totalIgst: null,
      },
    });
    const { payload } = ready(prepare(facts));
    expect(payload).toMatchObject({ cgstValue: 2500, sgstValue: 2500, igstValue: 0, totInvValue: 105000 });
    expect(payload.itemList.map((item) => [item.cgstRate, item.sgstRate, item.igstRate])).toEqual([
      [2.5, 2.5, 0],
      [2.5, 2.5, 0],
    ]);
  });

  it('carries a negative round-off as a negative otherValue', () => {
    const facts = requestFacts({ invoice: { payableTotal: '104999.00', roundOffAdjustment: '-1.00' } });
    expect(ready(prepare(facts)).payload).toMatchObject({ otherValue: -1, totInvValue: 104999 });
  });

  it('has a stable fingerprint that changes with the payload and carries no credentials', () => {
    const first = ready(prepare());
    const second = ready(prepare());
    expect(first.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(second.fingerprint).toBe(first.fingerprint);
    const changed = ready(
      prepare(requestFacts({ movement: completeMovement({ approximateDistanceKm: 351 }) })),
    );
    expect(changed.fingerprint).not.toBe(first.fingerprint);
    const serialized = JSON.stringify(first.payload);
    expect(serialized).not.toMatch(/test_mode|password|gstin_username|x-api-key/i);
  });

  it('always reports the unverified mappings it applied', () => {
    const result = ready(prepare());
    expect(result.assumptions.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['OUTWARD_SALE_CODES', 'TRANSACTION_TYPE_INFERRED_FROM_LOCATIONS', 'VALUATION_BASIS']),
    );
  });
});

describe('prepareEwayBillRequest — purchase mode and transaction type', () => {
  it('classifies SALE_RETURN exactly like OUTRIGHT (an outward sale, not a statutory sales return)', () => {
    const outright = ready(prepare(requestFacts({ invoice: { purchaseMode: 'OUTRIGHT' } })));
    const saleReturn = ready(prepare(requestFacts({ invoice: { purchaseMode: 'SALE_RETURN' } })));
    expect(saleReturn.payload).toEqual(outright.payload);
    expect(saleReturn.fingerprint).toBe(outright.fingerprint);
    expect(saleReturn.payload).toMatchObject({ supplyType: 'O', subSupplyType: '1', docType: 'INV' });
    expect(codes(prepare(requestFacts({ invoice: { purchaseMode: 'SALE_RETURN', invoiceNumber: null } })))).not.toContain(
      'SALE_RETURN_MAPPING_UNDECIDED',
    );
  });

  it('derives type 2 when the delivery location differs from the bill-to location', () => {
    const facts = requestFacts({
      invoice: {
        shipTo: { addressLine1: 'Plot 4', addressLine2: null, city: 'Mysuru', state: 'Karnataka', postalCode: '570001' },
      },
    });
    const result = ready(prepare(facts));
    expect(result.classification).toEqual({
      transactionType: 2,
      shipToDiffersFromBillTo: true,
      dispatchFromDiffersFromSupplier: false,
    });
    expect(result.payload).toMatchObject({ transactionType: 2, toPincode: 570001, toStateCode: 29, actToStateCode: 29 });
  });

  it('derives type 3 from a different dispatch-from and uses it as a whole unit', () => {
    const movement = completeMovement({
      dispatchFrom: {
        addressLine1: '9 Industrial Estate',
        addressLine2: null,
        city: 'Tiruppur',
        state: 'Tamil Nadu',
        stateCode: '33',
        postalCode: '641604',
      },
    });
    const result = ready(prepare(requestFacts({ movement })));
    expect(result.classification.transactionType).toBe(3);
    expect(result.payload).toMatchObject({
      fromAddr1: '9 Industrial Estate',
      fromPlace: 'Tiruppur',
      fromPincode: 641604,
      actFromStateCode: 33,
      fromStateCode: 33,
    });
    expect(result.payload.fromAddr2).toBeUndefined();
  });

  it('derives type 4 when both the delivery and dispatch locations differ, with the supplier registration state kept in fromStateCode', () => {
    const movement = completeMovement({
      dispatchFrom: {
        addressLine1: '1 Hosur Road',
        addressLine2: null,
        city: 'Bengaluru',
        state: null,
        stateCode: '29',
        postalCode: '560100',
      },
    });
    const facts = requestFacts({
      movement,
      invoice: {
        shipTo: { addressLine1: 'Dock 2', addressLine2: null, city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      },
    });
    const result = ready(prepare(facts));
    expect(result.classification.transactionType).toBe(4);
    expect(result.payload).toMatchObject({ fromStateCode: 33, actFromStateCode: 29, toStateCode: 29, actToStateCode: 32 });
  });

  it('blocks an incomplete dispatch-from instead of mixing it with the supplier address', () => {
    const movement = completeMovement({
      dispatchFrom: { addressLine1: null, addressLine2: null, city: null, state: null, stateCode: null, postalCode: '641604' },
    });
    const result = blocked(prepare(requestFacts({ movement })));
    const entry = result.blockers.find((item) => item.code === 'DISPATCH_FROM_INCOMPLETE');
    expect(entry?.message).toContain('addressLine1, city, stateCode');
  });
});

describe('prepareEwayBillRequest — fail closed', () => {
  it.each(['DRAFT', 'CANCELLED'] as const)('does not prepare a %s invoice', (status) => {
    const result = blocked(prepare(requestFacts({ invoice: { status } })));
    expect(result.blockers.map((entry) => entry.code)).toEqual([
      status === 'DRAFT' ? 'INVOICE_NOT_FINALIZED' : 'INVOICE_CANCELLED',
    ]);
  });

  it('reuses the B1 readiness blockers (e.g. missing movement)', () => {
    expect(codes(prepare(requestFacts({ movement: null })))).toContain('MOVEMENT_NOT_CAPTURED');
  });

  it('blocks a legacy invoice with no payable total and no snapshot descriptions', () => {
    const facts = requestFacts({
      invoice: { payableTotal: null, roundOffAdjustment: null },
      lines: [
        { id: 'l1', quantity: 1, hsnCode: '6109', taxableValue: '100000.000000', gstPercent: '5.00', productName: null, productDescription: null },
      ],
    });
    const result = blocked(prepare(facts));
    expect(result.blockers.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['ITEM_PRODUCT_NAME_MISSING', 'PAYABLE_TOTAL_MISSING', 'ROUND_OFF_ADJUSTMENT_MISSING']),
    );
    expect(result.blockers.find((entry) => entry.code === 'ITEM_PRODUCT_NAME_MISSING')?.lineIds).toEqual(['l1']);
  });

  it('blocks when rounded lines drift more than a paisa from the taxable total', () => {
    expect(codes(prepare(requestFacts({ invoice: { subtotal: '100001.000000' } })))).toContain(
      'VALUATION_ROUNDING_MISMATCH',
    );
  });

  it('tolerates a one-paisa rounding difference', () => {
    const facts = requestFacts({
      invoice: { subtotal: '100000.014000' },
    });
    expect(prepare(facts).ok).toBe(true);
  });

  it('blocks when the payable total does not reconcile with the stored round-off', () => {
    expect(codes(prepare(requestFacts({ invoice: { roundOffAdjustment: '5.00' } })))).toContain(
      'VALUATION_ROUND_OFF_MISMATCH',
    );
  });

  it('blocks malformed HSN, quantity and GST percentage per line', () => {
    const facts = requestFacts({
      lines: [
        { id: 'a', quantity: 1, hsnCode: '61', taxableValue: '100000.000000', gstPercent: '5.00', productName: 'X', productDescription: null },
        { id: 'b', quantity: 0, hsnCode: '6109', taxableValue: '0.000000', gstPercent: null, productName: 'Y', productDescription: null },
      ],
    });
    const result = blocked(prepare(facts));
    const byCode = (code: string) => result.blockers.find((entry) => entry.code === code);
    expect(byCode('ITEM_HSN_FORMAT_INVALID')?.lineIds).toEqual(['a']);
    expect(byCode('ITEM_QUANTITY_INVALID')?.lineIds).toEqual(['b']);
    expect(byCode('ITEM_GST_PERCENT_MISSING')?.lineIds).toEqual(['b']);
  });

  it('requires a vehicle type for road transport and never defaults it', () => {
    const facts = requestFacts({ movement: completeMovement({ vehicleType: null }) });
    expect(codes(prepare(facts))).toContain('MOVEMENT_VEHICLE_TYPE_REQUIRED');
  });

  it('rejects an invalid transporter ID', () => {
    const facts = requestFacts({ movement: completeMovement({ transporterId: 'NOT-A-GSTIN' }) });
    expect(codes(prepare(facts))).toContain('MOVEMENT_TRANSPORTER_ID_INVALID');
  });
});

describe('prepareEwayBillRequest — transport and optional data', () => {
  it('maps non-road modes without vehicle fields and formats the transport document date', () => {
    const movement = completeMovement({
      transportMode: 'RAIL',
      vehicleNumber: 'TN01AB1234',
      vehicleType: 'REGULAR',
      transportDocumentNumber: 'RR-778',
      transportDocumentDate: '2026-11-05',
      transporterName: 'Southern Railway',
    });
    const { payload } = ready(prepare(requestFacts({ movement })));
    expect(payload).toMatchObject({ transMode: '2', transDocNo: 'RR-778', transDocDate: '05/11/2026', transporterName: 'Southern Railway' });
    expect(payload).not.toHaveProperty('vehicleNo');
    expect(payload).not.toHaveProperty('vehicleType');
  });

  it('normalises the vehicle number and accepts a zero distance', () => {
    const movement = completeMovement({ vehicleNumber: ' tn 01-ab 1234 ', approximateDistanceKm: 0 });
    const { payload } = ready(prepare(requestFacts({ movement })));
    expect(payload).toMatchObject({ vehicleNo: 'TN01AB1234', transDistance: '0' });
  });

  it('omits an empty ship-to address instead of inventing one, and warns', () => {
    const facts = requestFacts({
      invoice: {
        shipTo: { addressLine1: null, addressLine2: null, city: null, state: 'Karnataka', postalCode: '560001' },
      },
    });
    const result = ready(prepare(facts));
    expect(result.payload).not.toHaveProperty('toAddr1');
    expect(result.payload).not.toHaveProperty('toPlace');
    expect(result.warnings.map((entry) => entry.code)).toContain('TO_ADDRESS_PARTIAL');
  });

  it('warns, without blocking, about an old document and a GSTIN / state-code mismatch', () => {
    const facts = requestFacts({ invoice: { billTo: { name: 'X', gstin: '27ABCDE1234F1Z5', stateCode: '29', postalCode: '560001' } } });
    const old = prepareEwayBillRequest(facts, { now: () => new Date('2027-06-01T00:00:00.000Z') });
    const result = ready(old);
    expect(result.warnings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['DOCUMENT_OLDER_THAN_180_DAYS', 'RECIPIENT_STATE_CODE_GSTIN_MISMATCH']),
    );
  });

  it('keeps URP as the recipient GSTIN for an unregistered recipient', () => {
    const facts = requestFacts({ invoice: { billTo: { name: 'Walk-in', gstin: 'urp', stateCode: '29', postalCode: '560001' } } });
    expect(ready(prepare(facts)).payload.toGstin).toBe('URP');
  });
});
