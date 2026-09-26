import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Badge, Button, DatePicker, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useFormDirty, useUnsavedChangesWarning } from '../../lib/use-unsaved-changes.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { DistributorLookupField, type DistributorLookupValue } from '../master-data/DistributorLookupField.js';
import type { Factory, PooledFactoryInventoryLine, SaleOrder } from './types.js';

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
  gstin: string;
  // Server-derived on edit only (undefined for a newly drafted destination,
  // which has never been packed and is therefore always movable) — never
  // inferred client-side. See SaleOrderDestinationView.canMoveDistributor.
  canMoveDistributor?: boolean;
  lines: LineDraft[];
}

// One Distributor group per Distributor per Dispatch Order (Correction 8) —
// each groups its own destination repeater, mirroring the existing
// destination/line draft shape one level deeper.
interface DistributorGroupDraft {
  clientKey: string;
  id?: string;
  distributorId: string;
  // The lookup's displayed value (name, code, purchaseMode) — from the
  // chosen option, or the saved group on edit. distributorId mirrors its id.
  distributor: DistributorLookupValue | null;
  destinations: DestinationDraft[];
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
    gstin: '',
    lines: [],
  };
}

function emptyLine(): LineDraft {
  return { key: nextKey('line'), styleId: '', sizeId: '', quantity: '' };
}

function emptyDistributorGroup(): DistributorGroupDraft {
  return { clientKey: nextKey('group'), distributorId: '', distributor: null, destinations: [emptyDestination()] };
}

