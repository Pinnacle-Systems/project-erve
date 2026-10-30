/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DistributorMappingPanel } from './DistributorMappingPanel.js';
import { apiClient } from '../../../lib/api-client.js';
import type { AdminUserSummary } from '../../master-data/types.js';

const confirmation = vi.hoisted(() => ({
  onConfirm: null as (() => void) | null,
  confirmBeforeCleanup: false,
}));

vi.mock('@erve/app-components', async (importOriginal) => {
  const original = await importOriginal<typeof import('@erve/app-components')>();
  const { useLayoutEffect } = await import('react');
  return {
    ...original,
    ConfirmDialog: (props: Parameters<typeof original.ConfirmDialog>[0]) => {
      confirmation.onConfirm = props.onConfirm;
      // A child layout effect runs before the panel's cleanup effects. Exercise
      // the actual handler in that interval, rather than only testing visibility.
      useLayoutEffect(() => {
        if (confirmation.confirmBeforeCleanup) {
          confirmation.confirmBeforeCleanup = false;
          props.onConfirm();
        }
      });
      return <original.ConfirmDialog {...props} />;
    },
  };
});

let root: Root;
let container: HTMLDivElement;
const mappedDistributor = { id: 'dist-a', name: 'Distributor A', code: 'DA' };

beforeEach(() => {
  confirmation.onConfirm = null;
  confirmation.confirmBeforeCleanup = false;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function userWith(id: string, distributors: typeof mappedDistributor[] = []) {
  return { id, name: id, distributors } as unknown as AdminUserSummary;
}

async function renderUser(
  user: AdminUserSummary,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <DistributorMappingPanel user={user} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return queryClient;
}

async function rerenderUser(queryClient: QueryClient, user: AdminUserSummary) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <DistributorMappingPanel user={user} />
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function click(label: string) {
  await act(async () =>
    (
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === label,
      ) as HTMLButtonElement
    ).click(),
  );
}
// The dialog's own confirm button also reads "Remove" (confirmLabel="Remove"),
// same as the panel's trigger button, so the confirm action must be scoped to
// the dialog to disambiguate the two.
async function confirmInDialog() {
  await act(async () => {
    const dialog = document.querySelector('[role="dialog"]')!;
    (
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.textContent === 'Remove',
      ) as HTMLButtonElement
    ).click();
  });
}

it('requires confirmation before removing and issues no DELETE on Cancel', async () => {
  const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} });
  await renderUser(userWith('worker-a', [mappedDistributor]));
  await click('Remove');
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain('Distributor A');
  expect(del).not.toHaveBeenCalled();
  await click('Cancel');
  expect(del).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('removes the correct user and mapping on Confirm, exactly once', async () => {
  const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} });
  await renderUser(userWith('worker-a', [mappedDistributor]));
  await click('Remove');
  await confirmInDialog();
  expect(del).toHaveBeenCalledExactlyOnceWith('/users/worker-a/distributors/dist-a');
});

it('shows an error and keeps the panel usable when the DELETE fails', async () => {
  const del = vi.spyOn(apiClient, 'delete').mockRejectedValueOnce(new Error('Removal unavailable'))
    .mockResolvedValue({ data: {} });
  await renderUser(userWith('worker-a', [mappedDistributor]));
  await click('Remove');
  await confirmInDialog();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  expect(document.body.textContent).toContain('Removal unavailable');
  expect(container.textContent).toContain('Distributor A');
  // Recovery: Remove is clickable again and reopens a confirmation.
  await click('Remove');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await confirmInDialog();
  expect(del.mock.calls).toEqual([
    ['/users/worker-a/distributors/dist-a'],
    ['/users/worker-a/distributors/dist-a'],
  ]);
});

const distributorB = { id: 'dist-b', name: 'Distributor B', code: 'DB' };

