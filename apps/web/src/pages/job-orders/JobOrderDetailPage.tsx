import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiErrorResponse, ApiSuccessResponse, JobOrderAuditEntry } from '@erve/types';
import { ConfirmDialog, getJobOrderOperationalPresentation } from '@erve/app-components';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@erve/primitives';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useOptionalAuth } from '../../auth/AuthContext.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import type { JobOrder } from './types.js';
import { JobOrderPageHeader } from './job-order-detail/JobOrderPageHeader.js';
import { JobOrderStickyContext } from './job-order-detail/JobOrderStickyContext.js';
import { JobOrderOverviewTab } from './job-order-detail/tabs/JobOrderOverviewTab.js';
import { JobOrderProductionTab } from './job-order-detail/tabs/JobOrderProductionTab.js';
import { JobOrderQualityTab } from './job-order-detail/tabs/JobOrderQualityTab.js';
import { JobOrderHistoryTab } from './job-order-detail/tabs/JobOrderHistoryTab.js';
import {
  disclaimerRequiredMessage,
  getJobOrderStyleSummary,
  mutationErrorMessage,
  type FlatSize,
} from './job-order-detail/job-order-detail-utils.js';

const JOB_ORDER_TABS = ['overview', 'production', 'quality', 'history'] as const;
type JobOrderTab = (typeof JOB_ORDER_TABS)[number];

function isJobOrderTab(value: string | null): value is JobOrderTab {
  return value != null && (JOB_ORDER_TABS as readonly string[]).includes(value);
}

