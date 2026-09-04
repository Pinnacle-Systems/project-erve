import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { canMutateFactoryDispatches } from '../../auth/permissions.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { FactoryDispatchDetail } from './types.js';

const PRINT_STYLE = `
@media print {
  body * { visibility: hidden; }
  #factory-packing-list, #factory-packing-list * { visibility: visible; }
  #factory-packing-list { position: absolute; top: 0; left: 0; width: 100%; }
}`;

export function FactoryDispatchDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canMutate = canMutateFactoryDispatches(user);

  const [cartonNumber, setCartonNumber] = useState('');
  const [packageDetails, setPackageDetails] = useState('');
  const [weight, setWeight] = useState('');
  const [cartonLineQty, setCartonLineQty] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [abandonOpen, setAbandonOpen] = useState(false);

  const query = useQuery({
    queryKey: ['factory-dispatch', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<FactoryDispatchDetail>>(`/factory-dispatches/${id}`);
      return res.data.data;
    },
  });
  const dispatch = query.data;

  function invalidate() {
    return queryClient.invalidateQueries({ queryKey: ['factory-dispatch', id] });
  }

  const addCartonMutation = useMutation({
    mutationFn: async () => {
      const lines = (dispatch?.lines ?? [])
        .filter((line) => (cartonLineQty[line.id] ?? '').trim() !== '')
        .map((line) => ({ factoryDispatchLineId: line.id, quantity: Number(cartonLineQty[line.id]) }));
      const res = await apiClient.post<ApiSuccessResponse<FactoryDispatchDetail>>(
        `/factory-dispatches/${id}/cartons`,
        { expectedVersion: dispatch!.version, cartonNumber, packageDetails: packageDetails || null, weight: weight ? Number(weight) : null, lines },
      );
      return res.data.data;
    },
    onSuccess: () => {
      setCartonNumber('');
      setPackageDetails('');
      setWeight('');
      setCartonLineQty({});
      return invalidate();
    },
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to add the carton.')),
  });

  const removeCartonMutation = useMutation({
    mutationFn: async (cartonId: string) => {
      await apiClient.delete(`/factory-dispatches/${id}/cartons/${cartonId}`, { data: { expectedVersion: dispatch!.version } });
    },
    onSuccess: invalidate,
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to remove the carton.')),
  });

  const finalizeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<ApiSuccessResponse<FactoryDispatchDetail>>(
        `/factory-dispatches/${id}/actions/finalize`,
        { expectedVersion: dispatch!.version },
      );
      return res.data.data;
    },
    onSuccess: invalidate,
    onError: (caught) => setFormError(getApiErrorMessage(caught, 'Unable to finalize this Factory Dispatch.')),
  });

  const abandonMutation = useMutation({
    mutationFn: async () => {
      await apiClient.delete(`/factory-dispatches/${id}`, { data: { expectedVersion: dispatch!.version } });
    },
    onSuccess: () => navigate('/fulfillment/factory-dispatches'),
    onError: (caught) => {
      setAbandonOpen(false);
      setFormError(getApiErrorMessage(caught, 'Unable to abandon this Factory Dispatch.'));
    },
  });

  if (query.isLoading) return <LoadingState label="Loading Factory Dispatch" />;
  if (!dispatch) return <EmptyState title="Factory Dispatch not found" tone="error" />;

  const isDraft = dispatch.status === 'DRAFT';
  const cartonedByLine = new Map(dispatch.lines.map((l) => [l.id, l.cartonedQuantity]));
  const fullyReconciled = dispatch.lines.every((l) => (cartonedByLine.get(l.id) ?? 0) === l.packedQuantity);

  return (
    <div className="space-y-6">
      <style>{PRINT_STYLE}</style>
      <PageHeader
        title={dispatch.factoryDispatchNumber}
        subtitle={`${dispatch.saleOrder.saleOrderNumber} · ${dispatch.saleOrder.distributor.name}`}
        status={
          <StatusBadge
            label={dispatch.status === 'READY_FOR_ERVE' ? 'Ready for Erve' : 'Draft'}
            tone={dispatch.status === 'READY_FOR_ERVE' ? 'approved' : 'draft'}
          />
        }
        secondaryActions={
          <>
            <Button variant="secondary" onClick={() => window.print()}>
              Print Packing List
            </Button>
            <Button variant="secondary" onClick={() => navigate('/fulfillment/factory-dispatches')}>
              Back
            </Button>
          </>
        }
        primaryAction={
          canMutate && isDraft ? (
            <div className="flex gap-2">
              <Button variant="destructive" onClick={() => setAbandonOpen(true)}>
                Abandon
              </Button>
              <Button
                onClick={() => finalizeMutation.mutate()}
                disabled={!fullyReconciled}
                loading={finalizeMutation.isPending}
              >
                Finalize (Ready for Erve)
              </Button>
            </div>
          ) : undefined
        }
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}
      {isDraft && !fullyReconciled && (
        <ValidationMessage tone="warning">
          Every line&apos;s packed quantity must be fully carton-packed before this Factory Dispatch can be finalized.
        </ValidationMessage>
      )}

      <div id="factory-packing-list" className="space-y-6">
        <Panel title="Factory Dispatch / Packing List">
          <DescriptionList columns={4}>
            <DescriptionList.Item label="Factory" value={dispatch.factory.name} />
            <DescriptionList.Item label="Sale Order" value={dispatch.saleOrder.saleOrderNumber} />
            <DescriptionList.Item label="Distributor" value={dispatch.saleOrder.distributor.name} />
            <DescriptionList.Item label="Prepared By" value={dispatch.preparedBy.name} />
            <DescriptionList.Item label="Prepared At" value={new Date(dispatch.preparedAt).toLocaleString()} />
            {dispatch.finalizedAt && (
              <>
                <DescriptionList.Item label="Finalized By" value={dispatch.finalizedBy?.name} />
                <DescriptionList.Item label="Finalized At" value={new Date(dispatch.finalizedAt).toLocaleString()} />
              </>
            )}
            <DescriptionList.Item label="Total Packed Qty" value={dispatch.totalPackedQuantity.toLocaleString()} />
          </DescriptionList>
        </Panel>

        <Panel title="Lines" padding="none">
          <DataTable
            rowKey="id"
            data={dispatch.lines}
            columns={[
              { key: 'style', header: 'Style', render: (r) => `${r.styleNumber} — ${r.styleName}` },
              { key: 'size', header: 'Size', accessor: 'sizeLabel' },
              { key: 'packed', header: 'Packed Qty', align: 'right', render: (r) => r.packedQuantity.toLocaleString() },
              { key: 'cartoned', header: 'Cartoned Qty', align: 'right', render: (r) => r.cartonedQuantity.toLocaleString() },
            ]}
          />
        </Panel>

        <Panel title="Cartons">
          <div className="space-y-4">
            {dispatch.cartons.map((carton) => (
              <div key={carton.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between">
                  <div className="font-medium">
                    Carton {carton.cartonNumber}
                    {carton.weight && <span className="ml-2 text-sm text-muted-foreground">{carton.weight} kg</span>}
                  </div>
                  {isDraft && canMutate && (
                    <Button
                      variant="ghost"
                      density="compact"
                      onClick={() => removeCartonMutation.mutate(carton.id)}
                      loading={removeCartonMutation.isPending}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                {carton.packageDetails && <div className="text-sm text-muted-foreground">{carton.packageDetails}</div>}
                <ul className="mt-2 text-sm">
                  {carton.lines.map((line, idx) => (
                    <li key={idx}>
                      {line.styleNumber} — {line.styleName} / {line.sizeLabel}: {line.quantity}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {dispatch.cartons.length === 0 && <div className="text-sm text-muted-foreground">No cartons yet.</div>}
          </div>
        </Panel>
      </div>

      {isDraft && canMutate && (
        <Panel title="Add Carton">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3">
              <TextField label="Carton Number" value={cartonNumber} onChange={(e) => setCartonNumber(e.target.value)} />
              <TextField label="Package Details (optional)" value={packageDetails} onChange={(e) => setPackageDetails(e.target.value)} />
              <TextField label="Weight, kg (optional)" type="number" min={0} value={weight} onChange={(e) => setWeight(e.target.value)} />
            </div>
            <div className="space-y-2">
              {dispatch.lines.map((line) => {
                const remaining = line.packedQuantity - (cartonedByLine.get(line.id) ?? 0);
                if (remaining <= 0) return null;
                return (
                  <div key={line.id} className="flex items-center gap-3">
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
                      value={cartonLineQty[line.id] ?? ''}
                      onChange={(e) => setCartonLineQty((current) => ({ ...current, [line.id]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
            <Button
              onClick={() => addCartonMutation.mutate()}
              disabled={!cartonNumber.trim() || Object.values(cartonLineQty).every((v) => !v.trim())}
              loading={addCartonMutation.isPending}
            >
              Add Carton
            </Button>
          </div>
        </Panel>
      )}

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
