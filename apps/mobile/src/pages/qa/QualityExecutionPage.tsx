import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { QualityExecutionForm, QualityExecutionPageShell } from '@erve/app-components';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  QualityExecutionPayload,
  QualityExecutionValidationError,
  QualityExecutionView,
  FinalQualityBatchView,
  JobOrderDetail,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

export function QualityExecutionPage() {
  const { executionId = '' } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState<QualityExecutionValidationError[]>([]);
  const [batchSwitchPending, setBatchSwitchPending] = useState(false);
  const [batchSwitchError, setBatchSwitchError] = useState('');
  const query = useQuery({
    queryKey: ['quality-execution', executionId],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<QualityExecutionView>>(
          `/quality-executions/${executionId}`,
        )
      ).data.data,
  });
  // ISS-050: non-batched (PPM/Inline) attempt history has no field of its own
  // on QualityExecutionView — reuse the Job Order detail response (already
  // authorized, already computes executionHistory) rather than add a new
  // backend endpoint or projection.
  const jobOrder = useQuery({
    queryKey: ['job-order', query.data?.jobOrderId],
    enabled: Boolean(query.data?.jobOrderId),
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<JobOrderDetail>>(`/job-orders/${query.data!.jobOrderId}`))
        .data.data,
    retry: false,
  });
  const attemptHistory =
    jobOrder.data?.id === query.data?.jobOrderId
      ? jobOrder.data?.qualityActivities?.find(
          (activity) => activity.processFlowVersionStageId === query.data?.processFlowActivityId,
        )?.executionHistory
      : undefined;
  const mutation = useMutation({
    mutationFn: async ({
      payload,
      finalize,
    }: {
      payload: QualityExecutionPayload;
      finalize: boolean;
    }) =>
      (
        await apiClient.request<ApiSuccessResponse<QualityExecutionView>>({
          method: finalize ? 'post' : 'put',
          url: `/quality-executions/${executionId}${finalize ? '/finalize' : ''}`,
          data: payload,
        })
      ).data.data,
    onSuccess: (data) => {
      client.setQueryData(['quality-execution', executionId], data);
      setMessage('');
      setValidationErrors([]);
    },
    onError: async (error) => {
      const api = isAxiosError<ApiErrorResponse>(error) ? error.response?.data.error : undefined;
      const details = api?.details as { validationErrors?: QualityExecutionValidationError[] };
      setValidationErrors(Array.isArray(details?.validationErrors) ? details.validationErrors : []);
      setMessage(
        api?.code === 'STALE_VERSION'
          ? 'Newer inspection data was found and reloaded.'
          : (api?.message ?? 'Unable to save inspection.'),
      );
      if (api?.code === 'STALE_VERSION') await query.refetch();
    },
  });
  const upload = async (componentId: string, requirementKey: string, file: File) => {
    const body = new FormData();
    body.append('image', file);
    body.append('componentId', componentId);
    body.append('requirementKey', requirementKey);
    await apiClient.post(`/quality-executions/${executionId}/attachments`, body);
    await query.refetch();
  };
  const removeAttachment = async (attachmentId: string) => {
    await apiClient.delete(`/quality-executions/attachments/${attachmentId}`);
    await query.refetch();
  };
  const selectAttempt = (nextExecutionId: string) => {
    if (nextExecutionId === executionId) return;
    setBatchSwitchError('');
    navigate(`/quality-executions/${nextExecutionId}`);
  };
  // Correction (post-review): a failed batch lookup must never leave the
  // user silently stuck, and must never navigate — staying on the
  // previously displayed execution with a visible, actionable reason is the
  // only safe outcome here.
  const selectBatch = async (batchId: string) => {
    if (batchId === query.data?.finalBatch?.id) return;
    setBatchSwitchPending(true);
    setBatchSwitchError('');
    try {
      const batch = (
        await apiClient.get<ApiSuccessResponse<FinalQualityBatchView>>(
          `/quality-executions/final-batches/${batchId}`,
        )
      ).data.data;
      const latestAttempt = [...batch.attempts].sort(
        (left, right) => right.attemptNumber - left.attemptNumber,
      )[0];
      if (!latestAttempt) {
        setBatchSwitchError('This batch has no recorded inspection attempts to open.');
        return;
      }
      navigate(`/quality-executions/${latestAttempt.id}`);
    } catch (error) {
      const api = isAxiosError<ApiErrorResponse>(error) ? error.response?.data.error : undefined;
      setBatchSwitchError(
        api?.message ??
          (error instanceof Error ? error.message : 'Unable to load the selected batch. Try again.'),
      );
    } finally {
      setBatchSwitchPending(false);
    }
  };
  const batchMutation = useMutation({
    mutationFn: async ({
      action,
      reason,
    }: {
      action: 'reinspect' | 'cancel' | 'permanently-reject';
      reason?: string;
    }) => {
      const batchId = query.data?.finalBatch?.id;
      if (!batchId) throw new Error('This inspection is not linked to a Final batch.');
      return (
        await apiClient.post<ApiSuccessResponse<QualityExecutionView | FinalQualityBatchView>>(
          `/quality-executions/final-batches/${batchId}/${action}`,
          reason ? { reason } : undefined,
        )
      ).data.data;
    },
    onSuccess: async (data, variables) => {
      setMessage('');
      await client.invalidateQueries({ queryKey: ['job-order', query.data?.jobOrderId] });
      if (variables.action === 'reinspect' && 'qualityForm' in data) {
        navigate(`/quality-executions/${data.id}`);
        return;
      }
      if (variables.action === 'cancel') {
        navigate(`/job-orders/${query.data?.jobOrderId}`);
        return;
      }
      await query.refetch();
    },
    onError: (error) => {
      const api = isAxiosError<ApiErrorResponse>(error) ? error.response?.data.error : undefined;
      setMessage(
        api?.message ?? (error instanceof Error ? error.message : 'Unable to update batch.'),
      );
    },
  });
  if (query.isLoading)
    return (
      <main className="p-4" role="status">
        Loading inspection…
      </main>
    );
  if (!query.data)
    return (
      <main className="p-4" role="alert">
        Unable to load inspection.
      </main>
    );
  return (
    <QualityExecutionPageShell
      jobOrderId={query.data.jobOrderId}
      jobOrderNumber={query.data.jobOrderNumber}
    >
      <QualityExecutionForm
        key={`${query.data.id}:${query.data.version}`}
        execution={query.data}
        busy={mutation.isPending || batchMutation.isPending}
        error={message}
        validationErrors={validationErrors}
        onSave={(payload) =>
          mutation.mutateAsync({ payload, finalize: false }).then(() => undefined)
        }
        onFinalize={(payload) =>
          mutation.mutateAsync({ payload, finalize: true }).then(() => undefined)
        }
        onUpload={upload}
        onRemoveAttachment={removeAttachment}
        attemptHistory={attemptHistory}
        onSelectAttempt={selectAttempt}
        onSelectBatch={(batchId) => void selectBatch(batchId)}
        batchSwitchPending={batchSwitchPending}
        batchSwitchError={batchSwitchError}
        onStartReinspection={() =>
          batchMutation.mutateAsync({ action: 'reinspect' }).then(() => undefined)
        }
        onCancelBatch={(reason) =>
          batchMutation.mutateAsync({ action: 'cancel', reason }).then(() => undefined)
        }
        onPermanentlyReject={(reason) =>
          batchMutation.mutateAsync({ action: 'permanently-reject', reason }).then(() => undefined)
        }
      />
    </QualityExecutionPageShell>
  );
}
