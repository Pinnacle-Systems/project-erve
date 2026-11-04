import { describe, expect, it } from 'vitest';
import type { EwayBillRequestPreparation } from './eway-bill-request.mapper.js';
import { isLiveGenerationPermitted, prepareEwayBillRequest } from './eway-bill-request.mapper.js';
import { toPaiseHalfUp } from './eway-bill-money.js';
import { completeMovement } from './test/eway-bill-fixtures.js';
import { requestFacts } from './test/eway-bill-request-fixtures.js';

const now = () => new Date('2026-11-05T00:00:00.000Z');
const prepare = (facts = requestFacts(), at: () => Date = now) => prepareEwayBillRequest(facts, { now: at });

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

const lineOf = (overrides: Partial<ReturnType<typeof requestFacts>['lines'][number]> = {}) => ({
  id: 'l1',
  quantity: 1,
  hsnCode: '6109',
  taxableValue: '100000.000000',
  gstPercent: '5.00',
  productName: 'Tee',
  productDescription: null,
  ...overrides,
});

const differentPlace = (overrides: Partial<NonNullable<NonNullable<ReturnType<typeof completeMovement>['dispatchFrom']>>> = {}) =>
  completeMovement({
    dispatchFrom: {
      addressLine1: '9 Industrial Estate',
      addressLine2: null,
      city: 'Tiruppur',
      state: 'Tamil Nadu',
      stateCode: '33',
      postalCode: '641604',
      ...overrides,
    },
  });

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
    expect(classification).toEqual({
      transactionType: 1,
      shipTo: 'BILLED_PARTY',
      dispatchFrom: 'SUPPLIER_REGISTERED_PREMISES',
    });
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
        billTo: { name: 'Chennai Distributor', gstin: '33ABCDE1234F1Z5', stateCode: '33', postalCode: '600002' },
        shipTo: { addressLine1: '3 Anna Nagar', addressLine2: null, city: 'Chennai', state: 'Tamil Nadu', postalCode: '600002' },
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
    expect(JSON.stringify(first.payload)).not.toMatch(/test_mode|password|gstin_username|x-api-key/i);
  });

  it('reports only the genuinely unresolved mappings, not those NIC has confirmed', () => {
    const reported = ready(prepare()).assumptions.map((entry) => entry.code);
    expect(reported).toEqual(
      expect.arrayContaining(['SUB_SUPPLY_TYPE_CODE', 'TRANSACTION_TYPE_CODES', 'VALUATION_BASIS', 'DISTANCE_PIN_TOLERANCE']),
    );
    expect(reported).not.toContain('WIRE_VALUE_TYPES');
    expect(reported).not.toContain('OUTWARD_SALE_CODES');
    expect(reported).not.toContain('ROAD_VEHICLE_TYPE_REQUIRED');
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

  it('derives type 2 for a different consignee shipped from the supplier premises', () => {
    const facts = requestFacts({
      arrangement: { shipTo: 'DIFFERENT_PARTY', dispatchFrom: 'SUPPLIER_REGISTERED_PREMISES' },
      invoice: {
        shipTo: { addressLine1: 'Plot 4', addressLine2: null, city: 'Mysuru', state: 'Karnataka', postalCode: '570001' },
      },
    });
    const result = ready(prepare(facts));
    expect(result.classification.transactionType).toBe(2);
    expect(result.payload).toMatchObject({ transactionType: 2, toPincode: 570001, toStateCode: 29, actToStateCode: 29 });
  });

  it('derives type 3 for the billed party shipped from a different place, using that address as a whole unit', () => {
    const facts = requestFacts({
      arrangement: { shipTo: 'BILLED_PARTY', dispatchFrom: 'DIFFERENT_PLACE' },
      movement: differentPlace(),
    });
    const result = ready(prepare(facts));
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

  it('derives type 4 for a different consignee shipped from a different place, keeping the supplier registration state', () => {
    const facts = requestFacts({
      arrangement: { shipTo: 'DIFFERENT_PARTY', dispatchFrom: 'DIFFERENT_PLACE' },
      movement: differentPlace({ addressLine1: '1 Hosur Road', city: 'Bengaluru', state: null, stateCode: '29', postalCode: '560100' }),
      invoice: {
        shipTo: { addressLine1: 'Dock 2', addressLine2: null, city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      },
    });
    const result = ready(prepare(facts));
    expect(result.classification.transactionType).toBe(4);
    expect(result.payload).toMatchObject({ fromStateCode: 33, actFromStateCode: 29, toStateCode: 29, actToStateCode: 32 });
  });

  it('does not infer a different party from a different delivery location', () => {
    // Same party, same state, another pincode: still a regular transaction.
    const facts = requestFacts({
      invoice: {
        shipTo: { addressLine1: 'Plot 4', addressLine2: null, city: 'Bengaluru', state: 'Karnataka', postalCode: '560100' },
      },
    });
    expect(ready(prepare(facts)).classification.transactionType).toBe(1);
  });

  it('does not infer a regular transaction from matching locations when a different party is declared', () => {
    const facts = requestFacts({ arrangement: { shipTo: 'DIFFERENT_PARTY', dispatchFrom: 'SUPPLIER_REGISTERED_PREMISES' } });
    expect(ready(prepare(facts)).classification.transactionType).toBe(2);
  });

  it('blocks when the arrangement has not been classified', () => {
    const result = blocked(prepare(requestFacts({ arrangement: null })));
    expect(result.blockers.map((entry) => entry.code)).toEqual(['TRANSACTION_ARRANGEMENT_NOT_CLASSIFIED']);
  });

  it('blocks an ambiguous arrangement: billed party declared but delivery is in another state', () => {
    const facts = requestFacts({
      invoice: {
        shipTo: { addressLine1: 'Dock 2', addressLine2: null, city: 'Kochi', state: 'Kerala', postalCode: '682001' },
      },
    });
    expect(codes(prepare(facts))).toContain('TRANSACTION_ARRANGEMENT_AMBIGUOUS');
  });

  it('blocks a dispatch arrangement that the captured data contradicts or cannot support', () => {
    expect(
      codes(prepare(requestFacts({ arrangement: { shipTo: 'BILLED_PARTY', dispatchFrom: 'DIFFERENT_PLACE' } }))),
    ).toContain('DISPATCH_FROM_ARRANGEMENT_UNSUPPORTED');
    expect(codes(prepare(requestFacts({ movement: differentPlace() })))).toContain(
      'DISPATCH_FROM_ARRANGEMENT_CONTRADICTED',
    );
  });

  it('blocks an incomplete dispatch-from instead of mixing it with the supplier address', () => {
    const movement = completeMovement({
      dispatchFrom: { addressLine1: null, addressLine2: null, city: null, state: null, stateCode: null, postalCode: '641604' },
    });
    const facts = requestFacts({ movement, arrangement: { shipTo: 'BILLED_PARTY', dispatchFrom: 'DIFFERENT_PLACE' } });
    const entry = blocked(prepare(facts)).blockers.find((item) => item.code === 'DISPATCH_FROM_INCOMPLETE');
    expect(entry?.message).toContain('addressLine1, city, stateCode');
  });
});

describe('prepareEwayBillRequest — mandatory addresses and places', () => {
  it('blocks a missing ship-to address line and place instead of omitting them', () => {
    const facts = requestFacts({
      invoice: { shipTo: { addressLine1: null, addressLine2: null, city: null, state: 'Karnataka', postalCode: '560001' } },
    });
    expect(codes(prepare(facts))).toEqual(
      expect.arrayContaining(['RECIPIENT_ADDRESS_LINE1_MISSING', 'RECIPIENT_PLACE_MISSING']),
    );
  });

  it('blocks a missing supplier address line and place', () => {
    const base = requestFacts();
    const facts = requestFacts({
      invoice: { seller: { ...base.invoice.seller, addressLine1: '  ', city: null } },
    });
    expect(codes(prepare(facts))).toEqual(
      expect.arrayContaining(['SUPPLIER_ADDRESS_LINE1_MISSING', 'SUPPLIER_PLACE_MISSING']),
    );
  });

  it('keeps address line 2 optional', () => {
    const base = requestFacts();
    const facts = requestFacts({ invoice: { seller: { ...base.invoice.seller, addressLine2: null } } });
    expect(ready(prepare(facts)).payload.fromAddr2).toBeUndefined();
  });

  it('reports over-long fields instead of truncating them', () => {
    const base = requestFacts();
    const facts = requestFacts({
      invoice: {
        seller: { ...base.invoice.seller, addressLine1: 'x'.repeat(121), city: 'y'.repeat(51) },
      },
    });
    const result = blocked(prepare(facts));
    expect(result.blockers.filter((entry) => entry.code === 'FIELD_TOO_LONG').map((entry) => entry.field)).toEqual(
      expect.arrayContaining(['supplier.addressLine1', 'supplier.place']),
    );
  });

  it('rejects pincodes outside the NIC range', () => {
    const facts = requestFacts({
      invoice: { shipTo: { addressLine1: 'A', addressLine2: null, city: 'B', state: 'Karnataka', postalCode: '060001' } },
    });
    expect(codes(prepare(facts))).toContain('RECIPIENT_PINCODE_OUT_OF_RANGE');
  });
});

describe('prepareEwayBillRequest — NIC validations', () => {
  it('blocks a document older than 180 days but allows exactly 180', () => {
    const exactly180 = prepare(requestFacts(), () => new Date('2027-05-03T00:00:00.000Z'));
    expect(exactly180.ok).toBe(true);
    const day181 = blocked(prepare(requestFacts(), () => new Date('2027-05-04T00:00:00.000Z')));
    expect(day181.blockers.map((entry) => entry.code)).toContain('DOCUMENT_TOO_OLD');
  });

  it('blocks a document dated in the future', () => {
    expect(codes(prepare(requestFacts(), () => new Date('2026-11-03T00:00:00.000Z')))).toContain(
      'DOCUMENT_DATE_IN_FUTURE',
    );
  });

  it('enforces the distance ceiling of 4000 km and accepts exactly 4000', () => {
    expect(
      prepare(requestFacts({ movement: completeMovement({ approximateDistanceKm: 4000 }) })).ok,
    ).toBe(true);
    expect(codes(prepare(requestFacts({ movement: completeMovement({ approximateDistanceKm: 4001 }) })))).toContain(
      'MOVEMENT_DISTANCE_EXCEEDS_MAXIMUM',
    );
  });

  it('caps the distance at 100 km when dispatch and delivery pincodes are the same', () => {
    const sameLocation = (km: number) =>
      requestFacts({
        arrangement: { shipTo: 'DIFFERENT_PARTY', dispatchFrom: 'SUPPLIER_REGISTERED_PREMISES' },
        movement: completeMovement({ approximateDistanceKm: km }),
        invoice: {
          shipTo: { addressLine1: 'Dock', addressLine2: null, city: 'Chennai', state: 'Tamil Nadu', postalCode: '600001' },
        },
      });
    expect(prepare(sameLocation(100)).ok).toBe(true);
    expect(codes(prepare(sameLocation(101)))).toContain('MOVEMENT_DISTANCE_EXCEEDS_SAME_PINCODE_LIMIT');
  });

  it('allows at most 250 items and never splits automatically', () => {
    const many = (count: number) =>
      requestFacts({ lines: Array.from({ length: count }, (_, index) => lineOf({ id: `l${index}`, taxableValue: '0.000000' })) });
    expect(codes(prepare(many(251)))).toContain('ITEMS_EXCEED_MAXIMUM');
    expect(codes(prepare(many(250)))).not.toContain('ITEMS_EXCEED_MAXIMUM');
  });

  it('blocks services-only invoices but allows services alongside goods', () => {
    const servicesOnly = requestFacts({ lines: [lineOf({ hsnCode: '9983' })] });
    expect(codes(prepare(servicesOnly))).toContain('ITEMS_SERVICES_ONLY');
    const mixed = requestFacts({
      invoice: { subtotal: '200000.000000', totalIgst: '10000.00', payableTotal: '210000.00' },
      lines: [lineOf({ hsnCode: '9983' }), lineOf({ id: 'l2' })],
    });
    expect(codes(prepare(mixed))).not.toContain('ITEMS_SERVICES_ONLY');
  });

  it('blocks an HSN code with a leading zero because NIC takes a number', () => {
    expect(codes(prepare(requestFacts({ lines: [lineOf({ hsnCode: '0101' })] })))).toContain('ITEM_HSN_LEADING_ZERO');
  });

  it('requires intra-state tax between same-state parties and IGST between different states', () => {
    // Fixture is Tamil Nadu -> Karnataka invoiced INTRA.
    expect(
      codes(prepare(requestFacts({ invoice: { gstTreatment: 'INTRA', totalCgst: '2500.00', totalSgst: '2500.00' } }))),
    ).toContain('GST_TREATMENT_STATE_MISMATCH');
    const sameStateInter = requestFacts({
      invoice: {
        billTo: { name: 'Chennai Distributor', gstin: '33ABCDE1234F1Z5', stateCode: '33', postalCode: '600002' },
        shipTo: { addressLine1: 'Dock', addressLine2: null, city: 'Chennai', state: 'Tamil Nadu', postalCode: '600002' },
      },
    });
    expect(codes(prepare(sameStateInter))).toContain('GST_TREATMENT_STATE_MISMATCH');
  });

  it('applies the vehicle, transport-document and transporter rules', () => {
    expect(codes(prepare(requestFacts({ movement: completeMovement({ vehicleType: null }) })))).toContain(
      'MOVEMENT_VEHICLE_TYPE_REQUIRED',
    );
    expect(codes(prepare(requestFacts({ movement: completeMovement({ vehicleNumber: 'AB' }) })))).toContain(
      'MOVEMENT_VEHICLE_NUMBER_INVALID',
    );
    expect(
      codes(prepare(requestFacts({ movement: completeMovement({ transportDocumentNumber: '1234567890123456' }) }))),
    ).toContain('MOVEMENT_TRANSPORT_DOCUMENT_INVALID');
    expect(codes(prepare(requestFacts({ movement: completeMovement({ transporterId: '1234' }) })))).toContain(
      'MOVEMENT_TRANSPORTER_ID_INVALID',
    );
    // A TRANSIN-style ID is not a structurally valid GSTIN but is a valid NIC transporter ID.
    expect(
      prepare(requestFacts({ movement: completeMovement({ transporterId: '33zzzzz99999999' }) })).ok,
    ).toBe(true);
  });

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
    expect(ready(prepare(requestFacts({ movement }))).payload).toMatchObject({ vehicleNo: 'TN01AB1234', transDistance: '0' });
  });
});

describe('prepareEwayBillRequest — fail closed on data', () => {
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
      lines: [lineOf({ productName: null })],
    });
    const result = blocked(prepare(facts));
    expect(result.blockers.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['ITEM_PRODUCT_NAME_MISSING', 'PAYABLE_TOTAL_MISSING', 'ROUND_OFF_ADJUSTMENT_MISSING']),
    );
    expect(result.blockers.find((entry) => entry.code === 'ITEM_PRODUCT_NAME_MISSING')?.lineIds).toEqual(['l1']);
  });

  it('blocks when rounded lines drift more than a paisa from the taxable total, and tolerates one paisa', () => {
    expect(codes(prepare(requestFacts({ invoice: { subtotal: '100001.000000' } })))).toContain(
      'VALUATION_ROUNDING_MISMATCH',
    );
    expect(prepare(requestFacts({ invoice: { subtotal: '100000.014000' } })).ok).toBe(true);
  });

  it('blocks when the payable total does not reconcile with the stored round-off', () => {
    expect(codes(prepare(requestFacts({ invoice: { roundOffAdjustment: '5.00' } })))).toContain(
      'VALUATION_ROUND_OFF_MISMATCH',
    );
  });

  it('blocks malformed HSN, quantity and GST percentage per line', () => {
    const facts = requestFacts({
      lines: [
        lineOf({ id: 'a', hsnCode: '61' }),
        lineOf({ id: 'b', quantity: 0, taxableValue: '0.000000', gstPercent: null }),
      ],
    });
    const result = blocked(prepare(facts));
    const byCode = (code: string) => result.blockers.find((entry) => entry.code === code);
    expect(byCode('ITEM_HSN_FORMAT_INVALID')?.lineIds).toEqual(['a']);
    expect(byCode('ITEM_QUANTITY_INVALID')?.lineIds).toEqual(['b']);
    expect(byCode('ITEM_GST_PERCENT_MISSING')?.lineIds).toEqual(['b']);
  });

  it('warns, without blocking, about a GSTIN / state-code mismatch', () => {
    const facts = requestFacts({ invoice: { billTo: { name: 'X', gstin: '27ABCDE1234F1Z5', stateCode: '29', postalCode: '560001' } } });
    expect(ready(prepare(facts)).warnings.map((entry) => entry.code)).toContain('RECIPIENT_STATE_CODE_GSTIN_MISMATCH');
  });

  it('keeps URP as the recipient GSTIN for an unregistered recipient', () => {
    const facts = requestFacts({ invoice: { billTo: { name: 'Walk-in', gstin: 'urp', stateCode: '29', postalCode: '560001' } } });
    expect(ready(prepare(facts)).payload.toGstin).toBe('URP');
  });
});