export function SaleOrderFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);

  const [factoryId, setFactoryId] = useState('');
  const [soDate, setSoDate] = useState(new Date().toISOString().slice(0, 10));
  const [remarks, setRemarks] = useState('');
  const [distributorGroups, setDistributorGroups] = useState<DistributorGroupDraft[]>([emptyDistributorGroup()]);
  const [error, setError] = useState('');
  const [expectedVersion, setExpectedVersion] = useState(0);
  // Edit mode: set together with the hydrated fields, so the unsaved-changes
  // baseline is the loaded record rather than the blank form.
  const [hydrated, setHydrated] = useState(!isEdit);

  const soQuery = useQuery({
    queryKey: ['sale-order', id],
    enabled: isEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<SaleOrder>>(`/sale-orders/${id}`);
      return res.data.data;
    },
  });

  const factoriesQuery = useQuery({
    queryKey: ['factories', 'options'],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<Factory[]>>('/factories/options');
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
    // Wait for the Factory option list too, not just the Sale Order itself,
    // before hydrating. Radix Select keeps a hidden native <select>
    // (SelectBubbleInput) in sync with the controlled value; if we call
    // setFactoryId while that Select has zero <option> children yet
    // (factoriesQuery still pending), the browser silently coerces the
    // native element back to "" and Radix's own change handler then calls
    // onValueChange(""), clobbering the value we just hydrated with no error
    // and no further effect re-run (see erve-sale-order-edit-hydration-fix).
    // Gating on the option query guarantees its <SelectItem>s already exist
    // in the same render that first sets the hydrated id, so there is no
    // window for the race. The Distributor lookups need no such gate: each
    // group's value is hydrated from the Sale Order's own group record.
    if (!factoriesQuery.data) return;
    const so = soQuery.data;
    // Hydrates the edit form from an async-loaded record; the data isn't
    // available for a lazy initial-state computation, so this can't be done
    // without an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFactoryId(so.factory.id);
    setSoDate(so.soDate.slice(0, 10));
    setRemarks(so.remarks ?? '');
    setExpectedVersion(so.version);
    setDistributorGroups(
      so.distributorGroups.map((group) => ({
        clientKey: group.id,
        id: group.id,
        distributorId: group.distributor.id,
        distributor: { ...group.distributor, purchaseMode: group.purchaseMode },
        destinations: group.destinations.map((dest) => ({
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
          gstin: dest.gstin ?? '',
          canMoveDistributor: dest.canMoveDistributor,
          lines: group.lines
            .filter((line) => line.destinationId === dest.id)
            .map((line) => ({
              key: line.id,
              id: line.id,
              styleId: line.styleId,
              sizeId: line.sizeId,
              quantity: String(line.quantity),
            })),
        })),
      })),
    );
    setHydrated(true);
  }, [soQuery.data, factoriesQuery.data]);

  // Pool key options for the Style/Size selects — the pooled inventory for
  // the selected Factory, plus (edit mode) any style/size already on a line
  // of this order, so an existing line's own selection is never dropped
  // from the dropdown even if this order's own reservation currently
  // reduces its visible "available" to zero in the naive pool view. Flattens
  // across every Distributor group's destinations — the pool itself is
  // Factory+Style+Size only, distributor-agnostic.
  const allDestinations = useMemo(() => distributorGroups.flatMap((g) => g.destinations), [distributorGroups]);

  const poolOptions = useMemo(() => {
    const byKey = new Map<string, { styleId: string; styleNumber: string; styleName: string; sizeId: string; sizeCode: string; sizeLabel: string; availableQuantity: number | null }>();
    for (const row of pooledInventoryQuery.data ?? []) {
      byKey.set(`${row.styleId}:${row.sizeId}`, { ...row, availableQuantity: row.availableQuantity });
    }
    for (const dest of allDestinations) {
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
  }, [pooledInventoryQuery.data, allDestinations]);

  const totalsByPool = useMemo(() => {
    const totals = new Map<string, number>();
    for (const dest of allDestinations) {
      for (const line of dest.lines) {
        if (!line.styleId || !line.sizeId) continue;
        const key = `${line.styleId}:${line.sizeId}`;
        totals.set(key, (totals.get(key) ?? 0) + (Number(line.quantity) || 0));
      }
    }
    return totals;
  }, [allDestinations]);

  function groupTotal(group: DistributorGroupDraft): number {
    return group.destinations.reduce(
      (sum, dest) => sum + dest.lines.reduce((lineSum, line) => lineSum + (Number(line.quantity) || 0), 0),
      0,
    );
  }

  function destinationTotal(dest: DestinationDraft): number {
    return dest.lines.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0);
  }

  function updateGroup(groupKey: string, patch: Partial<DistributorGroupDraft>) {
    setDistributorGroups((current) => current.map((g) => (g.clientKey === groupKey ? { ...g, ...patch } : g)));
  }

  function updateDestination(groupKey: string, destKey: string, patch: Partial<DestinationDraft>) {
    setDistributorGroups((current) =>
      current.map((g) =>
        g.clientKey === groupKey
          ? { ...g, destinations: g.destinations.map((d) => (d.clientKey === destKey ? { ...d, ...patch } : d)) }
          : g,
      ),
    );
  }

  function updateLine(groupKey: string, destKey: string, lineKey: string, patch: Partial<LineDraft>) {
    setDistributorGroups((current) =>
      current.map((g) =>
        g.clientKey === groupKey
          ? {
              ...g,
              destinations: g.destinations.map((d) =>
                d.clientKey === destKey
                  ? { ...d, lines: d.lines.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)) }
                  : d,
              ),
            }
          : g,
      ),
    );
  }

  function removeLine(groupKey: string, destKey: string, lineKey: string) {
    setDistributorGroups((current) =>
      current.map((g) =>
        g.clientKey === groupKey
          ? { ...g, destinations: g.destinations.map((d) => (d.clientKey === destKey ? { ...d, lines: d.lines.filter((l) => l.key !== lineKey) } : d)) }
          : g,
      ),
    );
  }

  function addLine(groupKey: string, destKey: string) {
    setDistributorGroups((current) =>
      current.map((g) =>
        g.clientKey === groupKey
          ? { ...g, destinations: g.destinations.map((d) => (d.clientKey === destKey ? { ...d, lines: [...d.lines, emptyLine()] } : d)) }
          : g,
      ),
    );
  }

  function addDestination(groupKey: string) {
    setDistributorGroups((current) =>
      current.map((g) => (g.clientKey === groupKey ? { ...g, destinations: [...g.destinations, emptyDestination()] } : g)),
    );
  }

  function removeDestination(groupKey: string, destKey: string) {
    setDistributorGroups((current) =>
      current.map((g) => (g.clientKey === groupKey ? { ...g, destinations: g.destinations.filter((d) => d.clientKey !== destKey) } : g)),
    );
  }

  function addDistributorGroup() {
    setDistributorGroups((current) => [...current, emptyDistributorGroup()]);
  }

  function removeDistributorGroup(groupKey: string) {
    setDistributorGroups((current) => current.filter((g) => g.clientKey !== groupKey));
  }

  // Moves an existing destination to a different Distributor group in the
  // same edit — the destination row (and its lines) keep their identity;
  // only which group it's nested under changes on submit. Only offered for
  // destinations the server has confirmed are still movable (zero packed
  // cartons) — see SaleOrderDestinationView.canMoveDistributor; a freshly
  // drafted destination (no `id` yet) has no server verdict and is always
  // movable since it doesn't exist yet.
  function moveDestination(fromGroupKey: string, destKey: string, toGroupKey: string) {
    setDistributorGroups((current) => {
      const fromGroup = current.find((g) => g.clientKey === fromGroupKey);
      const destination = fromGroup?.destinations.find((d) => d.clientKey === destKey);
      if (!destination) return current;
      return current.map((g) => {
        if (g.clientKey === fromGroupKey) return { ...g, destinations: g.destinations.filter((d) => d.clientKey !== destKey) };
        if (g.clientKey === toGroupKey) return { ...g, destinations: [...g.destinations, destination] };
        return g;
      });
    });
  }

  const mutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (distributorGroups.length === 0) throw new Error('At least one Distributor is required');
      for (const group of distributorGroups) {
        if (!group.distributorId) throw new Error('Every Distributor group must have a Distributor selected');
        if (group.destinations.length === 0) throw new Error('Every Distributor group needs at least one destination');
      }
      const distributorIds = distributorGroups.map((g) => g.distributorId);
      if (new Set(distributorIds).size !== distributorIds.length) {
        throw new Error('Each Distributor may appear only once per Dispatch Order');
      }
      if (!factoryId) throw new Error('Factory is required');
      if (!soDate) throw new Error('Dispatch Order date is required');

      const distributorsPayload = distributorGroups.map((group) => ({
        clientKey: group.clientKey,
        ...(group.id ? { id: group.id } : {}),
        distributorId: group.distributorId,
        destinations: group.destinations.map((d) => ({
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
          gstin: d.gstin || null,
        })),
      }));
      const linesPayload = allDestinations.flatMap((d) =>
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
          { expectedVersion, factoryId, soDate, remarks: remarks || null, distributors: distributorsPayload, lines: linesPayload },
          { headers: { 'Idempotency-Key': idempotencyKey } },
        );
        return res.data.data;
      }
      const res = await apiClient.post<ApiSuccessResponse<SaleOrder>>(
        '/sale-orders',
        { factoryId, soDate, remarks: remarks || null, distributors: distributorsPayload, lines: linesPayload },
        { headers: { 'Idempotency-Key': idempotencyKey } },
      );
      return res.data.data;
    },
    onSuccess: (so) => navigate(`/sale-orders/${so.id}`),
    onError: (caught) => setError(getApiErrorMessage(caught, 'Unable to save the Dispatch Order. Please try again.')),
  });
  const dirty = useFormDirty({ factoryId, soDate, remarks, distributorGroups }, hydrated);
  useUnsavedChangesWarning(dirty && !mutation.isSuccess);

  if (isEdit && soQuery.isLoading) {
    return <LoadingState label="Loading dispatch order" />;
  }
  if (isEdit && (soQuery.isError || !soQuery.data)) {
    // Without this guard, a failed load (network error, expired session,
    // 404) fell through to the same form the create route renders, with
    // every field silently blank/default — indistinguishable from actually
    // creating a new Dispatch Order. Mirrors SaleOrderDetailPage's identical
    // guard for the same query.
    return <EmptyState title="Unable to load this dispatch order" tone="error" />;
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
        subtitle="Allocate pooled Factory stock to one or more Distributors' destinations"
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

          <FormSection title="Distributors" description="A Dispatch Order may combine multiple Distributors, each with their own destinations and Purchase Mode — mixing OUTRIGHT and SALE_RETURN in one order is allowed.">
            <div className="space-y-5">
              {distributorGroups.map((group, groupIndex) => {
                  const otherGroupDistributorIds = new Set(
                    distributorGroups.filter((g) => g.clientKey !== group.clientKey).map((g) => g.distributorId),
                  );
                  const selectedDistributor = group.distributor;
                  const otherGroups = distributorGroups.filter((g) => g.clientKey !== group.clientKey);
                  return (
                    <Panel
                      key={group.clientKey}
                      title={`Distributor ${groupIndex + 1}${selectedDistributor ? ` — ${selectedDistributor.name}` : ''}`}
                    >
                      <div className="space-y-4">
                        <FormGrid layout="content">
                          <DistributorLookupField
                            id={`group-${group.clientKey}-distributor`}
                            label="Distributor"
                            value={group.distributor}
                            onChange={(distributor) =>
                              updateGroup(group.clientKey, { distributor, distributorId: distributor?.id ?? '' })
                            }
                            excludeIds={otherGroupDistributorIds}
                            required
                          />
                          {selectedDistributor?.purchaseMode && (
                            <div className="flex items-end pb-2">
                              <Badge variant="muted">Purchase Mode: {selectedDistributor.purchaseMode}</Badge>
                            </div>
                          )}
                        </FormGrid>

                        {!factoryId ? (
                          <EmptyState title="Select a Factory" description="Choose a Factory to see its available pooled stock before adding destinations." />
                        ) : (
                        <div className="space-y-3 pl-4">
                          {group.destinations.map((dest, destIndex) => (
                            <Panel key={dest.clientKey} title={`Destination ${destIndex + 1}`}>
                              <div className="space-y-4">
                                <FormGrid layout="content">
                                  <TextField
                                    id={`dest-${dest.clientKey}-label`}
                                    label="Label"
                                    value={dest.label}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { label: e.target.value })}
                                  />
                                  <TextField
                                    id={`dest-${dest.clientKey}-contact-name`}
                                    label="Contact Name"
                                    value={dest.contactName}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { contactName: e.target.value })}
                                  />
                                  <TextField
                                    id={`dest-${dest.clientKey}-contact-phone`}
                                    label="Contact Phone"
                                    value={dest.contactPhone}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { contactPhone: e.target.value })}
                                  />
                                  <TextField
                                    id={`dest-${dest.clientKey}-address-line-1`}
                                    label="Address Line 1"
                                    value={dest.addressLine1}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { addressLine1: e.target.value })}
                                    required
                                  />
                                  <TextField
                                    id={`dest-${dest.clientKey}-address-line-2`}
                                    label="Address Line 2"
                                    value={dest.addressLine2}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { addressLine2: e.target.value })}
                                  />
                                  <TextField
                                    id={`dest-${dest.clientKey}-city`}
                                    label="City"
                                    value={dest.city}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { city: e.target.value })}
                                    required
                                  />
                                  <TextField
                                    id={`dest-${dest.clientKey}-state`}
                                    label="State"
                                    value={dest.state}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { state: e.target.value })}
                                    required
                                  />
                                  <TextField
                                    id={`dest-${dest.clientKey}-country`}
                                    label="Country"
                                    value={dest.country}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { country: e.target.value })}
                                    required
                                  />
                                  <TextField
                                    id={`dest-${dest.clientKey}-postal-code`}
                                    label="Postal Code"
                                    value={dest.postalCode}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { postalCode: e.target.value })}
                                  />
                                  <TextField
                                    id={`dest-${dest.clientKey}-gstin`}
                                    label="GSTIN"
                                    value={dest.gstin}
                                    onChange={(e) => updateDestination(group.clientKey, dest.clientKey, { gstin: e.target.value })}
                                  />
                                </FormGrid>

                                <div className="space-y-2">
                                  {dest.lines.map((line) => {
                                    const pool = poolOptions.find((p) => p.styleId === line.styleId && p.sizeId === line.sizeId);
                                    return (
                                      <div key={line.key} className="flex items-end gap-2">
                                        <SelectField
                                          id={`line-${line.key}-style-size`}
                                          label="Style / Size"
                                          value={line.styleId && line.sizeId ? `${line.styleId}:${line.sizeId}` : ''}
                                          onValueChange={(value) => {
                                            const [styleId, sizeId] = value.split(':') as [string, string];
                                            updateLine(group.clientKey, dest.clientKey, line.key, { styleId, sizeId });
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
                                          id={`line-${line.key}-quantity`}
                                          label="Quantity"
                                          type="number"
                                          min={1}
                                          width="xs"
                                          value={line.quantity}
                                          onChange={(e) => updateLine(group.clientKey, dest.clientKey, line.key, { quantity: e.target.value })}
                                        />
                                        {pool && (
                                          <span className="pb-2 text-xs text-[var(--erp-text-muted)]">
                                            Pool available: {pool.availableQuantity ?? 'n/a'}
                                          </span>
                                        )}
                                        <Button type="button" variant="ghost" onClick={() => removeLine(group.clientKey, dest.clientKey, line.key)}>
                                          Remove
                                        </Button>
                                      </div>
                                    );
                                  })}
                                  <Button type="button" variant="secondary" onClick={() => addLine(group.clientKey, dest.clientKey)}>
                                    + Add Style/Size line
                                  </Button>
                                </div>

                                <div className="flex items-center justify-between text-xs text-[var(--erp-text-muted)]">
                                  <span>Destination total: {destinationTotal(dest)}</span>
                                  <div className="flex items-center gap-2">
                                    {otherGroups.length > 0 && (dest.canMoveDistributor ?? true) && (
                                      <SelectField
                                        id={`dest-${dest.clientKey}-move`}
                                        label="Move to Distributor"
                                        value=""
                                        onValueChange={(toGroupKey) => moveDestination(group.clientKey, dest.clientKey, toGroupKey)}
                                        width="md"
                                      >
                                        {otherGroups.map((g) => (
                                          <SelectItem key={g.clientKey} value={g.clientKey}>
                                            {g.distributor?.name ?? 'Select above'}
                                          </SelectItem>
                                        ))}
                                      </SelectField>
                                    )}
                                    {dest.canMoveDistributor === false && (
                                      <span>Cartons already packed — cannot move Distributor</span>
                                    )}
                                    {group.destinations.length > 1 && (
                                      <Button type="button" variant="ghost" onClick={() => removeDestination(group.clientKey, dest.clientKey)}>
                                        Remove destination
                                      </Button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </Panel>
                          ))}
                          <Button type="button" variant="secondary" onClick={() => addDestination(group.clientKey)}>
                            + Add Destination
                          </Button>
                        </div>
                        )}

                        <div className="flex items-center justify-between border-t border-[var(--erp-border)] pt-3 text-sm">
                          <span>Distributor total: {groupTotal(group)}</span>
                          {distributorGroups.length > 1 && (
                            <Button type="button" variant="ghost" onClick={() => removeDistributorGroup(group.clientKey)}>
                              Remove Distributor
                            </Button>
                          )}
                        </div>
                      </div>
                    </Panel>
                  );
                })}
              <Button type="button" variant="secondary" onClick={addDistributorGroup}>
                + Add Distributor
              </Button>
            </div>
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
                <div className="flex justify-between border-t border-[var(--erp-border)] pt-2 font-medium">
                  <span>Dispatch Order total</span>
                  <span>{[...totalsByPool.values()].reduce((sum, qty) => sum + qty, 0)}</span>
                </div>
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