export function JobOrderDetailPage() {
  const { id } = useParams();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [disclaimerDrafts, setDisclaimerDrafts] = useState<Record<string, string>>({});
  const [disclaimerError, setDisclaimerError] = useState('');
  const [sendError, setSendError] = useState('');
  const [acknowledgedRevision, setAcknowledgedRevision] = useState('');
  const [pendingFocusTarget, setPendingFocusTarget] = useState<'disclaimer' | null>(null);
  const disclaimerRef = useRef<HTMLTextAreaElement>(null);
  const user = useOptionalAuth()?.user;

  const activeTab: JobOrderTab = isJobOrderTab(searchParams.get('tab')) ? (searchParams.get('tab') as JobOrderTab) : 'overview';

  const navigateToTab = useCallback(
    (tab: JobOrderTab) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.set('tab', tab);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Deferred-focus sequencing: a failed Send validation switches to
  // Production (via navigateToTab, so ?tab= follows) and records the
  // pending focus target here. The textarea is `display:none` until Radix
  // actually marks the Production panel active, so focusing it in the same
  // tick as the tab switch would silently no-op — this effect only runs
  // once the Production tab is genuinely the active one.
  useEffect(() => {
    if (pendingFocusTarget === 'disclaimer' && activeTab === 'production') {
      disclaimerRef.current?.focus();
      disclaimerRef.current?.scrollIntoView?.({ block: 'center' });
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot: clears the pending-focus signal once consumed, doesn't cascade
      setPendingFocusTarget(null);
    }
  }, [pendingFocusTarget, activeTab]);

  const jobOrderQuery = useQuery({
    queryKey: ['job-order', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<JobOrder>>(`/job-orders/${id}`);
      return res.data.data;
    },
  });
  const auditQuery = useQuery({
    queryKey: ['job-order-audit', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<JobOrderAuditEntry[]>>(`/job-orders/${id}/audit`)).data.data,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['job-order', id] });
    void queryClient.invalidateQueries({ queryKey: ['job-order-audit', id] });
  };

  const sendMutation = useMutation({
    mutationFn: async () =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${id}/actions/send-to-factory`,
        { expectedVersion: jobOrderQuery.data!.version },
        { headers: { 'Idempotency-Key': `${id}:send:${jobOrderQuery.data!.version}` } },
      ),
    onSuccess: () => {
      setSendDialogOpen(false);
      setSendError('');
      invalidate();
    },
    onError: (error) => {
      const apiCode = isAxiosError<ApiErrorResponse>(error) ? error.response?.data.error.code : undefined;
      const message =
        apiCode === 'DISCLAIMER_REQUIRED'
          ? disclaimerRequiredMessage
          : mutationErrorMessage(error, 'Unable to send this Job Order to the factory.');
      setSendDialogOpen(false);
      setSendError(message);
      if (apiCode === 'DISCLAIMER_REQUIRED') {
        setDisclaimerError(message);
        navigateToTab('production');
        setPendingFocusTarget('disclaimer');
      }
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${id}/actions/confirm`,
        {
          expectedVersion: jobOrderQuery.data!.version,
          expectedDisclaimerRevision: jobOrderQuery.data!.disclaimerRevision,
          acknowledgeDisclaimer: true,
        },
        { headers: { 'Idempotency-Key': `${id}:confirm:${jobOrderQuery.data!.version}` } },
      ),
    onSuccess: () => {
      setDisclaimerError('');
      setSendError('');
      invalidate();
    },
  });

  const cancelJobOrderMutation = useMutation({
    mutationFn: async () =>
      apiClient.post<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${id}/actions/cancel`,
        { expectedVersion: jobOrderQuery.data!.version },
        { headers: { 'Idempotency-Key': `${id}:cancel:${jobOrderQuery.data!.version}` } },
      ),
    onSuccess: () => {
      setCancelDialogOpen(false);
      invalidate();
    },
  });

  const jobOrder = jobOrderQuery.data;
  const canManageJobOrders = Boolean(user?.roles.some((role) => role === 'ADMIN' || role === 'MERCHANDISER'));

  const flatSizes: FlatSize[] = useMemo(
    () =>
      (jobOrder?.lines ?? []).flatMap((line) =>
        line.sizes.map((size) => ({
          ...size,
          style: `${line.styleNumber} ${line.styleName}`,
          linePreparedQuantityTotal: line.preparedQuantityTotal,
        })),
      ),
    [jobOrder],
  );

  const generateJobOrderDetailPdf = useCallback(async () => {
    if (!jobOrder) throw new Error('Job order not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateJobOrderDetailPdfBlob } = await import('./pdf/generateJobOrderDetailPdf.js');
    return generateJobOrderDetailPdfBlob(jobOrder, {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [jobOrder, user?.name]);

  const jobOrderDetailPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Job-Order', jobOrder?.jobOrderNumber]),
    [jobOrder?.jobOrderNumber],
  );

  const pdfAction = usePdfAction({ generate: generateJobOrderDetailPdf, filename: jobOrderDetailPdfFilename });

  if (jobOrderQuery.isLoading) return <LoadingState label="Loading job order" />;
  if (jobOrderQuery.isError)
    return <ErrorState title="Unable to load job order" description={jobOrderQuery.error.message} />;
  if (!jobOrder)
    return (
      <EmptyState
        title="Job order not found"
        description="The selected job order could not be loaded."
        tone="error"
      />
    );

  const canSend = jobOrder.status === 'DRAFT' && canManageJobOrders;
  const acknowledgementKey = `${jobOrder.id}:${jobOrder.version}:${jobOrder.disclaimerRevision}`;
  const acknowledgeDisclaimer = acknowledgedRevision === acknowledgementKey;
  const disclaimerText = disclaimerDrafts[jobOrder.id] ?? jobOrder.disclaimerText ?? '';
  const canEditDisclaimer = jobOrder.status === 'DRAFT' && canManageJobOrders;
  const canConfirm = jobOrder.status === 'SENT_TO_FACTORY' && Boolean(user?.roles.includes('FACTORY_USER'));
  // Mirrors the server's cancellation boundary in cancelJobOrder — a Job
  // Order may be cancelled only until production actually starts.
  const canCancelJobOrder =
    ['DRAFT', 'SENT_TO_FACTORY', 'CONFIRMED_BY_FACTORY'].includes(jobOrder.status) && canManageJobOrders;
  const operationalPresentation = getJobOrderOperationalPresentation(jobOrder.operationalState);
  const styleSummary = getJobOrderStyleSummary(jobOrder.lines);

  const focusDisclaimer = (message: string) => {
    setDisclaimerError(message);
    setSendError(message);
    setSendDialogOpen(false);
    navigateToTab('production');
    setPendingFocusTarget('disclaimer');
  };

  const validateDisclaimerForSend = () => {
    if (!disclaimerText.trim()) {
      focusDisclaimer(disclaimerRequiredMessage);
      return false;
    }
    if (disclaimerText.trim() !== (jobOrder.disclaimerText ?? '').trim()) {
      focusDisclaimer('Save the disclaimer before sending this Job Order to the factory.');
      return false;
    }
    setDisclaimerError('');
    setSendError('');
    return true;
  };

  const openSendDialog = () => {
    if (validateDisclaimerForSend()) setSendDialogOpen(true);
  };
  const sendToFactory = () => {
    if (validateDisclaimerForSend()) sendMutation.mutate();
  };

  return (
    <div className="space-y-4">
      <JobOrderPageHeader
        jobOrderNumber={jobOrder.jobOrderNumber}
        factoryName={jobOrder.factory.name}
        pdfAction={pdfAction}
      />

      <JobOrderStickyContext
        jobOrderNumber={jobOrder.jobOrderNumber}
        style={styleSummary}
        factoryName={jobOrder.factory.name}
        isDelayed={jobOrder.isDelayed}
        operationalPresentation={operationalPresentation}
        actions={{
          canSend,
          onSend: openSendDialog,
          sendError,
          canConfirm,
          onConfirm: () => confirmMutation.mutate(),
          confirmPending: confirmMutation.isPending,
          confirmDisabled: !acknowledgeDisclaimer,
          confirmError: confirmMutation.isError
            ? mutationErrorMessage(confirmMutation.error, 'Unable to confirm this Job Order.')
            : '',
          canCancelJobOrder,
          onCancel: () => setCancelDialogOpen(true),
        }}
      />

      {cancelJobOrderMutation.isError && (
        <div className="px-4 md:px-8">
          <p className="text-sm text-[var(--erp-form-field-error-text-color)]" role="alert">
            {mutationErrorMessage(cancelJobOrderMutation.error, 'Unable to cancel this Job Order.')}
          </p>
        </div>
      )}

      <div className="px-4 md:px-8">
        <Tabs value={activeTab} onValueChange={(value) => navigateToTab(value as JobOrderTab)}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="production">Production</TabsTrigger>
            <TabsTrigger value="quality">Quality</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="pt-4">
            <JobOrderOverviewTab jobOrder={jobOrder} canManageJobOrders={canManageJobOrders} />
          </TabsContent>

          <TabsContent value="production" className="pt-4">
            <JobOrderProductionTab
              jobOrder={jobOrder}
              user={user}
              flatSizes={flatSizes}
              canManageJobOrders={canManageJobOrders}
              disclaimerRef={disclaimerRef}
              disclaimer={{
                text: disclaimerText,
                error: disclaimerError,
                canEdit: canEditDisclaimer,
                onChange: (value) => {
                  setDisclaimerDrafts((current) => ({ ...current, [jobOrder.id]: value }));
                  if (value.trim()) {
                    setDisclaimerError('');
                    setSendError('');
                  }
                },
              }}
              acknowledgement={{
                canConfirm,
                checked: acknowledgeDisclaimer,
                onToggle: (checked) => setAcknowledgedRevision(checked ? acknowledgementKey : ''),
              }}
            />
          </TabsContent>

          <TabsContent value="quality" className="pt-4">
            <JobOrderQualityTab jobOrderId={jobOrder.id} jobOrder={jobOrder} user={user} flatSizes={flatSizes} />
          </TabsContent>

          <TabsContent value="history" className="pt-4">
            <JobOrderHistoryTab
              jobOrder={jobOrder}
              auditEntries={auditQuery.data ?? []}
              auditLoading={auditQuery.isLoading}
            />
          </TabsContent>
        </Tabs>
      </div>

      <ConfirmDialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        title="Send job order to factory?"
        description="The selected process flow version will be locked for factory confirmation."
        confirmLabel="Send"
        loading={sendMutation.isPending}
        onConfirm={sendToFactory}
      />

      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancel this Job Order?"
        description="This Job Order will be cancelled and production cannot continue on it. Its source Order Sheets remain locked and mapped to this Job Order — they are not released or made available for another Job Order. This cannot be undone."
        confirmLabel="Yes, cancel Job Order"
        loading={cancelJobOrderMutation.isPending}
        onConfirm={() => cancelJobOrderMutation.mutate()}
      />
    </div>
  );
}
