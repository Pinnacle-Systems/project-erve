import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import type { PriceList, PriceListLine, StyleOption } from './types.js';
import {
  PRICE_LIST_STATUS_LABELS,
  apiErrorMessage,
  formatEffectiveDate,
  formatPrice,
  priceListStatusTone,
} from './price-list-ui.js';

function formatTimestamp(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PriceListDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = user?.roles.some((role) => ['ADMIN', 'MERCHANDISER'].includes(role)) ?? false;

  const [activateDialogOpen, setActivateDialogOpen] = useState(false);
  const [retireDialogOpen, setRetireDialogOpen] = useState(false);
  const [newStyleId, setNewStyleId] = useState('');
  const [newUnitPrice, setNewUnitPrice] = useState('');
  const [editedPrices, setEditedPrices] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const priceListQuery = useQuery({
    queryKey: ['price-list', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<PriceList>>(`/price-lists/${id}`);
      return res.data.data;
    },
  });

  const priceList = priceListQuery.data;
  const isDraft = priceList?.status === 'DRAFT';
  const canEdit = canManage && isDraft;

  const stylesQuery = useQuery({
    queryKey: ['styles', 'active'],
    enabled: canEdit,
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<StyleOption[]>>('/styles', {
        params: { status: 'ACTIVE' },
      });
      return res.data.data;
    },
  });

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['price-list', id] });
    await queryClient.invalidateQueries({ queryKey: ['price-lists'] });
  }

  const addLineMutation = useMutation({
    mutationFn: async () => {
      setError('');
      if (!newStyleId) throw new Error('Select a style to add');
      const unitPrice = Number(newUnitPrice);
      if (!newUnitPrice || Number.isNaN(unitPrice) || unitPrice <= 0) {
        throw new Error('Enter a price greater than 0');
      }
      const res = await apiClient.post<ApiSuccessResponse<PriceList>>(`/price-lists/${id}/lines`, {
        styleId: newStyleId,
        unitPrice,
      });
      return res.data.data;
    },
    onSuccess: async () => {
      setNewStyleId('');
      setNewUnitPrice('');
      await refresh();
    },
    onError: (caught) => setError(apiErrorMessage(caught, 'Unable to add price line')),
  });

  const updateLineMutation = useMutation({
    mutationFn: async (line: PriceListLine) => {
      setError('');
      const raw = editedPrices[line.id];
      const unitPrice = Number(raw);
      if (!raw || Number.isNaN(unitPrice) || unitPrice <= 0) {
        throw new Error('Enter a price greater than 0');
      }
      const res = await apiClient.patch<ApiSuccessResponse<PriceList>>(
        `/price-lists/${id}/lines/${line.id}`,
        { unitPrice },
      );
      return res.data.data;
    },
    onSuccess: async (_data, line) => {
      setEditedPrices((current) => {
        const next = { ...current };
        delete next[line.id];
        return next;
      });
      await refresh();
    },
    onError: (caught) => setError(apiErrorMessage(caught, 'Unable to update price line')),
  });

  const removeLineMutation = useMutation({
    mutationFn: async (line: PriceListLine) => {
      setError('');
      const res = await apiClient.delete<ApiSuccessResponse<PriceList>>(
        `/price-lists/${id}/lines/${line.id}`,
      );
      return res.data.data;
    },
    onSuccess: refresh,
    onError: (caught) => setError(apiErrorMessage(caught, 'Unable to remove price line')),
  });

  const activateMutation = useMutation({
    mutationFn: async () => {
      setError('');
      const res = await apiClient.post<ApiSuccessResponse<PriceList>>(`/price-lists/${id}/actions/activate`);
      return res.data.data;
    },
    onSuccess: async () => {
      setActivateDialogOpen(false);
      await refresh();
    },
    onError: (caught) => {
      setActivateDialogOpen(false);
      setError(apiErrorMessage(caught, 'Unable to activate price list'));
    },
  });

  const retireMutation = useMutation({
    mutationFn: async () => {
      setError('');
      const res = await apiClient.post<ApiSuccessResponse<PriceList>>(`/price-lists/${id}/actions/retire`);
      return res.data.data;
    },
    onSuccess: async () => {
      setRetireDialogOpen(false);
      await refresh();
    },
    onError: (caught) => {
      setRetireDialogOpen(false);
      setError(apiErrorMessage(caught, 'Unable to retire price list'));
    },
  });

  if (priceListQuery.isLoading) {
    return <LoadingState label="Loading price list" />;
  }
  if (!priceList) {
    return (
      <EmptyState
        title="Price list not found"
        description="The selected price list could not be loaded."
        tone="error"
      />
    );
  }

  const pricedStyleIds = new Set(priceList.lines.map((line) => line.styleId));
  const availableStyles = (stylesQuery.data ?? []).filter((style) => !pricedStyleIds.has(style.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title={priceList.code}
        subtitle={`${priceList.name} — ${priceList.distributor.name}`}
        status={
          <StatusBadge
            label={PRICE_LIST_STATUS_LABELS[priceList.status]}
            tone={priceListStatusTone(priceList.status)}
          />
        }
        secondaryActions={
          <>
            {canEdit && (
              <Button asChild variant="secondary">
                <Link to={`/price-lists/${id}/edit`}>Edit Details</Link>
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/price-lists')}>
              Back
            </Button>
          </>
        }
        primaryAction={
          canManage ? (
            <div className="flex gap-2">
              {isDraft && (
                <Button onClick={() => setActivateDialogOpen(true)} loading={activateMutation.isPending}>
                  Activate
                </Button>
              )}
              {priceList.status === 'ACTIVE' && (
                <Button
                  variant="destructive"
                  onClick={() => setRetireDialogOpen(true)}
                  loading={retireMutation.isPending}
                >
                  Retire
                </Button>
              )}
            </div>
          ) : undefined
        }
      />

      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

      <Panel title="Details">
        <DescriptionList columns={4}>
          <DescriptionList.Item label="Distributor" value={priceList.distributor.name} />
          <DescriptionList.Item label="Effective From" value={formatEffectiveDate(priceList.effectiveFrom)} />
          <DescriptionList.Item
            label="Effective To"
            value={priceList.effectiveTo ? formatEffectiveDate(priceList.effectiveTo) : 'Open-ended'}
          />
          <DescriptionList.Item label="Lines" value={String(priceList.lineCount)} />
          <DescriptionList.Item label="Created" value={formatTimestamp(priceList.createdAt)} />
          <DescriptionList.Item label="Last Updated" value={formatTimestamp(priceList.updatedAt)} />
        </DescriptionList>
        {priceList.status === 'EXPIRED' && (
          <p className="mt-3 text-sm text-muted-foreground">
            This price list is retired and read-only. Its prices are preserved for historical reference.
          </p>
        )}
      </Panel>

      {canEdit && (
        <Panel title="Add Style Price">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              addLineMutation.mutate();
            }}
          >
            <div className="min-w-64 flex-1">
              <SelectField
                label="Style"
                value={newStyleId || 'NONE'}
                onValueChange={(value) => setNewStyleId(value === 'NONE' ? '' : value)}
                width="fill"
              >
                <SelectItem value="NONE">Select style</SelectItem>
                {availableStyles.map((style) => (
                  <SelectItem key={style.id} value={style.id}>
                    {style.styleNumber} - {style.styleName}
                  </SelectItem>
                ))}
              </SelectField>
            </div>
            <TextField
              label="Unit Price (INR)"
              type="number"
              min="0.01"
              step="0.01"
              value={newUnitPrice}
              onChange={(e) => setNewUnitPrice(e.target.value)}
              placeholder="0.00"
              width="sm"
            />
            <Button type="submit" loading={addLineMutation.isPending}>
              Add Line
            </Button>
          </form>
        </Panel>
      )}

      <Panel title="Style Prices">
        <DataTable
          columns={[
            { key: 'styleNumber', header: 'Style Number', accessor: 'styleNumber' },
            { key: 'styleName', header: 'Style Name', accessor: 'styleName' },
            ...(canEdit
              ? [
                  {
                    key: 'unitPrice',
                    header: 'Unit Price (INR)',
                    align: 'right' as const,
                    render: (line: PriceListLine) => (
                      <TextField
                        aria-label={`Unit price for ${line.styleNumber}`}
                        type="number"
                        min="0.01"
                        step="0.01"
                        density="compact"
                        width="sm"
                        value={editedPrices[line.id] ?? String(line.unitPrice)}
                        onChange={(e) =>
                          setEditedPrices((current) => ({ ...current, [line.id]: e.target.value }))
                        }
                      />
                    ),
                  },
                  {
                    key: 'actions',
                    header: '',
                    align: 'right' as const,
                    render: (line: PriceListLine) => (
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          density="compact"
                          disabled={
                            editedPrices[line.id] === undefined ||
                            editedPrices[line.id] === String(line.unitPrice)
                          }
                          loading={
                            updateLineMutation.isPending && updateLineMutation.variables?.id === line.id
                          }
                          onClick={() => updateLineMutation.mutate(line)}
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          density="compact"
                          loading={
                            removeLineMutation.isPending && removeLineMutation.variables?.id === line.id
                          }
                          onClick={() => removeLineMutation.mutate(line)}
                        >
                          Remove
                        </Button>
                      </div>
                    ),
                  },
                ]
              : [
                  {
                    key: 'unitPrice',
                    header: 'Unit Price',
                    align: 'right' as const,
                    render: (line: PriceListLine) => formatPrice(line.unitPrice, line.currency),
                  },
                ]),
          ]}
          data={priceList.lines}
          rowKey="id"
          emptyState={
            <EmptyState
              title="No style prices yet"
              description={
                canEdit
                  ? 'Add style prices above. The price list needs at least one line before it can be activated.'
                  : 'This price list has no lines.'
              }
            />
          }
        />
      </Panel>

      <ConfirmDialog
        open={activateDialogOpen}
        onOpenChange={setActivateDialogOpen}
        title="Activate price list?"
        description={`This makes ${priceList.code} the applicable price list for ${priceList.distributor.name} from ${formatEffectiveDate(priceList.effectiveFrom)}. An overlapping open-ended price list will be ended the day before, and the list becomes read-only.`}
        confirmLabel="Activate"
        loading={activateMutation.isPending}
        onConfirm={() => activateMutation.mutate()}
      />

      <ConfirmDialog
        open={retireDialogOpen}
        onOpenChange={setRetireDialogOpen}
        title="Retire price list?"
        description={`New transactions will no longer price against ${priceList.code}. Historical prices remain readable and unchanged.`}
        confirmLabel="Retire"
        destructive
        loading={retireMutation.isPending}
        onConfirm={() => retireMutation.mutate()}
      />
    </div>
  );
}
