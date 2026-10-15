import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  TaxInvoiceReviewView,
  TaxInvoiceView,
  TaxInvoiceAuditEvent,
  TaxInvoiceBillToRefreshPreview,
  TaxInvoiceBillToRefreshInput,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

export function useTaxInvoiceReview(id: string | undefined) {
  return useQuery({
    queryKey: ['tax-invoice-review', id],
    enabled: Boolean(id),
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<TaxInvoiceReviewView>>(`/tax-invoices/${id}/review`))
        .data.data,
  });
}
export function useTaxInvoiceAudit(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ['tax-invoice-audit', id],
    enabled,
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<TaxInvoiceAuditEvent[]>>(`/tax-invoices/${id}/audit`))
        .data.data,
  });
}
export function useTaxInvoiceActions(id: string) {
  const client = useQueryClient();
  const refresh = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['tax-invoice-review', id] }),
      client.invalidateQueries({ queryKey: ['tax-invoice-audit', id] }),
      client.invalidateQueries({ queryKey: ['tax-invoices'] }),
    ]);
  };
  const override = useMutation({
    mutationFn: async (input: { lineId: string; overrideUnitRate: number; reason: string }) => {
      const { lineId, ...body } = input;
      return (
        await apiClient.patch<ApiSuccessResponse<TaxInvoiceView>>(
          `/tax-invoices/${id}/lines/${lineId}/override`,
          body,
        )
      ).data.data;
    },
    onSuccess: refresh,
  });
  const finalize = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post<ApiSuccessResponse<TaxInvoiceView>>(
          `/tax-invoices/${id}/actions/finalize`,
          {},
        )
      ).data.data,
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: async (input: { reason: string }) =>
      (
        await apiClient.post<ApiSuccessResponse<TaxInvoiceView>>(
          `/tax-invoices/${id}/actions/cancel`,
          input,
        )
      ).data.data,
    onSuccess: refresh,
  });
  return { override, finalize, cancel };
}

export function useCreateTaxInvoiceDraft() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { ervePackingListId: string; replacesInvoiceId?: string }) =>
      (await apiClient.post<ApiSuccessResponse<TaxInvoiceView>>('/tax-invoices', input)).data.data,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['tax-invoices'] }),
        client.invalidateQueries({ queryKey: ['tax-invoice-sources'] }),
      ]);
    },
  });
}

export function useBillToRefreshPreview(id: string, version: number) {
  return useQuery({
    queryKey: ['tax-invoice-bill-to', id, version],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<TaxInvoiceBillToRefreshPreview>>(
          `/tax-invoices/${id}/bill-to-refresh-preview`,
        )
      ).data.data,
  });
}
export function useRefreshBillTo(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ input, key }: { input: TaxInvoiceBillToRefreshInput; key: string }) =>
      (
        await apiClient.post<ApiSuccessResponse<TaxInvoiceView>>(
          `/tax-invoices/${id}/actions/refresh-bill-to`,
          input,
          { headers: { 'Idempotency-Key': key } },
        )
      ).data.data,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['tax-invoice-review', id] }),
        client.invalidateQueries({ queryKey: ['tax-invoice-audit', id] }),
        client.invalidateQueries({ queryKey: ['tax-invoice-bill-to', id] }),
        client.invalidateQueries({ queryKey: ['tax-invoices'] }),
      ]);
    },
  });
}
