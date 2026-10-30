import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { ApiSuccessResponse, UserOption } from '@erve/types';
import { ConfirmDialog, PageHeader, StatusBadge, createEnterToNextHandler } from '@erve/app-components';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, ValidationMessage } from '@erve/primitives';
import { DescriptionList, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageFactories, canManageUsers } from '../../auth/permissions.js';
import { apiClient } from '../../lib/api-client.js';
import { buildPdfFilename } from '../../lib/pdf/filenames.js';
import { usePdfAction } from '../../lib/pdf/usePdfAction.js';
import { PdfActionButtons } from '../../lib/pdf/components/PdfActionButtons.js';
import { UserLookupField, userLookupQueryKey } from '../users/UserLookupField.js';
import { InlineUserCreateDialog } from '../users/InlineUserCreateDialog.js';
import type { AdminUserSummary, Factory, FactoryUser } from './types.js';

function errorMessage(error: unknown, fallback: string) {
  if (isAxiosError(error))
    return (error.response?.data?.error?.message as string | undefined) ?? error.message;
  return error instanceof Error ? error.message : fallback;
}

// A factory user always has exactly one factory, so "assigning" a user here
// who is already mapped elsewhere reassigns them atomically (the backend
// replaces their prior mapping, never leaving them briefly unmapped) —
// unlike DistributorDetailPage's candidates, these (GET
// /factories/:id/user-options) do NOT exclude users already mapped to a
// different factory. There is no "remove"
// action here either: revoking factory access is done from the user's own
// detail page by removing the FACTORY_USER role, which the backend takes
// the mapping down with atomically.
// Keyed by factory.id so this never carries state (a pending lookup, an
// open reassignment confirmation, a selection) across an in-place
// navigation to a different, already-cached factory — the :id route does
// not otherwise unmount this panel when the destination's data is cached.
function MappedUsers({ factory }: { factory: Factory }) {
  return <MappedUsersPanel key={factory.id} factory={factory} />;
}

