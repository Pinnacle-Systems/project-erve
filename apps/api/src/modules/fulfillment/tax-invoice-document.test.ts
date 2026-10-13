import { describe, expect, it, vi } from 'vitest';
import { readInvoiceDocumentSnapshot } from './tax-invoice-document.service.js';
// The document reader is pure; no database connection is needed for these cases.
vi.mock('../../db/prisma.js', () => ({ prisma: {} }));

describe('Versioned issued document reader', () => {
  it('reads optional frozen size order without requiring it on old V1 snapshots', () => {
    const snapshot = {
      schemaVersion: 'ERVE_TAX_INVOICE_DOCUMENT_V1',
      dispatchOrders: [],
      transport: null,
      historicalBuyerOrderReference: null,
      lines: [
        {
          lineId: 'line-1',
          quantity: 2,
          style: {
            id: 'style-1',
            styleNumber: 'ST-001',
            styleName: 'Tee',
            description: null,
            colour: null,
          },
          size: { id: 'size-1', code: 'M', label: 'Medium', sortOrder: 4 },
          image: null,
          imageAvailability: 'NO_IMAGE',
        },
      ],
    };
    expect(readInvoiceDocumentSnapshot(snapshot)?.lines[0]?.size.sortOrder).toBe(4);
    const legacy = structuredClone(snapshot);
    Reflect.deleteProperty(legacy.lines[0]!.size, 'sortOrder');
    expect(readInvoiceDocumentSnapshot(legacy)?.lines[0]?.size.label).toBe('Medium');
  });
  it('leaves legacy and unsupported snapshots unavailable', () => {
    expect(readInvoiceDocumentSnapshot(null)).toBeNull();
    expect(
      readInvoiceDocumentSnapshot({ schemaVersion: 'UNKNOWN_V2', lines: [], dispatchOrders: [] }),
    ).toBeNull();
    expect(
      readInvoiceDocumentSnapshot({
        schemaVersion: 'ERVE_TAX_INVOICE_DOCUMENT_V1',
        lines: [{ image: {} }],
      }),
    ).toBeNull();
  });
  it('preserves a legitimate historical EISO verbatim and separately from current orders', () => {
    const reference = 'EISO/103/25-26';
    const document = readInvoiceDocumentSnapshot({
      schemaVersion: 'ERVE_TAX_INVOICE_DOCUMENT_V1',
      lines: [],
      dispatchOrders: [],
      transport: null,
      historicalBuyerOrderReference: { kind: 'HISTORICAL_EISO', value: reference },
    });
    expect(document?.historicalBuyerOrderReference?.value).toBe(reference);
    expect(document?.dispatchOrders).toEqual([]);
  });
});
