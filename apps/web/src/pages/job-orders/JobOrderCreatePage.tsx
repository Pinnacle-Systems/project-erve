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
  sortOrder: number;
  // Currently valid for the shared Style (ACTIVE StyleSize mapping + ACTIVE
  // Size) — the Production Plan quantity is only editable for these. A row
  // can still appear here with active: false when a selected Order Sheet's
  // historical forecast references a size that has since become inactive or
  // had its Style mapping removed entirely — its forecast stays visible,
  // just not producible.
  active: boolean;
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
  // The Job Order's OWN production plan (Phase 2.1) — one flat quantity per
  // size, entirely independent of any source Order Sheet. touchedSizeIds
  // tracks which sizes the Merchandiser has manually edited: an untouched
  // size keeps following the Combined Forecast default as sources change;
  // a touched size never gets overwritten by a source change again.
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [touchedSizeIds, setTouchedSizeIds] = useState<Set<string>>(new Set());
  const [factoryId, setFactoryId] = useState('');
  const [processFlowVersionId, setProcessFlowVersionId] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [priceEdited, setPriceEdited] = useState(false);
  const [disclaimerText, setDisclaimerText] = useState('');
  const [deliveryDateOverride, setDeliveryDateOverride] = useState('');

  const styleId = selectedOrderSheets[0]?.lines[0]?.styleId;

  function addOrderSheet(orderSheet: PurchaseOrder) {
    setSelectedOrderSheets((current) => [...current, orderSheet]);
  }

  function removeOrderSheet(id: string) {
    setSelectedOrderSheets((current) => current.filter((os) => os.id !== id));
  }

  function setSizeQuantity(sizeId: string, value: number) {
    setTouchedSizeIds((current) => {
      const next = new Set(current);
      next.add(sizeId);
      return next;
    });
    setQuantities((current) => ({ ...current, [sizeId]: value }));
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
  /* eslint-disable react-hooks/set-state-in-effect -- deep-link pre-selection */
  useEffect(() => {
    if (!deepLinkQuery.data) return;
    setSelectedOrderSheets((current) => {
      if (current.some((os) => os.id === deepLinkQuery.data!.id)) return current;
      return [...current, deepLinkQuery.data!];
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

  // Style-change reset (Phase 2.1): clear the Production Plan whenever the
  // effective shared Style actually changes (e.g. every Style-A source is
  // removed and a Style-B one is added) — Style-A quantities/touched state
  // must never leak into a Style-B plan.
  /* eslint-disable react-hooks/set-state-in-effect -- style-change reset */
  useEffect(() => {
    setQuantities({});
    setTouchedSizeIds(new Set());
  }, [styleId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const combinedForecastBySize = useMemo(() => {
    const totals = new Map<string, number>();
    for (const orderSheet of selectedOrderSheets) {
      for (const size of orderSheet.lines[0]?.sizes ?? []) {
        totals.set(size.sizeId, (totals.get(size.sizeId) ?? 0) + size.orderedQuantity);
      }
    }
    return totals;
  }, [selectedOrderSheets]);

  // The Production Plan's size columns come from the Style's own canonical
  // valid-size list (Phase 2.1) — not from union(selected Order Sheet
  // sizes). A size the Style currently maps as ACTIVE (and whose own Size
  // master row is ACTIVE) is producible; every other size that appears in a
  // selected Order Sheet's forecast (deactivated, or its StyleSize mapping
  // removed entirely) is still shown for historical/provenance context, just
  // not editable.
  const sizeRows: SizeRow[] = useMemo(() => {
    const bySizeId = new Map<string, SizeRow>();
    for (const size of styleDetailQuery.data?.sizes ?? []) {
      bySizeId.set(size.id, {
        sizeId: size.id,
        sizeCode: size.code,
        sizeLabel: size.label,
        sortOrder: size.sortOrder,
        active: size.status === 'ACTIVE' && size.mappingStatus === 'ACTIVE',
      });
    }
    for (const orderSheet of selectedOrderSheets) {
      for (const size of orderSheet.lines[0]?.sizes ?? []) {
        if (bySizeId.has(size.sizeId)) continue;
        bySizeId.set(size.sizeId, {
          sizeId: size.sizeId,
          sizeCode: size.sizeCode,
          sizeLabel: size.sizeLabel,
          sortOrder: Number.POSITIVE_INFINITY,
          active: false,
        });
      }
    }
    return [...bySizeId.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [styleDetailQuery.data, selectedOrderSheets]);

  // Untouched sizes keep following the Combined Forecast default; a size the
  // Merchandiser has manually edited is never overwritten by a source change.
  /* eslint-disable react-hooks/set-state-in-effect -- forecast-driven defaults */
  useEffect(() => {
    setQuantities((current) => {
      let changed = false;
      const next = { ...current };
      for (const row of sizeRows) {
        if (!row.active || touchedSizeIds.has(row.sizeId)) continue;
        const forecastDefault = combinedForecastBySize.get(row.sizeId) ?? 0;
        if (next[row.sizeId] !== forecastDefault) {
          next[row.sizeId] = forecastDefault;
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [combinedForecastBySize, sizeRows, touchedSizeIds]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const grandTotal = sizeRows
    .filter((row) => row.active)
    .reduce((sum, row) => sum + (quantities[row.sizeId] ?? 0), 0);

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
        orderSheetIds: selectedOrderSheets.map((orderSheet) => orderSheet.id),
        sizes: sizeRows
          .filter((row) => row.active)
          .map((row) => ({ sizeId: row.sizeId, quantity: quantities[row.sizeId] ?? 0 })),
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
        description="Every selected Order Sheet must share the same Style. Distributors and Purchase Modes may differ. These are planning provenance only — they do not set the Production Plan's quantities."
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
          title="Combined Forecast vs Production Plan"
          description="The Production Plan is the Job Order's own, independent production quantity per size — it defaults to the Combined Forecast but is freely editable and is never re-derived from source Order Sheets once you edit it."
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
          <DataTable
            density="compact"
            columns={[
              { key: 'size', header: 'Size', render: (row) => row.sizeLabel },
              {
                key: 'forecast',
                header: 'Combined Forecast',
                align: 'right',
                render: (row) => (combinedForecastBySize.get(row.sizeId) ?? 0).toLocaleString(),
              },
              {
                key: 'productionPlan',
                header: 'Production Plan',
                align: 'right',
                render: (row) =>
                  row.active ? (
                    <TextField
                      aria-label={`Production quantity for ${row.sizeLabel}`}
                      type="number"
                      min={0}
                      value={quantities[row.sizeId] ?? ''}
                      onChange={(event) => setSizeQuantity(row.sizeId, Math.max(0, Number(event.target.value || 0)))}
                      density="compact"
                      width="xs"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">Size inactive — cannot be produced</span>
                  ),
              },
              {
                key: 'variance',
                header: 'Variance',
                align: 'right',
                render: (row) =>
                  (
                    (row.active ? (quantities[row.sizeId] ?? 0) : 0) -
                    (combinedForecastBySize.get(row.sizeId) ?? 0)
                  ).toLocaleString(),
              },
            ]}
            data={sizeRows}
            rowKey="sizeId"
          />
        </Panel>
      )}
    </div>
  );
}