function MappedUsersPanel({ factory }: { factory: Factory }) {
  const { user: currentUser } = useAuth();
  const client = useQueryClient();
  const [selected, setSelected] = useState<UserOption | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [reassignment, setReassignment] = useState<{ user: UserOption; previousName: string } | null>(null);
  const submitting = useRef(false);
  const creationGeneration = useRef(0);
  const assignmentVisit = useRef(0);
  const [generation, setGeneration] = useState(0);
  useEffect(
    () => () => {
      creationGeneration.current += 1;
      assignmentVisit.current += 1;
    },
    [],
  );
  function closeCreation() {
    creationGeneration.current += 1;
    setCreating(false);
  }
  const mapped = useQuery({
    queryKey: ['factory-users', factory.id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<FactoryUser[]>>(`/factories/${factory.id}/users`))
        .data.data,
  });
  const userOptionsPath = `/factories/${factory.id}/user-options`;
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ['factory-users'] }),
      client.invalidateQueries({ queryKey: ['admin-user'] }),
      // The newly mapped user is no longer a candidate here.
      client.invalidateQueries({ queryKey: userLookupQueryKey(userOptionsPath) }),
      client.invalidateQueries({ queryKey: ['factory', factory.id] }),
    ]);
  const assign = useMutation({
    mutationFn: async (target: UserOption) => {
      setError('');
      await apiClient.post(`/users/${target.id}/factories`, { factoryId: factory.id });
    },
    onSuccess: async () => {
      setSelected(null);
      setReassignment(null);
      await refresh();
    },
    onError: (caught) => setError(errorMessage(caught, 'Unable to assign user')),
    onSettled: () => { submitting.current = false; },
  });
  const assignUser = (target: UserOption) => {
    if (submitting.current) return;
    submitting.current = true;
    assign.mutate(target);
  };
  const reviewAssignment = async () => {
    if (submitting.current || reassignment || factory.status !== 'ACTIVE') return;
    setError('');
    if (!selected) { setError('Select a factory user'); return; }
    const target = selected;
    const visit = assignmentVisit.current;
    submitting.current = true;
    setChecking(true);
    try {
      const response = await apiClient.get<ApiSuccessResponse<AdminUserSummary>>(`/users/${target.id}`);
      if (visit !== assignmentVisit.current) { submitting.current = false; return; }
      const previous = response.data.data.factories[0];
      if (previous?.id === factory.id) {
        setError('User is already mapped to this factory');
      } else if (previous) {
        setReassignment({ user: target, previousName: previous.name });
      } else {
        // Keep the submission lock through the existing atomic operation.
        assign.mutate(target);
        return;
      }
    } catch (caught) {
      setError(errorMessage(caught, 'Unable to check the current factory assignment. Please try again.'));
    } finally {
      setChecking(false);
    }
    submitting.current = false;
  };
  return (
    <Panel title="Mapped Factory Users">
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-3"
          onKeyDown={createEnterToNextHandler()}
          onSubmit={(event) => {
            event.preventDefault();
            void reviewAssignment();
          }}
        >
          <UserLookupField
            label="Assign user"
            searchPath={userOptionsPath}
            value={selected}
            onChange={setSelected}
            disabled={factory.status !== 'ACTIVE' || checking || assign.isPending}
            emptyMessage="No active factory users available"
            noMatchMessage="No active factory users match your search"
          />
          <Button type="submit" loading={checking || assign.isPending} disabled={factory.status !== 'ACTIVE'}>
            Assign
          </Button>
        </form>
        {factory.status !== 'ACTIVE' ? (
          <p className="text-sm text-muted-foreground">
            Users cannot be assigned to an inactive factory.
          </p>
        ) : null}
        {/* DEMO-015: offered only when no eligible Factory User exists yet to
            assign — gated by the User master's own create permission
            (canManageUsers), not just this panel's broader Factory-manage
            access. Creating with FACTORY_USER + this factoryId maps them
            in the same call, so success only needs a list refresh. */}
        {factory.status === 'ACTIVE' && canManageUsers(currentUser) && (
          <Button type="button" variant="ghost" onClick={() => {
            creationGeneration.current += 1;
            setGeneration(creationGeneration.current);
            setCreating(true);
          }}>
            + Create new Factory User
          </Button>
        )}
        {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
        <DataTable
          columns={[
            {
              key: 'name',
              header: 'Name',
              render: (user) => (
                <Link
                  className="font-medium text-[var(--erp-text-link)]"
                  to={`/master-data/users/${user.id}`}
                >
                  {user.name}
                </Link>
              ),
            },
            { key: 'email', header: 'Email', accessor: 'email' },
            {
              key: 'status',
              header: 'Status',
              render: (user) => (
                <StatusBadge
                  label={user.status}
                  tone={user.status === 'ACTIVE' ? 'success' : 'muted'}
                />
              ),
            },
          ]}
          data={mapped.data ?? []}
          loading={mapped.isLoading}
          loadingState={<LoadingState variant="rows" label="Loading mapped users" />}
          emptyState={
            <EmptyState
              title="No users mapped"
              description="Assign an eligible factory user to grant factory access."
            />
          }
          error={
            mapped.isError ? (
              <ErrorState title="Unable to load mapped users" description={mapped.error.message} />
            ) : undefined
          }
        />
      </div>
      <ConfirmDialog
        open={reassignment !== null}
        onOpenChange={(open) => { if (!open && !submitting.current) { setReassignment(null); setError(''); } }}
        title="Reassign factory user?"
        description={reassignment ? `Confirming will move ${reassignment.user.name} from ${reassignment.previousName} to ${factory.name}, replacing the existing factory assignment.` : undefined}
        error={error}
        loading={assign.isPending}
        onConfirm={() => { if (reassignment) assignUser(reassignment.user); }}
      />
      {creating && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) closeCreation();
          }}
        >
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" onKeyDown={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>Create Factory User</DialogTitle>
            </DialogHeader>
            <InlineUserCreateDialog
              defaultRoles={['FACTORY_USER']}
              factoryId={factory.id}
              onCancel={closeCreation}
              onCreated={() => {
                if (creationGeneration.current !== generation) return;
                closeCreation();
                void refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </Panel>
  );
}

