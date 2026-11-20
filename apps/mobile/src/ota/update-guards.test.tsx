/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useMutation } from '@tanstack/react-query';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DirtyFieldTracker,
  PENDING_MUTATION_MAX_AGE_MS,
  UpdateGuardRegistry,
  pendingMutationReason,
  protectedRouteReason,
} from './update-guards.js';
import { useUpdateSafetyGuards } from './useUpdateSafetyGuards.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('protectedRouteReason', () => {
  it.each([
    ['/qa/abc-123', /QA inspection/],
    ['/quality-executions/e1', /quality execution/],
    ['/factory-tasks/j1', /production task/],
    ['/job-orders/j1', /job order/],
  ])('protects %s', (path, reason) => {
    expect(protectedRouteReason(path)).toMatch(reason);
  });

  it.each(['/login', '/dashboard', '/qa', '/factory-tasks', '/job-orders', '/factory-rework'])(
    'allows updates on %s',
    (path) => {
      expect(protectedRouteReason(path)).toBeNull();
    },
  );
});

describe('UpdateGuardRegistry', () => {
  it('reports the first objecting source and clears when it unregisters', () => {
    const registry = new UpdateGuardRegistry();
    expect(registry.blockingReason()).toBeNull();
    const releaseA = registry.hold('first');
    registry.register(() => null);
    const releaseB = registry.hold('second');
    expect(registry.blockingReason()).toBe('first');
    releaseA();
    expect(registry.blockingReason()).toBe('second');
    releaseB();
    expect(registry.blockingReason()).toBeNull();
  });

  it('notifies subscribers when sources change', () => {
    const registry = new UpdateGuardRegistry();
    let calls = 0;
    const stop = registry.subscribe(() => (calls += 1));
    const release = registry.hold('x');
    release();
    registry.notify();
    stop();
    registry.notify();
    expect(calls).toBe(3);
  });
});

describe('DirtyFieldTracker', () => {
  let tracker: DirtyFieldTracker;
  let stop: () => void;

  beforeEach(() => {
    document.body.innerHTML = '';
    tracker = new DirtyFieldTracker(document);
    stop = tracker.start();
  });
  afterEach(() => stop());

  function typeInto(element: HTMLElement) {
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  it('is clean until the user edits a field', () => {
    document.body.innerHTML = '<input id="a" /><textarea id="b"></textarea>';
    expect(tracker.blockingReason()).toBeNull();
    typeInto(document.getElementById('a')!);
    expect(tracker.blockingReason()).toMatch(/unsaved/);
  });

  it('counts textareas, selects and contenteditable regions', () => {
    document.body.innerHTML =
      '<textarea id="t"></textarea><select id="s"><option>1</option></select><div id="c" contenteditable="true"></div>';
    for (const id of ['t', 's', 'c']) {
      const fresh = new DirtyFieldTracker(document);
      const stopFresh = fresh.start();
      typeInto(document.getElementById(id)!);
      expect(fresh.blockingReason(), id).not.toBeNull();
      stopFresh();
    }
  });

  it('ignores buttons and hidden inputs', () => {
    document.body.innerHTML = '<input id="h" type="hidden" /><input id="b" type="button" />';
    typeInto(document.getElementById('h')!);
    typeInto(document.getElementById('b')!);
    expect(tracker.blockingReason()).toBeNull();
  });

  it('releases the hold when the edited field leaves the document (saved / dialog closed)', () => {
    document.body.innerHTML = '<input id="a" />';
    typeInto(document.getElementById('a')!);
    expect(tracker.blockingReason()).not.toBeNull();
    document.body.innerHTML = '';
    expect(tracker.blockingReason()).toBeNull();
  });

  it('reset() forgets edits (a new screen starts clean)', () => {
    document.body.innerHTML = '<input id="a" />';
    typeInto(document.getElementById('a')!);
    tracker.reset();
    expect(tracker.blockingReason()).toBeNull();
  });

  it('stops tracking after cleanup', () => {
    document.body.innerHTML = '<input id="a" />';
    stop();
    typeInto(document.getElementById('a')!);
    expect(tracker.blockingReason()).toBeNull();
  });
});

describe('useUpdateSafetyGuards', () => {
  let container: HTMLDivElement;
  let root: Root;
  let registry: UpdateGuardRegistry;
  let navigateTo: (path: string) => void;
  let runMutation: () => void;
  let finishMutation: () => void = () => undefined;
  let resolveMutation: () => void = () => undefined;

  function Probe() {
    useUpdateSafetyGuards(registry);
    const navigate = useNavigate();
    navigateTo = (path) => navigate(path);
    const mutation = useMutation({
      mutationFn: () => new Promise<void>((resolve) => (resolveMutation = resolve)),
    });
    runMutation = () => mutation.mutate();
    finishMutation = () => resolveMutation();
    return <input data-testid="field" />;
  }

  async function mount(initialPath: string) {
    const client = new QueryClient();
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[initialPath]}>
            <Probe />
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
  }

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    registry = new UpdateGuardRegistry();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('is safe on an ordinary list screen', async () => {
    await mount('/qa');
    expect(registry.blockingReason()).toBeNull();
  });

  it('blocks on an open QA inspection and clears when leaving it', async () => {
    await mount('/qa/inspection-1');
    expect(registry.blockingReason()).toMatch(/QA inspection/);
    await act(async () => navigateTo('/qa'));
    expect(registry.blockingReason()).toBeNull();
  });

  it('blocks while a save (mutation) is in flight', async () => {
    await mount('/dashboard');
    await act(async () => runMutation());
    expect(registry.blockingReason()).toBe('A save is in progress');
    await act(async () => finishMutation());
    expect(registry.blockingReason()).toBeNull();
  });

  it('blocks on unsaved input and resets on navigation', async () => {
    await mount('/dashboard');
    const field = container.querySelector('[data-testid="field"]')!;
    await act(async () => {
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(registry.blockingReason()).toMatch(/unsaved/);
    await act(async () => navigateTo('/qa'));
    expect(registry.blockingReason()).toBeNull();
  });

  it('removes its guards on unmount', async () => {
    await mount('/qa/inspection-1');
    await act(async () => root.unmount());
    expect(registry.blockingReason()).toBeNull();
    root = createRoot(container);
  });
});

describe('pendingMutationReason', () => {
  it('holds while a save is pending and releases when it settles', async () => {
    const queryClient = new QueryClient();
    let finish!: () => void;
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    expect(pendingMutationReason(queryClient)).toBeNull();
    const running = mutation.execute(undefined);
    expect(pendingMutationReason(queryClient)).toMatch(/save is in progress/);
    await new Promise((resolve) => setTimeout(resolve, 0)); // let mutationFn start
    finish();
    await running;
    expect(pendingMutationReason(queryClient)).toBeNull();
  });

  it('stops holding for a save that has been pending longer than the bound', () => {
    const queryClient = new QueryClient();
    const mutation = queryClient.getMutationCache().build(queryClient, {
      mutationFn: () => new Promise<void>(() => undefined), // never settles
    });
    void mutation.execute(undefined);
    const start = Date.now();
    expect(pendingMutationReason(queryClient, () => start)).toMatch(/in progress/);
    expect(
      pendingMutationReason(queryClient, () => start + PENDING_MUTATION_MAX_AGE_MS - 1000),
    ).toMatch(/in progress/);
    expect(
      pendingMutationReason(queryClient, () => start + PENDING_MUTATION_MAX_AGE_MS + 1000),
    ).toBeNull();
  });
});
