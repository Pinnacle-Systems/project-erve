import axios from 'axios';
import type { PriceListStatus } from './types.js';

export const PRICE_LIST_STATUS_LABELS: Record<PriceListStatus, string> = {
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  // The enum value follows the existing schema convention (EXPIRED); the
  // user-facing lifecycle vocabulary is "retired".
  EXPIRED: 'Retired',
};

export function priceListStatusTone(status: PriceListStatus) {
  if (status === 'DRAFT') return 'draft' as const;
  if (status === 'ACTIVE') return 'success' as const;
  return 'muted' as const;
}

export function formatEffectiveDate(date: string | null): string {
  if (!date) return '—';
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatPrice(unitPrice: number, currency: string): string {
  return `${currency === 'INR' ? '₹' : `${currency} `}${unitPrice.toFixed(2)}`;
}

// Server-side validation messages (duplicate line, overlapping period, …) are
// the primary feedback for this module, so surface the API's error message
// instead of axios's generic "Request failed with status code 400".
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { error?: { message?: string } } | undefined;
    if (data?.error?.message) return data.error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
