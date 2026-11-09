import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { createEnterToNextHandler, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, DatePicker, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { StyleSizeMetricMatrix } from '../../components/style-size-grid/StyleSizeMetricMatrix.js';
import { SourceQuantityInputs } from '../../components/style-size-grid/SourceQuantityInputs.js';
import { groupSourceLinesByStyle, type StyleSizeMatrixRowModel } from './style-size-grouping.js';
import {
  canApproveDistributorReturns,
  canReceiveDistributorReturns,
  canSubmitDistributorReturns,
} from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { DistributorReturnLineView, DistributorReturnStatus, DistributorReturnView } from './types.js';

const statusTone: Record<DistributorReturnStatus, 'submitted' | 'approved' | 'rejected' | 'posted' | 'cancelled'> = {
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  RECEIVED: 'posted',
  CANCELLED: 'cancelled',
};

const statusLabel: Record<DistributorReturnStatus, string> = {
  SUBMITTED: 'Submitted',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

/**
 * A Return's Style rows are scoped to one Erve Dispatch + source Sale Order: the same Style under
 * another Dispatch or order is a separate row. Presentation only — every `lines[].id` the approve /
 * receive payloads key on stays on its own source line and input.
 */
const returnContext = (line: DistributorReturnLineView) => `${line.erveDispatch.id}::${line.saleOrderId}`;

function ReturnLineContext({ row }: { row: StyleSizeMatrixRowModel<DistributorReturnLineView> }) {
  const first = row.sources[0]!;
  return (
    <div className="truncate text-xs text-muted-foreground">
      {first.erveDispatch.erveDispatchNumber} · Order {first.saleOrderNumber}
    </div>
  );
}

const lineCaption = (line: DistributorReturnLineView, index: number) => `Line ${index + 1} · ${line.saleOrderNumber}`;

export function DistributorReturnDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isDistributor = Boolean(user?.roles.includes('DISTRIBUTOR'));
  const canApprove = canApproveDistributorReturns(user);
  const canReceive = canReceiveDistributorReturns(user);
  const canSubmitOwn = canSubmitDistributorReturns(user) && isDistributor;

  const [approvedQuantities, setApprovedQuantities] = useState<Record<string, string>>({});
  const [approvalRemarks, setApprovalRemarks] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, string>>({});
  const [creditNoteReference, setCreditNoteReference] = useState('');
  const [creditNoteDate, setCreditNoteDate] = useState('');
  const [formError, setFormError] = useState('');

  const query = useQuery({
    queryKey: ['distributor-return', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<DistributorReturnView>>(`/distributor-returns/${id}`);
      return res.data.data;
    },
  });
  const record = query.data;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['distributor-return', id] });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<DistributorReturnView>>(`/distributor-returns/${id}/approve`, {
        expectedVersion: record!.version,
        lines: record!.lines.map((l) => ({ id: l.id, approvedQuantity: Number(approvedQuantities[l.id] ?? l.requestedQuantity) })),
        approvalRemarks: approvalRemarks || undefined,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to approve the return.')),
  });

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<DistributorReturnView>>(`/distributor-returns/${id}/reject`, {
        expectedVersion: record!.version,
        rejectionReason,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to reject the return.')),
  });

  const receiveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<DistributorReturnView>>(`/distributor-returns/${id}/receive`, {
        expectedVersion: record!.version,
        lines: record!.lines.map((l) => ({
          id: l.id,
          receivedQuantity: Number(receivedQuantities[l.id] ?? l.approvedQuantity ?? 0),
        })),
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to record physical receipt.')),
  });

  const creditNoteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<DistributorReturnView>>(`/distributor-returns/${id}/credit-note`, {
        expectedVersion: record!.version,
        creditNoteReference,
        creditNoteDate,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      setCreditNoteReference('');
      setCreditNoteDate('');
      invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to record the credit note.')),
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<DistributorReturnView>>(`/distributor-returns/${id}/cancel`, {
        expectedVersion: record!.version,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to cancel the return.')),
  });

  if (query.isLoading) return <LoadingState label="Loading return" />;
  if (query.isError)
    return <ErrorState title="Unable to load return" description={query.error.message} />;
  if (!record) return <EmptyState title="Distributor Return not found" tone="error" />;

  const matrix = groupSourceLinesByStyle(record.lines, returnContext);
  const hasCreditNote = Boolean(record.creditNoteReference);
  const canCancel =
    (canSubmitOwn && record.status === 'SUBMITTED') ||
    (canApprove && (record.status === 'SUBMITTED' || (record.status === 'APPROVED' && !hasCreditNote)));

  return (
    <div className="space-y-6">
      <PageHeader
        title={record.returnNumber}
        subtitle={`${record.distributor.name} · ${record.returnReason}`}
        status={<StatusBadge label={statusLabel[record.status]} tone={statusTone[record.status]} />}
        secondaryActions={
          <Button variant="secondary" onClick={() => navigate('/fulfillment/distributor-returns')}>
            Back
          </Button>
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}

      <Panel title="Return Details">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Return Date" value={new Date(record.returnDate).toLocaleDateString()} />
          <DescriptionList.Item label="Return Reason" value={record.returnReason} span={2} />
          <DescriptionList.Item label="Submitted By" value={`${record.submittedBy.name} · ${new Date(record.submittedAt).toLocaleString()}`} />
          {record.approvedBy && (
            <DescriptionList.Item
              label="Approved By"
              value={`${record.approvedBy.name} · ${record.approvedAt ? new Date(record.approvedAt).toLocaleString() : ''}`}
            />
          )}
          {record.approvalRemarks && <DescriptionList.Item label="Approval Remarks" value={record.approvalRemarks} span={2} />}
          {record.rejectionReason && <DescriptionList.Item label="Rejection Reason" value={record.rejectionReason} span={2} />}
          {record.receivedBy && (
            <DescriptionList.Item
              label="Received By"
              value={`${record.receivedBy.name} · ${record.receivedAt ? new Date(record.receivedAt).toLocaleString() : ''}`}
            />
          )}
          {record.creditNoteReference && (
            <>
              <DescriptionList.Item label="Credit Note Reference" value={record.creditNoteReference} />
              <DescriptionList.Item
                label="Credit Note Date"
                value={record.creditNoteDate ? new Date(record.creditNoteDate).toLocaleDateString() : null}
              />
            </>
          )}
          {record.cancelledBy && (
            <DescriptionList.Item
              label="Cancelled By"
              value={`${record.cancelledBy.name} · ${record.cancelledAt ? new Date(record.cancelledAt).toLocaleString() : ''}`}
            />
          )}
          {record.remarks && <DescriptionList.Item label="Remarks" value={record.remarks} span={2} />}
        </DescriptionList>
      </Panel>

      <Panel title="Lines" padding="sm">
        <StyleSizeMetricMatrix
          label="Return lines by Style and Size"
          columns={matrix.columns}
          rows={matrix.rows}
          context={(row) => <ReturnLineContext row={row} />}
          emptyMessage={<EmptyState title="No lines" />}
          metrics={[
            { key: 'requested', label: 'Requested', value: (l) => l.requestedQuantity },
            { key: 'approved', label: 'Approved', value: (l) => l.approvedQuantity },
            { key: 'received', label: 'Received', value: (l) => l.receivedQuantity },
          ]}
        />
      </Panel>

      {canApprove && record.status === 'SUBMITTED' && (
        <Panel title="Finance Review">
          <div className="space-y-3">
            <StyleSizeMetricMatrix
              label="Finance review by Style and Size"
              columns={matrix.columns}
              rows={matrix.rows}
              context={(row) => <ReturnLineContext row={row} />}
              metrics={[
                { key: 'requested', label: 'Requested', value: (l) => l.requestedQuantity },
                {
                  key: 'approve',
                  label: 'Approve',
                  value: (l) => Number(approvedQuantities[l.id] ?? l.requestedQuantity),
                  renderCell: ({ sources }) => (
                    <SourceQuantityInputs
                      sources={sources}
                      idOf={(l) => l.id}
                      valueOf={(l) => approvedQuantities[l.id] ?? String(l.requestedQuantity)}
                      onChange={(l, value) => setApprovedQuantities((current) => ({ ...current, [l.id]: value }))}
                      maxOf={(l) => l.requestedQuantity}
                      ariaLabelOf={(l) => `${l.styleNumber} ${l.sizeLabel} approved quantity (${l.erveDispatch.erveDispatchNumber}, ${l.saleOrderNumber}, requested ${l.requestedQuantity})`}
                      captionOf={lineCaption}
                    />
                  ),
                },
              ]}
            />
            <TextField label="Approval Remarks (optional)" value={approvalRemarks} onChange={(e) => setApprovalRemarks(e.target.value)} />
          </div>
          <div className="mt-3 flex flex-wrap justify-end gap-3">
            <TextField label="Rejection Reason" value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} />
            <Button variant="secondary" onClick={() => rejectMutation.mutate()} loading={rejectMutation.isPending} disabled={!rejectionReason.trim()}>
              Reject
            </Button>
            <Button onClick={() => approveMutation.mutate()} loading={approveMutation.isPending}>
              Approve
            </Button>
          </div>
        </Panel>
      )}

      {canReceive && record.status === 'APPROVED' && (
        <Panel title="Record Physical Receipt">
          <StyleSizeMetricMatrix
            label="Physical receipt by Style and Size"
            columns={matrix.columns}
            rows={matrix.rows}
            context={(row) => <ReturnLineContext row={row} />}
            metrics={[
              { key: 'approved', label: 'Approved', value: (l) => l.approvedQuantity ?? 0 },
              {
                key: 'receive',
                label: 'Receive',
                value: (l) => Number(receivedQuantities[l.id] ?? l.approvedQuantity ?? 0),
                renderCell: ({ sources }) => (
                  <SourceQuantityInputs
                    sources={sources}
                    idOf={(l) => l.id}
                    valueOf={(l) => receivedQuantities[l.id] ?? String(l.approvedQuantity ?? 0)}
                    onChange={(l, value) => setReceivedQuantities((current) => ({ ...current, [l.id]: value }))}
                    maxOf={(l) => l.approvedQuantity ?? 0}
                    ariaLabelOf={(l) => `${l.styleNumber} ${l.sizeLabel} received quantity (${l.erveDispatch.erveDispatchNumber}, ${l.saleOrderNumber}, approved ${l.approvedQuantity ?? 0})`}
                    captionOf={lineCaption}
                  />
                ),
              },
            ]}
          />
          <div className="mt-3 flex justify-end">
            <Button onClick={() => receiveMutation.mutate()} loading={receiveMutation.isPending}>
              Record Receipt
            </Button>
          </div>
        </Panel>
      )}

      {canApprove && (record.status === 'APPROVED' || record.status === 'RECEIVED') && (
        <Panel title={hasCreditNote ? 'Credit Note' : 'Record Credit Note'}>
          <div className="flex flex-wrap items-end gap-3" onKeyDown={createEnterToNextHandler()}>
            <TextField
              label="Credit Note Reference"
              value={creditNoteReference || record.creditNoteReference || ''}
              onChange={(e) => setCreditNoteReference(e.target.value)}
            />
            <DatePicker
              label="Credit Note Date"
              value={creditNoteDate || record.creditNoteDate?.slice(0, 10) || ''}
              onValueChange={(value) => setCreditNoteDate(value ?? '')}
              width="sm"
            />
            <Button
              onClick={() => creditNoteMutation.mutate()}
              loading={creditNoteMutation.isPending}
              disabled={!(creditNoteReference || record.creditNoteReference) || !(creditNoteDate || record.creditNoteDate)}
            >
              {hasCreditNote ? 'Update' : 'Record'}
            </Button>
          </div>
        </Panel>
      )}

      {canCancel && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => cancelMutation.mutate()} loading={cancelMutation.isPending}>
            Cancel Return
          </Button>
        </div>
      )}
    </div>
  );
}
