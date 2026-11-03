import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApiSuccessResponse,
  GstIntegrationMode,
  GstinVerificationLevel,
  GstVerificationPreparation,
  GstVerificationTarget,
  GstVerificationView,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';

export const GST_VERIFICATION_PATH = '/gst-compliance/verification';

export type GstVerificationConfirmation = Extract<
  GstVerificationPreparation,
  { kind: 'CONFIRMATION' }
>;

// Browser timers cap at ~24.8 days; policy permits 30 days. Reschedule long
// waits rather than treating a capped timer as the actual expiry instant.
export function atExpiry(expiresAt: string, callback: () => void) {
  let timer: ReturnType<typeof setTimeout>;
  const expiry = Date.parse(expiresAt);
  const schedule = () => {
    timer = setTimeout(
      () => {
        if (Date.now() < expiry) schedule();
        else callback();
      },
      Math.min(2147483647, Math.max(0, expiry - Date.now()) + 10),
    );
  };
  schedule();
  return () => clearTimeout(timer);
}

export interface GstVerificationPolicy {
  enabled: boolean;
  mode?: GstIntegrationMode;
  level?: GstinVerificationLevel;
}

/** Reads the (cheap, no provider) settings policy that decides whether GSTIN
 * inputs offer online verification at all. */
export function useGstVerificationPolicy(enabled = true) {
  return useQuery({
    queryKey: ['gst-verification-policy'],
    enabled,
    staleTime: 30000,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<GstVerificationPolicy>>(
          `${GST_VERIFICATION_PATH}/policy`,
        )
      ).data.data,
  });
}

interface UiState {
  key: string;
  error: string;
  confirmation: GstVerificationConfirmation | null;
}

/**
 * The one place that reads cached verification, prepares, confirms and
 * executes it. A `null` target performs no request at all.
 *
 * Reading is cache-only. A provider call can only start from `verify()` (an
 * explicit user action); Live additionally stops at the server-issued
 * confirmation until `confirm()` is called.
 */
export function useGstinVerification(target: GstVerificationTarget | null) {
  const client = useQueryClient();
  const targetKey = target ? JSON.stringify(target) : '';
  const key = ['gst-verification', target];
  const query = useQuery({
    queryKey: key,
    enabled: !!target,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<GstVerificationView>>(GST_VERIFICATION_PATH, {
          params: {
            gstin: target!.gstin,
            sourceType: target!.source?.type,
            sourceId: target!.source?.id,
          },
        })
      ).data.data,
  });
  const expiresAt = query.data?.evidence?.expiresAt;
  const refetch = query.refetch;
  useEffect(() => {
    if (!expiresAt) return;
    const delay = Date.parse(expiresAt) - Date.now();
    if (delay <= 0) return;
    return atExpiry(expiresAt, () => void refetch());
  }, [expiresAt, refetch]);

  // UI state belongs to the target it was created for. A different GSTIN or
  // source starts clean, so a confirmation or message can never carry over.
  const [ui, setUi] = useState<UiState>({ key: targetKey, error: '', confirmation: null });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const current = ui.key === targetKey ? ui : { key: targetKey, error: '', confirmation: null };
  const busy = busyKey === targetKey && targetKey !== '';
  const submitting = useRef(false);
  const invoker = useRef<HTMLElement | null>(null);

  async function execute(intentId: string) {
    const result = (
      await apiClient.post<ApiSuccessResponse<GstVerificationView>>(
        `${GST_VERIFICATION_PATH}/execute`,
        { intentId },
      )
    ).data.data;
    client.setQueryData(key, result);
    void client.invalidateQueries({ queryKey: ['gst-verification-history', target] });
  }
  function fail(caught: unknown) {
    setUi({
      key: targetKey,
      confirmation: null,
      error: getApiErrorMessage(caught, 'Unable to verify GSTIN. Saving remains available.'),
    });
    void query.refetch();
  }
  /** Always an explicit user action; never called from an effect or render. */
  async function verify(refresh: boolean, trigger?: HTMLElement | null) {
    if (!target || submitting.current) return;
    submitting.current = true;
    setBusyKey(targetKey);
    setUi({ key: targetKey, error: '', confirmation: null });
    invoker.current = trigger ?? null;
    try {
      const result = (
        await apiClient.post<ApiSuccessResponse<GstVerificationPreparation>>(
          `${GST_VERIFICATION_PATH}/prepare`,
          { target, refresh },
        )
      ).data.data;
      if (result.kind === 'RESULT') client.setQueryData(key, result.view);
      else if (result.mode === 'DEMO') await execute(result.intentId);
      else setUi({ key: targetKey, error: '', confirmation: result });
    } catch (caught) {
      fail(caught);
    } finally {
      submitting.current = false;
      setBusyKey(null);
    }
  }
  async function confirm() {
    const confirmation = current.confirmation;
    if (!target || !confirmation || submitting.current) return;
    submitting.current = true;
    setBusyKey(targetKey);
    setUi({ key: targetKey, error: '', confirmation });
    try {
      await execute(confirmation.intentId);
      setUi({ key: targetKey, error: '', confirmation: null });
    } catch (caught) {
      fail(caught);
    } finally {
      submitting.current = false;
      setBusyKey(null);
    }
  }
  function cancel() {
    if (!busy) setUi({ key: targetKey, error: '', confirmation: null });
  }

  return {
    view: target ? query.data : undefined,
    isPending: !!target && query.isPending,
    isError: !!target && query.isError,
    refetch,
    busy,
    error: current.error,
    confirmation: current.confirmation,
    invoker,
    verify,
    confirm,
    cancel,
  };
}

export type GstinVerificationController = ReturnType<typeof useGstinVerification>;

export function confirmationTitle(confirmation: GstVerificationConfirmation) {
  return confirmation.refresh
    ? 'Reverify GSTIN'
    : confirmation.level === 'COMPLETE'
      ? 'Retrieve Complete Profile'
      : 'Verify GSTIN — Basic';
}

export function confirmationDescription(confirmation: GstVerificationConfirmation) {
  return `${confirmation.gstin} · ${confirmation.level === 'COMPLETE' ? 'Complete Profile' : 'Basic Verification'} · Live Mode. ${confirmation.refresh ? 'Cached information will be bypassed. ' : ''}Fresh cached information is ${confirmation.freshCacheAvailable ? 'available' : 'not available'}. This verification may consume ${confirmation.estimatedCredits} API credit${confirmation.estimatedCredits === 1 ? '' : 's'}. Proceed?`;
}
