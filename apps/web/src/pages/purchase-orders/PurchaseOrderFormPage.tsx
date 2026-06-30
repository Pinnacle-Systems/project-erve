import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, DatePicker, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel, Stack } from '@erve/layout';
import { apiClient } from '../../lib/api-client.js';
import type { Distributor, PurchaseMode, PurchaseOrder, StyleOption } from './types.js';

interface SizeRow {
  sizeId: string;
  sizeCode: string;
  sizeLabel: string;
  orderedQuantity: string;
}

interface LineRow {
  styleId: string;
  remarks: string;
  sizes: SizeRow[];
}

const emptyLine = (): LineRow => ({ styleId: '', remarks: '', sizes: [] });

export function PurchaseOrderFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [distributorId, setDistributorId] = useState('');
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [requiredDeliveryDate, setRequiredDeliveryDate] = useState('');
  const [purchaseMode, setPurchaseMode] = useState<PurchaseMode>('OUTRIGHT');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [error, setError] = useState('');

  const poQuery = useQuery({
    queryKey: ['purchase-order', id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PurchaseOrder>>(`/purchase-orders/${id}`);
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
    setDistributorId(po.distributor.id);
    setPoDate(po.poDate.slice(0, 10));
    setRequiredDeliveryDate(po.requiredDeliveryDate?.slice(0, 10) ?? '');
    setPurchaseMode(po.purchaseMode);
    setRemarks(po.remarks ?? '');
    setLines(
      po.lines.map((line) => ({
        styleId: line.styleId,
        remarks: line.remarks ?? '',
        sizes: line.sizes.map((sz) => ({
          sizeId: sz.sizeId,
          sizeCode: sz.sizeCode,
          sizeLabel: sz.sizeLabel,
          orderedQuantity: String(sz.orderedQuantity),
        })),
      })),
    );
  }, [poQuery.data]);

  function getStyleSizes(styleId: string): StyleOption['sizes'] {
    const style = stylesQuery.data?.find((s) => s.id === styleId);
    return (style?.sizes ?? []).filter((sz) => sz.status === 'ACTIVE' && sz.mappingStatus === 'ACTIVE');
  }

  function handleStyleChange(lineIndex: number, styleId: string) {
    const sizes = getStyleSizes(styleId);
    setLines((current) =>
      current.map((line, i) =>
        i === lineIndex
          ? {
              ...line,
              styleId,
              sizes: sizes.map((sz) => ({ sizeId: sz.id, sizeCode: sz.code, sizeLabel: sz.label, orderedQuantity: '' })),
            }
          : line,
      ),
    );
  }

  function handleQtyChange(lineIndex: number, sizeIndex: number, value: string) {
    setLines((current) =>
      current.map((line, i) =>
        i === lineIndex
          ? { ...line, sizes: line.sizes.map((sz, j) => (j === sizeIndex ? { ...sz, orderedQuantity: value } : sz)) }
          : line,
      ),
    );
  }

  function addLine() {
    setLines((current) => [...current, emptyLine()]);
  }

  function removeLine(index: number) {
    setLines((current) => current.filter((_, i) => i !== index));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!distributorId) throw new Error('Distributor is required');
      if (!poDate) throw new Error('PO date is required');
      const selectedStyleIds = lines.map((l) => l.styleId).filter(Boolean);
      if (new Set(selectedStyleIds).size !== selectedStyleIds.length) {
        throw new Error('Duplicate styles are not allowed');
      }

      const payload = {
        distributorId,
        poDate,
        requiredDeliveryDate: requiredDeliveryDate || null,
        purchaseMode,
        remarks: remarks || null,
        lines: lines
          .filter((l) => l.styleId)
          .map((l) => ({
            styleId: l.styleId,
            remarks: l.remarks || null,
            sizes: l.sizes
              .filter((sz) => sz.orderedQuantity && Number(sz.orderedQuantity) > 0)
              .map((sz) => ({ sizeId: sz.sizeId, orderedQuantity: Number(sz.orderedQuantity) })),
          })),
      };

      if (payload.lines.length === 0) throw new Error('At least one style line with sizes is required');

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
    onError: (caught) => setError(caught instanceof Error ? caught.message : 'Unable to save purchase order'),
  });

  const usedStyleIds = new Set(lines.map((l) => l.styleId).filter(Boolean));
  const availableStyles = stylesQuery.data?.filter((s) => s.status === 'ACTIVE') ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Purchase Order' : 'Create Purchase Order'}
        subtitle={isEdit ? 'Update draft quantities and dates' : 'Create distributor demand as a draft PO'}
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
          <FormSection title="PO Header">
            <FormGrid columns={2}>
              <SelectField
                label="Distributor *"
                value={distributorId || 'NONE'}
                disabled={isEdit}
                onValueChange={(value) => setDistributorId(value === 'NONE' ? '' : value)}
                width="fill"
              >
                <SelectItem value="NONE">Select distributor</SelectItem>
                {(distributorsQuery.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectField>

              <SelectField
                label="Purchase Mode *"
                value={purchaseMode}
                onValueChange={(value) => setPurchaseMode(value as PurchaseMode)}
                width="fill"
              >
                <SelectItem value="OUTRIGHT">Outright</SelectItem>
                <SelectItem value="SALE_RETURN">Sale Return</SelectItem>
              </SelectField>

              <DatePicker
                label="PO Date *"
                value={poDate}
                onValueChange={(value) => setPoDate(value ?? '')}
                displayFormat="yyyy-mm-dd"
              />
              <DatePicker
                label="Required Delivery Date"
                value={requiredDeliveryDate}
                onValueChange={(value) => setRequiredDeliveryDate(value ?? '')}
                displayFormat="yyyy-mm-dd"
              />
            </FormGrid>

            <TextField label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} width="fill" />
          </FormSection>

          <FormSection
            title="Style Lines"
            actions={
              <Button type="button" variant="secondary" onClick={addLine}>
                Add Style
              </Button>
            }
          >
            <Stack gap="md">

            {lines.map((line, lineIndex) => {
              const sizesForStyle = getStyleSizes(line.styleId);
              const availableForLine = availableStyles.filter(
                (s) => !usedStyleIds.has(s.id) || s.id === line.styleId,
              );

              return (
                <Panel key={lineIndex} variant="bordered" padding="sm">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <SelectField
                        label="Style *"
                        value={line.styleId || 'NONE'}
                        onValueChange={(value) => handleStyleChange(lineIndex, value === 'NONE' ? '' : value)}
                        width="fill"
                      >
                          <SelectItem value="NONE">Select style</SelectItem>
                          {availableForLine.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.styleNumber} - {s.styleName}
                            </SelectItem>
                          ))}
                      </SelectField>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => removeLine(lineIndex)}
                    >
                      Remove
                    </Button>
                  </div>

                  {line.styleId && sizesForStyle.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                        Size Quantities
                      </div>
                      <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-6">
                        {(line.sizes.length > 0 ? line.sizes : sizesForStyle.map((sz) => ({
                          sizeId: sz.id,
                          sizeCode: sz.code,
                          sizeLabel: sz.label,
                          orderedQuantity: '',
                        }))).map((sz, szIndex) => (
                          <div key={sz.sizeId} className="space-y-1">
                            <TextField
                              label={sz.sizeCode}
                              type="number"
                              min="1"
                              value={sz.orderedQuantity}
                              onChange={(e) => handleQtyChange(lineIndex, szIndex, e.target.value)}
                              placeholder="0"
                              density="compact"
                              width="fill"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <TextField
                    label="Line Remarks"
                    value={line.remarks}
                    onChange={(e) =>
                      setLines((current) =>
                        current.map((l, i) => (i === lineIndex ? { ...l, remarks: e.target.value } : l)),
                      )
                    }
                  />
                </Panel>
              );
            })}
            </Stack>
          </FormSection>

          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

          <div className="flex justify-end gap-3 border-t border-border-subtle pt-4">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              Save Draft
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
