import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable } from '@erve/data-display';
import { apiClient } from '../../../../lib/api-client.js';
import type { PurchaseOrder } from '../../../purchase-orders/types.js';
import type { JobOrder } from '../../types.js';
import { OrderSheetMultiSelectField } from '../../OrderSheetMultiSelectField.js';
import {
  CONFIRMATION_LABELS,
  JOB_ORDER_STATUS_LABELS,
  confirmationTone,
  formatDateTime,
} from '../../job-order-ui.js';
import { mutationErrorMessage } from '../job-order-detail-utils.js';

export interface JobOrderOverviewTabProps {
  jobOrder: JobOrder;
  canManageJobOrders: boolean;
}

function JobOrderOverviewSummary({ jobOrder }: { jobOrder: JobOrder }) {
  // Historical imports carry ordered quantities and source evidence only —
  // never live confirmation or prepared/variance tracking, so those items
  // are stated as not applicable rather than shown as pending/shortfall.
  const historical = jobOrder.historicalImport ?? null;
  return (
    <Panel title="Job Order Header">
      <DescriptionList columns={4}>
        {historical && (
          <>
            <DescriptionList.Item
              label="Record Origin"
              value={<StatusBadge label="Historical import" tone="info" />}
            />
            <DescriptionList.Item label="Historical Reference" value={historical.legacyReferenceNumber} />
            <DescriptionList.Item
              label="Historical Order Date"
              value={
                historical.historicalBusinessDate
                  ? new Date(historical.historicalBusinessDate).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })
                  : undefined
              }
            />
            <DescriptionList.Item label="Imported At" value={formatDateTime(historical.importedAt)} />
          </>
        )}
        <DescriptionList.Item label="Lifecycle" value={JOB_ORDER_STATUS_LABELS[jobOrder.status]} />
        <DescriptionList.Item label="Order Sheets" value={jobOrder.sourceOrderSheetCount} />
        <DescriptionList.Item label="Factory" value={jobOrder.factory.name} />
        <DescriptionList.Item
          label="Required Delivery Date"
          value={
            jobOrder.requiredDeliveryDate ? (
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {new Date(jobOrder.requiredDeliveryDate).toLocaleDateString('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
                {jobOrder.isDelayed && <StatusBadge label="Delayed" tone="warning" />}
              </div>
            ) : (
              'Not set'
            )
          }
        />
        <DescriptionList.Item label="Factory unit price" value={`₹${jobOrder.unitPrice.toFixed(2)}`} />
        <DescriptionList.Item
          label="Process Flow"
          value={`${jobOrder.processFlowVersion.processFlow.name} v${jobOrder.processFlowVersion.versionNumber}`}
        />
        {!historical && jobOrder.factoryConfirmationStatus !== 'CONFIRMED' && (
          <DescriptionList.Item
            label="Confirmation"
            value={
              <StatusBadge
                label={CONFIRMATION_LABELS[jobOrder.factoryConfirmationStatus]}
                tone={confirmationTone(jobOrder.factoryConfirmationStatus)}
              />
            }
          />
        )}
        <DescriptionList.Item label="Ordered Qty" value={jobOrder.orderedQuantityTotal.toLocaleString()} />
        <DescriptionList.Item
          label="Prepared Qty"
          value={historical ? 'Not recorded (historical)' : jobOrder.preparedQuantityTotal.toLocaleString()}
        />
        <DescriptionList.Item
          label="Variance"
          value={
            historical
              ? 'Not applicable'
              : (jobOrder.preparedQuantityTotal - jobOrder.orderedQuantityTotal).toLocaleString()
          }
        />
        <DescriptionList.Item label="Created" value={formatDateTime(jobOrder.createdAt)} />
        <DescriptionList.Item label="Confirmed By" value={jobOrder.confirmedBy?.name} />
        <DescriptionList.Item label="Confirmed At" value={formatDateTime(jobOrder.confirmedAt)} />
        <DescriptionList.Item label="Production Started" value={formatDateTime(jobOrder.productionStartedAt)} />
        <DescriptionList.Item
          label="Production Completed"
          value={formatDateTime(jobOrder.productionCompletedAt)}
        />
      </DescriptionList>
    </Panel>
  );
}

