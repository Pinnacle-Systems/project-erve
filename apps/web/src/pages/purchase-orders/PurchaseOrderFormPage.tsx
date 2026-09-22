import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { ErrorState, LoadingState } from '@erve/data-display';
import { Button, DatePicker, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { getLocalDateString } from '../../lib/dates.js';
import { toCompactFinancialYearCode } from '../../lib/financial-years.js';
import type { Distributor, PurchaseOrder, StyleOption } from './types.js';

interface SizeRow {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  orderedQuantity: string;
}

interface LineState {
  styleId: string;
  remarks: string;
  sizes: SizeRow[];
}

const emptyLine = (): LineState => ({ styleId: '', remarks: '', sizes: [] });

export function PurchaseOrderFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [distributorId, setDistributorId] = useState('');
  const [poDate, setPoDate] = useState(getLocalDateString());
  const [requiredDeliveryDate, setRequiredDeliveryDate] = useState('');
  const [remarks, setRemarks] = useState('');
  const [line, setLine] = useState<LineState>(emptyLine());
  const [error, setError] = useState('');

  const poQuery = useQuery({
    queryKey: ['purchase-order', id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${id}`);
      return res.data.data;
    },
  });

  // Read-only preview only — the server derives the authoritative Financial
  // Year from poDate itself on submit; the client never supplies it.
  const financialYearPreviewQuery = useQuery({
    queryKey: ['financial-years', 'resolve', poDate],
    enabled: Boolean(poDate),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<{ code: string }>>('/financial-years/resolve', {
        params: { date: poDate },
      });
      return res.data.data;
    },
  });

  // Only needed to populate the CREATE-mode dropdown. Edit mode shows the
  // Order Sheet's own (immutable) distributor from poQuery.data instead —
  // fetching this list on edit was never necessary and, worse, raced with
  // the po hydration effect (see the Distributor field below).
  const distributorsQuery = useQuery({
    queryKey: ['distributors', 'active'],
    enabled: !isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Distributor[]>>('/distributors', {
        params: { status: 'ACTIVE' },
      });
      return res.data.data;
    },
  });

  const stylesQuery = useQuery({
    queryKey: ['styles', 'active'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<StyleOption[]>>('/styles', {
        params: { status: 'ACTIVE' },
      });
      return res.data.data;
    },
  });

  // The loading guard below keeps the Style <SelectField> unmounted until
  // poQuery resolves, so — unlike Distributor, which is read-only on edit —
  // its <SelectItem>s mount in the very same commit as the hydrated styleId.
  // Radix's SelectBubbleInput syncs a hidden native <select> to the
  // controlled value in a useEffect; when that races the sibling
  // SelectItems' own registration into Radix's internal options collection,
  // the browser finds no matching <option> yet, coerces the native value
  // back to "", and Radix's onChange silently resets styleId to "" right
  // after hydration set it. Confirmed via instrumented repro: hydrating
  // synchronously (or even one React commit later) still raced; only
  // deferring to a fresh macrotask reliably lands after Radix's internal
  // registration settles. This does not occur pre-load-guard, where the
  // form (and its Style options) already mount well before poQuery resolves.
  //
  // hydratedRef makes this initial-load hydration only, run at most once:
  // poQuery has no staleTime override and refetchOnReconnect defaults to
  // true, so a network reconnect while the user is mid-edit would otherwise
  // hand this effect a new poQuery.data reference and silently clobber
  // whatever the user has already changed. The flag is set only once the
  // deferred hydration actually runs (not when merely scheduled), so if a
  // dependency changes and cancels an in-flight (not-yet-fired) attempt, the
  // next effect run still retries with the latest data — hydration is
  // guaranteed to happen exactly once, never skipped and never repeated.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current || !poQuery.data || !stylesQuery.data) return;
    const po = poQuery.data;
    const timer = setTimeout(() => {
      hydratedRef.current = true;
      const firstLine = po.lines[0];
      // Hydrates the edit form from an async-loaded record; the data isn't
      // available for a lazy initial-state computation, so this can't be
      // done without an effect.
      setDistributorId(po.distributor.id);
      setPoDate(po.poDate.slice(0, 10));
      setRequiredDeliveryDate(po.requiredDeliveryDate?.slice(0, 10) ?? '');
      setRemarks(po.remarks ?? '');
      setLine(
        firstLine
          ? {
              styleId: firstLine.styleId,
              remarks: firstLine.remarks ?? '',
              sizes: firstLine.sizes.map((sz) => ({
                sizeId: sz.sizeId,
                sizeCode: sz.sizeCode,
                sizeLabel: sz.sizeLabel,
                orderedQuantity: String(sz.orderedQuantity),
              })),
            }
          : emptyLine(),
      );
    }, 0);
    return () => clearTimeout(timer);
  }, [poQuery.data, stylesQuery.data]);

  function getStyleSizes(styleId: string): StyleOption['sizes'] {
    const style = stylesQuery.data?.find((s) => s.id === styleId);
    return (style?.sizes ?? []).filter((sz) => sz.status === 'ACTIVE' && sz.mappingStatus === 'ACTIVE');
  }

  function handleStyleChange(styleId: string) {
    const sizes = getStyleSizes(styleId);
    setLine((current) => ({
      ...current,
      styleId,
      sizes: sizes.map((sz) => ({ sizeId: sz.id, sizeCode: sz.code, sizeLabel: sz.label, orderedQuantity: '' })),
    }));
  }

  function handleQtyChange(sizeIndex: number, value: string) {
    setLine((current) => ({
      ...current,
      sizes: current.sizes.map((sz, j) => (j === sizeIndex ? { ...sz, orderedQuantity: value } : sz)),
    }));
  }

  // Edit mode reads Purchase Mode straight off the Order Sheet record
  // (PurchaseOrderSummary already carries its own purchaseMode) rather than
  // looking it up from distributorsQuery — that list isn't fetched on edit.
  const selectedDistributor = distributorsQuery.data?.find((d) => d.id === distributorId);
  const purchaseModeCode = isEdit ? poQuery.data?.purchaseMode : selectedDistributor?.purchaseMode;
  const purchaseModeLabel =
    purchaseModeCode === 'OUTRIGHT' ? 'Outright' : purchaseModeCode === 'SALE_RETURN' ? 'Sale or Return' : '';

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!distributorId) throw new Error('Distributor is required');
      if (!poDate) throw new Error('Order Sheet date is required');
      if (!line.styleId) throw new Error('A Style is required');

      const payload = {
        distributorId,
        poDate,
        requiredDeliveryDate: requiredDeliveryDate || null,
        remarks: remarks || null,
        lines: [
          {
            styleId: line.styleId,
            remarks: line.remarks || null,
            sizes: line.sizes
              .filter((sz) => sz.orderedQuantity && Number(sz.orderedQuantity) > 0)
              .map((sz) => ({ sizeId: sz.sizeId, orderedQuantity: Number(sz.orderedQuantity) })),
          },
        ],
      };

      if (payload.lines[0]!.sizes.length === 0) throw new Error('At least one size quantity is required');

      if (isEdit) {
        const res = await apiClient.patch<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${id}`, {
          ...payload,
          distributorId: undefined, // distributor cannot change on edit
        });
        return res.data.data;
      } else {
        const res = await apiClient.post<ApiSuccessResponse<PurchaseOrder>>('/purchase-orders', payload);
        return res.data.data;
      }
    },
    onSuccess: (po) => navigate(`/purchase-orders/${po.id}`),
    onError: (caught) => setError(getApiErrorMessage(caught, 'Unable to save the Order Sheet. Please try again.')),
  });

  if (isEdit && poQuery.isLoading) {
    return <LoadingState label="Loading Order Sheet" />;
  }
  if (isEdit && (poQuery.isError || !poQuery.data)) {
    // Without this guard, a slow or failed GET fell through to the same
    // writable default form CREATE renders — an authorized actor could
    // submit those defaults and PATCH the existing Order Sheet incorrectly.
    return (
      <ErrorState
        title="Unable to load Order Sheet"
        description={poQuery.isError ? poQuery.error.message : 'The selected Order Sheet could not be loaded.'}
      />
    );
  }

  const availableStyles = stylesQuery.data?.filter((s) => s.status === 'ACTIVE') ?? [];
  const sizesForStyle = getStyleSizes(line.styleId);

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Order Sheet' : 'Create Order Sheet'}
        subtitle={isEdit ? 'Update quantities and dates' : 'Create distributor demand as an Order Sheet'}
        secondaryActions={
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        }
      />

      <Panel>
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <FormSection title="Order Sheet Header">
            <FormGrid layout="content">
              {isEdit ? (
                // Distributor is immutable on edit; read-only text avoids the
                // interactive Radix Select (and its BubbleSelect hydration
                // race) entirely, mirroring the fix already applied to Sale
                // Order's Distributor field for the identical bug.
                <TextField label="Distributor *" value={poQuery.data!.distributor.name} disabled width="md" />
              ) : (
                <SelectField
                  label="Distributor *"
                  value={distributorId || 'NONE'}
                  onValueChange={(value) => setDistributorId(value === 'NONE' ? '' : value)}
                  width="md"
                >
                  <SelectItem value="NONE">Select distributor</SelectItem>
                  {(distributorsQuery.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectField>
              )}

              <TextField label="Purchase Mode" value={purchaseModeLabel} disabled width="sm" />

              <DatePicker
                label="Order Sheet Date *"
                value={poDate}
                onValueChange={(value) => setPoDate(value ?? '')}
                displayFormat="dd/mm/yyyy"
                width="sm"
              />
              <DatePicker
                label="Required Delivery Date"
                value={requiredDeliveryDate}
                onValueChange={(value) => setRequiredDeliveryDate(value ?? '')}
                displayFormat="dd/mm/yyyy"
                width="sm"
              />
              <TextField
                label="Financial Year"
                value={
                  financialYearPreviewQuery.data
                    ? toCompactFinancialYearCode(financialYearPreviewQuery.data.code)
                    : ''
                }
                disabled
                width="sm"
              />
            </FormGrid>

            <TextField
              label="Remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              width="full"
            />
          </FormSection>

          <FormSection title="Style">
            <Panel variant="bordered" padding="sm" className="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <SelectField
                  label="Style *"
                  value={line.styleId || 'NONE'}
                  onValueChange={(value) => handleStyleChange(value === 'NONE' ? '' : value)}
                  width="lg"
                >
                  <SelectItem value="NONE">Select style</SelectItem>
                  {availableStyles.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.styleNumber} - {s.styleName}
                    </SelectItem>
                  ))}
                </SelectField>
                <TextField
                  label="Remarks"
                  value={line.remarks}
                  width="lg"
                  onChange={(e) => setLine((current) => ({ ...current, remarks: e.target.value }))}
                />
              </div>

              {line.styleId && sizesForStyle.length > 0 && (
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                    Size Quantities
                  </div>
                  <FormGrid layout="content" gap="sm">
                    {(line.sizes.length > 0 ? line.sizes : sizesForStyle.map((sz) => ({
                      sizeId: sz.id,
                      sizeCode: sz.code,
                      sizeLabel: sz.label,
                      orderedQuantity: '',
                    }))).map((sz, szIndex) => (
                      <TextField
                        key={sz.sizeId}
                        label={sz.sizeCode}
                        type="number"
                        min="1"
                        value={sz.orderedQuantity}
                        onChange={(e) => handleQtyChange(szIndex, e.target.value)}
                        placeholder="0"
                        density="compact"
                        width="xs"
                      />
                    ))}
                  </FormGrid>
                </div>
              )}
            </Panel>
          </FormSection>

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Save
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
