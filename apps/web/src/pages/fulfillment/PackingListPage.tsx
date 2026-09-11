import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { canMutateFactoryDispatches } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { FactoryPackingCartonView, FinalizeBlockers, PackingListDestinationView, PackingListView } from './types.js';

const PRINT_STYLE = `
@media print {
  body * { visibility: hidden; }
  #factory-packing-list, #factory-packing-list * { visibility: visible; }
  #factory-packing-list { position: absolute; top: 0; left: 0; width: 100%; }
}`;

function auditStateBadge(state: PackingListDestinationView['cartons'][number]['auditState']) {
  if (state === 'INSPECTED') return <StatusBadge label="Inspected" tone="approved" />;
  if (state === 'NEEDS_REINSPECTION') return <StatusBadge label="Needs Reinspection" tone="rejected" />;
  return <StatusBadge label="Not Inspected" tone="draft" />;
}

function finalizeIssueSummary(blockers: FinalizeBlockers): string[] {
  const lines: string[] = [];
  for (const c of blockers.cartonsNotAudited) lines.push(`Carton ${c.cartonNumber}: not yet inspected`);
  for (const c of blockers.cartonsNeedingReinspection) lines.push(`Carton ${c.cartonNumber}: needs reinspection (contents changed since last inspection)`);
  for (const c of blockers.emptyCartons) lines.push(`Carton ${c.cartonNumber}: is empty`);
  for (const c of blockers.destinationMismatchCartons) lines.push(`Carton ${c.cartonNumber}: contains a line for another destination — repacking required`);
  for (const l of blockers.underPackedLines) lines.push(`${l.styleNumber} / ${l.sizeLabel}: packed ${l.packed} of ${l.required} required`);
  for (const l of blockers.overPackedLines) lines.push(`${l.styleNumber} / ${l.sizeLabel}: packed ${l.packed} exceeds ${l.required} required`);
  for (const l of blockers.internalPackingMismatch) lines.push(`${l.styleNumber} / ${l.sizeLabel}: internal packing attribution mismatch — contact support`);
  return lines;
}

interface ShellProps {
  fetchUrl: string;
  queryKey: unknown[];
  backLabel: string;
  backTo: string;
}