// Neither mutation below is observed outside this tab, so both are owned
// here rather than threaded down from the page shell — invalidating the
// shared `job-order`/`job-order-audit` query keys works identically
// regardless of which component calls useMutation.
export function JobOrderOverviewTab({ jobOrder, canManageJobOrders }: JobOrderOverviewTabProps) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['job-order', jobOrder.id] });
    void queryClient.invalidateQueries({ queryKey: ['job-order-audit', jobOrder.id] });
  };

  const [deliveryDateDraft, setDeliveryDateDraft] = useState<string | null>(null);

  const updateSourcesMutation = useMutation({
    mutationFn: async (input: { add: string[]; remove: string[] }) =>
      apiClient.patch<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${jobOrder.id}/sources`,
        { ...input, expectedVersion: jobOrder.version },
        {
          headers: { 'Idempotency-Key': `${jobOrder.id}:sources:${jobOrder.version}:${Date.now()}` },
        },
      ),
    onSuccess: invalidate,
  });

  const deliveryDateMutation = useMutation({
    mutationFn: async (requiredDeliveryDate: string | null) =>
      apiClient.patch<ApiSuccessResponse<JobOrder>>(
        `/job-orders/${jobOrder.id}/delivery-date`,
        { requiredDeliveryDate, expectedVersion: jobOrder.version },
        {
          headers: {
            'Idempotency-Key': `${jobOrder.id}:delivery-date:${jobOrder.version}:${Date.now()}`,
          },
        },
      ),
    onSuccess: invalidate,
  });

  return (
    <div className="space-y-4">
      <JobOrderOverviewSummary jobOrder={jobOrder} />

      {jobOrder.sourceOrderSheets && (
        <Panel
          title="Source Order Sheets"
          description={
            jobOrder.status === 'DRAFT'
              ? 'Merchandising planning provenance. Editable while this Job Order is a draft — the mapping freezes once it is sent to factory.'
              : 'Merchandising planning provenance. This mapping is frozen for this Job Order.'
          }
        >
          <div className="space-y-4">
            <DataTable
              density="compact"
              columns={[
                { key: 'poNumber', header: 'Order Sheet', accessor: 'poNumber' },
                { key: 'distributor', header: 'Distributor', render: (os) => os.distributor.name },
                {
                  key: 'purchaseMode',
                  header: 'Mode',
                  render: (os) => (os.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale Return'),
                },
                {
                  key: 'requiredDeliveryDate',
                  header: 'Required Date',
                  render: (os) => (os.requiredDeliveryDate ? formatDateTime(os.requiredDeliveryDate) : 'Not set'),
                },
                {
                  key: 'forecastTotal',
                  header: 'Forecast',
                  align: 'right',
                  render: (os) => os.forecastTotal.toLocaleString(),
                },
                ...(jobOrder.status === 'DRAFT' && canManageJobOrders
                  ? [
                      {
                        key: 'remove',
                        header: '',
                        render: (os: NonNullable<JobOrder['sourceOrderSheets']>[number]) => (
                          <Button
                            type="button"
                            variant="secondary"
                            density="compact"
                            disabled={
                              updateSourcesMutation.isPending || jobOrder.sourceOrderSheets!.length <= 1
                            }
                            onClick={() => updateSourcesMutation.mutate({ add: [], remove: [os.id] })}
                          >
                            Remove
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
              data={jobOrder.sourceOrderSheets}
              rowKey="id"
            />

            {jobOrder.combinedForecast && jobOrder.combinedForecast.length > 0 && (
              <DataTable
                density="compact"
                columns={[
                  { key: 'size', header: 'Size', render: (row) => row.sizeLabel },
                  {
                    key: 'forecast',
                    header: 'Combined Forecast',
                    align: 'right',
                    render: (row) => row.forecastQuantity.toLocaleString(),
                  },
                  {
                    key: 'jobOrder',
                    header: 'Job Order',
                    align: 'right',
                    render: (row) => {
                      const jobOrderQuantity = jobOrder.lines
                        .flatMap((line) => line.sizes)
                        .filter((size) => size.sizeId === row.sizeId)
                        .reduce((sum, size) => sum + size.orderedQuantity, 0);
                      return jobOrderQuantity.toLocaleString();
                    },
                  },
                  {
                    key: 'variance',
                    header: 'Variance',
                    align: 'right',
                    render: (row) => {
                      const jobOrderQuantity = jobOrder.lines
                        .flatMap((line) => line.sizes)
                        .filter((size) => size.sizeId === row.sizeId)
                        .reduce((sum, size) => sum + size.orderedQuantity, 0);
                      return (jobOrderQuantity - row.forecastQuantity).toLocaleString();
                    },
                  },
                ]}
                data={jobOrder.combinedForecast}
                rowKey="sizeId"
              />
            )}

            {jobOrder.status === 'DRAFT' && canManageJobOrders && (
              <OrderSheetMultiSelectField
                label="Add another Order Sheet"
                styleId={jobOrder.lines[0]?.styleId}
                excludeIds={jobOrder.sourceOrderSheets.map((os) => os.id)}
                onSelect={(orderSheet: PurchaseOrder) =>
                  updateSourcesMutation.mutate({ add: [orderSheet.id], remove: [] })
                }
              />
            )}
            {updateSourcesMutation.isError && (
              <ValidationMessage tone="error">
                {mutationErrorMessage(updateSourcesMutation.error, 'Unable to update source Order Sheets.')}
              </ValidationMessage>
            )}
          </div>
        </Panel>
      )}

      {!jobOrder.deliveryDateLocked && canManageJobOrders && (
        <Panel
          title="Delivery Date"
          description="Editable until the factory confirms this Job Order."
          footer={
            <div className="flex justify-end">
              <Button
                onClick={() =>
                  deliveryDateMutation.mutate(
                    (deliveryDateDraft ?? jobOrder.requiredDeliveryDate?.slice(0, 10) ?? '') || null,
                  )
                }
                loading={deliveryDateMutation.isPending}
              >
                Save Delivery Date
              </Button>
            </div>
          }
        >
          <TextField
            label="Required Delivery Date"
            type="date"
            value={deliveryDateDraft ?? jobOrder.requiredDeliveryDate?.slice(0, 10) ?? ''}
            onChange={(event) => setDeliveryDateDraft(event.target.value)}
            width="fill"
          />
          {deliveryDateMutation.isError && (
            <ValidationMessage tone="error">
              {mutationErrorMessage(deliveryDateMutation.error, 'Unable to update the delivery date.')}
            </ValidationMessage>
          )}
        </Panel>
      )}
    </div>
  );
}
