/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useServerLookup, type ServerLookupResult } from './use-server-lookup.js';

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let latest: ServerLookupResult<string>;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Probe({
  searchText,
  fetchOptions,
  onResult,
  minLength = 2,
  enabled,
}: {
  searchText: string;
  fetchOptions: (search: string, signal: AbortSignal) => Promise<string[]>;
  onResult: (result: ServerLookupResult<string>) => void;
  minLength?: number;
  enabled?: boolean;
}) {
  const result = useServerLookup({
    queryKey: ['probe'],
    searchText,
    fetchOptions,
    minLength,
    enabled,
    debounceMs: 50,
  });
  onResult(result);
  return null;
}

function recordResult(result: ServerLookupResult<string>) {
  latest = result;
}

function renderProbe(
  searchText: string,
  fetchOptions: (search: string, signal: AbortSignal) => Promise<string[]>,
  options: { minLength?: number; enabled?: boolean } = {},
) {
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe
          searchText={searchText}
          fetchOptions={fetchOptions}
          onResult={recordResult}
          {...options}
        />
      </QueryClientProvider>,
    ),
  );
}

async function wait(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor(assertion: () => void, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      assertion();
      return;
    } catch (caught) {
      if (Date.now() > deadline) throw caught;
      await wait(10);
    }
  }
}

describe('useServerLookup', () => {
  it('makes no request below the minimum length and reports belowMinLength', async () => {
    const fetchOptions = vi.fn(async () => ['x']);
    renderProbe('', fetchOptions);
    renderProbe('a', fetchOptions);
    await wait(120);

    expect(fetchOptions).not.toHaveBeenCalled();
    expect(latest).toMatchObject({
      options: [],
      loading: false,
      error: null,
      belowMinLength: true,
    });
  });

  it('debounces rapid typing into a single request for the final text', async () => {
    const fetchOptions = vi.fn(async (search: string) => [`${search}-result`]);
    // The field always mounts with an empty search.
    renderProbe('', fetchOptions);
    for (const text of ['55', '552', '5526', '55260']) {
      renderProbe(text, fetchOptions);
      await wait(10);
    }
    expect(latest.loading).toBe(true);

    await waitFor(() =>
      expect(latest).toMatchObject({
        options: ['55260-result'],
        loading: false,
        belowMinLength: false,
      }),
    );
    expect(fetchOptions).toHaveBeenCalledTimes(1);
    expect(fetchOptions.mock.calls[0]![0]).toBe('55260');
  });

  it('flags the previous rows as loading while the next search runs, then replaces them', async () => {
    let release!: () => void;
    const fetchOptions = vi.fn(async (search: string) => {
      if (search === 'abc') await new Promise<void>((resolve) => (release = resolve));
      return [`${search}-result`];
    });
    renderProbe('', fetchOptions);
    renderProbe('ab', fetchOptions);
    await waitFor(() => expect(latest).toMatchObject({ options: ['ab-result'], loading: false }));

    renderProbe('abc', fetchOptions);
    await waitFor(() => expect(fetchOptions).toHaveBeenCalledWith('abc', expect.anything()));
    // Previous rows retained, but marked loading (not committable).
    expect(latest).toMatchObject({ options: ['ab-result'], loading: true });

    release();
    await waitFor(() => expect(latest).toMatchObject({ options: ['abc-result'], loading: false }));
  });

  it('never lets a late response for an older search overwrite a newer one', async () => {
    let releaseOld!: () => void;
    const fetchOptions = vi.fn(async (search: string) => {
      if (search === 'old') await new Promise<void>((resolve) => (releaseOld = resolve));
      return [`${search}-result`];
    });
    renderProbe('', fetchOptions);
    renderProbe('old', fetchOptions);
    await waitFor(() => expect(fetchOptions).toHaveBeenCalledWith('old', expect.anything()));
    renderProbe('new', fetchOptions);
    await waitFor(() => expect(latest).toMatchObject({ options: ['new-result'], loading: false }));

    releaseOld();
    await wait(50);

    expect(latest).toMatchObject({ options: ['new-result'], loading: false });
  });

  it('surfaces a failed search as an error with no rows', async () => {
    const fetchOptions = vi.fn(async () => {
      throw new Error('boom');
    });
    renderProbe('', fetchOptions);
    renderProbe('boom', fetchOptions);

    await waitFor(() => expect(latest.error?.message).toBe('boom'));
    expect(latest.options).toEqual([]);
    expect(latest.loading).toBe(false);
  });

  describe('initial options (minLength 0, LU0)', () => {
    it('makes no request while disabled, even for a searchable text', async () => {
      const fetchOptions = vi.fn(async () => ['x']);
      renderProbe('', fetchOptions, { minLength: 0, enabled: false });
      renderProbe('ab', fetchOptions, { minLength: 0, enabled: false });
      await wait(120);

      expect(fetchOptions).not.toHaveBeenCalled();
      expect(latest).toMatchObject({ options: [], loading: false, error: null });
    });

    it('requests the empty search once enabled and reports no belowMinLength', async () => {
      const fetchOptions = vi.fn(async (search: string) => [`initial:${search}`]);
      renderProbe('', fetchOptions, { minLength: 0, enabled: false });
      renderProbe('', fetchOptions, { minLength: 0, enabled: true });

      await waitFor(() =>
        expect(latest).toMatchObject({
          options: ['initial:'],
          loading: false,
          belowMinLength: false,
        }),
      );
      expect(fetchOptions).toHaveBeenCalledTimes(1);
      expect(fetchOptions.mock.calls[0]![0]).toBe('');
    });

    it('opening by typing searches only the typed text, never the stale empty one', async () => {
      const fetchOptions = vi.fn(async (search: string) => [`${search}-result`]);
      renderProbe('', fetchOptions, { minLength: 0, enabled: false });
      renderProbe('ab', fetchOptions, { minLength: 0, enabled: true });
      expect(latest.loading).toBe(true);

      await waitFor(() => expect(latest).toMatchObject({ options: ['ab-result'], loading: false }));
      expect(fetchOptions.mock.calls.map(([search]) => search)).toEqual(['ab']);
    });

    it('clearing back to empty restores the initial options from cache', async () => {
      const fetchOptions = vi.fn(async (search: string) => [`${search || 'initial'}-result`]);
      renderProbe('', fetchOptions, { minLength: 0, enabled: true });
      await waitFor(() =>
        expect(latest).toMatchObject({ options: ['initial-result'], loading: false }),
      );

      renderProbe('ab', fetchOptions, { minLength: 0, enabled: true });
      await waitFor(() => expect(latest).toMatchObject({ options: ['ab-result'], loading: false }));

      renderProbe('', fetchOptions, { minLength: 0, enabled: true });
      await waitFor(() =>
        expect(latest).toMatchObject({ options: ['initial-result'], loading: false }),
      );
      expect(fetchOptions.mock.calls.map(([search]) => search)).toEqual(['', 'ab']);
    });

    it('closing (disabling) hides the rows; reopening serves them from cache', async () => {
      const fetchOptions = vi.fn(async () => ['initial-result']);
      renderProbe('', fetchOptions, { minLength: 0, enabled: true });
      await waitFor(() => expect(latest.options).toEqual(['initial-result']));

      renderProbe('', fetchOptions, { minLength: 0, enabled: false });
      expect(latest).toMatchObject({ options: [], loading: false });

      renderProbe('', fetchOptions, { minLength: 0, enabled: true });
      expect(latest).toMatchObject({ options: ['initial-result'], loading: false });
      expect(fetchOptions).toHaveBeenCalledTimes(1);
    });
  });
});
