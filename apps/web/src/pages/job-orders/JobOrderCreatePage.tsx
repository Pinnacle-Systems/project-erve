import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { DataTable, EmptyState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { Factory, ProcessFlow, Style } from '../master-data/types.js';
import type { PurchaseOrder } from '../purchase-orders/types.js';
import { OrderSheetMultiSelectField } from './OrderSheetMultiSelectField.js';
import type { JobOrder } from './types.js';

interface SizeRow {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
}

function formatDate(iso: string | null) {
  if (!iso) return 'No date';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function JobOrderCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const deepLinkOrderSheetId = searchParams.get('purchaseOrderId');
  const [selectedOrderSheets, setSelectedOrderSheets] = useState<PurchaseOrder[]>([]);
  // quantities[orderSheetId][sizeId] = the production quantity entered
  // against that specific source's line for that size. Kept per-source
  // because JobOrderLineSize still resolves to one specific source Order
  // Sheet's line/size (downstream QA-passed-stock attribution depends on
  // it) — see job-orders.service.ts createJobOrderLineForSource. Each
  // source defaults to its own forecast; the Merchandiser may edit any
  // cell freely, independent of the others.
  const [quantities, setQuantities] = useState<Record<string, Record<string, number>>>({});
  const [factoryId, setFactoryId] = useState('');
  const [processFlowVersionId, setProcessFlowVersionId] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [priceEdited, setPriceEdited] = useState(false);
  const [disclaimerText, setDisclaimerText] = useState('');
  const [deliveryDateOverride, setDeliveryDateOverride] = useState('');

  const styleId = selectedOrderSheets[0]?.lines[0]?.styleId;

  function addOrderSheet(orderSheet: PurchaseOrder) {
    setSelectedOrderSheets((current) => [...current, orderSheet]);
    const line = orderSheet.lines[0];
    setQuantities((current) => ({
      ...current,
      [orderSheet.id]: Object.fromEntries(
        (line?.sizes ?? []).map((size) => [size.sizeId, size.orderedQuantity]),
      ),
    }));
  }

  function removeOrderSheet(id: string) {
    setSelectedOrderSheets((current) => current.filter((os) => os.id !== id));
    setQuantities((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  const deepLinkQuery = useQuery({
    queryKey: ['purchase-order', deepLinkOrderSheetId],
    enabled: Boolean(deepLinkOrderSheetId),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PurchaseOrder>>(
        `/purchase-orders/${deepLinkOrderSheetId}`,
      );
      return res.data.data;
    },
  });
  /* eslint-disable react-hooks/set-state-in-effect -- deep-link pre-selection, mirrors the
     Order Sheet forecast pre-fill pattern below */
  useEffect(() => {
    if (!deepLinkQuery.data) return;
    setSelectedOrderSheets((current) => {
      if (current.some((os) => os.id === deepLinkQuery.data!.id)) return current;
      return [...current, deepLinkQuery.data!];
    });
    setQuantities((current) => {
      if (current[deepLinkQuery.data!.id]) return current;
      const line = deepLinkQuery.data!.lines[0];
      return {
        ...current,
        [deepLinkQuery.data!.id]: Object.fromEntries(
          (line?.sizes ?? []).map((size) => [size.sizeId, size.orderedQuantity]),
        ),
      };
    });
  }, [deepLinkQuery.data]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
          .map((version) => ({ ...version, label: `${flow.name} v${version.versionNumber}` })),
      ),
    [processFlowsQuery.data],
  );

  const styleDetailQuery = useQuery({
    queryKey: ['style', styleId],
    enabled: Boolean(styleId),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Style>>(`/styles/${styleId}`);
      return res.data.data;
    },
  });
  const mappedUnitPrice = factoryId
    ? styleDetailQuery.data?.factories.find((f) => f.id === factoryId)?.exFactoryPrice
    : undefined;
  const effectiveUnitPrice = priceEdited
    ? unitPrice
    : mappedUnitPrice == null
      ? ''
      : String(mappedUnitPrice);

  // Union of sizes across every selected source, in first-seen order.
  const sizeRows: SizeRow[] = useMemo(() => {
    const seen = new Map<string, SizeRow>();
    for (const orderSheet of selectedOrderSheets) {
      for (const size of orderSheet.lines[0]?.sizes ?? []) {
        if (!seen.has(size.sizeId)) {
          seen.set(size.sizeId, { sizeId: size.sizeId, sizeCode: size.sizeCode, sizeLabel: size.sizeLabel });
        }
      }
    }
    return [...seen.values()];
  }, [selectedOrderSheets]);

  const combinedForecastBySize = useMemo(() => {
    const totals = new Map<string, number>();
    for (const orderSheet of selectedOrderSheets) {
      for (const size of orderSheet.lines[0]?.sizes ?? []) {
        totals.set(size.sizeId, (totals.get(size.sizeId) ?? 0) + size.orderedQuantity);
      }
    }
    return totals;
  }, [selectedOrderSheets]);

  const jobOrderTotalBySize = useMemo(() => {
    const totals = new Map<string, number>();
    for (const orderSheet of selectedOrderSheets) {
      const bySize = quantities[orderSheet.id] ?? {};
      for (const sizeId of Object.keys(bySize)) {
        totals.set(sizeId, (totals.get(sizeId) ?? 0) + (bySize[sizeId] ?? 0));
      }
    }
    return totals;
  }, [quantities, selectedOrderSheets]);

  const grandTotal = [...jobOrderTotalBySize.values()].reduce((sum, qty) => sum + qty, 0);

  const distinctDeliveryDates = useMemo(
    () => [...new Set(selectedOrderSheets.map((os) => os.requiredDeliveryDate ?? ''))],
    [selectedOrderSheets],
  );
  const deliveryDatesAgree = distinctDeliveryDates.length <= 1;
  const resolvedDeliveryDate = deliveryDatesAgree
    ? (distinctDeliveryDates[0]?.slice(0, 10) ?? '')
    : deliveryDateOverride;

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<JobOrder>>('/job-orders', {
        sources: selectedOrderSheets.map((orderSheet) => ({
          orderSheetId: orderSheet.id,
          sizes: (orderSheet.lines[0]?.sizes ?? []).map((size) => ({
            sizeId: size.sizeId,
            quantity: quantities[orderSheet.id]?.[size.sizeId] ?? 0,
          })),
        })),
        factoryId,
        processFlowVersionId,
        unitPrice: effectiveUnitPrice,
        disclaimerText,
        requiredDeliveryDate: deliveryDatesAgree ? undefined : deliveryDateOverride || undefined,
      });
      return res.data.data;
    },
    onSuccess: (jobOrder) => navigate(`/job-orders/${jobOrder.id}`),
  });

  const canSubmit = Boolean(
    selectedOrderSheets.length > 0 &&
      factoryId &&
      processFlowVersionId &&
      effectiveUnitPrice &&
      grandTotal > 0 &&
      (deliveryDatesAgree || deliveryDateOverride),
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title="Create Job Order"
        subtitle="Consolidate one or more compatible Order Sheets into one factory production instruction"
        secondaryActions={
          <Button asChild variant="secondary">
            <Link to="/job-orders">Back</Link>
          </Button>
        }
      />

      <Panel
        title="Source Order Sheets"
        description="Every selected Order Sheet must share the same Style. Distributors and Purchase Modes may differ."
      >
        <div className="space-y-4">
          {selectedOrderSheets.length > 0 && (
            <DataTable
              columns={[
                { key: 'poNumber', header: 'Order Sheet', accessor: 'poNumber' },
                {
                  key: 'distributor',
                  header: 'Distributor',
                  render: (os) => os.distributor.name,
                },
                {
                  key: 'purchaseMode',
                  header: 'Mode',
                  render: (os) => (
                    <StatusBadge
                      label={os.purchaseMode === 'OUTRIGHT' ? 'Outright' : 'Sale Return'}
                      tone={os.purchaseMode === 'OUTRIGHT' ? 'info' : 'pending'}
                    />
                  ),
                },
                {
                  key: 'requiredDeliveryDate',
                  header: 'Required Date',
                  render: (os) => formatDate(os.requiredDeliveryDate),
                },
                {
                  key: 'style',
                  header: 'Style',
                  render: (os) =>
                    os.lines[0] ? `${os.lines[0].styleNumber} ${os.lines[0].styleName}` : '—',
                },
                {
                  key: 'remove',
                  header: '',
                  render: (os) => (
                    <Button
                      type="button"
                      variant="secondary"
                      density="compact"
                      onClick={() => removeOrderSheet(os.id)}
                    >
                      Remove
                    </Button>
                  ),
                },
              ]}
              data={selectedOrderSheets}
              rowKey="id"
            />
          )}
          <OrderSheetMultiSelectField
            styleId={styleId}
            excludeIds={selectedOrderSheets.map((os) => os.id)}
            onSelect={addOrderSheet}
          />
          {styleId && (
            <p className="text-xs text-muted-foreground">
              Only Order Sheets for this Style are shown — one Job Order can contain only one Style.
            </p>
          )}
        </div>
      </Panel>

      {selectedOrderSheets.length === 0 && (
        <EmptyState
          title="Select at least one Order Sheet"
          description="Search above and select one or more compatible Order Sheets to plan this Job Order."
        />
      )}

      {selectedOrderSheets.length > 0 && (
        <Panel title="Factory Assignment">
          <FormGrid columns={3}>
            <SelectField label="Factory" value={factoryId || undefined} onValueChange={setFactoryId} width="fill">
              {(factoriesQuery.data ?? []).map((factory) => (
                <SelectItem key={factory.id} value={factory.id}>
                  {factory.name}
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
                <SelectItem key={version.id} value={version.id} disabled={!version.runtimeSupport.supported}>
                  {version.label}
                  {!version.runtimeSupport.supported
                    ? ` — ${version.runtimeSupport.reasons[0] ?? 'Unsupported by the Job Order runtime'}`
                    : ''}
                </SelectItem>
              ))}
            </SelectField>
            {deliveryDatesAgree ? (
              <TextField
                label="Required Delivery Date"
                value={formatDate(resolvedDeliveryDate ? `${resolvedDeliveryDate}T00:00:00.000Z` : null)}
                disabled
                helpText="Every selected Order Sheet shares this date."
                width="fill"
              />
            ) : (
              <TextField
                label="Required Delivery Date"
                type="date"
                value={deliveryDateOverride}
                onChange={(event) => setDeliveryDateOverride(event.target.value)}
                helpText="Selected Order Sheets have different dates — set the Job Order's own target date."
                width="fill"
              />
            )}
            <label className="col-span-full flex flex-col gap-1 text-sm font-medium">
              Factory commercial terms / disclaimer
              <textarea
                className="min-h-28 rounded-md border border-border bg-background px-3 py-2 font-normal"
                value={disclaimerText}
                maxLength={10000}
                onChange={(event) => setDisclaimerText(event.target.value)}
                aria-describedby="job-order-disclaimer-help"
              />
              <span id="job-order-disclaimer-help" className="text-xs font-normal text-muted-foreground">
                The factory must acknowledge these plain-text terms before confirmation.{' '}
                {disclaimerText.length}/10,000
              </span>
            </label>
          </FormGrid>
        </Panel>
      )}

      {selectedOrderSheets.length > 0 && sizeRows.length > 0 && (
        <Panel
          title="Combined Order Sheet Forecast vs Job Order Quantities"
          description="Job Order quantities default to the combined forecast and may be freely adjusted per size, per source — no cap or minimum applies."
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
              </div>
              <Button onClick={() => createMutation.mutate()} disabled={!canSubmit} loading={createMutation.isPending}>
                Create Draft
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <DataTable
              density="compact"
              columns={[
                { key: 'size', header: 'Size', render: (size) => size.sizeLabel },
                {
                  key: 'forecast',
                  header: 'Combined Forecast',
                  align: 'right',
                  render: (size) => (combinedForecastBySize.get(size.sizeId) ?? 0).toLocaleString(),
                },
                {
                  key: 'jobOrder',
                  header: 'Job Order',
                  align: 'right',
                  render: (size) => (jobOrderTotalBySize.get(size.sizeId) ?? 0).toLocaleString(),
                },
                {
                  key: 'variance',
                  header: 'Variance',
                  align: 'right',
                  render: (size) =>
                    (
                      (jobOrderTotalBySize.get(size.sizeId) ?? 0) - (combinedForecastBySize.get(size.sizeId) ?? 0)
                    ).toLocaleString(),
                },
              ]}
              data={sizeRows}
              rowKey="sizeId"
            />
            {selectedOrderSheets.map((orderSheet) => (
              <div key={orderSheet.id} className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {orderSheet.poNumber} · {orderSheet.distributor.name}
                </h3>
                <DataTable
                  density="compact"
                  columns={[
                    { key: 'size', header: 'Size', render: (size) => size.sizeLabel },
                    {
                      key: 'forecast',
                      header: 'Order Sheet Forecast',
                      align: 'right',
                      render: (size) =>
                        (
                          orderSheet.lines[0]?.sizes.find((s) => s.sizeId === size.sizeId)?.orderedQuantity ?? 0
                        ).toLocaleString(),
                    },
                    {
                      key: 'quantity',
                      header: 'Job Order Qty',
                      align: 'right',
                      render: (size) => (
                        <TextField
                          aria-label={`Quantity for ${orderSheet.poNumber} ${size.sizeLabel}`}
                          type="number"
                          min={0}
                          value={quantities[orderSheet.id]?.[size.sizeId] ?? ''}
                          onChange={(event) => {
                            const next = Math.max(0, Number(event.target.value || 0));
                            setQuantities((current) => ({
                              ...current,
                              [orderSheet.id]: { ...current[orderSheet.id], [size.sizeId]: next },
                            }));
                          }}
                          density="compact"
                          width="xs"
                        />
                      ),
                    },
                  ]}
                  data={orderSheet.lines[0]?.sizes.map((s) => ({ sizeId: s.sizeId, sizeLabel: s.sizeLabel })) ?? []}
                  rowKey="sizeId"
                />
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
