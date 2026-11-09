import { describe, expect, it } from 'vitest';
import {
  EMPTY_COMPONENTS,
  addComponents,
  rawComponentsFromRow,
  toMeasures,
} from './retail-store-inventory-measures.js';
import { computeAvailability } from './sale-or-return-quantities.js';

const base = { ...EMPTY_COMPONENTS, sourceCount: 1, shipped: 100 };

describe('toMeasures', () => {
  it('reports missing A4 evidence and a missing ledger as null, never zero', () => {
    const m = toMeasures({ ...base, awaiting: 100 }, 'SALE_RETURN');
    expect(m.attestedReceivedQuantity).toBeNull();
    expect(m.shortageQuantity).toBeNull();
    expect(m.ledgerQuantity).toBeNull();
    expect(m.awaitingConfirmationQuantity).toBe(100);
  });

  it('keeps a real all-zero attestation as 0 with a full shortage, distinct from missing', () => {
    const m = toMeasures({ ...base, attestedShipped: 100, attestedCount: 1, shortage: 100 }, 'OUTRIGHT');
    expect(m.attestedReceivedQuantity).toBe(0);
    expect(m.shortageQuantity).toBe(100);
    expect(m.ledgerQuantity).toBeNull();
  });

  it('derives the SALE_RETURN position only from the shared formula and never for OUTRIGHT', () => {
    const raw = { ...base, ledger: 100, ledgerCount: 1, sold: 25, returned: 30, approved: 10, pending: 5 };
    const sale = toMeasures(raw, 'SALE_RETURN');
    expect(sale.saleReturn).toEqual({
      actualSoldQuantity: 25,
      returnedQuantity: 30,
      approvedAwaitingReceiptQuantity: 10,
      pendingRequestedQuantity: 5,
      ...computeAvailability({
        receivedQuantity: 100,
        actualSoldQuantity: 25,
        returnedQuantity: 30,
        approvedAwaitingReceiptQuantity: 10,
        pendingRequestedQuantity: 5,
      }),
    });
    expect(sale.saleReturn!.remainingWithDistributor).toBe(45);
    expect(sale.saleReturn!.availableForActualSale).toBe(35);
    expect(sale.saleReturn!.availableForNewReturn).toBe(30);
    expect(toMeasures(raw, 'OUTRIGHT').saleReturn).toBeNull();
  });

  it('counts a source with no ledger row as received 0 for availability, like the existing position', () => {
    expect(toMeasures({ ...base, sold: 0 }, 'SALE_RETURN').saleReturn!.remainingWithDistributor).toBe(0);
  });

  it('is additive: summing raw components then finalizing equals finalizing the parts and summing', () => {
    const a = { ...base, ledger: 60, ledgerCount: 1, sold: 10, returned: 5, approved: 2, pending: 1 };
    const b = { ...base, shipped: 40, ledger: 40, ledgerCount: 1, sold: 3, returned: 0, approved: 0, pending: 4 };
    const whole = toMeasures(addComponents(a, b), 'SALE_RETURN').saleReturn!;
    const ma = toMeasures(a, 'SALE_RETURN').saleReturn!;
    const mb = toMeasures(b, 'SALE_RETURN').saleReturn!;
    expect(whole.remainingWithDistributor).toBe(ma.remainingWithDistributor + mb.remainingWithDistributor);
    expect(whole.availableForActualSale).toBe(ma.availableForActualSale + mb.availableForActualSale);
    expect(whole.availableForNewReturn).toBe(ma.availableForNewReturn + mb.availableForNewReturn);
  });

  it('parses bigint/string/null SQL aggregates', () => {
    const raw = rawComponentsFromRow({ source_count: 2, shipped: 10n, awaiting: '4', ledger: null, attested_count: 0 });
    expect(raw).toMatchObject({ sourceCount: 2, shipped: 10, awaiting: 4, ledger: 0, attestedCount: 0 });
  });
});
