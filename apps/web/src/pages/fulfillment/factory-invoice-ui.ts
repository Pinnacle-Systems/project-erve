import type { FactoryInvoiceStatus } from './types.js';

export const FACTORY_INVOICE_STATUS_LABELS: Record<FactoryInvoiceStatus, string> = {
  GENERATED: 'Awaiting Factory Confirmation',
  FACTORY_CONFIRMED: 'Factory Confirmed',
  FINALIZED: 'Finalized',
};

export function factoryInvoiceStatusTone(status: FactoryInvoiceStatus) {
  if (status === 'GENERATED') return 'pending' as const;
  if (status === 'FACTORY_CONFIRMED') return 'submitted' as const;
  return 'posted' as const;
}

// No currency field exists on Factory Invoice (domestic Style<->Factory
// production rate, implicitly INR) — mirrors price-list-ui.ts's INR
// formatting without needing a currency parameter.
export function formatMoney(value: number): string {
  return `₹${value.toFixed(2)}`;
}
