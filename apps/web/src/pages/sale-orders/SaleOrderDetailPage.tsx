import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ApprovalActionBar, AuditTrail, ConfirmDialog, PageHeader, StatusBadge, TotalsPanel } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorCode, getApiErrorMessage } from '../../lib/api-errors.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canApproveSaleOrders, canManageSaleOrdersAsDistributor } from '../../auth/permissions.js';
import { formatDateTime } from '../job-orders/job-order-ui.js';
import type { GlobalInventoryLine, SaleOrder, SaleOrderAuditEntry, SaleOrderLine, SaleOrderStatus } from './types.js';

const STATUS_LABELS: Record<SaleOrderStatus, string> = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

function statusTone(status: SaleOrderStatus) {
  if (status === 'DRAFT') return 'draft';
  if (status === 'SUBMITTED') return 'submitted';
  if (status === 'UNDER_REVIEW') return 'pending';
  if (status === 'APPROVED') return 'approved';
  if (status === 'REJECTED') return 'rejected';
  return 'cancelled';
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface SourcingRow {
  key: string;
  qaReleaseLineId: string;
  quantity: string;
  reason: string;
}

function activeCommittedTotal(line: SaleOrderLine): number {
  return line.allocations.filter((a) => a.status === 'ACTIVE').reduce((sum, a) => sum + a.quantity, 0);
}

export function SaleOrderDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [approvedQuantities, setApprovedQuantities] = useState<Record<string, string>>({});
  const [sourcingByLine, setSourcingByLine] = useState<Record<string, SourcingRow[]>>({});
  const [decisionReason, setDecisionReason] = useState('');
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [stale, setStale] = useState(false);

  const canReview = canApproveSaleOrders(user);
  const canManageAsDistributor = canManageSaleOrdersAsDistributor(user);

  const soQuery = useQuery({
    queryKey: ['sale-order', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<SaleOrder>>(`/sale-orders/${id}`);
      return res.data.data;
    },
  });
  const so = soQuery.data;
  const isUnderReview = so?.status === 'SUBMITTED' || so?.status === 'UNDER_REVIEW';

  const inventoryQuery = useQuery({
    queryKey: ['sale-orders', 'inventory'],
    enabled: canReview && isUnderReview,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<GlobalInventoryLine[]>>('/sale-orders/inventory');
      return res.data.data;
    },
  });

  const auditQuery = useQuery({
    queryKey: ['sale-order-audit', id],
    enabled: !!so,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<SaleOrderAuditEntry[]>>(`/sale-orders/${id}/audit`);
      return res.data.data;
    },
  });

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['sale-order', id] });
  }

  function idempotencyKey(action: string) {
    return `${id}:${action}:${so?.version}`;
  }

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<SaleOrder>>(
        `/sale-orders/${id}/actions/submit`,
        { expectedVersion: so!.version },
        { headers: { 'Idempotency-Key': idempotencyKey('submit') } },
      );
      return res.data.data;
    },
    onSuccess: invalidate,
    onError: (caught) => handleMutationError(caught),
  });

  const startReviewMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<SaleOrder>>(`/sale-orders/${id}/actions/start-review`, {
        expectedVersion: so!.version,
      });
      return res.data.data;
    },
    onSuccess: invalidate,
    onError: (caught) => handleMutationError(caught),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<SaleOrder>>(`/sale-orders/${id}/actions/reject`, {
        expectedVersion: so!.version,
        reason: decisionReason || null,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setRejectDialogOpen(false);
      return invalidate();
    },
    onError: (caught) => handleMutationError(caught),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<SaleOrder>>(`/sale-orders/${id}/actions/cancel`, {
        expectedVersion: so!.version,
        reason: decisionReason || null,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setCancelDialogOpen(false);
      return invalidate();
    },
    onError: (caught) => handleMutationError(caught),
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const lines = (so?.lines ?? []).map((line) => {
        const entered = approvedQuantities[line.id] ?? String(line.approvedQuantity ?? line.requestedQuantity);
        const delta = Number(entered) - activeCommittedTotal(line);
        const sourcing =
          delta > 0
            ? (sourcingByLine[line.id] ?? [])
                .filter((row) => row.qaReleaseLineId && row.quantity)
                .map((row) => ({
                  qaReleaseLineId: row.qaReleaseLineId,
                  quantity: Number(row.quantity),
                  reason: row.reason || null,
                }))
            : undefined;
        return { saleOrderLineId: line.id, approvedQuantity: Number(entered), sourcing };
      });
      const res = await apiClient.post<ApiSuccessResponse<SaleOrder>>(
        `/sale-orders/${id}/actions/approve`,
        { expectedVersion: so!.version, reason: decisionReason || null, lines },
        { headers: { 'Idempotency-Key': idempotencyKey('approve') } },
      );
      return res.data.data;
    },
    onSuccess: () => {
      setApproveDialogOpen(false);
      return invalidate();
    },
    onError: (caught) => handleMutationError(caught),
  });

  function handleMutationError(caught: unknown) {
    const code = getApiErrorCode(caught);
    if (code === 'STALE_VERSION') {
      setStale(true);
      return;
    }
    setFormError(getApiErrorMessage(caught, 'Unable to update this sale order. Please try again.'));
  }

  function addSourcingRow(lineId: string) {
    setSourcingByLine((current) => ({
      ...current,
      [lineId]: [...(current[lineId] ?? []), { key: crypto.randomUUID(), qaReleaseLineId: '', quantity: '', reason: '' }],
    }));
  }

  function updateSourcingRow(lineId: string, key: string, patch: Partial<SourcingRow>) {
    setSourcingByLine((current) => ({
      ...current,
      [lineId]: (current[lineId] ?? []).map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  }

  function removeSourcingRow(lineId: string, key: string) {
    setSourcingByLine((current) => ({
      ...current,
      [lineId]: (current[lineId] ?? []).filter((row) => row.key !== key),
    }));
  }

  const lineValidation = useMemo(() => {
    if (!so) return new Map<string, string>();
    const errors = new Map<string, string>();
    for (const line of so.lines) {
      const entered = approvedQuantities[line.id] ?? String(line.approvedQuantity ?? line.requestedQuantity);
      const approvedQty = Number(entered);
      if (!Number.isFinite(approvedQty) || approvedQty < 0) {
        errors.set(line.id, 'Approved quantity must be a non-negative number');
        continue;
      }
      const delta = approvedQty - activeCommittedTotal(line);
      if (delta > 0) {
        const rows = sourcingByLine[line.id] ?? [];
        const total = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
        if (total !== delta) {
          errors.set(line.id, `Sourcing quantities must sum to exactly ${delta} unit(s) to cover this increase`);
          continue;
        }
        const missingReason = rows.some((row) => {
          const source = (inventoryQuery.data ?? []).find((inv) => inv.qaReleaseLineId === row.qaReleaseLineId);
          return source && source.distributor.id !== so.distributor.id && !row.reason.trim();
        });
        if (missingReason) {
          errors.set(line.id, 'A reason is required when sourcing stock from another distributor');
        }
      }
    }
    return errors;
  }, [so, approvedQuantities, sourcingByLine, inventoryQuery.data]);

  if (soQuery.isLoading) {
    return <LoadingState label="Loading sale order" />;
  }
  if (!so) {
    return (
      <EmptyState title="Sale order not found" description="The selected sale order could not be loaded." tone="error" />
    );
  }

  const isDraft = so.status === 'DRAFT';
  const canEdit = isDraft && canManageAsDistributor;
  const canSubmit = isDraft && canManageAsDistributor;
  // APPROVED can only be cancelled by ADMIN/MERCHANDISER (canReview) — an
  // owning distributor loses cancellation rights once merchandiser approval
  // has committed allocations that may span other distributors' stock. The
  // leading (canManageAsDistributor || canReview) gate keeps this button
  // hidden from every read-only viewer (SENIOR_MANAGEMENT, ACCOUNTANT) on
  // every status, matching the backend's cancel route guard exactly.
  const canCancel =
    (canManageAsDistributor || canReview) &&
    (['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(so.status) || (so.status === 'APPROVED' && canReview));
  const canStartReview = so.status === 'SUBMITTED' && canReview;
  const canDecide = isUnderReview && canReview;
  const hasAnyLineError = lineValidation.size > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={so.saleOrderNumber}
        subtitle={so.distributor.name}
        status={<StatusBadge label={STATUS_LABELS[so.status]} tone={statusTone(so.status)} />}
        secondaryActions={
          <>
            {canEdit && (
              <Button asChild variant="secondary">
                <Link to={`/sale-orders/${id}/edit`}>Edit</Link>
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/sale-orders')}>
              Back
            </Button>
          </>
        }
        primaryAction={
          <div className="flex gap-2">
            {canSubmit && (
              <Button onClick={() => submitMutation.mutate()} loading={submitMutation.isPending}>
                Submit
              </Button>
            )}
            {canStartReview && (
              <Button
                variant="secondary"
                onClick={() => startReviewMutation.mutate()}
                loading={startReviewMutation.isPending}
              >
                Start Review
              </Button>
            )}
            {canCancel && (
              <Button variant="destructive" onClick={() => setCancelDialogOpen(true)}>
                Cancel
              </Button>
            )}
          </div>
        }
      />

      {stale && (
        <ValidationMessage tone="error" role="alert">
          <span>This sale order has changed since you opened it.</span>{' '}
          <Button type="button" variant="ghost" density="compact" onClick={() => void invalidate().then(() => setStale(false))}>
            Reload latest
          </Button>
        </ValidationMessage>
      )}
      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}

      <Panel title="Sale Order Header">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Sale Order Date" value={formatDate(so.soDate)} />
          <DescriptionList.Item label="Created By" value={so.creator.name} />
          <DescriptionList.Item label="Reviewed By" value={so.reviewedBy?.name} />
          <DescriptionList.Item label="Remarks" value={so.remarks} span={2} />
          {so.decisionReason && <DescriptionList.Item label="Decision Reason" value={so.decisionReason} span={2} />}
        </DescriptionList>
      </Panel>

      <Panel title="Requested vs Approved">
        <TotalsPanel
          items={[
            { label: 'Total Requested', value: so.totalRequestedQuantity.toLocaleString() },
            {
              label: 'Total Approved',
              value: so.totalApprovedQuantity.toLocaleString(),
              tone: so.totalApprovedQuantity < so.totalRequestedQuantity ? 'warning' : 'default',
            },
          ]}
        />
      </Panel>

      <Panel title="Lines" padding="none">
        <div className="divide-y divide-border-subtle">
          {so.lines.map((line) => {
            const committed = activeCommittedTotal(line);
            const entered = approvedQuantities[line.id] ?? String(line.approvedQuantity ?? line.requestedQuantity);
            const delta = Number(entered) - committed;
            const needsSourcing = canDecide && delta > 0;
            const lineError = lineValidation.get(line.id);
            const candidateSources = (inventoryQuery.data ?? []).filter(
              (inv) => inv.styleId === line.styleId && inv.sizeId === line.sizeId && inv.availableQuantity > 0,
            );

            return (
              <div key={line.id} className="p-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="font-medium text-foreground">{line.styleNumber}</span>
                    <span className="ml-2 text-sm text-muted-foreground">{line.styleName}</span>
                    <span className="ml-2 text-sm text-muted-foreground">{line.sizeLabel}</span>
                    <span className="ml-2 text-xs text-muted-foreground">({line.poNumber})</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Requested Qty</div>
                    <div className="tabular-nums text-sm font-medium">{line.requestedQuantity.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Approved Qty</div>
                    {canDecide ? (
                      <TextField
                        aria-label={`Approved quantity for ${line.styleNumber} ${line.sizeLabel}`}
                        type="number"
                        min={0}
                        density="compact"
                        width="xs"
                        value={approvedQuantities[line.id] ?? String(line.approvedQuantity ?? line.requestedQuantity)}
                        onChange={(event) =>
                          setApprovedQuantities((current) => ({ ...current, [line.id]: event.target.value }))
                        }
                      />
                    ) : (
                      <div className="tabular-nums text-sm font-medium">
                        {line.approvedQuantity != null ? line.approvedQuantity.toLocaleString() : '—'}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Currently Committed</div>
                    <div className="tabular-nums text-sm">{committed.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">QA Released (line)</div>
                    <div className="tabular-nums text-sm">{line.qaPassedQuantity.toLocaleString()}</div>
                  </div>
                </div>

                {line.allocations.length > 0 && (
                  <DataTable
                    rowKey="id"
                    density="compact"
                    columns={[
                      {
                        key: 'source',
                        header: 'Source',
                        render: (a) =>
                          a.source
                            ? `${a.source.distributor.name} · ${a.source.purchaseOrder.poNumber} · ${a.source.jobOrder.jobOrderNumber}`
                            : 'Reassigned from another distributor',
                      },
                      { key: 'allocationSource', header: 'Type', accessor: 'allocationSource' },
                      { key: 'quantity', header: 'Qty', align: 'right', render: (a) => a.quantity.toLocaleString() },
                      { key: 'status', header: 'Status', accessor: 'status' },
                    ]}
                    data={line.allocations}
                  />
                )}

                {needsSourcing && (
                  <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">
                        Additional {delta} unit(s) needed — choose sourcing
                      </span>
                      <Button type="button" variant="ghost" density="compact" onClick={() => addSourcingRow(line.id)}>
                        + Add source
                      </Button>
                    </div>
                    {(sourcingByLine[line.id] ?? []).map((row) => {
                      const selected = candidateSources.find((s) => s.qaReleaseLineId === row.qaReleaseLineId);
                      const isCrossDistributor = selected && selected.distributor.id !== so.distributor.id;
                      return (
                        <div key={row.key} className="flex flex-wrap items-center gap-2">
                          <SelectField
                            aria-label="Source"
                            value={row.qaReleaseLineId}
                            onValueChange={(value) => updateSourcingRow(line.id, row.key, { qaReleaseLineId: value })}
                            density="compact"
                            width="lg"
                          >
                            {candidateSources.map((s) => (
                              <SelectItem key={s.qaReleaseLineId} value={s.qaReleaseLineId}>
                                {s.distributor.name} · {s.purchaseOrder.poNumber} · {s.jobOrder.jobOrderNumber} (
                                {s.availableQuantity} available)
                              </SelectItem>
                            ))}
                          </SelectField>
                          <TextField
                            aria-label="Sourcing quantity"
                            type="number"
                            min={0}
                            density="compact"
                            width="xs"
                            value={row.quantity}
                            onChange={(event) => updateSourcingRow(line.id, row.key, { quantity: event.target.value })}
                          />
                          {isCrossDistributor && (
                            <TextField
                              aria-label="Reassignment reason"
                              placeholder="Reason for reassigning stock (required)"
                              density="compact"
                              width="md"
                              value={row.reason}
                              onChange={(event) => updateSourcingRow(line.id, row.key, { reason: event.target.value })}
                            />
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            density="compact"
                            onClick={() => removeSourcingRow(line.id, row.key)}
                          >
                            Remove
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {lineError && <ValidationMessage tone="error">{lineError}</ValidationMessage>}
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel title="Audit Log">
        <AuditTrail
          items={(auditQuery.data ?? []).map((entry) => ({
            id: entry.id,
            title: entry.title,
            description: entry.detail,
            actor: entry.actor?.name ?? 'System',
            timestamp: formatDateTime(entry.createdAt),
          }))}
          emptyState={
            auditQuery.isLoading
              ? 'Loading history…'
              : auditQuery.isError
                ? 'Unable to load audit history.'
                : 'No audit history available.'
          }
        />
      </Panel>

      {(canDecide || canCancel) && (
        <TextField
          label="Reason (optional)"
          placeholder="Note for this decision — required when sourcing stock from another distributor"
          value={decisionReason}
          onChange={(e) => setDecisionReason(e.target.value)}
        />
      )}

      {canDecide && (
        <ApprovalActionBar
          status={STATUS_LABELS[so.status]}
          statusTone={so.status === 'UNDER_REVIEW' ? 'warning' : 'info'}
          message="Review the requested quantities above, adjust and source as needed, then approve or reject."
          actions={[
            { key: 'reject', label: 'Reject', tone: 'danger', variant: 'secondary', loading: rejectMutation.isPending },
            {
              key: 'approve',
              label: 'Approve',
              tone: 'success',
              variant: 'primary',
              disabled: hasAnyLineError,
              loading: approveMutation.isPending,
            },
          ]}
          onAction={(action) => {
            if (action.key === 'reject') setRejectDialogOpen(true);
            if (action.key === 'approve') setApproveDialogOpen(true);
          }}
        />
      )}

      <ConfirmDialog
        open={approveDialogOpen}
        onOpenChange={setApproveDialogOpen}
        title="Approve sale order?"
        description={
          Object.values(sourcingByLine).some((rows) => rows.some((r) => r.qaReleaseLineId))
            ? 'Some lines source stock from other Job Orders or distributors. This will commit those allocations.'
            : 'This will commit the approved quantities against QA-released stock.'
        }
        confirmLabel="Approve"
        loading={approveMutation.isPending}
        onConfirm={() => approveMutation.mutate()}
      />
      <ConfirmDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        title="Reject sale order?"
        description="This will release all reserved stock back to availability."
        confirmLabel="Reject"
        destructive
        loading={rejectMutation.isPending}
        onConfirm={() => rejectMutation.mutate()}
      />
      <ConfirmDialog
        open={cancelDialogOpen}
        onOpenChange={setCancelDialogOpen}
        title="Cancel sale order?"
        description={
          so.status === 'APPROVED'
            ? 'Cancel this approved sale order? Its committed stock will be released back to available QA-released inventory.'
            : 'This will release any reserved stock back to availability.'
        }
        confirmLabel="Cancel Sale Order"
        destructive
        loading={cancelMutation.isPending}
        onConfirm={() => cancelMutation.mutate()}
      />
    </div>
  );
}
