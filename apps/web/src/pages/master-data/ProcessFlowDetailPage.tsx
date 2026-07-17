import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge } from '@erve/app-components';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Radio,
  RadioGroup,
  SelectField,
  SelectItem,
  ValidationMessage,
} from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { apiClient } from '../../lib/api-client.js';
import type { ProcessFlow, ProcessFlowVersion } from './types.js';
import { processFlowErrorMessage } from './process-flow-ui.js';

function dateLabel(value: string): string {
  return new Date(value).toLocaleDateString('en-IN');
}

export function ProcessFlowDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [activationOpen, setActivationOpen] = useState(false);
  const [newVersionOpen, setNewVersionOpen] = useState(false);
  const [newVersionMode, setNewVersionMode] = useState<'copy' | 'empty'>('copy');
  const [copyFromVersionId, setCopyFromVersionId] = useState('');
  const [error, setError] = useState('');

  const flowQuery = useQuery({
    queryKey: ['process-flow', id],
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<ProcessFlow>>(`/process-flows/${id}`);
      return response.data.data;
    },
  });
  const flow = flowQuery.data;
  const selectedVersionId = useMemo(() => {
    const requested = searchParams.get('version');
    if (requested && flow?.versions.some((version) => version.id === requested)) return requested;
    return (
      flow?.versions.find((version) => version.status === 'ACTIVE')?.id ?? flow?.versions[0]?.id
    );
  }, [flow, searchParams]);

  const versionQuery = useQuery({
    queryKey: ['process-flow-version', selectedVersionId],
    enabled: Boolean(selectedVersionId),
    queryFn: async () => {
      const response = await apiClient.get<ApiSuccessResponse<ProcessFlowVersion>>(
        `/process-flow-versions/${selectedVersionId}`,
      );
      return response.data.data;
    },
  });

  const createVersionMutation = useMutation({
    mutationFn: async () => {
      if (newVersionMode === 'copy' && !copyFromVersionId)
        throw new Error('Select a version to copy');
      const response = await apiClient.post<ApiSuccessResponse<ProcessFlowVersion>>(
        `/process-flows/${id}/versions`,
        {
          ...(newVersionMode === 'copy' ? { copyFromVersionId } : {}),
        },
      );
      return response.data.data;
    },
    onSuccess: async (version) => {
      setNewVersionOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['process-flow', id] });
      navigate(`/master-data/process-flow-versions/${version.id}/edit`);
    },
    onError: (caught) => setError(processFlowErrorMessage(caught, 'Unable to create version')),
  });

  const activateMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const response = await apiClient.post<ApiSuccessResponse<ProcessFlowVersion>>(
        `/process-flow-versions/${versionId}/activate`,
      );
      return response.data.data;
    },
    onSuccess: async (version) => {
      setActivationOpen(false);
      setError('');
      setSearchParams({ version: version.id }, { replace: true });
      await queryClient.invalidateQueries({ queryKey: ['process-flow', id] });
      await queryClient.invalidateQueries({ queryKey: ['process-flow-version'] });
    },
    onError: (caught) => setError(processFlowErrorMessage(caught, 'Unable to activate version')),
  });

  if (flowQuery.isLoading) return <LoadingState label="Loading process flow" />;
  if (flowQuery.isError) {
    return (
      <ErrorState
        title="Unable to load process flow"
        description={flowQuery.error.message}
        action={<Button onClick={() => void flowQuery.refetch()}>Retry</Button>}
      />
    );
  }
  if (!flow)
    return (
      <EmptyState
        title="Process flow not found"
        description="The selected process flow could not be loaded."
        tone="error"
      />
    );

  const selectedVersion = versionQuery.data;
  const activeVersion = flow.versions.find((version) => version.status === 'ACTIVE');

  return (
    <div className="space-y-5">
      <PageHeader
        title={flow.name}
        subtitle={flow.description ? `${flow.code} · ${flow.description}` : flow.code}
        status={
          <StatusBadge label={flow.status} tone={flow.status === 'ACTIVE' ? 'success' : 'muted'} />
        }
        primaryAction={
          <Button
            variant="default"
            onClick={() => {
              const defaultSource = activeVersion?.id ?? flow.versions[0]?.id ?? '';
              setCopyFromVersionId(defaultSource);
              setNewVersionMode(defaultSource ? 'copy' : 'empty');
              setError('');
              setNewVersionOpen(true);
            }}
          >
            Create New Version
          </Button>
        }
      />

      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        <Panel title="Version History">
          <div className="divide-y divide-border-subtle">
            {flow.versions.map((version) => (
              <button
                key={version.id}
                type="button"
                aria-pressed={selectedVersionId === version.id}
                className={`w-full py-3 text-left ${selectedVersionId === version.id ? 'bg-[var(--erp-color-primary-soft)]' : ''}`}
                onClick={() => setSearchParams({ version: version.id })}
              >
                <div className="flex items-center justify-between gap-3 px-2">
                  <span className="text-sm font-medium text-foreground">
                    Version {version.versionNumber}
                  </span>
                  <StatusBadge
                    label={version.status}
                    tone={
                      version.status === 'ACTIVE'
                        ? 'success'
                        : version.status === 'DRAFT'
                          ? 'pending'
                          : 'muted'
                    }
                  />
                </div>
                <div className="mt-2 px-2 text-xs text-muted-foreground">
                  Created {dateLabel(version.createdAt)}
                  {version.effectiveFrom ? ` · Activated ${dateLabel(version.effectiveFrom)}` : ''}
                </div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel
          title={selectedVersion ? `Version ${selectedVersion.versionNumber} Stages` : 'Stages'}
        >
          {versionQuery.isError ? (
            <ErrorState
              title="Unable to load version"
              description={versionQuery.error.message}
              action={<Button onClick={() => void versionQuery.refetch()}>Retry</Button>}
            />
          ) : (
            <>
              {selectedVersion ? (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <DescriptionList columns={3} density="compact">
                    <DescriptionList.Item
                      label="Status"
                      value={
                        <StatusBadge
                          label={selectedVersion.status}
                          tone={
                            selectedVersion.status === 'ACTIVE'
                              ? 'success'
                              : selectedVersion.status === 'DRAFT'
                                ? 'pending'
                                : 'muted'
                          }
                        />
                      }
                    />
                    <DescriptionList.Item
                      label="Created"
                      value={dateLabel(selectedVersion.createdAt)}
                    />
                    <DescriptionList.Item
                      label="Activated"
                      value={
                        selectedVersion.effectiveFrom
                          ? dateLabel(selectedVersion.effectiveFrom)
                          : '—'
                      }
                    />
                  </DescriptionList>
                  <div className="flex gap-2">
                    {selectedVersion.status === 'DRAFT' ? (
                      <>
                        <Button asChild variant="secondary">
                          <Link
                            to={`/master-data/process-flow-versions/${selectedVersion.id}/edit`}
                          >
                            Edit Draft
                          </Link>
                        </Button>
                        <Button
                          variant="default"
                          disabled={selectedVersion.stages.length === 0}
                          onClick={() => {
                            setError('');
                            setActivationOpen(true);
                          }}
                        >
                          Activate
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <DataTable
                columns={[
                  {
                    key: 'sequence',
                    header: '#',
                    accessor: 'sequence',
                    align: 'right',
                    width: '72px',
                  },
                  { key: 'name', header: 'Stage', accessor: 'name' },
                  { key: 'code', header: 'Code', render: (stage) => stage.code ?? '—' },
                  {
                    key: 'status',
                    header: 'Status',
                    render: (stage) => (
                      <StatusBadge
                        label={stage.status}
                        tone={stage.status === 'ACTIVE' ? 'success' : 'muted'}
                      />
                    ),
                  },
                ]}
                data={selectedVersion?.stages ?? []}
                loading={versionQuery.isLoading}
                loadingState={<LoadingState variant="rows" label="Loading stages" />}
                emptyState={
                  <EmptyState
                    title="No stages in this draft"
                    description={
                      selectedVersion?.status === 'DRAFT'
                        ? 'Edit the draft to add stages before activation.'
                        : 'This version contains no stages.'
                    }
                  />
                }
                containerClassName="shadow-none"
              />
            </>
          )}
        </Panel>
      </div>

      <Dialog open={newVersionOpen} onOpenChange={setNewVersionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Version</DialogTitle>
            <DialogDescription>
              Create an independent draft. Copying never changes the source version.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup
            value={newVersionMode}
            onValueChange={(value) => setNewVersionMode(value as 'copy' | 'empty')}
            label="Starting stages"
          >
            <Radio
              id="version-copy"
              value="copy"
              label="Copy an existing version"
              description={
                activeVersion
                  ? 'The active version is selected by default.'
                  : 'Choose any historical version.'
              }
            />
            <Radio
              id="version-empty"
              value="empty"
              label="Start with an empty version"
              description="Add stages in the draft editor after creation."
            />
          </RadioGroup>
          {newVersionMode === 'copy' ? (
            <div className="mt-4">
              <SelectField
                label="Version to copy"
                value={copyFromVersionId || undefined}
                onValueChange={setCopyFromVersionId}
                width="fill"
              >
                {flow.versions.map((version) => (
                  <SelectItem key={version.id} value={version.id}>
                    Version {version.versionNumber} · {version.status}
                  </SelectItem>
                ))}
              </SelectField>
            </div>
          ) : null}
          {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setNewVersionOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="default"
              loading={createVersionMutation.isPending}
              onClick={() => createVersionMutation.mutate()}
            >
              Create Draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={activationOpen}
        onOpenChange={setActivationOpen}
        title={`Activate ${flow.name} v${selectedVersion?.versionNumber ?? ''}?`}
        description={[
          `Final stages: ${selectedVersion?.stages.map((stage) => `${stage.sequence}. ${stage.name}`).join('; ') || 'none'}.`,
          'This version will become immutable.',
          activeVersion
            ? `Version ${activeVersion.versionNumber} will be retired.`
            : 'There is no previous active version to retire.',
        ].join(' ')}
        confirmLabel="Activate Version"
        loading={activateMutation.isPending}
        onConfirm={() => selectedVersion && activateMutation.mutate(selectedVersion.id)}
      />
    </div>
  );
}
