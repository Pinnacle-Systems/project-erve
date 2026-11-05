import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  CloseEwayBillDemoAttemptRequest,
  CloseEwayBillDemoAttemptResponse,
  EwayBillGenerateResponse,
  EwayBillGenerationPreviewResponse,
  EwayBillHistoryResponse,
  EwayBillMovementRecord,
  EwayBillReadinessResponse,
  GenerateEwayBillDemoRequest,
  LinkEwayBillRequest,
  LinkEwayBillResponse,
  UpdateEwayBillMovementRequest,
} from '@erve/types';
import { apiClient } from '../../../lib/api-client.js';

/** Separate keys so a movement save never refetches history, and vice versa. */
export const ewayBillKeys = {
  all: (invoiceId: string) => ['eway-bill', invoiceId] as const,
  readiness: (invoiceId: string) => ['eway-bill', invoiceId, 'readiness'] as const,
  movement: (invoiceId: string) => ['eway-bill', invoiceId, 'movement'] as const,
  preview: (invoiceId: string) => ['eway-bill', invoiceId, 'preview'] as const,
  history: (invoiceId: string) => ['eway-bill', invoiceId, 'history'] as const,
};

const base = (invoiceId: string) => `/tax-invoices/${invoiceId}`;

export function useEwayBillReadiness(invoiceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ewayBillKeys.readiness(invoiceId),
    enabled,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<EwayBillReadinessResponse>>(
          `${base(invoiceId)}/eway-bill-readiness`,
        )
      ).data.data,
  });
}

export function useEwayBillMovement(invoiceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ewayBillKeys.movement(invoiceId),
    enabled,
    // A background refetch must never replace what an Accountant is typing.
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<EwayBillMovementRecord>>(
          `${base(invoiceId)}/eway-bill/movement`,
        )
      ).data.data,
  });
}

export function useEwayBillPreview(invoiceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ewayBillKeys.preview(invoiceId),
    enabled,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<EwayBillGenerationPreviewResponse>>(
          `${base(invoiceId)}/eway-bill/generation-preview`,
        )
      ).data.data,
  });
}

export function useEwayBillHistory(invoiceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ewayBillKeys.history(invoiceId),
    enabled,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<EwayBillHistoryResponse>>(
          `${base(invoiceId)}/eway-bill/attempts`,
        )
      ).data.data,
  });
}

/**
 * Mutations never retry: a repeated generate or link request is not safe to
 * send blindly. After any of them the derived server state is refetched.
 */
export function useEwayBillActions(invoiceId: string) {
  const client = useQueryClient();

  /** Everything except the movement record, which only a save changes. */
  const refreshDerived = async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ewayBillKeys.readiness(invoiceId) }),
      client.invalidateQueries({ queryKey: ewayBillKeys.preview(invoiceId) }),
      client.invalidateQueries({ queryKey: ewayBillKeys.history(invoiceId) }),
    ]);
  };

  const saveMovement = useMutation({
    retry: false,
    mutationFn: async (body: UpdateEwayBillMovementRequest) =>
      (
        await apiClient.put<ApiSuccessResponse<EwayBillMovementRecord>>(
          `${base(invoiceId)}/eway-bill/movement`,
          body,
        )
      ).data.data,
    onSuccess: async (record) => {
      client.setQueryData(ewayBillKeys.movement(invoiceId), record);
      await refreshDerived();
    },
  });

  const generateDemo = useMutation({
    retry: false,
    mutationFn: async (body: GenerateEwayBillDemoRequest) =>
      (
        await apiClient.post<ApiSuccessResponse<EwayBillGenerateResponse>>(
          `${base(invoiceId)}/eway-bill/generate`,
          body,
        )
      ).data.data,
    // Success, rejection, uncertainty and any failure alike: re-read the
    // backend before another action is offered.
    onSettled: refreshDerived,
  });

  const linkExisting = useMutation({
    retry: false,
    mutationFn: async (body: LinkEwayBillRequest) =>
      (
        await apiClient.post<ApiSuccessResponse<LinkEwayBillResponse>>(
          `${base(invoiceId)}/eway-bill/link`,
          body,
        )
      ).data.data,
    onSuccess: refreshDerived,
    // A 409 means the backend state differs from what the page showed.
    onError: refreshDerived,
  });

  const closeDemoAttempt = useMutation({
    retry: false,
    mutationFn: async ({
      attemptId,
      ...body
    }: CloseEwayBillDemoAttemptRequest & { attemptId: string }) =>
      (
        await apiClient.post<ApiSuccessResponse<CloseEwayBillDemoAttemptResponse>>(
          `${base(invoiceId)}/eway-bill/attempts/${attemptId}/close-demo`,
          body,
        )
      ).data.data,
    onSuccess: refreshDerived,
    onError: refreshDerived,
  });

  return { saveMovement, generateDemo, linkExisting, closeDemoAttempt, refreshDerived };
}
