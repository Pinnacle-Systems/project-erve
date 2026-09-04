import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { LoadingState, EmptyState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { canMutateInvoiceHandoffs } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { InvoiceHandoffView } from './types.js';

export function InvoiceHandoffDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canRecord = canMutateInvoiceHandoffs(user);

  const [tallyInvoiceNumber, setTallyInvoiceNumber] = useState('');
  const [tallyInvoiceDate, setTallyInvoiceDate] = useState('');
  const [tallyVoucherReference, setTallyVoucherReference] = useState('');
  const [remarks, setRemarks] = useState('');
  const [formError, setFormError] = useState('');

  const query = useQuery({
    queryKey: ['invoice-handoff', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<InvoiceHandoffView>>(`/invoice-handoffs/${id}`);
      return res.data.data;
    },
  });
  const handoff = query.data;

  const recordMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.patch<ApiSuccessResponse<InvoiceHandoffView>>(`/invoice-handoffs/${id}/tally-reference`, {
        expectedVersion: handoff!.version,
        tallyInvoiceNumber,
        tallyInvoiceDate,
        tallyVoucherReference: tallyVoucherReference || null,
        remarks: remarks || null,
      });
      return res.data.data;
    },
    onSuccess: () => {
      setFormError('');
      void queryClient.invalidateQueries({ queryKey: ['invoice-handoff', id] });
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to record the Tally invoice reference.')),
  });

  if (query.isLoading) return <LoadingState label="Loading invoice handoff" />;
  if (!handoff) return <EmptyState title="Invoice handoff not found" tone="error" />;

  const modeLabel = handoff.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale-or-Return';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${handoff.style.styleNumber} / ${handoff.size.sizeLabel}`}
        subtitle={`${modeLabel} · ${handoff.distributor.name} · ${handoff.erveDispatch.erveDispatchNumber}`}
        status={
          handoff.status === 'PENDING_TALLY' ? (
            <StatusBadge label="Pending Tally" tone="pending" />
          ) : (
            <StatusBadge label="Invoiced" tone="posted" />
          )
        }
        secondaryActions={
          <Button variant="secondary" onClick={() => navigate('/fulfillment/invoices')}>
            Back
          </Button>
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}

      <Panel title="Handoff Details">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Purchase Mode" value={modeLabel} />
          <DescriptionList.Item label="Erve Dispatch" value={handoff.erveDispatch.erveDispatchNumber} />
          <DescriptionList.Item label="Distributor" value={handoff.distributor.name} />
          <DescriptionList.Item label="Dispatched (Invoiceable) Quantity" value={handoff.quantity.toLocaleString()} />
          <DescriptionList.Item label="Sale Order" value={handoff.saleOrder.saleOrderNumber} />
          <DescriptionList.Item label="Tally Invoice #" value={handoff.tallyInvoiceNumber} />
          <DescriptionList.Item
            label="Tally Invoice Date"
            value={handoff.tallyInvoiceDate ? new Date(handoff.tallyInvoiceDate).toLocaleDateString() : null}
          />
          {handoff.tallyVoucherReference && (
            <DescriptionList.Item label="Tally Voucher Reference" value={handoff.tallyVoucherReference} />
          )}
          {handoff.recordedBy && (
            <DescriptionList.Item
              label="Recorded By"
              value={`${handoff.recordedBy.name} · ${handoff.recordedAt ? new Date(handoff.recordedAt).toLocaleString() : ''}`}
            />
          )}
          {handoff.remarks && <DescriptionList.Item label="Remarks" value={handoff.remarks} span={2} />}
        </DescriptionList>
      </Panel>

      {canRecord && (
        <Panel title={handoff.status === 'PENDING_TALLY' ? 'Record Tally Invoice Reference' : 'Correct Tally Invoice Reference'}>
          <div className="flex flex-wrap gap-3">
            <TextField
              label="Tally Invoice Number"
              value={tallyInvoiceNumber || handoff.tallyInvoiceNumber || ''}
              onChange={(e) => setTallyInvoiceNumber(e.target.value)}
            />
            <TextField
              label="Tally Invoice Date"
              type="date"
              value={tallyInvoiceDate || handoff.tallyInvoiceDate?.slice(0, 10) || ''}
              onChange={(e) => setTallyInvoiceDate(e.target.value)}
            />
            <TextField
              label="Tally Voucher Reference (optional)"
              value={tallyVoucherReference || handoff.tallyVoucherReference || ''}
              onChange={(e) => setTallyVoucherReference(e.target.value)}
            />
            <TextField
              label="Remarks (optional)"
              value={remarks || handoff.remarks || ''}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
          <div className="mt-3 flex justify-end">
            <Button
              onClick={() => recordMutation.mutate()}
              loading={recordMutation.isPending}
              disabled={!(tallyInvoiceNumber || handoff.tallyInvoiceNumber) || !(tallyInvoiceDate || handoff.tallyInvoiceDate)}
            >
              {handoff.status === 'PENDING_TALLY' ? 'Record' : 'Save Correction'}
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
