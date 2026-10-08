import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiSuccessResponse, RetailStore } from '@erve/types';
import { PageHeader, StatusBadge } from '@erve/app-components';
import { Button, SelectField, SelectItem, TextField, ValidationMessage } from '@erve/primitives';
import { FormGrid, Panel } from '@erve/layout';
import { DataTable, EmptyState, ErrorState, LoadingState } from '@erve/data-display';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageRetailStores } from '../../auth/permissions.js';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useDebouncedValue } from '../../lib/use-debounced-value.js';
import { LoadMoreFooter, loadMoreProps, useCursorList } from '../../lib/cursor-list.js';
import { DistributorLookupField, type DistributorLookupValue } from './DistributorLookupField.js';
import { RetailStoreEditor } from './RetailStoreEditor.js';

const base = '/master-data/retail-stores';
export function RetailStoreListPage() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 300);
  const [status, setStatus] = useState('ALL');
  const [distributor, setDistributor] = useState<DistributorLookupValue | null>(null);
  const { query, items } = useCursorList<RetailStore>({
    queryKey: ['retail-stores'],
    path: '/retail-stores',
    params: {
      limit: 25,
      search: debounced || undefined,
      status: status === 'ALL' ? undefined : status,
      distributorId: distributor?.id,
    },
  });
  return (
    <div className="space-y-4">
      <PageHeader
        title="Retail Stores"
        subtitle="Delivery stores maintained per Distributor"
        primaryAction={
          canManageRetailStores(user) ? (
            <Button asChild>
              <Link to={`${base}/new`}>Create Retail Store</Link>
            </Button>
          ) : undefined
        }
      />
      <Panel>
        <FormGrid layout="content">
          <TextField
            label="Search"
            placeholder="Store Code or Store Name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <DistributorLookupField
            label="Distributor"
            value={distributor}
            onChange={setDistributor}
          />
          <SelectField label="Status" value={status} onValueChange={setStatus} width="sm">
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="INACTIVE">Inactive</SelectItem>
          </SelectField>
        </FormGrid>
      </Panel>
      <DataTable<RetailStore>
        columns={[
          {
            key: 'code',
            header: 'Store Code',
            render: (s) => (
              <Link className="font-medium text-[var(--erp-text-link)]" to={`${base}/${s.id}`}>
                {s.code}
              </Link>
            ),
          },
          { key: 'name', header: 'Store Name', accessor: 'name' },
          { key: 'distributor', header: 'Distributor', render: (s) => s.distributor?.name ?? '' },
          { key: 'city', header: 'City', accessor: 'city' },
          {
            key: 'status',
            header: 'Status',
            render: (s) => (
              <StatusBadge label={s.status} tone={s.status === 'ACTIVE' ? 'success' : 'muted'} />
            ),
          },
        ]}
        data={items}
        loading={query.isLoading}
        loadingState={<LoadingState variant="rows" label="Loading Retail Stores" />}
        emptyState={
          <EmptyState
            title="No Retail Stores found"
            description="Create a Store or adjust your filters."
          />
        }
        error={
          query.isError ? (
            <ErrorState
              title="Unable to load Retail Stores"
              description={getApiErrorMessage(query.error, 'Please retry')}
            />
          ) : undefined
        }
      />
      <LoadMoreFooter {...loadMoreProps(query, items.length, ['Retail Store', 'Retail Stores'])} />
    </div>
  );
}
function useStore() {
  const { id } = useParams();
  return useQuery({
    queryKey: ['retail-store', id],
    enabled: Boolean(id),
    queryFn: async () =>
      (await apiClient.get<ApiSuccessResponse<RetailStore>>(`/retail-stores/${id}`)).data.data,
  });
}
export function RetailStoreFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const query = useStore();
  if (id && query.isLoading) return <LoadingState label="Loading Retail Store" />;
  if (id && (query.isError || !query.data))
    return <ErrorState title="Unable to load Retail Store" />;
  return (
    <div className="space-y-4">
      <PageHeader title={id ? 'Edit Retail Store' : 'Create Retail Store'} />
      <Panel>
        <RetailStoreEditor
          key={id ?? 'new'}
          store={query.data}
          onCancel={() => navigate(id ? `${base}/${id}` : base)}
          onSaved={(s) => navigate(`${base}/${s.id}`)}
        />
      </Panel>
    </div>
  );
}
export function RetailStoreDetailPage() {
  const query = useStore();
  const client = useQueryClient();
  const { user } = useAuth();
  const status = useMutation({
    mutationFn: async () =>
      apiClient.patch(`/retail-stores/${query.data!.id}/status`, {
        status: query.data!.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE',
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['retail-store'] });
      void client.invalidateQueries({ queryKey: ['retail-stores'] });
      void client.invalidateQueries({ queryKey: ['retail-store-lookup'] });
    },
  });
  if (query.isLoading) return <LoadingState label="Loading Retail Store" />;
  if (query.isError || !query.data) return <ErrorState title="Unable to load Retail Store" />;
  const s = query.data;
  return (
    <div className="space-y-4">
      <PageHeader
        title={`${s.code} — ${s.name}`}
        subtitle={s.distributor?.name}
        primaryAction={
          canManageRetailStores(user) ? (
            <Button asChild>
              <Link to={`${base}/${s.id}/edit`}>Edit Retail Store</Link>
            </Button>
          ) : undefined
        }
      />
      <Panel title="Store Identity">
        <FormGrid layout="content">
          <TextField label="Distributor" readOnly value={s.distributor?.name ?? ''} />
          <TextField label="Store Code" readOnly value={s.code} />
          <TextField label="Store Name" readOnly value={s.name} />
          <TextField label="GSTIN" readOnly value={s.gstin ?? ''} />
          <StatusBadge label={s.status} tone={s.status === 'ACTIVE' ? 'success' : 'muted'} />
        </FormGrid>
      </Panel>
      <Panel title="Address">
        <FormGrid layout="content">
          {(
            [
              ['Address Line 1', s.addressLine1],
              ['Address Line 2', s.addressLine2],
              ['City', s.city],
              ['State', s.state],
              ['PIN', s.postalCode],
              ['Country', s.country],
            ] as const
          ).map(([label, value]) => (
            <TextField key={label} label={label} readOnly value={value ?? ''} />
          ))}
        </FormGrid>
      </Panel>
      <Panel title="Contact Information">
        <FormGrid layout="content">
          <TextField label="Contact Person" readOnly value={s.contactName ?? ''} />
          <TextField label="Phone" readOnly value={s.contactPhone ?? ''} />
          <TextField label="Contact Email" readOnly value={s.contactEmail ?? ''} />
        </FormGrid>
      </Panel>
      {canManageRetailStores(user) && (
        <Button variant="secondary" loading={status.isPending} onClick={() => status.mutate()}>
          {s.status === 'ACTIVE' ? 'Inactivate Store' : 'Activate Store'}
        </Button>
      )}
      {status.isError && (
        <ValidationMessage tone="error">
          {getApiErrorMessage(status.error, 'Unable to change status')}
        </ValidationMessage>
      )}
      <Button asChild variant="ghost">
        <Link to={base}>Back to Retail Stores</Link>
      </Button>
    </div>
  );
}
