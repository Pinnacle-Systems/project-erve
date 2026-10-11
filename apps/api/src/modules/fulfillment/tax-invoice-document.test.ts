import { describe, expect, it } from 'vitest';
import { readInvoiceDocumentSnapshot } from './tax-invoice-document.service.js';

describe('Versioned issued document reader', () => {
  it('leaves legacy and unsupported snapshots unavailable', () => {
    expect(readInvoiceDocumentSnapshot(null)).toBeNull();
    expect(readInvoiceDocumentSnapshot({ schemaVersion: 'UNKNOWN_V2', lines: [], dispatchOrders: [] })).toBeNull();
    expect(readInvoiceDocumentSnapshot({ schemaVersion: 'ERVE_TAX_INVOICE_DOCUMENT_V1', lines: [{ image: {} }] })).toBeNull();
  });
  it('preserves a legitimate historical EISO verbatim and separately from current orders', () => {
    const reference = 'EISO/103/25-26';
    const document = readInvoiceDocumentSnapshot({ schemaVersion: 'ERVE_TAX_INVOICE_DOCUMENT_V1', lines: [], dispatchOrders: [], transport: null, historicalBuyerOrderReference: { kind: 'HISTORICAL_EISO', value: reference } });
    expect(document?.historicalBuyerOrderReference?.value).toBe(reference);
    expect(document?.dispatchOrders).toEqual([]);
  });
});