it.each([
  ['changed', [distributorB]],
  ['missing', []],
  ['ambiguous', [mappedDistributor, distributorB]],
] as const)('rejects a stale confirmation before cleanup when the mapping is %s', async (_label, distributors) => {
  const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} });
  const queryClient = await renderUser(userWith('worker-a', [mappedDistributor]));
  await click('Remove');
  confirmation.confirmBeforeCleanup = true;
  await rerenderUser(queryClient, userWith('worker-a', [...distributors]));
  expect(del).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('invalidates the old target on refresh and requires a fresh confirmation for the new mapping', async () => {
  const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} });
  const queryClient = await renderUser(userWith('worker-a', [mappedDistributor]));
  await click('Remove');
  const staleConfirm = confirmation.onConfirm!;
  await rerenderUser(queryClient, userWith('worker-a', [distributorB]));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => staleConfirm());
  expect(del).not.toHaveBeenCalled();
  await click('Remove');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Distributor B');
  await confirmInDialog();
  expect(del).toHaveBeenCalledExactlyOnceWith('/users/worker-a/distributors/dist-b');
});

it('never resurrects an invalidated confirmation when the mapping changes X to Y to X', async () => {
  const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} });
  const userA = userWith('worker-a', [mappedDistributor]);
  const queryClient = await renderUser(userA);
  await click('Remove');
  const staleConfirm = confirmation.onConfirm!;
  await rerenderUser(queryClient, userWith('worker-a', [distributorB]));
  await rerenderUser(queryClient, userA);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => staleConfirm());
  expect(del).not.toHaveBeenCalled();
  await click('Remove');
  await confirmInDialog();
  expect(del).toHaveBeenCalledExactlyOnceWith('/users/worker-a/distributors/dist-a');
});

it('keeps the captured display names when the same identity pair is refreshed', async () => {
  const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} });
  const queryClient = await renderUser(userWith('worker-a', [mappedDistributor]));
  await click('Remove');
  await rerenderUser(queryClient, {
    ...userWith('worker-a', [{ ...mappedDistributor, name: 'Renamed distributor' }]),
    name: 'Renamed user',
  });
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain('worker-a will lose access to Distributor A');
  expect(dialog.textContent).not.toContain('Renamed');
  await confirmInDialog();
  expect(del).toHaveBeenCalledExactlyOnceWith('/users/worker-a/distributors/dist-a');
});

it('Escape cancels without deletion and invalidates a retained confirm callback', async () => {
  const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} });
  await renderUser(userWith('worker-a', [mappedDistributor]));
  await click('Remove');
  const staleConfirm = confirmation.onConfirm!;
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => staleConfirm());
  expect(del).not.toHaveBeenCalled();
});

it(
  'does not remove a different user’s mapping if the displayed user changes ' +
    'while a removal confirmation is pending',
  async () => {
    // The User Detail page does not remount this panel on an in-place
    // navigation between two already-cached users, so a pending
    // confirmation opened for worker-a must not survive, and must never be
    // confirmable against worker-b's own mapping.
    const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} });
    const userA = userWith('worker-a', [mappedDistributor]);
    const userB = userWith('worker-b', []);
    const queryClient = await renderUser(userA);

    await click('Remove');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();

    // Navigate in place to a different, already-cached user.
    await rerenderUser(queryClient, userB);

    expect(document.querySelector('[role="dialog"]')).toBeNull();
    // worker-b has no mapping, so the panel shows the assign form, not even
    // a "Remove" trigger — there is no way to reach a confirm action here.
    const removeButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Remove',
    );
    expect(removeButton).toBeUndefined();
    expect(del).not.toHaveBeenCalled();

    // Navigating back to worker-a does not resurrect the stale confirmation.
    await rerenderUser(queryClient, userA);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(del).not.toHaveBeenCalled();
  },
);

