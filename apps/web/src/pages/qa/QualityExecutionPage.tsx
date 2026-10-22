import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { QualityExecutionForm, QualityExecutionPageShell, qualityIdentityItems } from '@erve/app-components';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  ValidationMessage,
} from '@erve/primitives';
import { useAuthedImage } from '../../lib/use-authed-image.js';
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
import { useOptionalAuth } from '../../auth/AuthContext.js';
import { canMutateQualityExecution } from '../../auth/permissions.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { displayQualityActivityName } from './pdf/shared/displayQualityActivityName.js';
import { StyleThumbnailCell } from '../../components/style/StyleThumbnailCell.js';
import { StyleIdentityUnavailable } from '../../components/style/StyleIdentityUnavailable.js';
import { IDENTITY_HEADER_IMAGE_SIZE } from '../../components/style/identity-header-image-size.js';

export function QualityExecutionPage() {
  const { executionId = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useOptionalAuth()?.user;
  const [message, setMessage] = useState('');
  const [validationErrors, setValidationErrors] = useState<QualityExecutionValidationError[]>([]);
  const [viewingAttachment, setViewingAttachment] = useState<{ id: string; name: string } | null>(
    null,
  );
  const query = useQuery({
    queryKey: ['quality-execution', executionId],
    queryFn: async () =>
      (
        await apiClient.get<ApiSuccessResponse<QualityExecutionView>>(
          `/quality-executions/${executionId}`,
        )
      ).data.data,
  });
  // Existing role-scoped read supplies identity absent from historical/canonical form definitions.
  // Project only QA identity; never render planning/provenance from this response.
  const jobOrder = useQuery({
    queryKey: ['job-order', query.data?.jobOrderId],
    enabled: Boolean(query.data?.jobOrderId),
    queryFn: async () => (await apiClient.get<ApiSuccessResponse<JobOrderDetail>>(`/job-orders/${query.data!.jobOrderId}`)).data.data,
    retry: false,
  });
  const recordedContext = jobOrder.data?.id === query.data?.jobOrderId ? jobOrder.data : undefined;
  const identityItems = useMemo(() => recordedContext ? [
    ...(recordedContext.factory ? [{ label: 'Factory', value: recordedContext.factory.name }] : []),
    ...(typeof recordedContext.orderedQuantityTotal === 'number' ? [{ label: 'Job Order quantity', value: `${recordedContext.orderedQuantityTotal} pcs` }] : []),
    ...(recordedContext.seasonSnapshots?.length ? [{ label: 'Season snapshot', value: recordedContext.seasonSnapshots.map(season => season.displayName).join(', ') }] : []),
  ] : query.data ? qualityIdentityItems(query.data) : [], [recordedContext, query.data]);
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
      const validationErrors = Array.isArray(details?.validationErrors) ? details.validationErrors : [];
      setValidationErrors(validationErrors);
      const rawMessage = api?.message;
      const isRawTransport =
        !rawMessage ||
        rawMessage === 'Invalid request data' ||
        rawMessage.toLowerCase().includes('validation error');
      const fallbackMessage = isRawTransport
        ? validationErrors.length
          ? 'Please correct the highlighted fields before saving.'
          : 'Please review and complete the required inspection fields.'
        : rawMessage;
      setMessage(
        api?.code === 'STALE_VERSION'
          ? 'This inspection changed elsewhere. The latest version has been reloaded.'
          : (fallbackMessage ?? 'Unable to save inspection.'),
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
      const rawMessage = api?.message;
      const isRawTransport =
        !rawMessage ||
        rawMessage === 'Invalid request data' ||
        rawMessage.toLowerCase().includes('validation error');
      setMessage(
        isRawTransport
          ? 'Unable to update batch. Please review the details and try again.'
          : (rawMessage ?? (error instanceof Error ? error.message : 'Unable to update batch.')),
      );
    },
  });
  const executionData = query.data;
  const generateQualityExecutionPdf = useCallback(async () => {
    if (!executionData) throw new Error('Quality execution not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateQualityExecutionPdfBlob } = await import('./pdf/execution/generateQualityExecutionPdf.js');
    return generateQualityExecutionPdfBlob(executionData, {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
      identityItems,
    });
  }, [executionData, user?.name, identityItems]);
  const pdfAction = usePdfAction({
    generate: generateQualityExecutionPdf,
    filename: () =>
      buildPdfFilename([
        'ERVE-QA',
        executionData ? displayQualityActivityName(executionData.activityName) : null,
        executionData?.jobOrderNumber,
        executionData ? `Attempt-${executionData.attemptNumber}` : null,
        executionData?.finalBatch ? `Batch-${executionData.finalBatch.batchNumber}` : null,
      ]),
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
    <>
      <QualityExecutionPageShell
        jobOrderId={query.data.jobOrderId}
        jobOrderNumber={query.data.jobOrderNumber}
        actions={
          <PdfActionButtons
            disabled={jobOrder.isFetching}
            disabledHint="Loading Job Order context"
            isGenerating={pdfAction.isGenerating}
            error={pdfAction.error}
            onDownload={pdfAction.handleDownload}
            onPrint={pdfAction.handlePrint}
          />
        }
      >
        <QualityExecutionForm
          compactIdentity
          identityItems={identityItems}
          key={`${query.data.id}:${query.data.version}`}
          execution={query.data}
          leadingVisual={
            query.data.primaryStyle.consistent ? (
              <StyleThumbnailCell
                styleId={query.data.primaryStyle.style.id}
                image={query.data.primaryStyle.style.primaryImage}
                size={IDENTITY_HEADER_IMAGE_SIZE}
                viewerTitle={query.data.primaryStyle.style.styleNumber}
              />
            ) : (
              <StyleIdentityUnavailable
                size={IDENTITY_HEADER_IMAGE_SIZE}
                reason="Style identity unavailable — this Job Order's lines disagree on Style, which should never happen. Reported for investigation, not guessed."
              />
            )
          }
          busy={mutation.isPending || batchMutation.isPending}
          error={message}
          validationErrors={validationErrors}
          canMutate={canMutateQualityExecution(user)}
          onSave={(payload) =>
            mutation.mutateAsync({ payload, finalize: false }).then(() => undefined)
          }
          onFinalize={(payload) =>
            mutation.mutateAsync({ payload, finalize: true }).then(() => undefined)
          }
          onUpload={upload}
          onRemoveAttachment={removeAttachment}
          onViewAttachment={(id, name) => setViewingAttachment({ id, name })}
          onStartReinspection={() =>
            batchMutation.mutateAsync({ action: 'reinspect' }).then(() => undefined)
          }
          onCancelBatch={(reason) =>
            batchMutation.mutateAsync({ action: 'cancel', reason }).then(() => undefined)
          }
          onPermanentlyReject={(reason) =>
            batchMutation
              .mutateAsync({ action: 'permanently-reject', reason })
              .then(() => undefined)
          }
        />
      </QualityExecutionPageShell>
      {/* Keep the dialog mounted so Radix observes a controlled closed-to-open
        transition, rather than mounting a brand-new controlled-open portal
        in the same click that selected the evidence. */}
    <Dialog
      open={viewingAttachment !== null}
      onOpenChange={(open) => { if (!open) setViewingAttachment(null); }}
    >
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inspection evidence: {viewingAttachment?.name ?? ''}</DialogTitle>
        </DialogHeader>
        {viewingAttachment && (
          <QualityEvidencePreviewImage
            attachmentId={viewingAttachment.id}
            fileName={viewingAttachment.name}
          />
        )}
      </DialogContent>
    </Dialog>
    </>
  );
}

function QualityEvidencePreviewImage({
  attachmentId,
  fileName,
}: {
  attachmentId: string;
  fileName: string;
}) {
  const image = useAuthedImage(`/quality-executions/attachments/${attachmentId}/content`);
  return (
    <>
      {image.loading && <p role="status">Loading evidence…</p>}
      {image.error && (
        <ValidationMessage tone="error">Unable to load evidence. Check your access and try again.</ValidationMessage>
      )}
      {image.url && (
        <img className="mx-auto max-h-[65vh] max-w-full object-contain" src={image.url} alt={fileName} />
      )}
    </>
  );
}
