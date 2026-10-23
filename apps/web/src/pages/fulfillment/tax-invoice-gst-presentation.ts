import type { TaxInvoiceView } from '@erve/types';

/** Select labels/fields only. Treatment and amounts always come from the backend response. */
export function taxInvoiceGstComponents(treatment: TaxInvoiceView['gstTreatment']) {
  const cgst = {
    key: 'cgst',
    label: 'CGST',
    totalField: 'totalCgst',
    hsnField: 'cgstAmount',
  } as const;
  const sgst = {
    key: 'sgst',
    label: 'SGST',
    totalField: 'totalSgst',
    hsnField: 'sgstAmount',
  } as const;
  const igst = {
    key: 'igst',
    label: 'IGST',
    totalField: 'totalIgst',
    hsnField: 'igstAmount',
  } as const;
  return treatment === 'INTRA' ? [cgst, sgst] : treatment === 'INTER' ? [igst] : [];
}
