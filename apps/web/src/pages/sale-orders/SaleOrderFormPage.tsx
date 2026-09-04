import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, DatePicker, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import type { Distributor, RequestableCatalogLine, SaleOrder } from './types.js';

export function SaleOrderFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [distributorId, setDistributorId] = useState('');
  const [distributorName, setDistributorName] = useState('');
  const [soDate, setSoDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const soQuery = useQuery({
    queryKey: ['sale-order', id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<SaleOrder>>(`/sale-orders/${id}`);
      return res.data.data;
    },
  });

  // Distributor cannot change on edit (see the mutation below), so the
  // selectable-distributor list is only ever needed for Create.
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

  const requestableCatalogQuery = useQuery({
    queryKey: ['sale-orders', 'requestable-catalog', distributorId],
    enabled: Boolean(distributorId),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<RequestableCatalogLine[]>>(
        '/sale-orders/requestable-catalog',
        { params: { distributorId } },
      );
      return res.data.data;
    },
  });

  useEffect(() => {
    if (!soQuery.data) return;
    const so = soQuery.data;
    // Hydrates the edit form from an async-loaded record; the data isn't
    // available for a lazy initial-state computation, so this can't be done
    // without an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDistributorId(so.distributor.id);
    setDistributorName(so.distributor.name);
    setSoDate(so.soDate.slice(0, 10));
    setRemarks(so.remarks ?? '');
    setQuantities(
      Object.fromEntries(so.lines.map((line) => [line.purchaseOrderLineSizeId, String(line.requestedQuantity)])),
    );
  }, [soQuery.data]);

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!distributorId) throw new Error('Distributor is required');
      if (!soDate) throw new Error('Sale Order date is required');

      const lines = Object.entries(quantities)
        .filter(([, qty]) => qty && Number(qty) > 0)
        .map(([purchaseOrderLineSizeId, qty]) => ({
          purchaseOrderLineSizeId,
          requestedQuantity: Number(qty),
        }));
      if (lines.length === 0) throw new Error('At least one line with a requested quantity is required');

      const payload = { distributorId, soDate, remarks: remarks || null, lines };

      if (isEdit) {
        const res = await apiClient.patch<ApiSuccessResponse<SaleOrder>>(`/sale-orders/${id}`, {
          ...payload,
          distributorId: undefined, // distributor cannot change on edit
        });
        return res.data.data;
      }
      const res = await apiClient.post<ApiSuccessResponse<SaleOrder>>('/sale-orders', payload);
      return res.data.data;
    },
    onSuccess: (so) => navigate(`/sale-orders/${so.id}`),
    onError: (caught) => setError(getApiErrorMessage(caught, 'Unable to save the Sale Order. Please try again.')),
  });

  if (isEdit && soQuery.isLoading) {
    return <LoadingState label="Loading sale order" />;
  }
  if (isEdit && soQuery.data && soQuery.data.status !== 'DRAFT') {
    return (
      <EmptyState
        title="This sale order can no longer be edited"
        description="Only DRAFT sale orders can be edited."
        tone="error"
      />
    );
  }

  const catalogLines = requestableCatalogQuery.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Sale Order' : 'Create Sale Order'}
        subtitle={
          isEdit
            ? 'Update requested quantities while this sale order is still a draft'
            : 'Request the styles/sizes you need against your own purchase orders'
        }
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
          <FormSection title="Sale Order Header">
            <FormGrid layout="content">
              {isEdit ? (
                <TextField label="Distributor" value={distributorName} disabled readOnly />
              ) : (
                <SelectField label="Distributor" value={distributorId} onValueChange={setDistributorId} required>
                  {(distributorsQuery.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectField>
              )}
              <DatePicker
                label="Sale Order Date"
                value={soDate}
                onValueChange={(value) => setSoDate(value ?? '')}
                required
              />
              <TextField
                label="Remarks"
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </FormGrid>
          </FormSection>

          <FormSection title="Requested Demand">
            {!distributorId ? (
              <EmptyState title="Select a distributor" description="Choose a distributor to see their orderable styles/sizes." />
            ) : requestableCatalogQuery.isLoading ? (
              <LoadingState variant="rows" label="Loading orderable styles/sizes" />
            ) : catalogLines.length === 0 ? (
              <EmptyState
                title="No orderable styles/sizes found"
                description="This distributor has no active purchase order lines to request against."
              />
            ) : (
              <DataTable
                rowKey="purchaseOrderLineSizeId"
                columns={[
                  { key: 'poNumber', header: 'PO Number', accessor: 'poNumber' },
                  { key: 'styleNumber', header: 'Style', render: (l) => `${l.styleNumber} — ${l.styleName}` },
                  { key: 'sizeLabel', header: 'Size', accessor: 'sizeLabel' },
                  {
                    key: 'requestedQuantity',
                    header: 'Requested Qty',
                    align: 'right',
                    render: (l) => (
                      <TextField
                        aria-label={`Requested quantity for ${l.styleNumber} ${l.sizeLabel}`}
                        type="number"
                        min={0}
                        density="compact"
                        width="xs"
                        value={quantities[l.purchaseOrderLineSizeId] ?? ''}
                        onChange={(event) =>
                          setQuantities((current) => ({
                            ...current,
                            [l.purchaseOrderLineSizeId]: event.target.value,
                          }))
                        }
                      />
                    ),
                  },
                ]}
                data={catalogLines}
              />
            )}
          </FormSection>

          {error && <ValidationMessage tone="error">{error}</ValidationMessage>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create Sale Order'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
