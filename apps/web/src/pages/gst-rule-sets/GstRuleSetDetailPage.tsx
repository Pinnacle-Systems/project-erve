import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge, createEnterToNextHandler } from '@erve/app-components';
import { Button, DatePicker, TextField, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageGstRuleSets } from '../../auth/permissions.js';
import type { GstRuleSet, GstRuleSetVersion, GstValueBand } from '../master-data/types.js';

function toErrorMessage(caught: unknown, fallback: string): string {
  if (isAxiosError(caught)) {
    const message = caught.response?.data?.error?.message as string | undefined;
    if (message) return message;
  }
  return caught instanceof Error ? caught.message : fallback;
}

function formatBound(value: number | null, side: 'min' | 'max'): string {
  if (value === null) return side === 'min' ? '0' : '∞';
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

function formatBandRange(band: GstValueBand): string {
  if (band.minValue === null) return `≤ ${formatBound(band.maxValue, 'max')}`;
  if (band.maxValue === null) return `> ${formatBound(band.minValue, 'min')}`;
  return `${formatBound(band.minValue, 'min')} < value ≤ ${formatBound(band.maxValue, 'max')}`;
}

function versionStatusTone(status: GstRuleSetVersion['status']) {
  if (status === 'ACTIVE') return 'success' as const;
  if (status === 'DRAFT') return 'warning' as const;
  return 'muted' as const;
}

export function GstRuleSetDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManage = canManageGstRuleSets(user);

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [newEffectiveFrom, setNewEffectiveFrom] = useState('');
  const [newEffectiveTo, setNewEffectiveTo] = useState('');
  const [newMinValue, setNewMinValue] = useState('');
  const [newMaxValue, setNewMaxValue] = useState('');
  const [newGstPercent, setNewGstPercent] = useState('');
  const [activateDialogVersionId, setActivateDialogVersionId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const ruleSetQuery = useQuery({
    queryKey: ['gst-rule-set', id],
    queryFn: async () => {
      const res = await apiClient.get<ApiSuccessResponse<GstRuleSet>>(`/gst-rule-sets/${id}`);
      return res.data.data;
    },
  });
  const ruleSet = ruleSetQuery.data;
  const selectedVersion = ruleSet?.versions.find((version) => version.id === selectedVersionId) ?? ruleSet?.versions[0];

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ['gst-rule-set', id] });
    await queryClient.invalidateQueries({ queryKey: ['gst-rule-sets'] });
  }

  const createVersionMutation = useMutation({
    mutationFn: async () => {
      setError('');
      const res = await apiClient.post<ApiSuccessResponse<GstRuleSet>>(`/gst-rule-sets/${id}/versions`, {
        effectiveFrom: newEffectiveFrom || null,
        effectiveTo: newEffectiveTo || null,
      });
      return res.data.data;
    },
    onSuccess: async (updated) => {
      setNewEffectiveFrom('');
      setNewEffectiveTo('');
      setSelectedVersionId(updated.versions[0]?.id ?? null);
      await refresh();
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to create version')),
  });

  const deleteVersionMutation = useMutation({
    mutationFn: async (versionId: string) => {
      setError('');
      await apiClient.delete(`/gst-rule-sets/${id}/versions/${versionId}`);
    },
    onSuccess: refresh,
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to delete version')),
  });

  const addBandMutation = useMutation({
    mutationFn: async (versionId: string) => {
      setError('');
      const gstPercent = Number(newGstPercent);
      if (!newGstPercent || Number.isNaN(gstPercent)) {
        throw new Error('Enter a GST percentage');
      }
      const res = await apiClient.post<ApiSuccessResponse<GstRuleSet>>(
        `/gst-rule-sets/${id}/versions/${versionId}/bands`,
        {
          minValue: newMinValue === '' ? null : Number(newMinValue),
          maxValue: newMaxValue === '' ? null : Number(newMaxValue),
          gstPercent,
        },
      );
      return res.data.data;
    },
    onSuccess: async () => {
      setNewMinValue('');
      setNewMaxValue('');
      setNewGstPercent('');
      await refresh();
    },
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to add value band')),
  });

  const removeBandMutation = useMutation({
    mutationFn: async ({ versionId, bandId }: { versionId: string; bandId: string }) => {
      setError('');
      await apiClient.delete(`/gst-rule-sets/${id}/versions/${versionId}/bands/${bandId}`);
    },
    onSuccess: refresh,
    onError: (caught) => setError(toErrorMessage(caught, 'Unable to remove value band')),
  });

  const activateMutation = useMutation({
    mutationFn: async (versionId: string) => {
      setError('');
      await apiClient.post(`/gst-rule-sets/${id}/versions/${versionId}/actions/activate`);
    },
    onSuccess: async () => {
      setActivateDialogVersionId(null);
      await refresh();
    },
    onError: (caught) => {
      setActivateDialogVersionId(null);
      setError(toErrorMessage(caught, 'Unable to activate version'));
    },
  });

  if (ruleSetQuery.isLoading) {
    return <LoadingState label="Loading GST Rule Set" />;
  }
  if (!ruleSet) {
    return <EmptyState title="GST Rule Set not found" description="The selected GST Rule Set could not be loaded." tone="error" />;
  }

  const isDraftSelected = selectedVersion?.status === 'DRAFT';

  return (
    <div className="space-y-6">
      <PageHeader
        title={ruleSet.code}
        subtitle={ruleSet.name}
        status={<StatusBadge label={ruleSet.status} tone={ruleSet.status === 'ACTIVE' ? 'success' : 'muted'} />}
        secondaryActions={
          <>
            {canManage && (
              <Button asChild variant="secondary">
                <Link to={`/gst-rule-sets/${id}/edit`}>Edit</Link>
              </Button>
            )}
            <Button variant="secondary" onClick={() => navigate('/gst-rule-sets')}>
              Back
            </Button>
          </>
        }
      />

      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

      {canManage && (
        <Panel title="Add Version">
          <form
            className="flex flex-wrap items-end gap-3"
            onKeyDown={createEnterToNextHandler()}
            onSubmit={(e) => {
              e.preventDefault();
              createVersionMutation.mutate();
            }}
          >
            <DatePicker
              label="Effective From (optional while draft)"
              value={newEffectiveFrom}
              onValueChange={(value) => setNewEffectiveFrom(value ?? '')}
              displayFormat="dd/mm/yyyy"
              width="sm"
            />
            <DatePicker
              label="Effective To (optional)"
              value={newEffectiveTo}
              onValueChange={(value) => setNewEffectiveTo(value ?? '')}
              displayFormat="dd/mm/yyyy"
              min={newEffectiveFrom || undefined}
              width="sm"
            />
            <Button type="submit" loading={createVersionMutation.isPending}>
              Add Version
            </Button>
          </form>
        </Panel>
      )}

      <Panel title="Versions">
        <DataTable
          columns={[
            {
              key: 'versionNumber',
              header: 'Version',
              render: (version: GstRuleSetVersion) => (
                <button
                  type="button"
                  className="font-medium text-[var(--erp-text-link)]"
                  onClick={() => setSelectedVersionId(version.id)}
                >
                  v{version.versionNumber}
                </button>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              render: (version: GstRuleSetVersion) => (
                <StatusBadge label={version.status} tone={versionStatusTone(version.status)} />
              ),
            },
            { key: 'effectiveFrom', header: 'Effective From', render: (v: GstRuleSetVersion) => v.effectiveFrom ?? '—' },
            { key: 'effectiveTo', header: 'Effective To', render: (v: GstRuleSetVersion) => v.effectiveTo ?? 'Open-ended' },
            { key: 'bands', header: 'Bands', render: (v: GstRuleSetVersion) => String(v.bands.length) },
            {
              key: 'actions',
              header: '',
              align: 'right' as const,
              render: (version: GstRuleSetVersion) =>
                canManage && version.status === 'DRAFT' ? (
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      density="compact"
                      onClick={() => setActivateDialogVersionId(version.id)}
                      loading={activateMutation.isPending && activateMutation.variables === version.id}
                    >
                      Activate
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      density="compact"
                      loading={deleteVersionMutation.isPending && deleteVersionMutation.variables === version.id}
                      onClick={() => deleteVersionMutation.mutate(version.id)}
                    >
                      Delete
                    </Button>
                  </div>
                ) : null,
            },
          ]}
          data={ruleSet.versions}
          rowKey="id"
          emptyState={<EmptyState title="No versions yet" description="Add a version above to define its value bands." />}
        />
      </Panel>

      {selectedVersion && (
        <Panel title={`Value Bands — v${selectedVersion.versionNumber}`}>
          <DescriptionList columns={3} className="mb-4">
            <DescriptionList.Item label="Status" value={selectedVersion.status} />
            <DescriptionList.Item label="Effective From" value={selectedVersion.effectiveFrom ?? '—'} />
            <DescriptionList.Item label="Effective To" value={selectedVersion.effectiveTo ?? 'Open-ended'} />
          </DescriptionList>

          <DataTable
            columns={[
              { key: 'range', header: 'Value Range (per piece)', render: (band: GstValueBand) => formatBandRange(band) },
              { key: 'gstPercent', header: 'GST %', align: 'right' as const, render: (band: GstValueBand) => `${band.gstPercent}%` },
              ...(canManage && isDraftSelected
                ? [
                    {
                      key: 'actions',
                      header: '',
                      align: 'right' as const,
                      render: (band: GstValueBand) => (
                        <Button
                          type="button"
                          variant="destructive"
                          density="compact"
                          loading={removeBandMutation.isPending && removeBandMutation.variables?.bandId === band.id}
                          onClick={() => removeBandMutation.mutate({ versionId: selectedVersion.id, bandId: band.id })}
                        >
                          Remove
                        </Button>
                      ),
                    },
                  ]
                : []),
            ]}
            data={selectedVersion.bands}
            rowKey="id"
            emptyState={
              <EmptyState
                title="No value bands yet"
                description="A version needs at least one value band — open at the lower bound on the lowest band and open at the upper bound on the highest — before it can be activated."
              />
            }
          />

          {canManage && isDraftSelected && (
            <form
              className="mt-4 flex flex-wrap items-end gap-3"
              onKeyDown={createEnterToNextHandler()}
              onSubmit={(e) => {
                e.preventDefault();
                addBandMutation.mutate(selectedVersion.id);
              }}
            >
              <TextField
                label="Min Value (blank = from zero)"
                type="number"
                step="0.01"
                value={newMinValue}
                onChange={(e) => setNewMinValue(e.target.value)}
                width="sm"
              />
              <TextField
                label="Max Value (blank = open-ended)"
                type="number"
                step="0.01"
                value={newMaxValue}
                onChange={(e) => setNewMaxValue(e.target.value)}
                width="sm"
              />
              <TextField
                label="GST %"
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={newGstPercent}
                onChange={(e) => setNewGstPercent(e.target.value)}
                width="sm"
              />
              <Button type="submit" loading={addBandMutation.isPending}>
                Add Band
              </Button>
            </form>
          )}
        </Panel>
      )}

      <ConfirmDialog
        open={activateDialogVersionId !== null}
        onOpenChange={(open) => !open && setActivateDialogVersionId(null)}
        title="Activate this version?"
        description="Once active, its value bands become the applicable GST rule for this HSN going forward from its effective date. An overlapping open-ended predecessor version will be ended the day before; any other conflict is rejected. Once activated, a version's bands can no longer be changed — a future rate change requires a new version."
        confirmLabel="Activate"
        loading={activateMutation.isPending}
        onConfirm={() => activateDialogVersionId && activateMutation.mutate(activateDialogVersionId)}
      />
    </div>
  );
}
