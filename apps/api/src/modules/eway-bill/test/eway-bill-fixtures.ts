import type { EwayBillMovementInfo } from '@erve/types';
import type { EwayBillFacts } from '../eway-bill-eligibility.js';

// Syntactically valid GSTINs (structure only, as the codebase validates).
export const SELLER_GSTIN = '33ABCDE1234F1Z5';
export const RECIPIENT_GSTIN = '29ABCDE1234F1Z5';

export const completeMovement = (overrides: Partial<EwayBillMovementInfo> = {}): EwayBillMovementInfo => ({
  transportMode: 'ROAD',
  vehicleNumber: 'TN01AB1234',
  vehicleType: 'REGULAR',
  transporterId: null,
  transporterName: null,
  transportDocumentNumber: null,
  transportDocumentDate: null,
  approximateDistanceKm: 350,
  shipToArrangement: 'BILLED_PARTY',
  dispatchFromArrangement: 'SUPPLIER_REGISTERED_PREMISES',
  dispatchFrom: null,
  ...overrides,
});

/** A fully populated FINALIZED invoice with no E-Way Bill records. */
export function finalizedFacts(overrides: {
  invoice?: Partial<EwayBillFacts['invoice']>;
  lines?: EwayBillFacts['lines'];
  movement?: EwayBillFacts['movement'];
  bills?: EwayBillFacts['bills'];
  attempts?: EwayBillFacts['attempts'];
  settings?: EwayBillFacts['settings'];
} = {}): EwayBillFacts {
  return {
    invoice: {
      id: 'inv-1',
      status: 'FINALIZED',
      invoiceNumber: 'EI/26-27/0001',
      finalizedAt: new Date('2026-11-04T06:00:00.000Z'),
      gstTreatment: 'INTER',
      subtotal: '100000.000000',
      totalCgst: null,
      totalSgst: null,
      totalIgst: '5000.00000000000',
      seller: { gstin: SELLER_GSTIN, stateCode: '33', postalCode: '600001' },
      billTo: { gstin: RECIPIENT_GSTIN, stateCode: '29', postalCode: '560001' },
      shipTo: { state: 'Karnataka', postalCode: '560002' },
      ...overrides.invoice,
    },
    lines: overrides.lines ?? [
      { id: 'line-1', quantity: 10, hsnCode: '6109', taxableValue: '60000.000000' },
      { id: 'line-2', quantity: 5, hsnCode: '6109', taxableValue: '40000.000000' },
    ],
    movement: overrides.movement === undefined ? completeMovement() : overrides.movement,
    bills: overrides.bills ?? [],
    attempts: overrides.attempts ?? [],
    settings: overrides.settings ?? { ewayBillGenerationEnabled: false, integrationMode: 'DEMO' },
  };
}
