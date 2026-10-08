import { useEffect, useRef, useState } from 'react';
import type { ApiSuccessResponse, RetailStore } from '@erve/types';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  LookupField,
} from '@erve/primitives';
import { apiClient } from '../../lib/api-client.js';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import { useServerLookup } from '../../lib/use-server-lookup.js';
import { useAuth } from '../../auth/AuthContext.js';
import { canManageRetailStores } from '../../auth/permissions.js';
import type { DistributorLookupValue } from './DistributorLookupField.js';
import { RetailStoreEditor } from './RetailStoreEditor.js';

export type RetailStoreLookupValue = Pick<RetailStore, 'id' | 'name'> &
  Partial<Pick<RetailStore, 'code'>>;
export function RetailStoreLookupField({
  id,
  distributor,
  value,
  onChange,
}: {
  id: string;
  distributor: DistributorLookupValue | null;
  value: RetailStoreLookupValue | null;
  onChange: (store: RetailStore | null) => void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const creationGeneration = useRef(0);
  const [generation, setGeneration] = useState(0);
  useEffect(
    () => () => {
      creationGeneration.current += 1;
    },
    [],
  );
  function closeCreation() {
    creationGeneration.current += 1;
    setCreating(false);
  }
  const lookup = useServerLookup<RetailStore>({
    queryKey: ['retail-store-lookup', distributor?.id],
    searchText: search,
    minLength: 0,
    enabled: open && Boolean(distributor),
    fetchOptions: async (text, signal) =>
      (
        await apiClient.get<ApiSuccessResponse<RetailStore[]>>('/retail-stores/options', {
          params: { distributorId: distributor!.id, search: text, limit: 20 },
          signal,
        })
      ).data.data,
  });
  return (
    <div className="space-y-2">
      <LookupField<RetailStoreLookupValue>
        id={id}
        label="Retail Store"
        selectedOption={value}
        disabled={!distributor}
        placeholder="Search Store Code or Store Name…"
        options={lookup.options}
        onSelect={(store) => onChange(store as RetailStore | null)}
        searchText={search}
        onSearchTextChange={setSearch}
        getOptionKey={(s) => s.id}
        getOptionLabel={(s) => `${s.code ? `${s.code} — ` : ''}${s.name}`}
        loading={lookup.loading}
        searchError={
          lookup.error ? getApiErrorMessage(lookup.error, 'Unable to search Retail Stores') : null
        }
        emptyMessage="No active Retail Stores found"
        onOpenChange={setOpen}
      />
      {distributor && canManageRetailStores(user) && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            creationGeneration.current += 1;
            setGeneration(creationGeneration.current);
            setCreating(true);
          }}
        >
          + Create new Retail Store
        </Button>
      )}
      {creating && distributor && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) closeCreation();
          }}
        >
          <DialogContent
            className="max-w-4xl max-h-[90vh] overflow-y-auto"
            onKeyDown={(e) => e.stopPropagation()}
          >
            <DialogHeader>
              <DialogTitle>Create Retail Store</DialogTitle>
            </DialogHeader>
            <RetailStoreEditor
              distributor={distributor}
              onCancel={closeCreation}
              onSaved={(store) => {
                if (creationGeneration.current !== generation) return;
                closeCreation();
                if (store.status === 'ACTIVE') onChange(store);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
