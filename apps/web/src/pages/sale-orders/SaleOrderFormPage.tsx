import { useEffect, useMemo, useState } from 'react';
import { isValidGstinFormat, normalizeGstin } from '@erve/shared';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueries, useQuery } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import type { RetailStore } from '@erve/types';
import type { Style as StyleMasterRecord } from '../master-data/types.js';
import { RetailStoreLookupField } from '../master-data/RetailStoreLookupField.js';
import { createEnterToNextHandler, PageHeader } from '@erve/app-components';
import { Badge, Button, DatePicker, NumericField, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, FormSection, Panel } from '@erve/layout';
import { EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getLocalDateString } from '../../lib/dates.js';
import { useFormDirty, useUnsavedChangesWarning } from '../../lib/use-unsaved-changes.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageDistributorMaster, canManageFactories } from '../../auth/permissions.js';
import { DistributorLookupField, type DistributorLookupValue } from '../master-data/DistributorLookupField.js';
import { FactoryLookupField, type FactoryLookupValue } from '../master-data/FactoryLookupField.js';
import {
  DispatchOrderStyleField,
  groupPooledStylesForFactory,
  type DispatchOrderStyleOption,
} from './DispatchOrderStyleField.js';
import { DispatchOrderQuantityGrid } from './DispatchOrderQuantityGrid.js';
import type { Factory, PooledFactoryInventoryLine, SaleOrder } from './types.js';

// DEMO-016: one total quantity per Style per destination — the server alone
// derives the exact equal per-Size split (see expandStyleTotalsToLines in
// sale-orders.service.ts). There is no sizeId and no per-line id here any
// more: the per-Size persisted lines this draft eventually expands into are
// an implementation detail the form never manipulates directly, and the
// server recovers their identity itself by natural key on edit.
interface LineDraft {
  key: string;
  style: DispatchOrderStyleOption | null;
  totalQuantity: number | null;
}

interface DestinationDraft {
  retailStoreId?: string | null;
  refreshStoreSnapshot?: boolean;
  storeCode?: string | null;
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
  return { key: nextKey('line'), style: null, totalQuantity: null };
}

function emptyDistributorGroup(): DistributorGroupDraft {
  return { clientKey: nextKey('group'), distributorId: '', distributor: null, destinations: [emptyDestination()] };
}

