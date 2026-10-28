import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { PageHeader } from '@erve/app-components';
import { Button, ValidationMessage } from '@erve/primitives';
import { Panel } from '@erve/layout';
import { DataTable } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { StyleSizeGrid } from '../../components/style-size-grid/StyleSizeGrid.js';
import {
  distinctSizeColumns,
  groupLinesByStyle,
  withBusinessKeyIdentity,
} from './style-size-grouping.js';
import type { EligibleErveCartonView } from './types.js';
import { useEligibleErveCartons } from './use-eligible-erve-cartons.js';
import {
  EligibleCartonSearch,
  EligibleCartonContinuation,
} from './EligibleCartonDiscoveryControls.js';

// ISS-100: compatibility is the server-derived destinationCompatibilityKey
// (one retail store = one destination) combined with the independent
// Distributor boundary — never city/state, which different stores can
// share. A carton whose destination has no linked Retail Store can never
// be combined with anything (destinationCompatibilityKey is null).
function destinationGroupKeyOf(carton: EligibleErveCartonView): string | null {
  if (!carton.destination.destinationCompatibilityKey) return null;
  return `${carton.distributor.id}|${carton.destination.destinationCompatibilityKey}`;
}

export function ErvePackingListCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Map<string, EligibleErveCartonView>>(new Map());
  const [formError, setFormError] = useState('');

  const discovery = useEligibleErveCartons();
  const { cartons } = discovery;
  const selectedCartons = useMemo(() => [...selected.values()], [selected]);
  const groupKey = selectedCartons[0] ? destinationGroupKeyOf(selectedCartons[0]) : null;

  const totalQuantity = selectedCartons.reduce((sum, c) => sum + c.totalQuantity, 0);
  const sourceFactories = useMemo(
    () => new Set(selectedCartons.map((c) => c.factory.id)),
    [selectedCartons],
  );
  const sourceDispatchOrders = useMemo(
    () => new Set(selectedCartons.map((c) => c.saleOrder.id)),
    [selectedCartons],
  );
  // ISS-023 Phase 3: the selected cartons' combined contents as one Style row per Style, with Sizes
  // as columns, instead of one flat "Style/Size: qty" string per line.
  const summaryLines = useMemo(
    () => selectedCartons.flatMap((c) => c.lines).map(withBusinessKeyIdentity),
    [selectedCartons],
  );
  const summarySizeColumns = useMemo(() => distinctSizeColumns(summaryLines), [summaryLines]);
  const summaryStyleRows = useMemo(
    () =>
      groupLinesByStyle(summaryLines).map((group) => ({
        styleId: group.styleId,
        styleNumber: group.styleNumber,
        styleName: group.styleName,
        values: Object.fromEntries(
          group.sizeEntries.map((entry) => [entry.sizeId, entry.quantity]),
        ),
      })),
    [summaryLines],
  );

  function toggle(carton: EligibleErveCartonView) {
    setSelected((current) => {
      const next = new Map(current);
      if (next.has(carton.id)) {
        next.delete(carton.id);
      } else {
        next.set(carton.id, carton);
      }
      return next;
    });
  }

  const createMutation = useMutation({
    mutationFn: async (cartonIds: string[]) => {
      const res = await apiClient.post<ApiSuccessResponse<{ id: string }>>('/erve-packing-lists', {
        cartonIds,
      });
      return res.data.data;
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['erve-packing-lists'] });
      navigate(`/fulfillment/erve-packing-lists/${created.id}`);
    },
    onError: (caught) =>
      setFormError(getApiErrorMessage(caught, 'Unable to create this Erve Packing List.')),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create Erve Packing List"
        subtitle="Select audited Factory cartons bound for one destination to consolidate"
      />

      {formError && <ValidationMessage tone="error">{formError}</ValidationMessage>}

      {groupKey && (
        <Panel title="Selected for consolidation">
          <div className="flex flex-wrap gap-6 text-sm">
            <div>
              <div className="text-muted-foreground">Cartons</div>
              <div className="text-lg font-semibold">{selectedCartons.length}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Total Pieces</div>
              <div className="text-lg font-semibold">{totalQuantity.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Source Factories</div>
              <div className="text-lg font-semibold">{sourceFactories.size}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Source Dispatch Orders</div>
              <div className="text-lg font-semibold">{sourceDispatchOrders.size}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Retail Store</div>
              <div className="text-lg font-semibold">
                {selectedCartons[0]!.destination.label ?? '—'}
                {selectedCartons[0]!.destination.storeCode
                  ? ` (${selectedCartons[0]!.destination.storeCode})`
                  : ''}
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedCartons[0]!.destination.city}, {selectedCartons[0]!.destination.state}
              </div>
            </div>
            <div>
              <div className="text-muted-foreground">Distributor</div>
              <div className="text-lg font-semibold">{selectedCartons[0]!.distributor.name}</div>
            </div>
          </div>
          {summaryStyleRows.length > 0 && (
            <div className="mt-3">
              <StyleSizeGrid
                columns={summarySizeColumns}
                rows={summaryStyleRows}
                variant="readOnly"
              />
            </div>
          )}
          <ul aria-label="Selected cartons" className="mt-3 space-y-1">
            {selectedCartons.map((carton) => (
              <li key={carton.id} className="flex items-center gap-3">
                <span>
                  {carton.cartonNumber} · {carton.totalQuantity.toLocaleString()} pieces
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  density="compact"
                  aria-label={`Remove selected carton ${carton.cartonNumber}`}
                  disabled={createMutation.isPending}
                  onClick={() => toggle(carton)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-sm text-muted-foreground">
            Only cartons for this exact Retail Store can be added — a shared address or
            Distributor is never enough.
          </p>
        </Panel>
      )}

      <Panel>
        <EligibleCartonSearch discovery={discovery} />
        {cartons.length > 0 && (
          <DataTable
            rowKey="id"
            data={cartons}
            columns={[
              {
                key: 'select',
                header: '',
                render: (r: EligibleErveCartonView) => {
                  const incompatible =
                    groupKey !== null && !selected.has(r.id) && destinationGroupKeyOf(r) !== groupKey;
                  return (
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      disabled={createMutation.isPending || incompatible}
                      onChange={() => toggle(r)}
                      aria-label={`Select carton ${r.cartonNumber}`}
                      title={
                        incompatible
                          ? 'This carton is for a different Retail Store and cannot be combined with the cartons already selected.'
                          : undefined
                      }
                    />
                  );
                },
              },
              { key: 'carton', header: 'Carton #', accessor: 'cartonNumber' },
              { key: 'factory', header: 'Factory', render: (r) => r.factory.name },
              {
                key: 'dispatchOrder',
                header: 'Dispatch Order',
                render: (r) => r.saleOrder.saleOrderNumber,
              },
              {
                key: 'retailStore',
                header: 'Retail Store',
                render: (r) => (
                  <>
                    <div>
                      {r.destination.label ?? '—'}
                      {r.destination.storeCode ? ` (${r.destination.storeCode})` : ''}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.destination.city}, {r.destination.state}
                    </div>
                  </>
                ),
              },
              { key: 'distributor', header: 'Distributor', render: (r) => r.distributor.name },
              {
                key: 'qty',
                header: 'Pieces',
                align: 'right',
                render: (r) => r.totalQuantity.toLocaleString(),
              },
            ]}
          />
        )}
        <EligibleCartonContinuation discovery={discovery} />
      </Panel>

      {(cartons.length > 0 || selected.size > 0) && (
        <div className="flex justify-end">
          <Button
            type="button"
            onClick={() => {
              setFormError('');
              createMutation.mutate([...selected.keys()]);
            }}
            disabled={selected.size === 0}
            loading={createMutation.isPending}
          >
            Create Erve Packing List
          </Button>
        </div>
      )}
    </div>
  );
}
