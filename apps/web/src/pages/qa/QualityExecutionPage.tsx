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
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

export function QualityExecutionPage() {
  const { executionId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState<QualityExecutionValidationError[]>([]);
  const query = useQuery({
    queryKey: ['quality-execution', executionId],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<QualityExecutionView>>(
          `/quality-executions/${executionId}`,
        )
      ).data.data,
  });
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
      queryClient.setQueryData(['quality-execution', executionId], data);
      setMessage('');
      setValidationErrors([]);
    },
    onError: async (error) => {
      const api = isAxiosError<ApiErrorResponse>(error) ? error.response?.data.error : undefined;
      const details = api?.details as { validationErrors?: QualityExecutionValidationError[] };
      setValidationErrors(Array.isArray(details?.validationErrors) ? details.validationErrors : []);
      setMessage(
        api?.code === 'STALE_VERSION'
          ? 'This inspection changed elsewhere. The latest version has been reloaded.'
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
      await queryClient.invalidateQueries({ queryKey: ['job-order', query.data?.jobOrderId] });
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
      <main className="p-6" role="status">
        Loading inspection…
      </main>
    );
  if (!query.data)
    return (
      <main className="p-6" role="alert">
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
