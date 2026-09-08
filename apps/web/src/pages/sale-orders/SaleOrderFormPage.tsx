import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, DatePicker, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import type { Distributor, Factory, PooledFactoryInventoryLine, SaleOrder } from './types.js';

interface LineDraft {
  key: string;
  id?: string;
  styleId: string;
  sizeId: string;
  quantity: string;
}

interface DestinationDraft {
  clientKey: string;
  id?: string;
  label: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  country: string;
  postalCode: string;
  lines: LineDraft[];
}

let keySeq = 0;
function nextKey(prefix: string) {
  keySeq += 1;
  return `${prefix}-${keySeq}`;
}

function emptyDestination(): DestinationDraft {
  return {
    clientKey: nextKey('dest'),
    label: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    addressLine1: '',
    addressLine2: '',
    city: '',
    state: '',
    country: 'India',
    postalCode: '',
    lines: [],
  };
}

function emptyLine(): LineDraft {
  return { key: nextKey('line'), styleId: '', sizeId: '', quantity: '' };
}

export function SaleOrderFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [distributorId, setDistributorId] = useState('');
  const [factoryId, setFactoryId] = useState('');
  const [soDate, setSoDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState('');
  const [destinations, setDestinations] = useState<DestinationDraft[]>([emptyDestination()]);
  const [error, setError] = useState('');
  const [expectedVersion, setExpectedVersion] = useState(0);

  const soQuery = useQuery({
    queryKey: ['sale-order', id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<SaleOrder>>(`/sale-orders/${id}`);
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

  const factoriesQuery = useQuery({
    queryKey: ['factories', 'active'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Factory[]>>('/factories', { params: { status: 'ACTIVE' } });
      return res.data.data;
    },
  });

  const pooledInventoryQuery = useQuery({
    queryKey: ['job-orders', 'pooled-inventory', factoryId],
    enabled: Boolean(factoryId),
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PooledFactoryInventoryLine[]>>(
        '/job-orders/pooled-inventory',
        { params: { factoryId } },
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
    setFactoryId(so.factory.id);
    setSoDate(so.soDate.slice(0, 10));
    setRemarks(so.remarks ?? '');
    setExpectedVersion(so.version);
    setDestinations(
      so.destinations.map((dest) => ({
        clientKey: dest.id,
        id: dest.id,
        label: dest.label ?? '',
        contactName: dest.contactName ?? '',
        contactEmail: dest.contactEmail ?? '',
        contactPhone: dest.contactPhone ?? '',
        addressLine1: dest.addressLine1,
        addressLine2: dest.addressLine2 ?? '',
        city: dest.city,
        state: dest.state,
        country: dest.country,
        postalCode: dest.postalCode ?? '',
        lines: so.lines
          .filter((line) => line.destinationId === dest.id)
          .map((line) => ({
            key: line.id,
            id: line.id,
            styleId: line.styleId,
            sizeId: line.sizeId,
            quantity: String(line.quantity),
          })),
      })),
    );
  }, [soQuery.data]);

  // Pool key options for the Style/Size selects — the pooled inventory for
  // the selected Factory, plus (edit mode) any style/size already on a line
  // of this order, so an existing line's own selection is never dropped
  // from the dropdown even if this order's own reservation currently
  // reduces its visible "available" to zero in the naive pool view.
  const poolOptions = useMemo(() => {
    const byKey = new Map<string, { styleId: string; styleNumber: string; styleName: string; sizeId: string; sizeCode: string; sizeLabel: string; availableQuantity: number | null }>();
    for (const row of pooledInventoryQuery.data ?? []) {
      byKey.set(`${row.styleId}:${row.sizeId}`, { ...row, availableQuantity: row.availableQuantity });
    }
    for (const dest of destinations) {
      for (const line of dest.lines) {
        if (!line.styleId || !line.sizeId) continue;
        const key = `${line.styleId}:${line.sizeId}`;
        if (!byKey.has(key)) {
          byKey.set(key, {
            styleId: line.styleId,
            styleNumber: line.styleId,
            styleName: '',
            sizeId: line.sizeId,
            sizeCode: line.sizeId,
            sizeLabel: '',
            availableQuantity: null,
          });
        }
      }
    }
    return [...byKey.values()];
  }, [pooledInventoryQuery.data, destinations]);

  const totalsByPool = useMemo(() => {
    const totals = new Map<string, number>();
    for (const dest of destinations) {
      for (const line of dest.lines) {
        if (!line.styleId || !line.sizeId) continue;
        const key = `${line.styleId}:${line.sizeId}`;
        totals.set(key, (totals.get(key) ?? 0) + (Number(line.quantity) || 0));
      }
    }
    return totals;
  }, [destinations]);

  function updateDestination(clientKey: string, patch: Partial<DestinationDraft>) {
    setDestinations((current) => current.map((d) => (d.clientKey === clientKey ? { ...d, ...patch } : d)));
  }

  function updateLine(destKey: string, lineKey: string, patch: Partial<LineDraft>) {
    setDestinations((current) =>
      current.map((d) =>
        d.clientKey === destKey
          ? { ...d, lines: d.lines.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)) }
          : d,
      ),
    );
  }

  function removeLine(destKey: string, lineKey: string) {
    setDestinations((current) =>
      current.map((d) => (d.clientKey === destKey ? { ...d, lines: d.lines.filter((l) => l.key !== lineKey) } : d)),
    );
  }

  function addLine(destKey: string) {
    setDestinations((current) =>
      current.map((d) => (d.clientKey === destKey ? { ...d, lines: [...d.lines, emptyLine()] } : d)),
    );
  }

  function addDestination() {
    setDestinations((current) => [...current, emptyDestination()]);
  }

  function removeDestination(clientKey: string) {
    setDestinations((current) => current.filter((d) => d.clientKey !== clientKey));
  }

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!distributorId) throw new Error('Distributor is required');
      if (!factoryId) throw new Error('Factory is required');
      if (!soDate) throw new Error('Dispatch Order date is required');
      if (destinations.length === 0) throw new Error('At least one destination is required');

      const destinationsPayload = destinations.map((d) => ({
        clientKey: d.clientKey,
        ...(d.id ? { id: d.id } : {}),
        label: d.label || null,
        contactName: d.contactName || null,
        contactEmail: d.contactEmail || null,
        contactPhone: d.contactPhone || null,
        addressLine1: d.addressLine1,
        addressLine2: d.addressLine2 || null,
        city: d.city,
        state: d.state,
        country: d.country,
        postalCode: d.postalCode || null,
      }));
      const linesPayload = destinations.flatMap((d) =>
        d.lines
          .filter((l) => l.styleId && l.sizeId && Number(l.quantity) > 0)
          .map((l) => ({
            ...(l.id ? { id: l.id } : {}),
            destinationClientKey: d.clientKey,
            styleId: l.styleId,
            sizeId: l.sizeId,
            quantity: Number(l.quantity),
          })),
      );
      if (linesPayload.length === 0) throw new Error('At least one quantity line is required');

      const idempotencyKey = `dispatch-order-${id ?? 'create'}-${Date.now()}`;
      if (isEdit) {
        const res = await apiClient.patch<ApiSuccessResponse<SaleOrder>>(
          `/sale-orders/${id}`,
          { expectedVersion, distributorId, factoryId, soDate, remarks: remarks || null, destinations: destinationsPayload, lines: linesPayload },
          { headers: { 'Idempotency-Key': idempotencyKey } },
        );
        return res.data.data;
      }
      const res = await apiClient.post<ApiSuccessResponse<SaleOrder>>(
        '/sale-orders',
        { distributorId, factoryId, soDate, remarks: remarks || null, destinations: destinationsPayload, lines: linesPayload },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      return res.data.data;
    },
    onSuccess: (so) => navigate(`/sale-orders/${so.id}`),
    onError: (caught) => setError(getApiErrorMessage(caught, 'Unable to save the Dispatch Order. Please try again.')),
  });

  if (isEdit && soQuery.isLoading) {
    return <LoadingState label="Loading dispatch order" />;
  }
  if (isEdit && soQuery.data?.isLocked) {
    return (
      <EmptyState
        title="This dispatch order can no longer be edited"
        description="Factory Dispatch has already occurred — the dispatch order is now read-only."
        tone="error"
      />
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={isEdit ? 'Edit Dispatch Order' : 'Create Dispatch Order'}
        subtitle="Allocate pooled Factory stock to Distributor destinations"
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
          <FormSection title="Dispatch Order Header">
            <FormGrid layout="content">
              <SelectField label="Distributor" value={distributorId} onValueChange={setDistributorId} required>
                {(distributorsQuery.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectField>
              <SelectField
                label="Factory"
                value={factoryId}
                onValueChange={setFactoryId}
                required
                helpText={isEdit ? 'Changing Factory triggers full reallocation of all stock.' : undefined}
              >
                {(factoriesQuery.data ?? []).map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectField>
              <DatePicker label="Dispatch Order Date" value={soDate} onValueChange={(value) => setSoDate(value ?? '')} required />
              <TextField label="Remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </FormGrid>
          </FormSection>

          <FormSection title="Destinations">
            {!factoryId ? (
              <EmptyState title="Select a Factory" description="Choose a Factory to see its available pooled stock." />
            ) : (
              <div className="space-y-4">
                {destinations.map((dest, destIndex) => (
                  <Panel key={dest.clientKey} title={`Destination ${destIndex + 1}`}>
                    <div className="space-y-4">
                      <FormGrid layout="content">
                        <TextField
                          label="Label"
                          value={dest.label}
                          onChange={(e) => updateDestination(dest.clientKey, { label: e.target.value })}
                        />
                        <TextField
                          label="Contact Name"
                          value={dest.contactName}
                          onChange={(e) => updateDestination(dest.clientKey, { contactName: e.target.value })}
                        />
                        <TextField
                          label="Contact Phone"
                          value={dest.contactPhone}
                          onChange={(e) => updateDestination(dest.clientKey, { contactPhone: e.target.value })}
                        />
                        <TextField
                          label="Address Line 1"
                          value={dest.addressLine1}
                          onChange={(e) => updateDestination(dest.clientKey, { addressLine1: e.target.value })}
                          required
                        />
                        <TextField
                          label="Address Line 2"
                          value={dest.addressLine2}
                          onChange={(e) => updateDestination(dest.clientKey, { addressLine2: e.target.value })}
                        />
                        <TextField
                          label="City"
                          value={dest.city}
                          onChange={(e) => updateDestination(dest.clientKey, { city: e.target.value })}
                          required
                        />
                        <TextField
                          label="State"
                          value={dest.state}
                          onChange={(e) => updateDestination(dest.clientKey, { state: e.target.value })}
                          required
                        />
                        <TextField
                          label="Country"
                          value={dest.country}
                          onChange={(e) => updateDestination(dest.clientKey, { country: e.target.value })}
                          required
                        />
                        <TextField
                          label="Postal Code"
                          value={dest.postalCode}
                          onChange={(e) => updateDestination(dest.clientKey, { postalCode: e.target.value })}
                        />
                      </FormGrid>

                      <div className="space-y-2">
                        {dest.lines.map((line) => {
                          const pool = poolOptions.find((p) => p.styleId === line.styleId && p.sizeId === line.sizeId);
                          return (
                            <div key={line.key} className="flex items-end gap-2">
                              <SelectField
                                label="Style / Size"
                                value={line.styleId && line.sizeId ? `${line.styleId}:${line.sizeId}` : ''}
                                onValueChange={(value) => {
                                  const [styleId, sizeId] = value.split(':') as [string, string];
                                  updateLine(dest.clientKey, line.key, { styleId, sizeId });
                                }}
                                width="lg"
                              >
                                {poolOptions.map((p) => (
                                  <SelectItem key={`${p.styleId}:${p.sizeId}`} value={`${p.styleId}:${p.sizeId}`}>
                                    {p.styleNumber} {p.styleName ? `— ${p.styleName}` : ''} / {p.sizeLabel || p.sizeCode}
                                    {p.availableQuantity !== null ? ` (${p.availableQuantity} available)` : ''}
                                  </SelectItem>
                                ))}
                              </SelectField>
                              <TextField
                                label="Quantity"
                                type="number"
                                min={1}
                                width="xs"
                                value={line.quantity}
                                onChange={(e) => updateLine(dest.clientKey, line.key, { quantity: e.target.value })}
                              />
                              {pool && (
                                <span className="pb-2 text-xs text-[var(--erp-text-muted)]">
                                  Pool available: {pool.availableQuantity ?? 'n/a'}
                                </span>
                              )}
                              <Button type="button" variant="ghost" onClick={() => removeLine(dest.clientKey, line.key)}>
                                Remove
                              </Button>
                            </div>
                          );
                        })}
                        <Button type="button" variant="secondary" onClick={() => addLine(dest.clientKey)}>
                          + Add Style/Size line
                        </Button>
                      </div>

                      {destinations.length > 1 && (
                        <div className="flex justify-end">
                          <Button type="button" variant="ghost" onClick={() => removeDestination(dest.clientKey)}>
                            Remove destination
                          </Button>
                        </div>
                      )}
                    </div>
                  </Panel>
                ))}
                <Button type="button" variant="secondary" onClick={addDestination}>
                  + Add destination
                </Button>
              </div>
            )}
          </FormSection>

          {totalsByPool.size > 0 && (
            <FormSection title="Summary">
              <div className="space-y-1 text-sm">
                {[...totalsByPool.entries()].map(([key, qty]) => {
                  const pool = poolOptions.find((p) => `${p.styleId}:${p.sizeId}` === key);
                  return (
                    <div key={key} className="flex justify-between">
                      <span>
                        {pool ? `${pool.styleNumber} / ${pool.sizeLabel || pool.sizeCode}` : key}
                      </span>
                      <span>
                        Requested {qty}
                        {pool?.availableQuantity !== undefined && pool?.availableQuantity !== null
                          ? ` / Available ${pool.availableQuantity}`
                          : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            </FormSection>
          )}

          {error && <ValidationMessage tone="error">{error}</ValidationMessage>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending}>
              {isEdit ? 'Save Changes' : 'Create Dispatch Order'}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
