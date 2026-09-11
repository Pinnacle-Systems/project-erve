import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
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

  const distributorsQuery = useQuery({
    queryKey: ['distributors', 'active'],
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

  useEffect(() => {
    if (!poQuery.data) return;
    const po = poQuery.data;
    const firstLine = po.lines[0];
    // Hydrates the edit form from an async-loaded record; the data isn't available
    // for a lazy initial-state computation, so this can't be done without an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  }, [poQuery.data]);

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

  const selectedDistributor = distributorsQuery.data?.find((d) => d.id === distributorId);

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
              <SelectField
                label="Distributor *"
                value={distributorId || 'NONE'}
                disabled={isEdit}
                onValueChange={(value) => setDistributorId(value === 'NONE' ? '' : value)}
                width="md"
              >
                <SelectItem value="NONE">Select distributor</SelectItem>
                {(distributorsQuery.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectField>

              <TextField
                label="Purchase Mode"
                value={
                  selectedDistributor
                    ? selectedDistributor.purchaseMode === 'OUTRIGHT'
                      ? 'Outright'
                      : 'Sale or Return'
                    : ''
                }
                disabled
                width="sm"
              />

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
