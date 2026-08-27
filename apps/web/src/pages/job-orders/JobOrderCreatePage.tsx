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
import { PurchaseOrderLookupField, type PurchaseOrderLookupValue } from './PurchaseOrderLookupField.js';
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
  const [selectedPurchaseOrder, setSelectedPurchaseOrder] = useState<PurchaseOrderLookupValue | null>(
    () => {
      const paramId = searchParams.get('purchaseOrderId');
      return paramId ? { id: paramId, poNumber: '' } : null;
    },
  );
  const purchaseOrderId = selectedPurchaseOrder?.id ?? '';
  const [factoryId, setFactoryId] = useState('');
  const [processFlowVersionId, setProcessFlowVersionId] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedStyleId, setSelectedStyleId] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [disclaimerText, setDisclaimerText] = useState('');
  const [priceEdited, setPriceEdited] = useState(false);

  const balanceQuery = useQuery({
    queryKey: ['purchase-order-job-order-balance', purchaseOrderId, factoryId],
    enabled: Boolean(purchaseOrderId),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<JobOrderBalance>>(
        `/purchase-orders/${purchaseOrderId}/job-order-balance`,
        { params: { factoryId } },
      );
      return res.data.data;
    },
  });

  // For the deep-link ?purchaseOrderId= entry path only the internal id is
  // known up front; the balance endpoint's response (already fetched above)
  // resolves the human-readable poNumber for display without a second
  // PO-by-id fetch.
  const displayedPurchaseOrder = selectedPurchaseOrder
    ? { id: selectedPurchaseOrder.id, poNumber: selectedPurchaseOrder.poNumber || balanceQuery.data?.poNumber || '' }
    : null;

  function resetPurchaseOrderDerivedState() {
    setSelectedStyleId('');
    setQuantities({});
    setPriceEdited(false);
    setUnitPrice('');
  }

  function handleSelectPurchaseOrder(po: PurchaseOrderLookupValue) {
    resetPurchaseOrderDerivedState();
    setSelectedPurchaseOrder(po);
    setSearchParams({ purchaseOrderId: po.id });
  }

  function handleClearPurchaseOrder() {
    resetPurchaseOrderDerivedState();
    setSelectedPurchaseOrder(null);
    setSearchParams({});
  }

  const factoriesQuery = useQuery({
    queryKey: ['factories', 'active'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Factory[]>>('/factories', {
        params: { status: 'ACTIVE' },
      });
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
          .map((version) => ({
            ...version,
            label: `${flow.name} v${version.versionNumber}`,
          })),
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

  const styles = useMemo(
    () =>
      Array.from(
        new Map(
          rows.map((row) => [
            row.purchaseOrderLineId,
            { id: row.purchaseOrderLineId, label: row.style },
          ]),
        ).values(),
      ),
    [rows],
  );
  const visibleRows = selectedStyleId
    ? rows.filter((row) => row.purchaseOrderLineId === selectedStyleId)
    : [];

  const selectedStyle = balanceQuery.data?.lines.find((line) => line.lineId === selectedStyleId);
  const mappedUnitPrice = selectedStyle
    ? balanceQuery.data?.styleFactoryPrices?.[selectedStyle.styleId]
    : undefined;
  const effectiveUnitPrice = priceEdited
    ? unitPrice
    : mappedUnitPrice == null
      ? ''
      : String(mappedUnitPrice);

  const selectedTotal = visibleRows.reduce((sum, row) => sum + (quantities[row.id] ?? 0), 0);
  const hasInvalidQuantity = visibleRows.some(
    (row) => (quantities[row.id] ?? 0) > row.balanceQuantity,
  );

  const createMutation = useMutation({
    mutationFn: async () => {
      const lineMap = new Map<
        string,
        Array<{ purchaseOrderLineSizeId: string; quantity: number }>
      >();
      for (const row of visibleRows) {
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
        unitPrice: effectiveUnitPrice,
        disclaimerText,
        lines: Array.from(lineMap.entries()).map(([purchaseOrderLineId, sizes]) => ({
          purchaseOrderLineId,
          sizes,
        })),
      });
      return res.data.data;
    },
    onSuccess: (jobOrder) => navigate(`/job-orders/${jobOrder.id}`),
  });

  const canSubmit = Boolean(
    purchaseOrderId &&
    factoryId &&
    processFlowVersionId &&
    selectedStyleId &&
    effectiveUnitPrice &&
    selectedTotal > 0 &&
    !hasInvalidQuantity,
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Create Job Order"
        subtitle={
          balanceQuery.data
            ? `From ${balanceQuery.data.poNumber}`
            : 'Create factory demand from one purchase order'
        }
        secondaryActions={
          <Button asChild variant="secondary">
            <Link to="/job-orders">Back</Link>
          </Button>
        }
      />

      <Panel title="Source and Assignment">
        <FormGrid columns={3}>
          <PurchaseOrderLookupField
            selected={displayedPurchaseOrder}
            onSelect={handleSelectPurchaseOrder}
            onClear={handleClearPurchaseOrder}
          />
          <SelectField
            label="Factory"
            value={factoryId || undefined}
            onValueChange={setFactoryId}
            width="fill"
          >
            {(factoriesQuery.data ?? []).map((factory) => (
              <SelectItem key={factory.id} value={factory.id}>
                {factory.name}
              </SelectItem>
            ))}
          </SelectField>
          <SelectField
            label="Style (one per Job Order)"
            value={selectedStyleId || undefined}
            onValueChange={(value) => {
              setSelectedStyleId(value);
              setQuantities({});
              setPriceEdited(false);
              setUnitPrice('');
            }}
            width="fill"
          >
            {styles.map((style) => (
              <SelectItem key={style.id} value={style.id}>
                {style.label}
              </SelectItem>
            ))}
          </SelectField>
          <TextField
            label="Unit price (INR)"
            value={effectiveUnitPrice}
            inputMode="decimal"
            placeholder="Enter factory unit price"
            onChange={(event) => {
              setPriceEdited(true);
              setUnitPrice(event.target.value);
            }}
            error={Boolean(
              effectiveUnitPrice &&
              (!/^\d+(\.\d{1,2})?$/.test(effectiveUnitPrice) || Number(effectiveUnitPrice) <= 0),
            )}
            width="fill"
          />
          <SelectField
            label="Process Flow Version"
            value={processFlowVersionId || undefined}
            onValueChange={setProcessFlowVersionId}
            helpText="Unsupported versions remain configurable in Process Flow Master but cannot be assigned to new Job Orders."
            width="fill"
          >
            {activeVersions.map((version) => (
              <SelectItem
                key={version.id}
                value={version.id}
                disabled={!version.runtimeSupport.supported}
              >
                {version.label}
                {!version.runtimeSupport.supported
                  ? ` — ${version.runtimeSupport.reasons[0] ?? 'Unsupported by the Job Order runtime'}`
                  : ''}
              </SelectItem>
            ))}
          </SelectField>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Factory commercial terms / disclaimer
            <textarea
              className="min-h-28 rounded-md border border-border bg-background px-3 py-2 font-normal"
              value={disclaimerText}
              maxLength={10000}
              onChange={(event) => setDisclaimerText(event.target.value)}
              aria-describedby="job-order-disclaimer-help"
            />
            <span
              id="job-order-disclaimer-help"
              className="text-xs font-normal text-muted-foreground"
            >
              The factory must acknowledge these plain-text terms before confirmation.{' '}
              {disclaimerText.length}/10,000
            </span>
          </label>
        </FormGrid>
      </Panel>

      {balanceQuery.isLoading && <LoadingState label="Loading PO balance" />}
      {balanceQuery.isError && (
        <ErrorState title="Unable to load PO balance" description={balanceQuery.error.message} />
      )}
      {!purchaseOrderId && (
        <EmptyState
          title="Select a purchase order"
          description="Open a submitted PO and use Create Job Order, or search for one above."
        />
      )}

      {balanceQuery.data && selectedStyleId && (
        <Panel
          title="Remaining PO Balance"
          description={`Selected quantity: ${selectedTotal.toLocaleString()}`}
          footer={
            <div className="flex items-center justify-between gap-3">
              <div>
                {createMutation.isError && (
                  <ValidationMessage tone="error">
                    {createMutation.error instanceof Error
                      ? createMutation.error.message
                      : 'Unable to create job order'}
                  </ValidationMessage>
                )}
                {hasInvalidQuantity && (
                  <ValidationMessage tone="error">
                    One or more quantities exceed remaining PO balance.
                  </ValidationMessage>
                )}
              </div>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!canSubmit}
                loading={createMutation.isPending}
              >
                Create Draft
              </Button>
            </div>
          }
        >
          <DataTable
            columns={[
              { key: 'style', header: 'Style', accessor: 'style' },
              { key: 'size', header: 'Size', accessor: 'size' },
              {
                key: 'orderedQuantity',
                header: 'Ordered',
                align: 'right',
                render: (row) => row.orderedQuantity.toLocaleString(),
              },
              {
                key: 'jobOrderedQuantity',
                header: 'Already Job Ordered',
                align: 'right',
                render: (row) => row.jobOrderedQuantity.toLocaleString(),
              },
              {
                key: 'balanceQuantity',
                header: 'Remaining',
                align: 'right',
                render: (row) => row.balanceQuantity.toLocaleString(),
              },
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
            data={visibleRows}
            rowKey="id"
            emptyState={
              <EmptyState
                title="No remaining balance"
                description="This PO has no quantity left for job ordering."
              />
            }
          />
        </Panel>
      )}
    </div>
  );
}