export function FactoryDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const client = useQueryClient();
  const canEdit = canManageFactories(user);
  const canManageFactoryUsers = canManageUsers(user);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const query = useQuery({
    queryKey: ['factory', id],
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<Factory>>(`/factories/${id}`)).data.data,
  });
  const factory = query.data;

  const generateFactoryDetailPdf = useCallback(async () => {
    if (!factory) throw new Error('Factory not loaded');
    // Dynamically imported so @react-pdf/renderer and the document code load only when a user
    // actually clicks Download/Print, not as part of the app's initial bundle.
    const { generateFactoryDetailPdfBlob } = await import('./pdf/generateFactoryDetailPdf.js');
    return generateFactoryDetailPdfBlob(factory, {
      generatedAt: new Date().toISOString(),
      generatedBy: user?.name,
    });
  }, [factory, user?.name]);

  const factoryDetailPdfFilename = useCallback(
    () => buildPdfFilename(['ERVE-Factory', factory?.code]),
    [factory?.code],
  );

  const pdfAction = usePdfAction({
    generate: generateFactoryDetailPdf,
    filename: factoryDetailPdfFilename,
  });

  const mutation = useMutation({
    mutationFn: (status: 'ACTIVE' | 'INACTIVE') =>
      apiClient.patch(`/factories/${id}/status`, { status }),
    onSuccess: async () => {
      setConfirm(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['factory', id] }),
        client.invalidateQueries({ queryKey: ['factories'] }),
      ]);
    },
    onError: (caught) => {
      setConfirm(false);
      setError(errorMessage(caught, 'Unable to update status'));
    },
  });
  if (query.isLoading) return <LoadingState label="Loading factory" />;
  if (query.isError)
    return <ErrorState title="Unable to load factory" description={query.error.message} />;
  if (!factory)
    return (
      <EmptyState
        title="Factory not found"
        description="The selected factory could not be loaded."
      />
    );
  const active = factory.status === 'ACTIVE';
  const fields = [
    ['Code', factory.code],
    ['Name', factory.name],
    ['Contact name', factory.contactName ?? '—'],
    ['Contact email', factory.contactEmail ?? '—'],
    ['Contact phone', factory.contactPhone ?? '—'],
    ['Address line 1', factory.addressLine1 ?? '—'],
    ['Address line 2', factory.addressLine2 ?? '—'],
    ['City', factory.city ?? '—'],
    ['State', factory.state ?? '—'],
    ['Country', factory.country ?? '—'],
    ['Postal code', factory.postalCode ?? '—'],
  ] as const;
  const usage = factory.usage ?? { styleMappings: 0, jobOrders: 0, mappedUsers: 0 };
  return (
    <div className="space-y-5">
      <PageHeader
        title={factory.code}
        subtitle={factory.name}
        status={<StatusBadge label={factory.status} tone={active ? 'success' : 'muted'} />}
        primaryAction={
          <div className="flex items-start gap-3">
            <PdfActionButtons
              isGenerating={pdfAction.isGenerating}
              error={pdfAction.error}
              onDownload={pdfAction.handleDownload}
              onPrint={pdfAction.handlePrint}
            />
            {canEdit ? (
              <Button asChild>
                <Link to={`/master-data/factories/${factory.id}/edit`}>Edit</Link>
              </Button>
            ) : null}
          </div>
        }
        secondaryActions={
          canEdit ? (
            <Button variant={active ? 'destructive' : 'secondary'} onClick={() => setConfirm(true)}>
              {active ? 'Deactivate' : 'Activate'}
            </Button>
          ) : undefined
        }
      />
      {error ? <ValidationMessage tone="error">{error}</ValidationMessage> : null}
      <Panel title="Factory Details">
        <DescriptionList columns={3}>
          {fields.map(([label, value]) => (
            <DescriptionList.Item key={label} label={label} value={value} />
          ))}
        </DescriptionList>
      </Panel>
      <Panel title="Usage and impact">
        <DescriptionList columns={3}>
          <DescriptionList.Item label="Style mappings" value={String(usage.styleMappings)} />
          <DescriptionList.Item label="Job orders" value={String(usage.jobOrders)} />
          <DescriptionList.Item label="Mapped users" value={String(usage.mappedUsers)} />
        </DescriptionList>
      </Panel>
      {canManageFactoryUsers ? <MappedUsers factory={factory} /> : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={active ? 'Deactivate factory' : 'Activate factory'}
        description={
          active
            ? `This factory has ${usage.jobOrders} job order(s), ${usage.styleMappings} style mapping(s), and ${usage.mappedUsers} mapped user(s). New mappings and operational actions will be blocked; history and user mappings remain unchanged.`
            : 'This factory will become available for new mappings and job orders.'
        }
        confirmLabel={active ? 'Deactivate' : 'Activate'}
        destructive={active}
        loading={mutation.isPending}
        onConfirm={() => mutation.mutate(active ? 'INACTIVE' : 'ACTIVE')}
      />
    </div>
  );
}
