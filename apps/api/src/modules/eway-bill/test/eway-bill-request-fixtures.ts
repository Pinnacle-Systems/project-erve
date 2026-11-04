import type { EwayBillRequestFacts } from '../eway-bill-request.mapper.js';
import { completeMovement, RECIPIENT_GSTIN, SELLER_GSTIN } from './eway-bill-fixtures.js';

// A fully populated FINALIZED INTER-state OUTRIGHT invoice that maps cleanly.
// Amounts reconcile exactly: 60000 + 40000 = 100000 taxable; 5% IGST = 5000;
// payable 105000 with a zero round-off.
export function requestFacts(overrides: {
  invoice?: Partial<EwayBillRequestFacts['invoice']>;
  lines?: EwayBillRequestFacts['lines'];
  movement?: EwayBillRequestFacts['movement'];
} = {}): EwayBillRequestFacts {
  return {
    invoice: {
      id: 'inv-1',
      status: 'FINALIZED',
      invoiceNumber: 'EI/26-27/0001',
      finalizedAt: new Date('2026-11-04T06:00:00.000Z'),
      purchaseMode: 'OUTRIGHT',
      gstTreatment: 'INTER',
      subtotal: '100000.000000',
      totalCgst: null,
      totalSgst: null,
      totalIgst: '5000.00000000000',
      payableTotal: '105000.00',
      roundOffAdjustment: '0.00',
      seller: {
        legalName: 'Erve India Private Limited',
        tradeName: 'Erve India',
        gstin: SELLER_GSTIN,
        stateCode: '33',
        postalCode: '600001',
        addressLine1: '1 Mount Road',
        addressLine2: 'Anna Salai',
        city: 'Chennai',
      },
      billTo: {
        name: 'Bengaluru Distributor LLP',
        gstin: RECIPIENT_GSTIN,
        stateCode: '29',
        postalCode: '560001',
      },
      shipTo: {
        addressLine1: '22 Brigade Road',
        addressLine2: null,
        city: 'Bengaluru',
        state: 'Karnataka',
        postalCode: '560001',
      },
      ...overrides.invoice,
    },
    lines: overrides.lines ?? [
      {
        id: 'line-1',
        quantity: 10,
        hsnCode: '6109',
        taxableValue: '60000.000000',
        gstPercent: '5.00',
        productName: 'Round Neck Tee',
        productDescription: 'Cotton jersey',
      },
      {
        id: 'line-2',
        quantity: 5,
        hsnCode: '6109',
        taxableValue: '40000.000000',
        gstPercent: '5.00',
        productName: 'Polo Tee',
        productDescription: null,
      },
    ],
    movement: overrides.movement === undefined ? completeMovement() : overrides.movement,
  };
}
