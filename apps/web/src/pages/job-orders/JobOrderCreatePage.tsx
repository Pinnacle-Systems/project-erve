import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Factory, ProcessFlow } from '../master-data/types.js';
import type { JobOrder, JobOrderBalance } from './types.js';

type QuantityRow = {
  id: string;
  purchaseOrderLineId: string;
  purchaseOrderLineSizeId: string;
  style: string;
  size: string;
  orderedQuantity: number;
  jobOrderedQuantity: number;
  balanceQuantity: number;
};

export function JobOrderCreatePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [purchaseOrderId, setPurchaseOrderId] = useState(searchParams.get('purchaseOrderId') ?? '');
  const [factoryId, setFactoryId] = useState('');
  const [processFlowVersionId, setProcessFlowVersionId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const balanceQuery = useQuery({
    queryKey: ['purchase-order-job-order-balance', purchaseOrderId],
    enabled: Boolean(purchaseOrderId),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<JobOrderBalance>>(`/purchase-orders/${purchaseOrderId}/job-order-balance`);
      return res.data.data;
    },
  });

  const factoriesQuery = useQuery({
    queryKey: ['factories', 'active'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Factory[]>>('/factories', { params: { status: 'ACTIVE' } });
      return res.data.data;
    },
  });

  const processFlowsQuery = useQuery({
    queryKey: ['process-flows'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<ProcessFlow[]>>('/process-flows');
      return res.data.data;
    },
  });

  const activeVersions = useMemo(
    () =>
      (processFlowsQuery.data ?? []).flatMap((flow) =>
        flow.versions
          .filter((version) => version.status === 'ACTIVE')
          .map((version) => ({ ...version, label: `${flow.name} v${version.versionNumber}` })),
      ),
    [processFlowsQuery.data],
  );

  const rows: QuantityRow[] = useMemo(
    () =>
      (balanceQuery.data?.lines ?? []).flatMap((line) =>
        line.sizes.map((size) => ({
          id: size.purchaseOrderLineSizeId,
          purchaseOrderLineId: line.lineId,
          purchaseOrderLineSizeId: size.purchaseOrderLineSizeId,
          style: `${line.styleNumber} ${line.styleName}`,
          size: size.sizeCode,
          orderedQuantity: size.orderedQuantity,
          jobOrderedQuantity: size.jobOrderedQuantity,
          balanceQuantity: size.balanceQuantity,
        })),
      ),
    [balanceQuery.data],
  );

  const selectedTotal = rows.reduce((sum, row) => sum + (quantities[row.id] ?? 0), 0);
  const hasInvalidQuantity = rows.some((row) => (quantities[row.id] ?? 0) > row.balanceQuantity);

  const createMutation = useMutation({
    mutationFn: async () => {
      const lineMap = new Map<string, Array<{ purchaseOrderLineSizeId: string; quantity: number }>>();
      for (const row of rows) {
        const quantity = quantities[row.id] ?? 0;
        if (quantity > 0) {
          lineMap.set(row.purchaseOrderLineId, [
            ...(lineMap.get(row.purchaseOrderLineId) ?? []),
            { purchaseOrderLineSizeId: row.purchaseOrderLineSizeId, quantity },
          ]);
        }
      }
      const res = await apiClient.post<ApiSuccessResponse<JobOrder>>('/job-orders', {
        purchaseOrderId,
        factoryId,
        processFlowVersionId,
        lines: Array.from(lineMap.entries()).map(([purchaseOrderLineId, sizes]) => ({ purchaseOrderLineId, sizes })),
      });
      return res.data.data;
    },
    onSuccess: (jobOrder) => navigate(`/job-orders/${jobOrder.id}`),
  });

  const canSubmit = Boolean(purchaseOrderId && factoryId && processFlowVersionId && selectedTotal > 0 && !hasInvalidQuantity);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Create Job Order"
        subtitle={balanceQuery.data ? `From ${balanceQuery.data.poNumber}` : 'Create factory demand from one purchase order'}
        secondaryActions={
          <Button asChild variant="secondary">
            <Link to="/job-orders">Back</Link>
          </Button>
        }
      />

      <Panel title="Source and Assignment">
        <FormGrid columns={3}>
          <TextField
            label="Purchase Order ID"
            value={purchaseOrderId}
            onChange={(event) => {
              const value = event.target.value;
              setPurchaseOrderId(value);
              setSearchParams(value ? { purchaseOrderId: value } : {});
            }}
            width="fill"
          />
          <SelectField label="Factory" value={factoryId || undefined} onValueChange={setFactoryId} width="fill">
            {(factoriesQuery.data ?? []).map((factory) => (
              <SelectItem key={factory.id} value={factory.id}>{factory.name}</SelectItem>
            ))}
          </SelectField>
          <SelectField label="Process Flow Version" value={processFlowVersionId || undefined} onValueChange={setProcessFlowVersionId} width="fill">
            {activeVersions.map((version) => (
              <SelectItem key={version.id} value={version.id}>{version.label}</SelectItem>
            ))}
          </SelectField>
        </FormGrid>
      </Panel>

      {balanceQuery.isLoading && <LoadingState label="Loading PO balance" />}
      {balanceQuery.isError && <ErrorState title="Unable to load PO balance" description={balanceQuery.error.message} />}
      {!purchaseOrderId && (
        <EmptyState title="Select a purchase order" description="Open a submitted PO and use Create Job Order, or paste the PO id here." />
      )}

      {balanceQuery.data && (
        <Panel
          title="Remaining PO Balance"
          description={`Selected quantity: ${selectedTotal.toLocaleString()}`}
          footer={
            <div className="flex items-center justify-between gap-3">
              <div>
                {createMutation.isError && (
                  <ValidationMessage tone="error">
                    {createMutation.error instanceof Error ? createMutation.error.message : 'Unable to create job order'}
                  </ValidationMessage>
                )}
                {hasInvalidQuantity && <ValidationMessage tone="error">One or more quantities exceed remaining PO balance.</ValidationMessage>}
              </div>
              <Button onClick={() => createMutation.mutate()} disabled={!canSubmit} loading={createMutation.isPending}>
                Create Draft
              </Button>
            </div>
          }
        >
          <DataTable
            columns={[
              { key: 'style', header: 'Style', accessor: 'style' },
              { key: 'size', header: 'Size', accessor: 'size' },
              { key: 'orderedQuantity', header: 'Ordered', align: 'right', render: (row) => row.orderedQuantity.toLocaleString() },
              { key: 'jobOrderedQuantity', header: 'Already Job Ordered', align: 'right', render: (row) => row.jobOrderedQuantity.toLocaleString() },
              { key: 'balanceQuantity', header: 'Remaining', align: 'right', render: (row) => row.balanceQuantity.toLocaleString() },
              {
                key: 'quantity',
                header: 'Job Order Qty',
                align: 'right',
                render: (row) => (
                  <TextField
                    aria-label={`Quantity for ${row.style} ${row.size}`}
                    type="number"
                    min={0}
                    max={row.balanceQuantity}
                    value={quantities[row.id] ?? ''}
                    onChange={(event) => {
                      const next = Math.max(0, Number(event.target.value || 0));
                      setQuantities((current) => ({ ...current, [row.id]: next }));
                    }}
                    error={(quantities[row.id] ?? 0) > row.balanceQuantity}
                    density="compact"
                    width="xs"
                  />
                ),
              },
            ]}
            data={rows}
            rowKey="id"
            emptyState={<EmptyState title="No remaining balance" description="This PO has no quantity left for job ordering." />}
          />
        </Panel>
      )}
    </div>
  );
}
