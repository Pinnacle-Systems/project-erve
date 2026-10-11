import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LookupFieldWidth } from '@erve/primitives';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, LookupField } from '@erve/primitives';
import { FactoryEditor } from './FactoryEditor.js';
import type { Factory } from './types.js';

export type FactoryLookupValue = Pick<Factory, 'id' | 'code' | 'name'> & Partial<Pick<Factory, 'status'>>;

function isInactive(factory: FactoryLookupValue): boolean {
  return factory.status !== undefined && factory.status !== 'ACTIVE';
}

function getFactoryLabel(factory: FactoryLookupValue): string {
  return `${factory.name} (${factory.code})${isInactive(factory) ? ' — inactive' : ''}`;
}

function FactoryOptionRow({ factory }: { factory: FactoryLookupValue }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="truncate font-semibold">{factory.name}</span>
      <span className="shrink-0 text-muted-foreground">{factory.code}</span>
      {isInactive(factory) && <span className="shrink-0 text-muted-foreground">(inactive)</span>}
    </div>
  );
}

export interface FactoryLookupFieldProps {
  id?: string;
  label?: string;
  width?: LookupFieldWidth;
  value: FactoryLookupValue | null;
  onChange: (factory: FactoryLookupValue | null) => void;
  // The already-loaded Factory option set (GET /factories/options — small
  // and unpaginated, so this is filtered client-side like the Dispatch
  // Order Style picker, not a separate server search). Callers may pass
  // their own minimal Factory-option shape; only id/code/name/status are
  // read here.
  options: readonly FactoryLookupValue[];
  required?: boolean;
  disabled?: boolean;
  errorMessage?: string;
  helpText?: ReactNode;
  // DEMO-015: offers "+ Create new Factory" when true — opt-in, since
  // most consumers of this field are filters or read contexts where
  // inline-create makes no sense. The CALLER computes this (typically
  // `canManageFactories(user)`), never a check made in here — this
  // component has no AuthContext dependency of its own.
  allowInlineCreate?: boolean;
}

// Factory lookup: client-side filtered over the already-loaded Factory
// option list (modeled on DistributorLookupField's search-box UX, but
// without a separate server round trip — the Factory master is small and
// GET /factories/options already returns it in full). Optional inline
// creation follows the RetailStoreLookupField pattern exactly: a generation-
// guarded dialog, gated by the Factory master's own create permission.
export function FactoryLookupField({
  id,
  label = 'Factory',
  width = 'md',
  value,
  onChange,
  options,
  required,
  disabled,
  errorMessage,
  helpText,
  allowInlineCreate = false,
}: FactoryLookupFieldProps) {
  const [searchText, setSearchText] = useState('');
  const [creating, setCreating] = useState(false);
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

  const query = searchText.trim().toLowerCase();
  const filtered = query
    ? options.filter((f) => `${f.name} ${f.code}`.toLowerCase().includes(query))
    : options;

  return (
    <div className="space-y-2">
      <LookupField<FactoryLookupValue>
        id={id}
        label={label}
        width={width}
        required={required}
        disabled={disabled}
        errorMessage={errorMessage}
        helpText={helpText}
        placeholder="Search factory name or code…"
        selectedOption={value}
        onSelect={onChange}
        searchText={searchText}
        onSearchTextChange={setSearchText}
        options={filtered}
        getOptionKey={(f) => f.id}
        getOptionLabel={getFactoryLabel}
        renderOption={(f) => <FactoryOptionRow factory={f} />}
        emptyMessage={options.length === 0 ? 'No active factories available' : 'No factories match your search'}
      />
      {allowInlineCreate && (
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={() => {
            creationGeneration.current += 1;
            setGeneration(creationGeneration.current);
            setCreating(true);
          }}
        >
          + Create new Factory
        </Button>
      )}
      {creating && (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) closeCreation();
          }}
        >
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto" onKeyDown={(e) => e.stopPropagation()}>
            <DialogHeader>
              <DialogTitle>Create Factory</DialogTitle>
            </DialogHeader>
            <FactoryEditor
              onCancel={closeCreation}
              onSaved={(factory) => {
                if (creationGeneration.current !== generation) return;
                closeCreation();
                if (factory.status === 'ACTIVE') onChange(factory);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
