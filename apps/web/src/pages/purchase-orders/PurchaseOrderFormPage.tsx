import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse, DistributorOption, OrderSheetStyleDetail } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { ErrorState, LoadingState } from '@erve/data-display';
import { Button, DatePicker, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { getLocalDateString } from '../../lib/dates.js';
import { toCompactFinancialYearCode } from '../../lib/financial-years.js';
import { StyleLookupField, type StyleLookupValue } from './StyleLookupField.js';
import { DistributorLookupField } from '../master-data/DistributorLookupField.js';
import type { PurchaseOrder } from './types.js';

interface SizeRow {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  orderedQuantity: string;
}

interface LineState {
  styleId: string;
  remarks: string;
  // Empty until the user types a quantity for a newly selected Style — the
  // rows are then derived from that Style's orderable sizes (see sizeRows).
  // An edited Order Sheet starts with its saved sizes here.
  sizes: SizeRow[];
}

const emptyLine = (): LineState => ({ styleId: '', remarks: '', sizes: [] });

function toBlankSizeRows(sizes: OrderSheetStyleDetail['sizes']): SizeRow[] {
  return sizes.map((sz) => ({ sizeId: sz.id, sizeCode: sz.code, sizeLabel: sz.label, orderedQuantity: '' }));
}

export function PurchaseOrderFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);

  const poQuery = useQuery({
    queryKey: ['purchase-order', id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${id}`);
      return res.data.data;
    },
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

  // The form initialises its state from the loaded record once, on mount —
  // no hydration effect. So a background refetch of poQuery (e.g. on
  // reconnect) can never clobber an in-progress edit, and keying by id gives
  // a fresh form when the route moves from one Order Sheet to another.
  return <PurchaseOrderForm key={poQuery.data?.id ?? 'new'} existing={poQuery.data} />;
}

function PurchaseOrderForm({ existing }: { existing?: PurchaseOrder }) {
  const navigate = useNavigate();
  const isEdit = Boolean(existing);
  const existingLine = existing?.lines[0];

  // Create mode only — the Distributor is immutable on edit, which shows the
  // Order Sheet's own distributor instead.
  const [selectedDistributor, setSelectedDistributor] = useState<DistributorOption | null>(null);
  const [poDate, setPoDate] = useState(existing ? existing.poDate.slice(0, 10) : getLocalDateString());
  const [requiredDeliveryDate, setRequiredDeliveryDate] = useState(
    existing?.requiredDeliveryDate?.slice(0, 10) ?? '',
  );
  const [remarks, setRemarks] = useState(existing?.remarks ?? '');
  const [line, setLine] = useState<LineState>(() =>
    existingLine
      ? {
          styleId: existingLine.styleId,
          remarks: existingLine.remarks ?? '',
          sizes: existingLine.sizes.map((sz) => ({
            sizeId: sz.sizeId,
            sizeCode: sz.sizeCode,
            sizeLabel: sz.sizeLabel,
            orderedQuantity: String(sz.orderedQuantity),
          })),
        }
      : emptyLine(),
  );
  // The Style lookup's displayed value. Seeded from the saved line, so an
  // edited Order Sheet shows its Style even if it is no longer ACTIVE and
  // would never appear in a new-selection search.
  const [selectedStyle, setSelectedStyle] = useState<StyleLookupValue | null>(() =>
    existingLine
      ? { id: existingLine.styleId, styleNumber: existingLine.styleNumber, styleName: existingLine.styleName }
      : null,
  );
  const [error, setError] = useState('');

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

  // The one selected Style — its orderable sizes and full lookup label
  // (LMIX, status). Search results stay slim; only this record carries sizes.
  const selectedStyleQuery = useQuery({
    queryKey: ['purchase-orders', 'style-options', 'detail', line.styleId],
    enabled: Boolean(line.styleId),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<OrderSheetStyleDetail>>(
        `/purchase-orders/style-options/${line.styleId}`,
      );
      return res.data.data;
    },
  });
  const styleDetail = selectedStyleQuery.data?.id === line.styleId ? selectedStyleQuery.data : undefined;

  // Saved/typed rows when there are any, otherwise the selected Style's
  // orderable sizes with blank quantities.
  const sizeRows = line.sizes.length > 0 ? line.sizes : toBlankSizeRows(styleDetail?.sizes ?? []);

  function handleStyleChange(style: StyleLookupValue | null) {
    if (style?.id === line.styleId) return;
    setSelectedStyle(style);
    setLine((current) => ({ ...current, styleId: style?.id ?? '', sizes: [] }));
  }

  function handleQtyChange(sizeIndex: number, value: string) {
    setLine((current) => ({
      ...current,
      sizes: (current.sizes.length > 0 ? current.sizes : sizeRows).map((sz, j) =>
        j === sizeIndex ? { ...sz, orderedQuantity: value } : sz,
      ),
    }));
  }

  // Edit mode reads Purchase Mode straight off the Order Sheet record
  // (PurchaseOrderSummary already carries its own purchaseMode); create mode
  // derives it from the selected lookup option, which carries purchaseMode.
  const distributorId = isEdit ? existing!.distributor.id : selectedDistributor?.id;
  const purchaseModeCode = isEdit ? existing!.purchaseMode : selectedDistributor?.purchaseMode;
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
            sizes: sizeRows
              .filter((sz) => sz.orderedQuantity && Number(sz.orderedQuantity) > 0)
              .map((sz) => ({ sizeId: sz.sizeId, orderedQuantity: Number(sz.orderedQuantity) })),
          },
        ],
      };

      if (payload.lines[0]!.sizes.length === 0) throw new Error('At least one size quantity is required');

      if (isEdit) {
        const res = await apiClient.patch<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${existing!.id}`, {
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
                <TextField label="Distributor *" value={existing!.distributor.name} disabled width="md" />
              ) : (
                <DistributorLookupField
                  label="Distributor *"
                  value={selectedDistributor}
                  onChange={setSelectedDistributor}
                  width="md"
                />
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
            <Panel variant="bordered" padding="sm">
              {/* Panel applies className to its outer box, not the body that
                  holds children — so the vertical rhythm lives here. */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-start gap-3">
                  <StyleLookupField
                    value={styleDetail ?? selectedStyle}
                    onChange={handleStyleChange}
                    width="lg"
                  />
                  <TextField
                    label="Remarks"
                    value={line.remarks}
                    width="lg"
                    onChange={(e) => setLine((current) => ({ ...current, remarks: e.target.value }))}
                  />
                </div>

                {line.styleId && sizeRows.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                      Size Quantities
                    </div>
                    <FormGrid layout="content" gap="sm">
                      {sizeRows.map((sz, szIndex) => (
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
                {line.styleId && sizeRows.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    {selectedStyleQuery.isError
                      ? getApiErrorMessage(selectedStyleQuery.error, 'Unable to load the sizes for this Style.')
                      : styleDetail
                        ? 'This Style has no active sizes to order.'
                        : 'Loading sizes…'}
                  </p>
                )}
              </div>
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
