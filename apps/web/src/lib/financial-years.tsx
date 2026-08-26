import { useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { SelectField, SelectItem, type SelectFieldDensity, type SelectFieldWidth } from '@erve/primitives';
import { apiClient } from './api-client.js';

export interface FinancialYear {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
}

/** "2026-27" -> "26-27" — mirrors the API's toCompactFinancialYearCode. */
export function toCompactFinancialYearCode(code: string): string {
  const [start = '', end = ''] = code.split('-');
  return `${start.slice(-2)}-${end}`;
}

/**
 * Shared across Season, Purchase Order, and Job Order screens so ordering,
 * labels, and fetching aren't each reinvented per page.
 */
export function useFinancialYearsQuery() {
  return useQuery({
    queryKey: ['financial-years'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<FinancialYear[]>>('/financial-years');
      return res.data.data;
    },
  });
}

/**
 * The server is the single authority for "today's" Financial Year (it
 * resolves the business date in IST, not the browser's local/UTC clock) —
 * callers that need a default selection must use this rather than
 * re-deriving it from `useFinancialYearsQuery()`'s rows.
 */
export function useCurrentFinancialYearQuery() {
  return useQuery({
    queryKey: ['financial-years', 'current'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<FinancialYear>>('/financial-years/current');
      return res.data.data;
    },
  });
}

interface FinancialYearSelectProps {
  /** Visible field label, styled/positioned like TextField's. Omit for a bare filter control and rely on `aria-label` instead. */
  label?: string;
  'aria-label'?: string;
  errorMessage?: string;
  value: string;
  onValueChange: (value: string) => void;
  /** Included as the first option, representing "no filter". Omit for a required selector (e.g. Season create/edit). */
  allLabel?: string;
  density?: SelectFieldDensity;
  width?: SelectFieldWidth;
}

export function FinancialYearSelect({
  label,
  'aria-label': ariaLabel,
  errorMessage,
  value,
  onValueChange,
  allLabel,
  density = 'compact',
  width = 'sm',
}: FinancialYearSelectProps) {
  const financialYearsQuery = useFinancialYearsQuery();
  const financialYears = financialYearsQuery.data ?? [];
  const isLoading = financialYearsQuery.isLoading;
  const loadFailed = financialYearsQuery.isError || (financialYearsQuery.isSuccess && financialYears.length === 0);

  return (
    <SelectField
      label={label}
      aria-label={ariaLabel}
      errorMessage={errorMessage ?? (loadFailed ? 'Unable to load Financial Years' : undefined)}
      value={value || (allLabel ? 'ALL' : '')}
      onValueChange={(next) => onValueChange(next === 'ALL' ? '' : next)}
      density={density}
      width={width}
      disabled={isLoading || loadFailed}
      placeholder={isLoading ? 'Loading…' : undefined}
    >
      {allLabel ? <SelectItem value="ALL">{allLabel}</SelectItem> : null}
      {financialYears.map((fy) => (
        <SelectItem key={fy.id} value={fy.id}>
          {toCompactFinancialYearCode(fy.code)}
        </SelectItem>
      ))}
    </SelectField>
  );
}