function PackingListShell({ fetchUrl, queryKey, backLabel, backTo }: ShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canMutate = canMutateFactoryDispatches(user);

  const [cartonNumber, setCartonNumber] = useState('');
  const [packageDetails, setPackageDetails] = useState('');
  const [weight, setWeight] = useState('');
  const [cartonLineQty, setCartonLineQty] = useState<Record<string, string>>({});
  const [addingForDestination, setAddingForDestination] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [abandonOpen, setAbandonOpen] = useState(false);
  const [finalizeIssues, setFinalizeIssues] = useState<string[] | null>(null);

  // Carton edit form state — desired-state PATCH, hydrated from the carton
  // being edited. editOriginalLineQty is a one-time snapshot of the
  // carton's OWN contents at the moment Edit was opened, used only to
  // compute each line's true remaining capacity while editing (a line's
  // "remaining" must add back this carton's own current contribution,
  // since editing replaces it rather than stacking on top).
  const [editingCartonId, setEditingCartonId] = useState<string | null>(null);
  const [editDestinationId, setEditDestinationId] = useState('');
  const [editPackageDetails, setEditPackageDetails] = useState('');
  const [editWeight, setEditWeight] = useState('');
  const [editLineQty, setEditLineQty] = useState<Record<string, string>>({});
  const [editOriginalLineQty, setEditOriginalLineQty] = useState<Record<string, number>>({});

  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PackingListView>>(fetchUrl);
      return res.data.data;
    },
  });
  const packingList = query.data;

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey });
  }

  const addCartonMutation = useMutation({
    mutationFn: async (destinationId: string) => {
      const lines = Object.entries(cartonLineQty)
        .filter(([, v]) => v.trim() !== '')
        .map(([saleOrderLineId, v]) => ({ saleOrderLineId, quantity: Number(v) }));
      const res = await apiClient.post<ApiSuccessResponse<PackingListView>>(
        `/sale-orders/${packingList!.saleOrderId}/packing-list/cartons`,
        { cartonNumber, destinationId, packageDetails: packageDetails || null, weight: weight ? Number(weight) : null, lines },
      );
      return res.data.data;
    },
    onSuccess: () => {
      setCartonNumber('');
      setPackageDetails('');
      setWeight('');
      setCartonLineQty({});
      setAddingForDestination(null);
      return invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to add the carton.')),
  });

  const removeCartonMutation = useMutation({
    mutationFn: async ({ cartonId, expectedVersion }: { cartonId: string; expectedVersion: number }) => {
      await apiClient.delete(`/factory-dispatches/${packingList!.factoryDispatch!.id}/cartons/${cartonId}`, {
        data: { expectedVersion },
      });
    },
    onSuccess: invalidate,
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to remove/retire the carton.')),
  });

  function closeEdit() {
    setEditingCartonId(null);
    setEditDestinationId('');
    setEditPackageDetails('');
    setEditWeight('');
    setEditLineQty({});
    setEditOriginalLineQty({});
  }

  function openEdit(carton: FactoryPackingCartonView) {
    setAddingForDestination(null);
    setEditingCartonId(carton.id);
    setEditDestinationId(carton.destinationId);
    setEditPackageDetails(carton.packageDetails ?? '');
    setEditWeight(carton.weight ?? '');
    setEditLineQty(Object.fromEntries(carton.lines.map((l) => [l.saleOrderLineId, String(l.quantity)])));
    setEditOriginalLineQty(Object.fromEntries(carton.lines.map((l) => [l.saleOrderLineId, l.quantity])));
  }

  function changeEditDestination(destinationId: string) {
    setEditDestinationId(destinationId);
    // A different destination's lines are an entirely different set of
    // valid saleOrderLineIds — any quantities entered for the previous
    // destination's lines are no longer valid choices and must not be
    // silently resubmitted.
    setEditLineQty({});
  }

  const editingCarton = editingCartonId
    ? (packingList?.destinations.flatMap((d) => d.cartons).find((c) => c.id === editingCartonId) ?? null)
    : null;

  const editCartonMutation = useMutation({
    mutationFn: async () => {
      const carton = editingCarton!;
      const lines = Object.entries(editLineQty)
        .filter(([, v]) => v.trim() !== '')
        .map(([saleOrderLineId, v]) => ({ saleOrderLineId, quantity: Number(v) }));
      const res = await apiClient.patch<ApiSuccessResponse<PackingListView>>(
        `/factory-dispatches/${packingList!.factoryDispatch!.id}/cartons/${carton.id}`,
        {
          expectedVersion: carton.version,
          destinationId: editDestinationId,
          packageDetails: editPackageDetails || null,
          weight: editWeight ? Number(editWeight) : null,
          lines,
        },
      );
      return res.data.data;
    },
    onSuccess: () => {
      closeEdit();
      return invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to update the carton.')),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<PackingListView>>(
        `/factory-dispatches/${packingList!.factoryDispatch!.id}/actions/finalize`,
        { expectedVersion: packingList!.factoryDispatch!.version },
      );
      return res.data.data;
    },
    onSuccess: () => {
      setFinalizeIssues(null);
      return invalidate();
    },
    onError: (caught) => {
      const details = (caught as { response?: { data?: { error?: { details?: FinalizeBlockers } } } })?.response?.data
        ?.error?.details;
      if (details) setFinalizeIssues(finalizeIssueSummary(details));
      setFormError(getApiErrorMessage(caught, 'Unable to finalize this Factory Dispatch.'));
    },
  });

  const abandonMutation = useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/factory-dispatches/${packingList!.factoryDispatch!.id}`, {
        data: { expectedVersion: packingList!.factoryDispatch!.version },
      });
    },
    onSuccess: () => navigate(backTo),
    onError: (caught) => {
      setAbandonOpen(false);
      setFormError(getApiErrorMessage(caught, 'Unable to abandon this Factory Dispatch.'));
    },
  });

  if (query.isLoading) return <LoadingState label="Loading Packing List" />;
  if (!packingList) return <EmptyState title="Dispatch Order not found" tone="error" />;

  const dispatch = packingList.factoryDispatch;
  const isDraft = !dispatch || dispatch.status === 'DRAFT';
  const canFinalize = Boolean(dispatch) && isDraft;

  return (
    <div className="space-y-6">
      <style>{PRINT_STYLE}</style>
      <PageHeader
        title={packingList.saleOrderNumber}
        subtitle={`${packingList.factory.name} · ${packingList.distributors.map((d) => d.name).join(', ')}${dispatch ? ` · ${dispatch.factoryDispatchNumber}` : ''}`}
        status={
          dispatch ? (
            <StatusBadge
              label={dispatch.status === 'READY_FOR_ERVE' ? 'Ready for Erve' : 'Draft'}
              tone={dispatch.status === 'READY_FOR_ERVE' ? 'approved' : 'draft'}
            />
          ) : (
            <StatusBadge label="Not started" tone="draft" />
          )
        }
        secondaryActions={
          <>
            {dispatch?.factoryInvoiceId && (
              <Button variant="secondary" onClick={() => navigate(`/fulfillment/factory-invoices/${dispatch.factoryInvoiceId}`)}>
                View Factory Invoice
              </Button>
            )}
            <Button variant="secondary" onClick={() => window.print()}>
              Print Packing List
            </Button>
            <Button variant="secondary" onClick={() => navigate(backTo)}>
              {backLabel}
            </Button>
          </>
        }
        primaryAction={
          canMutate && canFinalize && dispatch ? (
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => setAbandonOpen(true)}>
                Abandon
              </Button>
              <Button onClick={() => finalizeMutation.mutate()} loading={finalizeMutation.isPending}>
                Finalize (Ready for Erve)
              </Button>
            </div>
          ) : undefined
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {finalizeIssues && finalizeIssues.length > 0 && (
        <ValidationMessage tone="warning">
          <div className="space-y-1">
            <div>Cannot finalize yet:</div>
            <ul className="list-disc pl-5">
              {finalizeIssues.map((line, idx) => (
                <li key={idx}>{line}</li>
              ))}
            </ul>
          </div>
        </ValidationMessage>
      )}

      <div id="factory-packing-list" className="space-y-6">
        {packingList.destinations.map((destination) => (
          <Panel
            key={destination.id}
            title={`${destination.label ?? `${destination.city}, ${destination.state}`} — ${destination.distributor.name}`}
          >
            <div className="space-y-4">
              <DescriptionList columns={3}>
                <DescriptionList.Item
                  label="Address"
                  value={`${destination.addressLine1}${destination.addressLine2 ? `, ${destination.addressLine2}` : ''}, ${destination.city}, ${destination.state}, ${destination.country}`}
                />
                {destination.contactName && <DescriptionList.Item label="Contact" value={destination.contactName} />}
              </DescriptionList>

              <DataTable
                rowKey="saleOrderLineId"
                data={destination.lines}
                columns={[
                  { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
                  { key: 'size', header: 'Size', accessor: 'sizeLabel' },
                  { key: 'required', header: 'Required', align: 'right', render: (r) => r.requiredQuantity.toLocaleString() },
                  { key: 'packed', header: 'Packed', align: 'right', render: (r) => r.packedQuantity.toLocaleString() },
                ]}
              />

              <div className="space-y-3">
                {destination.cartons.map((carton) =>
                  editingCartonId === carton.id ? (
                    <div key={carton.id} className="rounded-md border border-primary p-3">
                      <div className="mb-3 font-medium">Editing Carton {carton.cartonNumber}</div>
                      {carton.auditState === 'INSPECTED' && (
                        <ValidationMessage tone="warning">
                          This carton is currently Inspected. Saving a change to its destination, contents, package
                          details, or weight will mark it Needs Reinspection.
                        </ValidationMessage>
                      )}
                      <div className="mt-3 space-y-3">
                        <div className="flex flex-wrap gap-3">
                          <SelectField label="Destination" value={editDestinationId} onValueChange={changeEditDestination} width="fill">
                            {packingList.destinations.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.label ?? `${d.city}, ${d.state}`} — {d.distributor.name}
                              </SelectItem>
                            ))}
                          </SelectField>
                          <TextField
                            label="Package Details (optional)"
                            value={editPackageDetails}
                            onChange={(e) => setEditPackageDetails(e.target.value)}
                          />
                          <TextField
                            label="Weight, kg (optional)"
                            type="number"
                            min={0}
                            value={editWeight}
                            onChange={(e) => setEditWeight(e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          {(packingList.destinations.find((d) => d.id === editDestinationId)?.lines ?? []).map((line) => {
                            const remaining =
                              line.requiredQuantity - line.packedQuantity + (editOriginalLineQty[line.saleOrderLineId] ?? 0);
                            if (remaining <= 0 && !(line.saleOrderLineId in editLineQty)) return null;
                            return (
                              <div key={line.saleOrderLineId} className="flex items-center gap-3">
                                <span className="w-64 text-sm">
                                  {line.styleNumber} / {line.sizeLabel} — {remaining} available
                                </span>
                                <TextField
                                  aria-label={`Quantity for ${line.styleNumber} ${line.sizeLabel}`}
                                  type="number"
                                  min={0}
                                  max={remaining}
                                  density="compact"
                                  width="xs"
                                  value={editLineQty[line.saleOrderLineId] ?? ''}
                                  onChange={(e) =>
                                    setEditLineQty((current) => ({ ...current, [line.saleOrderLineId]: e.target.value }))
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            onClick={() => editCartonMutation.mutate()}
                            disabled={Object.values(editLineQty).every((v) => !v.trim())}
                            loading={editCartonMutation.isPending}
                          >
                            Save Changes
                          </Button>
                          <Button variant="secondary" onClick={closeEdit}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div key={carton.id} className="rounded-md border border-border p-3">
                      <div className="flex items-center justify-between">
                        <div className="font-medium">
                          Carton {carton.cartonNumber}
                          {carton.weight && <span className="ml-2 text-sm text-muted-foreground">{carton.weight} kg</span>}
                          <span className="ml-2">{auditStateBadge(carton.auditState)}</span>
                          {carton.destinationMismatch && (
                            <span className="ml-2">
                              <StatusBadge label="Destination mismatch — repack required" tone="rejected" />
                            </span>
                          )}
                        </div>
                        {isDraft && canMutate && (
                          <div className="flex gap-2">
                            <Button variant="ghost" density="compact" onClick={() => openEdit(carton)}>
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              density="compact"
                              onClick={() => removeCartonMutation.mutate({ cartonId: carton.id, expectedVersion: carton.version })}
                              loading={removeCartonMutation.isPending}
                            >
                              {carton.auditHistory.length > 0 ? 'Retire' : 'Delete'}
                            </Button>
                          </div>
                        )}
                      </div>
                      {carton.packageDetails && <div className="text-sm text-muted-foreground">{carton.packageDetails}</div>}
                      <ul className="mt-2 text-sm">
                        {carton.lines.map((line) => (
                          <li key={line.saleOrderLineId}>
                            {line.styleNumber} — {line.styleName} / {line.sizeLabel}: {line.quantity}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
                )}
                {destination.cartons.length === 0 && <div className="text-sm text-muted-foreground">No cartons yet.</div>}
              </div>

              {isDraft && canMutate && (
                <div className="rounded-md border border-dashed border-border p-3">
                  {addingForDestination === destination.id ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap gap-3">
                        <TextField label="Carton Number" value={cartonNumber} onChange={(e) => setCartonNumber(e.target.value)} />
                        <TextField label="Package Details (optional)" value={packageDetails} onChange={(e) => setPackageDetails(e.target.value)} />
                        <TextField label="Weight, kg (optional)" type="number" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} />
                      </div>
                      <div className="space-y-2">
                        {destination.lines.map((line) => {
                          const remaining = line.requiredQuantity - line.packedQuantity;
                          if (remaining <= 0) return null;
                          return (
                            <div key={line.saleOrderLineId} className="flex items-center gap-3">
                              <span className="w-64 text-sm">
                                {line.styleNumber} / {line.sizeLabel} — {remaining} remaining
                              </span>
                              <TextField
                                aria-label={`Quantity for ${line.styleNumber} ${line.sizeLabel}`}
                                type="number"
                                min={0}
                                max={remaining}
                                density="compact"
                                width="xs"
                                value={cartonLineQty[line.saleOrderLineId] ?? ''}
                                onChange={(e) =>
                                  setCartonLineQty((current) => ({ ...current, [line.saleOrderLineId]: e.target.value }))
                                }
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          onClick={() => addCartonMutation.mutate(destination.id)}
                          disabled={!cartonNumber.trim() || Object.values(cartonLineQty).every((v) => !v.trim())}
                          loading={addCartonMutation.isPending}
                        >
                          Add Carton
                        </Button>
                        <Button variant="secondary" onClick={() => setAddingForDestination(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button variant="secondary" onClick={() => setAddingForDestination(destination.id)}>
                      Add Carton
                    </Button>
                  )}
                </div>
              )}
            </div>
          </Panel>
        ))}

        {packingList.retiredCartons.length > 0 && (
          <Panel title="Retired Cartons (historical)">
            <ul className="space-y-1 text-sm text-muted-foreground">
              {packingList.retiredCartons.map((carton) => (
                <li key={carton.id}>
                  Carton {carton.cartonNumber} — retired {carton.retiredAt ? new Date(carton.retiredAt).toLocaleString() : ''}
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>

      <ConfirmDialog
        open={abandonOpen}
        onOpenChange={setAbandonOpen}
        title="Abandon this Factory Dispatch?"
        description="This DRAFT packing batch and its cartons will be permanently deleted. This cannot be undone."
        confirmLabel="Abandon"
        destructive
        loading={abandonMutation.isPending}
        onConfirm={() => abandonMutation.mutate()}
      />
    </div>
  );
}

export function PackingListPage() {
  const { id: saleOrderId } = useParams();
  return (
    <PackingListShell
      queryKey={['packing-list', saleOrderId]}
      fetchUrl={`/sale-orders/${saleOrderId}/packing-list`}
      backLabel="Back to Dispatch Order"
      backTo={`/sale-orders/${saleOrderId}`}
    />
  );
}

export function FactoryDispatchDetailPage() {
  const { id } = useParams();
  return (
    <PackingListShell
      queryKey={['packing-list', 'factory-dispatch', id]}
      fetchUrl={`/factory-dispatches/${id}`}
      backLabel="Back"
      backTo="/fulfillment/factory-dispatches"
    />
  );
}