export function SaleOrderFormPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const { user } = useAuth();
  // DEMO-015: computed once here, not inside the shared lookup fields —
  // they have no AuthContext dependency of their own, so every other
  // consumer's tests keep working unchanged.
  const canCreateFactory = canManageFactories(user);
  const canCreateDistributor = canManageDistributorMaster(user);

  // Held as the full selected record (like Distributor/Style elsewhere in
  // this form), never re-derived by looking `factoryId` up in the Factory
  // options list — a Factory inline-created moments ago (DEMO-015) isn't
  // in that list's cache yet, and an edit's hydrated Factory may since have
  // gone INACTIVE and dropped out of it too. Both must still display.
  const [selectedFactory, setSelectedFactory] = useState<FactoryLookupValue | null>(null);
  const factoryId = selectedFactory?.id ?? '';
  const [soDate, setSoDate] = useState(() => getLocalDateString());
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

  // DEMO-016/DEMO-003: the Style picker and the computed Size-split preview
  // are both built directly from the Factory's pooled inventory — no
  // separate style-options endpoint. Re-grouped whenever the pool reloads
  // (e.g. the Factory changes).
  const pooledStyles = useMemo(
    () => groupPooledStylesForFactory(pooledInventoryQuery.data ?? []),
    [pooledInventoryQuery.data],
  );
  const pooledStyleById = useMemo(() => new Map(pooledStyles.map((s) => [s.styleId, s])), [pooledStyles]);

  // DEMO-016 fix: the server's eligible-Size set for the equal split is the
  // union of pooled Sizes and the Style's currently ACTIVE configured
  // Sizes (see resolveEligibleSizeIds in sale-orders.service.ts) — a
  // configured Size with no pooled stock must still show up here (with 0
  // available) rather than silently vanish from the preview's divisor
  // while the server's own divisor includes it. Fetched per distinct Style
  // actually selected on this form (GET /styles/:id, the same ADMIN /
  // MERCHANDISER / SENIOR_MANAGEMENT roles as this form already requires).
  const selectedStyleIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of distributorGroups) {
      for (const dest of group.destinations) {
        for (const line of dest.lines) if (line.style) ids.add(line.style.styleId);
      }
    }
    return [...ids];
  }, [distributorGroups]);

  const styleMasterQueries = useQueries({
    queries: selectedStyleIds.map((styleId) => ({
      queryKey: ['styles', styleId],
      queryFn: async () => {
        const res = await apiClient.get<ApiSuccessResponse<StyleMasterRecord>>(`/styles/${styleId}`);
        return res.data.data;
      },
    })),
  });
  const configuredActiveSizesByStyleId = useMemo(() => {
    const map = new Map<string, DispatchOrderStyleOption['sizes']>();
    selectedStyleIds.forEach((styleId, index) => {
      const style = styleMasterQueries[index]?.data;
      if (!style) return;
      map.set(
        styleId,
        style.sizes
          .filter((size) => size.status === 'ACTIVE' && size.mappingStatus === 'ACTIVE')
          .map((size) => ({ sizeId: size.id, sizeCode: size.code, sizeLabel: size.label, sizeSortOrder: size.sortOrder, availableQuantity: 0 })),
      );
    });
    return map;
  }, [selectedStyleIds, styleMasterQueries]);

  // A saved line's Style may have since dropped out of the live pool (fully
  // consumed, or never re-released) — the server always re-derives the
  // split from the CURRENT pool, so this form must display the same
  // current state, not a frozen one. A style that genuinely has no current
  // pool entry still displays (by its own last-known identity) with zero
  // pooled Sizes, which DispatchOrderQuantityGrid reports honestly rather
  // than silently.
  function resolveStyleOption(fallback: DispatchOrderStyleOption): DispatchOrderStyleOption {
    const pooled = pooledStyleById.get(fallback.styleId) ?? { ...fallback, sizes: [] };
    const configured = configuredActiveSizesByStyleId.get(fallback.styleId);
    if (!configured || configured.length === 0) return pooled;
    const sizesBySizeId = new Map(pooled.sizes.map((size) => [size.sizeId, size]));
    for (const size of configured) if (!sizesBySizeId.has(size.sizeId)) sizesBySizeId.set(size.sizeId, size);
    return { ...pooled, sizes: [...sizesBySizeId.values()].sort((a, b) => a.sizeSortOrder - b.sizeSortOrder) };
  }

  useEffect(() => {
    if (!soQuery.data) return;
    // Wait for the Factory option list too, not just the Sale Order itself,
    // before hydrating — keeps this whole effect's writes atomic (the
    // Factory field is now a FactoryLookupField hydrated directly from
    // so.factory, independent of this list, so the original Radix native-
    // <select> race this gate was first added for — see
    // erve-sale-order-edit-hydration-fix — no longer applies to it; the
    // gate is kept so every field hydrates in one pass rather than Factory
    // lagging the rest by a render). The Distributor lookups need no such
    // gate: each group's value is hydrated from the Sale Order's own group
    // record.
    if (!factoriesQuery.data) return;
    const so = soQuery.data;
    // Hydrates the edit form from an async-loaded record; the data isn't
    // available for a lazy initial-state computation, so this can't be done
    // without an effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedFactory(so.factory);
    setSoDate(so.soDate.slice(0, 10));
    setRemarks(so.remarks ?? '');
    setExpectedVersion(so.version);
    setDistributorGroups(
      so.distributorGroups.map((group) => ({
        clientKey: group.id,
        id: group.id,
        distributorId: group.distributor.id,
        distributor: { ...group.distributor, purchaseMode: group.purchaseMode },
        destinations: group.destinations.map((dest) => {
          // DEMO-016: the server's per-Size lines for this destination
          // collapse into one draft row per Style, summing their
          // quantities back into a single total — the inverse of
          // expandStyleTotalsToLines.
          const destLines = group.lines.filter((line) => line.destinationId === dest.id);
          const byStyle = new Map<string, LineDraft>();
          for (const line of destLines) {
            const existing = byStyle.get(line.styleId);
            if (existing) {
              existing.totalQuantity = (existing.totalQuantity ?? 0) + line.quantity;
              continue;
            }
            byStyle.set(line.styleId, {
              key: nextKey('line'),
              style: {
                styleId: line.styleId,
                styleNumber: line.styleNumber,
                styleName: line.styleName,
                primaryImage: line.primaryImage,
                sizes: [],
              },
              totalQuantity: line.quantity,
            });
          }
          return {
            clientKey: dest.id,
            id: dest.id,
            retailStoreId: dest.retailStoreId ?? null,
            storeCode: dest.storeCode ?? null,
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
            lines: [...byStyle.values()],
          };
        }),
      })),
    );
    setHydrated(true);
  }, [soQuery.data, factoriesQuery.data]);

  const allDestinations = useMemo(() => distributorGroups.flatMap((g) => g.destinations), [distributorGroups]);

  function groupTotal(group: DistributorGroupDraft): number {
    return group.destinations.reduce(
      (sum, dest) => sum + dest.lines.reduce((lineSum, line) => lineSum + (line.totalQuantity ?? 0), 0),
      0,
    );
  }

  function destinationTotal(dest: DestinationDraft): number {
    return dest.lines.reduce((sum, line) => sum + (line.totalQuantity ?? 0), 0);
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

  function selectStore(groupKey: string, destKey: string, store: RetailStore | null) {
    if (!store) {
      updateDestination(groupKey, destKey, { retailStoreId: null, storeCode: null });
      return;
    }
    updateDestination(groupKey, destKey, {
      retailStoreId: store.id,
      refreshStoreSnapshot: true,
      storeCode: store.code,
      label: store.name,
      addressLine1: store.addressLine1,
      addressLine2: store.addressLine2 ?? '',
      city: store.city,
      state: store.state,
      country: store.country,
      postalCode: store.postalCode,
      contactName: store.contactName ?? '',
      contactEmail: store.contactEmail ?? '',
      contactPhone: store.contactPhone ?? '',
      gstin: store.gstin ?? '',
    });
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
        if (g.clientKey === toGroupKey) return { ...g, destinations: [...g.destinations, { ...destination, retailStoreId: null, storeCode: null }] };
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
        for (const destination of group.destinations) {
          if (normalizeGstin(destination.gstin) && !isValidGstinFormat(destination.gstin)) {
            throw new Error('Enter a valid 15-character GSTIN for the destination');
          }
        }
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
          retailStoreId: d.retailStoreId ?? null,
          refreshStoreSnapshot: d.refreshStoreSnapshot ?? false,
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
          gstin: normalizeGstin(d.gstin) || null,
        })),
      }));
      // DEMO-016: one total per Style per destination — no sizeId, no line
      // id. The server derives the per-Size split and recovers existing
      // per-Size line identity itself.
      const linesPayload = allDestinations.flatMap((d) =>
        d.lines
          .filter((l) => l.style && (l.totalQuantity ?? 0) > 0)
          .map((l) => ({
            destinationClientKey: d.clientKey,
            styleId: l.style!.styleId,
            totalQuantity: l.totalQuantity!,
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
          onKeyDown={createEnterToNextHandler()}
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <FormSection title="Dispatch Order Header">
            <FormGrid layout="content">
              <FactoryLookupField
                label="Factory"
                value={selectedFactory}
                onChange={setSelectedFactory}
                options={factoriesQuery.data ?? []}
                required
                allowInlineCreate={canCreateFactory}
                helpText={isEdit ? 'Changing Factory triggers full reallocation of all stock.' : undefined}
              />
              <DatePicker
                label="Dispatch Order Date"
                value={soDate}
                onValueChange={(value) => setSoDate(value ?? '')}
                displayFormat="dd/mm/yyyy"
                width="sm"
                required
              />
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
                              updateGroup(group.clientKey, {
                                distributor,
                                distributorId: distributor?.id ?? '',
                                destinations: group.destinations.map((d) => ({ ...d, retailStoreId: null, storeCode: null })),
                              })
                            }
                            excludeIds={otherGroupDistributorIds}
                            required
                            allowInlineCreate={canCreateDistributor}
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
                          {group.destinations.map((dest, destIndex) => {
                            const chosenStyleIds = new Set(
                              dest.lines.filter((l) => l.style).map((l) => l.style!.styleId),
                            );
                            return (
                            <Panel key={dest.clientKey} title={`Destination ${destIndex + 1}`}>
                              <div className="space-y-4">
                                <RetailStoreLookupField
                                  id={`dest-${dest.clientKey}-store`}
                                  key={group.distributorId}
                                  distributor={group.distributor}
                                  value={
                                    dest.retailStoreId
                                      ? {
                                          id: dest.retailStoreId,
                                          code: dest.storeCode ?? undefined,
                                          name: dest.label,
                                        }
                                      : null
                                  }
                                  onChange={(store) =>
                                    selectStore(group.clientKey, dest.clientKey, store)
                                  }
                                />
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
                                    id={`dest-${dest.clientKey}-email`}
                                    label="Contact Email"
                                    type="email"
                                    value={dest.contactEmail}
                                    onChange={(e) =>
                                      updateDestination(group.clientKey, dest.clientKey, {
                                        contactEmail: e.target.value,
                                      })
                                    }
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

                                <div className="space-y-3">
                                  {dest.lines.map((line) => {
                                    const resolvedStyle = line.style ? resolveStyleOption(line.style) : null;
                                    return (
                                      <Panel key={line.key} className="bg-surface-muted">
                                        <div className="space-y-2">
                                          <div className="flex items-end gap-2">
                                            <DispatchOrderStyleField
                                              id={`line-${line.key}-style`}
                                              value={line.style}
                                              onChange={(style) => updateLine(group.clientKey, dest.clientKey, line.key, { style })}
                                              options={pooledStyles}
                                              excludeStyleIds={
                                                line.style
                                                  ? new Set([...chosenStyleIds].filter((s) => s !== line.style!.styleId))
                                                  : chosenStyleIds
                                              }
                                            />
                                            <NumericField
                                              id={`line-${line.key}-total-quantity`}
                                              label="Total Quantity"
                                              mode="integer"
                                              min={1}
                                              width="xs"
                                              value={line.totalQuantity}
                                              onChange={(value) => updateLine(group.clientKey, dest.clientKey, line.key, { totalQuantity: value })}
                                            />
                                            <Button type="button" variant="ghost" onClick={() => removeLine(group.clientKey, dest.clientKey, line.key)}>
                                              Remove
                                            </Button>
                                          </div>
                                          {resolvedStyle && (
                                            <DispatchOrderQuantityGrid style={resolvedStyle} totalQuantity={line.totalQuantity} />
                                          )}
                                        </div>
                                      </Panel>
                                    );
                                  })}
                                  <Button type="button" variant="secondary" onClick={() => addLine(group.clientKey, dest.clientKey)}>
                                    + Add Style
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
                            );
                          })}
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

          <div className="flex items-center justify-end border-t border-[var(--erp-border)] pt-3 text-sm font-medium">
            Dispatch Order total: {allDestinations.reduce((sum, d) => sum + destinationTotal(d), 0)}
          </div>

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
