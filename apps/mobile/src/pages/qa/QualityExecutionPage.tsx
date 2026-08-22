import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { QualityExecutionForm } from '@erve/app-components';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  QualityExecutionPayload,
  QualityExecutionValidationError,
  QualityExecutionView,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

export function QualityExecutionPage() {
  const { executionId = '' } = useParams();
  const client = useQueryClient();
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
    <main className="space-y-4 p-4">
      <Link to={`/job-orders/${query.data.jobOrderId}`}>← Job Order</Link>
      <QualityExecutionForm
        key={`${query.data.id}:${query.data.version}`}
        execution={query.data}
        busy={mutation.isPending}
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
      />
    </main>
  );
}