describe('prepareEwayBillRequest — Demo is never statutory clearance', () => {
  it('always carries a Live gate, so a Demo preparation can never be taken for Live clearance', () => {
    const result = ready(prepare());
    expect(result.live.blockers.map((entry) => entry.code)).toEqual(['LIVE_GENERATION_NOT_AUTHORIZED']);
    expect(isLiveGenerationPermitted(result)).toBe(false);
    expect(isLiveGenerationPermitted(prepare(requestFacts({ movement: null })))).toBe(false);
  });

  it('flags the e-invoice direct-generation restriction for a registered recipient while still allowing Demo', () => {
    const result = ready(prepare(requestFacts({ invoice: { sellerEinvoiceApplicable: true } })));
    expect(result.live.blockers.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['LIVE_GENERATION_NOT_AUTHORIZED', 'EINVOICE_ENABLED_SUPPLIER_DIRECT_GENERATION_RESTRICTED']),
    );
    expect(isLiveGenerationPermitted(result)).toBe(false);
  });

  it('reports the e-invoice restriction even when the Demo request cannot be built', () => {
    const result = blocked(prepare(requestFacts({ invoice: { sellerEinvoiceApplicable: true }, movement: null })));
    expect(result.live.blockers.map((entry) => entry.code)).toContain(
      'EINVOICE_ENABLED_SUPPLIER_DIRECT_GENERATION_RESTRICTED',
    );
  });

  it('does not apply the e-invoice restriction to an unregistered (URP) recipient', () => {
    const facts = requestFacts({
      invoice: {
        sellerEinvoiceApplicable: true,
        billTo: { name: 'Walk-in', gstin: 'URP', stateCode: '29', postalCode: '560001' },
      },
    });
    expect(ready(prepare(facts)).live.blockers.map((entry) => entry.code)).toEqual(['LIVE_GENERATION_NOT_AUTHORIZED']);
  });
});
