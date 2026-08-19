import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { QualityExecutionForm } from '@erve/app-components';
import type {
  ApiErrorResponse,
  ApiSuccessResponse,
  QualityExecutionPayload,
  QualityExecutionView,
} from '@erve/types';
import { apiClient } from '../../lib/api-client.js';

export function QualityExecutionPage() {
  const { executionId = '' } = useParams();
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
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
    },
    onError: async (error) => {
      const api = isAxiosError<ApiErrorResponse>(error) ? error.response?.data.error : undefined;
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
    <main className="space-y-4 p-6">
      <Link to={`/job-orders/${query.data.jobOrderId}`}>← Job Order</Link>
      <QualityExecutionForm
        key={`${query.data.id}:${query.data.version}`}
        execution={query.data}
        busy={mutation.isPending}
        error={message}
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