it('scopes a fresh confirmation on the newly displayed user to that user’s own mapping', async () => {
  const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: {} });
  const distributorB = { id: 'dist-b', name: 'Distributor B', code: 'DB' };
  const userA = userWith('worker-a', [mappedDistributor]);
  const userB = userWith('worker-b', [distributorB]);
  const queryClient = await renderUser(userA);

  await rerenderUser(queryClient, userB);
  await click('Remove');
  await confirmInDialog();
  expect(del).toHaveBeenCalledExactlyOnceWith('/users/worker-b/distributors/dist-b');
});

it('does not duplicate the DELETE request on a double confirm click', async () => {
  let resolveDelete!: () => void;
  const del = vi.spyOn(apiClient, 'delete').mockImplementation(
    () => new Promise((resolve) => { resolveDelete = () => resolve({ data: {} }); }),
  );
  await renderUser(userWith('worker-a', [mappedDistributor]));
  await click('Remove');
  await confirmInDialog();
  await confirmInDialog();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  expect((document.querySelector('[role="dialog"] button') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(del).toHaveBeenCalledExactlyOnceWith('/users/worker-a/distributors/dist-a');
  await act(async () => { resolveDelete(); });
});

it('keeps a submitted request and its confirmation bound to X during a same-user refresh to Y', async () => {
  let resolveDelete!: () => void;
  const del = vi.spyOn(apiClient, 'delete').mockImplementation(
    () => new Promise((resolve) => { resolveDelete = () => resolve({ data: {} }); }),
  );
  const queryClient = await renderUser(userWith('worker-a', [mappedDistributor]));
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  await click('Remove');
  await confirmInDialog();
  await rerenderUser(queryClient, userWith('worker-a', [distributorB]));
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Distributor A');
  expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain('Distributor B');
  await act(async () => { resolveDelete(); });
  expect(del).toHaveBeenCalledExactlyOnceWith('/users/worker-a/distributors/dist-a');
  expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
    ['admin-user', 'worker-a'], ['admin-users'],
  ]);
});

it('does not show an old request failure on a newly displayed user', async () => {
  let rejectDelete!: (error: Error) => void;
  const del = vi.spyOn(apiClient, 'delete').mockImplementation(
    () => new Promise((_resolve, reject) => { rejectDelete = reject; }),
  );
  const queryClient = await renderUser(userWith('worker-a', [mappedDistributor]));
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  await click('Remove');
  await confirmInDialog();
  await rerenderUser(queryClient, userWith('worker-b', [distributorB]));
  await act(async () => { rejectDelete(new Error('Original removal failed')); });
  expect(del).toHaveBeenCalledExactlyOnceWith('/users/worker-a/distributors/dist-a');
  expect(invalidate).not.toHaveBeenCalled();
  expect(container.textContent).toContain('Distributor B');
  expect(container.textContent).not.toContain('Original removal failed');
  await click('Remove');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('worker-b');
});

it(
  'keeps an already-submitted DELETE bound to its original user and mapping ' +
    'even if navigation occurs before the request resolves',
  async () => {
    let resolveDelete!: () => void;
    const del = vi.spyOn(apiClient, 'delete').mockImplementation(
      () => new Promise((resolve) => { resolveDelete = () => resolve({ data: {} }); }),
    );
    const userA = userWith('worker-a', [mappedDistributor]);
    const userB = userWith('worker-b', [distributorB]);
    const queryClient = await renderUser(userA);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await click('Remove');
    await confirmInDialog();
    expect(del).toHaveBeenCalledExactlyOnceWith('/users/worker-a/distributors/dist-a');

    // Navigate away while the DELETE for worker-a is still in flight.
    await rerenderUser(queryClient, userB);

    // Resolve the in-flight request; it must not retarget worker-b.
    await act(async () => { resolveDelete(); });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(del).toHaveBeenCalledOnce();
    expect(del).toHaveBeenCalledWith('/users/worker-a/distributors/dist-a');
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      ['admin-user', 'worker-a'],
      ['admin-users'],
    ]);
    expect(container.textContent).toContain('Distributor B');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  },
);
