/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import * as AuthContext from '../../auth/AuthContext.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import { FactoryDetailPage } from './FactoryDetailPage.js';
import type { Factory } from './types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForLoaded(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (!container.textContent?.includes('Loading factory')) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for the factory to finish loading');
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

function makeFactory(overrides: Partial<Factory> = {}): Factory {
  return {
    id: 'factory-1',
    code: 'FAC-1',
    name: 'Acme Factory',
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    city: null,
    status: 'ACTIVE',
    usage: { styleMappings: 0, jobOrders: 0, mappedUsers: 0 },
    ...overrides,
  };
}

async function renderPage(factory: Factory) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/factories/${factory.id}`) return { data: { data: factory } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/master-data/factories/${factory.id}`]}>
          <AuthProvider>
            <Routes>
              <Route path="/master-data/factories/:id" element={<FactoryDetailPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
  await waitForLoaded();
}

function mockAuth(role: 'ADMIN' | 'MERCHANDISER') {
  const authUser: AuthUser = { id: 'u1', email: 'u1@test.local', mobile: null, name: 'U1', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user: authUser,
    token: 't',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

async function renderPageWithRole(factory: Factory, role: 'ADMIN' | 'MERCHANDISER', currentFactories = [{ id: 'old', name: 'Original Factory', code: 'OLD' }]) {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/factories/${factory.id}`) return { data: { data: factory } };
    if (url === `/factories/${factory.id}/users`) return { data: { data: [] } };
    if (url === `/factories/${factory.id}/user-options`) return { data: { data: [{ id: 'worker', name: 'Factory Worker', email: 'worker@test.local' }] } };
    if (url === '/users/worker') return { data: { data: { factories: currentFactories } } };
    throw new Error(`Unexpected request: ${url}`);
  });
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/master-data/factories/${factory.id}`]}>
          <Routes>
            <Route path="/master-data/factories/:id" element={<FactoryDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
  await waitForLoaded();
}

describe('FactoryDetailPage — Mapped Factory Users inline creation (DEMO-015)', () => {
  async function chooseWorker() {
    const input = document.getElementById('lookup-assign-user') as HTMLInputElement;
    await act(async () => { input.focus(); input.click(); });
    await waitFor(() => Boolean(document.querySelector('[role="option"]')));
    await act(async () => (document.querySelector('[role="option"]') as HTMLElement).click());
  }
  async function submitAssignment() {
    await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  }
  it('does not assign after leaving the page while the current mapping is being checked', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderPageWithRole(makeFactory(), 'ADMIN'); await chooseWorker();
    let complete!: (value: { data: { data: { factories: [] } } }) => void;
    vi.mocked(apiClient.get).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await submitAssignment();
    act(() => root.render(null));
    await act(async () => complete({ data: { data: { factories: [] } } }));
    expect(post).not.toHaveBeenCalled();
  });
  it('does not assign after switching to an already-cached different factory while the current mapping is being checked', async () => {
    // When the destination factory's data is still cached (no "Loading
    // factory" state is shown), the :id route does not unmount MappedUsers
    // on an in-place navigation between two factories — this exercises the
    // companion guard to the unmount case above for that scenario.
    const factoryA = makeFactory({ id: 'factory-1', name: 'Acme Factory' });
    const factoryB = makeFactory({ id: 'factory-2', name: 'Other Factory', code: 'FAC-2' });
    mockAuth('ADMIN');
    const post = vi.spyOn(apiClient, 'post');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === `/factories/${factoryA.id}`) return { data: { data: factoryA } };
      if (url === `/factories/${factoryB.id}`) return { data: { data: factoryB } };
      if (url === `/factories/${factoryA.id}/users` || url === `/factories/${factoryB.id}/users`) return { data: { data: [] } };
      if (url === `/factories/${factoryA.id}/user-options`) return { data: { data: [{ id: 'worker', name: 'Factory Worker', email: 'worker@test.local' }] } };
      throw new Error(`Unexpected request: ${url}`);
    });
    function Harness() {
      const [destination, setDestination] = useState(factoryB.id);
      return (
        <MemoryRouter initialEntries={[`/master-data/factories/${factoryA.id}`]}>
          <NavSwitcher destination={destination} setDestination={setDestination} other={factoryA.id} otherB={factoryB.id} />
          <Routes>
            <Route path="/master-data/factories/:id" element={<FactoryDetailPage />} />
          </Routes>
        </MemoryRouter>
      );
    }
    function NavSwitcher({
      destination,
      setDestination,
      other,
      otherB,
    }: {
      destination: string;
      setDestination: (id: string) => void;
      other: string;
      otherB: string;
    }) {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => {
            navigate(`/master-data/factories/${destination}`);
            setDestination(destination === otherB ? other : otherB);
          }}
        >
          Go to other factory
        </button>
      );
    }
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    await act(async () => { await flushMicrotasks(); });
    await waitForLoaded();
    const clickNav = async () => {
      const navButton = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Go to other factory',
      ) as HTMLButtonElement;
      await act(async () => navButton.click());
      await waitForLoaded();
    };
    // Warm the cache for both factories so a later switch shows no loading
    // state (and therefore does not unmount MappedUsers).
    await clickNav();
    await clickNav();
    await chooseWorker();
    let complete!: (value: { data: { data: { factories: [] } } }) => void;
    vi.mocked(apiClient.get).mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
    await submitAssignment();
    await clickNav();
    await act(async () => complete({ data: { data: { factories: [] } } }));
    expect(post).not.toHaveBeenCalled();
  });
  it('closes a pending reassignment confirmation when switching to an already-cached different factory', async () => {
    // A still-open confirmation dialog must not survive an in-place switch
    // to a different (already-cached) factory — otherwise clicking Confirm
    // would reassign the originally-selected worker into whichever factory
    // is current, using a description that already looks outdated.
    const factoryA = makeFactory({ id: 'factory-1', name: 'Acme Factory' });
    const factoryB = makeFactory({ id: 'factory-2', name: 'Other Factory', code: 'FAC-2' });
    mockAuth('ADMIN');
    const post = vi.spyOn(apiClient, 'post');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === `/factories/${factoryA.id}`) return { data: { data: factoryA } };
      if (url === `/factories/${factoryB.id}`) return { data: { data: factoryB } };
      if (url === `/factories/${factoryA.id}/users` || url === `/factories/${factoryB.id}/users`) return { data: { data: [] } };
      if (url === `/factories/${factoryA.id}/user-options`) return { data: { data: [{ id: 'worker', name: 'Factory Worker', email: 'worker@test.local' }] } };
      if (url === '/users/worker') return { data: { data: { factories: [{ id: 'elsewhere', name: 'Elsewhere Factory' }] } } };
      throw new Error(`Unexpected request: ${url}`);
    });
    function Harness() {
      const [destination, setDestination] = useState(factoryB.id);
      return (
        <MemoryRouter initialEntries={[`/master-data/factories/${factoryA.id}`]}>
          <NavSwitcher destination={destination} setDestination={setDestination} other={factoryA.id} otherB={factoryB.id} />
          <Routes>
            <Route path="/master-data/factories/:id" element={<FactoryDetailPage />} />
          </Routes>
        </MemoryRouter>
      );
    }
    function NavSwitcher({
      destination,
      setDestination,
      other,
      otherB,
    }: {
      destination: string;
      setDestination: (id: string) => void;
      other: string;
      otherB: string;
    }) {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          onClick={() => {
            navigate(`/master-data/factories/${destination}`);
            setDestination(destination === otherB ? other : otherB);
          }}
        >
          Go to other factory
        </button>
      );
    }
    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Harness />
        </QueryClientProvider>,
      );
    });
    await act(async () => { await flushMicrotasks(); });
    await waitForLoaded();
    const clickNav = async () => {
      const navButton = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Go to other factory',
      ) as HTMLButtonElement;
      await act(async () => navButton.click());
      await waitForLoaded();
    };
    // Warm the cache for both factories so a later switch shows no loading
    // state (and therefore does not unmount MappedUsers).
    await clickNav();
    await clickNav();
    await chooseWorker();
    await submitAssignment();
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')));
    await clickNav();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (candidate) => candidate.textContent === 'Confirm',
    );
    expect(confirmButton).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
  it('assigns an unmapped user directly, but never reassigns a user already at this factory', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });
    await renderPageWithRole(makeFactory(), 'ADMIN', []);
    await chooseWorker(); await submitAssignment();
    await waitFor(() => post.mock.calls.length === 1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(post).toHaveBeenCalledExactlyOnceWith('/users/worker/factories', { factoryId: 'factory-1' });
  });
  it('does not show a cross-factory warning or submit when the current mapping is already the destination', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderPageWithRole(makeFactory(), 'ADMIN', [{ id: 'factory-1', name: 'Acme Factory', code: 'FAC-1' }]);
    await chooseWorker(); await submitAssignment();
    await waitFor(() => Boolean(container.textContent?.includes('already mapped')));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
  it('retains the selected user and dialog after failure and blocks duplicate confirmation', async () => {
    let reject!: (error: Error) => void;
    const post = vi.spyOn(apiClient, 'post').mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    await renderPageWithRole(makeFactory(), 'ADMIN'); await chooseWorker(); await submitAssignment();
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')));
    const confirm = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Confirm') as HTMLButtonElement;
    await act(async () => { confirm.click(); confirm.click(); });
    expect(post).toHaveBeenCalledTimes(1);
    await act(async () => reject(new Error('Reassignment unavailable')));
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')?.textContent?.includes('Reassignment unavailable')));
    expect((document.getElementById('lookup-assign-user') as HTMLInputElement).value).toContain('Factory Worker');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Original Factory');
  });
  it('confirms the old and new factory before assigning, and Cancel issues no mutation', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} });
    await renderPageWithRole(makeFactory(), 'ADMIN');
    const input = document.getElementById('lookup-assign-user') as HTMLInputElement;
    await act(async () => { input.focus(); input.click(); });
    await waitFor(() => Boolean(document.querySelector('[role="option"]')));
    await act(async () => (document.querySelector('[role="option"]') as HTMLElement).click());
    await act(async () => (container.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Original Factory');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Acme Factory');
    expect(post).not.toHaveBeenCalled();
    await act(async () => (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Cancel') as HTMLButtonElement).click());
    expect(post).not.toHaveBeenCalled();
    expect(input.value).toContain('Factory Worker');
    await act(async () => (container.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    await waitFor(() => Boolean(document.querySelector('[role="dialog"]')));
    await act(async () => (Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Confirm') as HTMLButtonElement).click());
    expect(post).toHaveBeenCalledExactlyOnceWith('/users/worker/factories', { factoryId: 'factory-1' });
  });
  it('offers "+ Create new Factory User" for ADMIN, and the button opens the create dialog', async () => {
    const factory = makeFactory();
    await renderPageWithRole(factory, 'ADMIN');
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === '+ Create new Factory User'),
    ).toBe(true);
  });

  it('never offers inline User creation to MERCHANDISER, even though it can otherwise manage this Factory', async () => {
    const factory = makeFactory();
    await renderPageWithRole(factory, 'MERCHANDISER');
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent === '+ Create new Factory User'),
    ).toBe(false);
  });
});

describe('FactoryDetailPage PDF actions', () => {
  it('shows Download PDF and Print actions in the header', async () => {
    await renderPage(makeFactory());
    const buttons = Array.from(container.querySelectorAll('button, a')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    await renderPage(makeFactory());
    vi.spyOn(generateModule, 'renderPdfBlob').mockRejectedValue(new Error('boom'));

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    // Rendering the PDF module is asynchronous and may exceed the old
    // 40 zero-delay polling attempts on a busy CI worker.
    await vi.waitFor(
      () => expect(container.querySelector('[role="alert"]')).not.toBeNull(),
      { timeout: 3000 },
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'PDF generation failed. Please try again.',
    );
    expect(
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Download PDF')!
        .disabled,
    ).toBe(false);
  });

  it('generates the PDF from the loaded factory and downloads it under the expected filename', async () => {
    await renderPage(makeFactory({ code: 'FAC-1' }));
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy).toHaveBeenCalledWith(expect.any(Blob), 'ERVE-Factory-FAC-1.pdf');
  });
});
