import { useState } from 'react';
import { Button, TextField, ValidationMessage } from '@erve/primitives';
import { EmptyState, LoadingState } from '@erve/data-display';
import { getApiErrorMessage } from '../../lib/api-errors.js';
import type { useEligibleErveCartons } from './use-eligible-erve-cartons.js';

type Discovery = ReturnType<typeof useEligibleErveCartons>;

export function EligibleCartonSearch({ discovery }: { discovery: Discovery }) {
  const [draft, setDraft] = useState(discovery.search);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        discovery.setSearch(draft);
      }}
    >
      <TextField
        label="Search eligible cartons"
        aria-label="Search eligible cartons"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Carton, Factory Packing List or Dispatch Order"
        maxLength={256}
      />
      <Button type="submit" variant="secondary" disabled={discovery.query.isFetching}>
        Search
      </Button>
    </form>
  );
}

export function EligibleCartonContinuation({ discovery }: { discovery: Discovery }) {
  const { query, cartons, lastPageEmpty } = discovery;
  return (
    <div className="space-y-3" aria-live="polite">
      {query.isFetching && (
        <LoadingState
          label={
            query.isFetchingNextPage
              ? 'Searching more eligible cartons'
              : 'Loading eligible cartons'
          }
        />
      )}
      {query.isError ? (
        <>
          <ValidationMessage tone="error">
            {getApiErrorMessage(query.error, 'Unable to search eligible cartons.')}
          </ValidationMessage>
          <Button
            type="button"
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => {
              if (query.isFetchNextPageError) void query.fetchNextPage();
              else void query.refetch();
            }}
          >
            Retry search
          </Button>
        </>
      ) : query.hasNextPage ? (
        <>
          {lastPageEmpty && (
            <p className="text-sm text-muted-foreground">
              No matching cartons in this batch. Continue searching for later matches.
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            disabled={query.isFetching}
            onClick={() => void query.fetchNextPage()}
          >
            {lastPageEmpty ? 'Continue searching' : 'Load more'}
          </Button>
        </>
      ) : !query.isPending && !query.isFetching && cartons.length === 0 ? (
        <EmptyState
          title="No more eligible cartons"
          description="No further eligible cartons match this search. Selected cartons remain available below."
        />
      ) : null}
    </div>
  );
}
