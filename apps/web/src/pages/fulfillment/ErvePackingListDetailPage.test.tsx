/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { ErvePackingListDetailPage } from './ErvePackingListDetailPage.js';
import type { EligibleErveCartonView, ErvePackingListDetail } from './types.js';

let container: HTMLDivElement;
let root: Root;

function mockAuth(role: Role) {
  const user: AuthUser = { id: 'user-1', email: 'user@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

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

const content = () => container.textContent ?? '';

function buttonByText(text: string): HTMLButtonElement | null {
  return (
    (Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as
      | HTMLButtonElement
      | undefined) ?? null
  );
}

function buildPackingList(overrides: Partial<ErvePackingListDetail> = {}): ErvePackingListDetail {
  return {
    id: 'epl-1',
    ervePackingListNumber: 'EIPL/26-27/0001',
    distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
    saleOrder: null,
    destination: {
      label: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      addressLine1: '123 Test Street',
      addressLine2: null,
      city: 'Chennai',
      state: 'TN',
      country: 'India',
      postalCode: null,
    },
    status: 'OPEN',
    createdBy: { id: 'user-1', name: 'Test User', email: 'user@test.local' },
    createdAt: '2026-09-01T00:00:00.000Z',
    cartonCount: 1,
    totalQuantity: 10,
    sourceFactories: [{ id: 'fac-1', code: 'FAC1', name: 'Factory One' }],
    sourceDispatchOrders: [{ id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' }],
    dispatch: null,
    finalizedBy: null,
    finalizedAt: null,
    cartons: [
      {
        id: 'carton-1',
        cartonNumber: 'C1',
        factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
        factoryDispatchId: 'fd-1',
        factoryDispatchNumber: 'EIFD/26-27/0001',
        saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
        packageDetails: null,
        weight: null,
        totalQuantity: 10,
        lines: [
          {
            saleOrderLineId: 'line-1',
            styleId: 'style-1',
            styleNumber: 'ST-001',
            styleName: 'Classic Tee',
            primaryImage: null,
            sizeCode: 'M',
            sizeLabel: 'Medium',
            quantity: 10,
          },
        ],
      },
    ],
    styleSizeSummary: [],
    ...overrides,
  };
}

async function renderPage(packingList: ErvePackingListDetail, role: Role = 'ADMIN', eligibleCartons: EligibleErveCartonView[] = []) {
  mockAuth(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/erve-packing-lists/epl-1') return { data: { data: packingList } };
    if (url === '/erve-packing-lists/eligible-cartons') return { data: { data: { items: eligibleCartons, pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
    throw new Error(`Unexpected GET: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/erve-packing-lists/epl-1']}>
          <Routes>
            <Route path="/fulfillment/erve-packing-lists/:id" element={<ErvePackingListDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await vi.waitFor(() => expect(content()).not.toContain('Loading Erve Packing List'));
}

// UXAUTH-007 baseline: before this fix, an OPEN EIPL rendered every mutation
// control (Add Cartons panel incl. its eligible-cartons support query,
// per-carton Remove, Finalize) purely from packingList.status === 'OPEN',
// with no role check at all — even though only ERVE_DISPATCH_MUTATION_ROLES
// (ADMIN, MERCHANDISER) may actually call those endpoints
// (erve-dispatch.routes.ts canMutatePackingLists). SENIOR_MANAGEMENT is a
// read-only member of ERVE_PACKING_LIST_VIEW_ROLES and must see none of them.
describe('ErvePackingListDetailPage mutation gating (UXAUTH-007)', () => {
  it('ADMIN sees every mutation control on an OPEN Erve Packing List', async () => {
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');
    expect(content()).toContain('Add Cartons');
    expect(buttonByText('Remove')).not.toBeNull();
    expect(buttonByText('Finalize Packing List')).not.toBeNull();
  });

  it('MERCHANDISER (a mutation role) also sees every mutation control on an OPEN Erve Packing List', async () => {
    await renderPage(buildPackingList({ status: 'OPEN' }), 'MERCHANDISER');
    expect(content()).toContain('Add Cartons');
    expect(buttonByText('Remove')).not.toBeNull();
    expect(buttonByText('Finalize Packing List')).not.toBeNull();
  });

  it('SENIOR_MANAGEMENT reads an OPEN Erve Packing List but sees no mutation control', async () => {
    const get = vi.spyOn(apiClient, 'get');
    await renderPage(buildPackingList({ status: 'OPEN' }), 'SENIOR_MANAGEMENT');

    // Read-only content remains visible.
    expect(content()).toContain('EIPL/26-27/0001');
    expect(content()).toContain('Distributor One');
    expect(content()).toContain('C1');

    // Every mutation control is absent.
    expect(content()).not.toContain('Add Cartons');
    expect(buttonByText('Remove')).toBeNull();
    expect(buttonByText('Finalize Packing List')).toBeNull();

    // The mutation-only eligible-cartons support query must not even run for
    // a read-only role.
    expect(get.mock.calls.some((call) => call[0] === '/erve-packing-lists/eligible-cartons')).toBe(
      false,
    );
  });

  it('SENIOR_MANAGEMENT sees no Record Dispatch control on a FINALIZED Erve Packing List', async () => {
    await renderPage(buildPackingList({ status: 'FINALIZED' }), 'SENIOR_MANAGEMENT');
    expect(content()).not.toContain('Record Erve Dispatch');
    expect(buttonByText('Record Dispatch')).toBeNull();
  });

  it('ADMIN still sees Record Dispatch on a FINALIZED Erve Packing List', async () => {
    await renderPage(buildPackingList({ status: 'FINALIZED' }), 'ADMIN');
    expect(content()).toContain('Record Erve Dispatch');
    expect(buttonByText('Record Dispatch')).not.toBeNull();
  });
});

// UXAUTH-018: a failed fetch (403/500/network error) must render the real
// ErrorState, not fall through to the "Erve Packing List not found"
// EmptyState — that EmptyState is reserved for a genuine no-such-record
// response.
describe('ErvePackingListDetailPage load error handling (UXAUTH-018)', () => {
  it('shows an error state, not a not-found/empty state, when the request fails', async () => {
    mockAuth('ADMIN');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/erve-packing-lists/epl-1') throw new Error('Request failed with status code 500');
      throw new Error(`Unexpected GET: ${url}`);
    });

    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/fulfillment/erve-packing-lists/epl-1']}>
            <Routes>
              <Route path="/fulfillment/erve-packing-lists/:id" element={<ErvePackingListDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(content()).not.toContain('Loading Erve Packing List'));

    expect(content()).not.toContain('Erve Packing List not found');
    expect(content()).toContain('Unable to load Erve Packing List');
    expect(content()).toContain('Request failed with status code 500');
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

// DEMO-020: sourceFactories/carton.factory*/factoryDispatch* are confidential
// factory/supplier provenance, omitted entirely (not nulled) by the API for
// any role outside ERVE_PACKING_LIST_PROVENANCE_ROLES — see
// erve-dispatch.provenance.test.ts for the API-side redaction proof. This
// page is only ever route-gated to that same authorized role set today, so
// there is no real request that omits these fields yet, but the rendering
// must stay correct if that ever changes (e.g. ERVE_PACKING_LIST_VIEW_ROLES
// widened for an unrelated reason): no "Source Factories" row, no "Factory"
// or "Factory Packing List" column, and no stray undefined/placeholder text.
describe('ErvePackingListDetailPage factory/supplier provenance redaction (DEMO-020)', () => {
  function buildPackingListWithoutProvenance(overrides: Partial<ErvePackingListDetail> = {}): ErvePackingListDetail {
    const full = buildPackingList(overrides);
    const { sourceFactories: _sourceFactories, ...withoutSourceFactories } = full;
    return {
      ...withoutSourceFactories,
      cartons: full.cartons.map(({ factory: _factory, factoryDispatchId: _factoryDispatchId, factoryDispatchNumber: _factoryDispatchNumber, ...carton }) => carton),
    };
  }

  it('renders no "Source Factories" row and no Factory/Factory Packing List columns when the API omits provenance', async () => {
    await renderPage(buildPackingListWithoutProvenance({ status: 'OPEN' }), 'ADMIN');

    expect(content()).toContain('EIPL/26-27/0001');
    expect(content()).toContain('C1');
    expect(content()).not.toContain('Source Factories');
    expect(content()).not.toContain('Factory One');
    expect(content()).not.toContain('Factory Packing List');
    expect(content()).not.toContain('undefined');

    // The ordinary, non-confidential fields stay visible.
    expect(content()).toContain('Source Dispatch Orders');
    expect(content()).toContain('EISO/26-27/0001');
  });

  it('still renders Source Factories and the Factory column when the API includes provenance (ADMIN/MERCHANDISER/SENIOR_MANAGEMENT must not regress)', async () => {
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');

    expect(content()).toContain('Source Factories');
    expect(content()).toContain('Factory One');
    expect(content()).toContain('Factory Packing List');
    expect(content()).toContain('EIFD/26-27/0001');
  });
});


describe('Erve Packing List finalization safety and placement (UX-03/UX-10)', () => {
  it('places the only Finalize button above the packing-list detail panels', async () => {
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');
    const action = buttonByText('Finalize Packing List')!;
    const panelTitle = Array.from(container.querySelectorAll('*')).find(
      (element) => element.textContent?.trim() === 'Erve India Consolidated Packing List',
    );
    expect(panelTitle).toBeDefined();
    expect(action.compareDocumentPosition(panelTitle!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('prevents finalization while a carton removal is in flight and re-enables it after completion', async () => {
    let resolveRemoval!: (value: unknown) => void;
    const pendingRemoval = new Promise((resolve) => { resolveRemoval = resolve; });
    const remove = vi.spyOn(apiClient, 'delete').mockReturnValue(pendingRemoval as never);
    const post = vi.spyOn(apiClient, 'post');
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');

    const finalize = buttonByText('Finalize Packing List')!;
    expect(finalize.disabled).toBe(false);
    act(() => buttonByText('Remove')!.click());
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith('/erve-packing-lists/epl-1/cartons/carton-1'));
    await vi.waitFor(() => expect(finalize.disabled).toBe(true));
    act(() => finalize.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(post).not.toHaveBeenCalled();

    await act(async () => { resolveRemoval({ data: { data: null } }); });
    await vi.waitFor(() => expect(finalize.disabled).toBe(false));
  });

  it('prevents finalization while selected cartons are being added and re-enables it afterward', async () => {
    const candidate: EligibleErveCartonView = {
      id: 'eligible-1',
      cartonNumber: 'C2',
      factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
      factoryDispatchId: 'fd-1',
      factoryDispatchNumber: 'EIFD/26-27/0001',
      saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
      distributor: { id: 'dist-1', code: 'D1', name: 'Distributor One' },
      destination: { id: 'dest-1', label: null, city: 'Chennai', state: 'TN' },
      packageDetails: null,
      weight: null,
      totalQuantity: 8,
      lines: [],
    };
    let resolveAdd!: (value: unknown) => void;
    const pendingAdd = new Promise((resolve) => { resolveAdd = resolve; });
    const post = vi.spyOn(apiClient, 'post').mockImplementation((url: string) => {
      if (url === '/erve-packing-lists/epl-1/cartons') return pendingAdd as never;
      throw new Error(`Unexpected POST: ${url}`);
    });
    await renderPage(buildPackingList({ status: 'OPEN' }), 'MERCHANDISER', [candidate]);

    await vi.waitFor(() => expect(container.querySelector('input[aria-label="Select carton C2"]')).not.toBeNull());
    act(() => (container.querySelector('input[aria-label="Select carton C2"]') as HTMLInputElement).click());
    await vi.waitFor(() => expect(buttonByText('Add Selected Cartons')?.disabled).toBe(false));
    const finalize = buttonByText('Finalize Packing List')!;
    expect(finalize.disabled).toBe(false);
    act(() => buttonByText('Add Selected Cartons')!.click());
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/erve-packing-lists/epl-1/cartons', { cartonIds: ['eligible-1'] }));
    await vi.waitFor(() => expect(finalize.disabled).toBe(true));
    act(() => finalize.click());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(post).toHaveBeenCalledTimes(1);

    await act(async () => { resolveAdd({ data: { data: null } }); });
    await vi.waitFor(() => expect(finalize.disabled).toBe(false));
  });

  it('closes the finalization confirmation after a successful submission', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: null } } as never);
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');
    act(() => buttonByText('Finalize Packing List')!.click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'))
      .find((b) => b.textContent === 'Finalize Packing List');
    act(() => confirm!.click());
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/erve-packing-lists/epl-1/finalize'));
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
  });



  it('does not enable finalization for an empty OPEN packing list', async () => {
    await renderPage(buildPackingList({ status: 'OPEN', cartonCount: 0, totalQuantity: 0, cartons: [] }), 'ADMIN');
    expect(buttonByText('Finalize Packing List')?.disabled).toBe(true);
  });

  it('submits the finalize request only after the user confirms', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: null } } as never);
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');
    act(() => buttonByText('Finalize Packing List')!.click());
    expect(post).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    const dialog = document.querySelector('[role="dialog"]')!;
    const finalize = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Finalize Packing List')!;
    act(() => finalize.click());
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/erve-packing-lists/epl-1/finalize'));
  });

  it('shows a failed finalization in its dialog instead of silently hiding the error', async () => {
    const post = vi.spyOn(apiClient, 'post').mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { message: 'Carton allocation changed' } } },
    });
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');
    act(() => buttonByText('Finalize Packing List')!.click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    const dialog = document.querySelector('[role="dialog"]')!;
    const finalize = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Finalize Packing List')!;
    act(() => finalize.click());
    await vi.waitFor(() => expect(post).toHaveBeenCalledWith('/erve-packing-lists/epl-1/finalize'));
    await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent).toContain('Carton allocation changed'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  });


  it('shows exactly one header Finalize action for an eligible list', async () => {
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');
    const buttons = Array.from(container.querySelectorAll('button')).filter((b) => b.textContent?.trim() === 'Finalize Packing List');
    expect(buttons).toHaveLength(1);
    expect(container.firstElementChild?.firstElementChild?.textContent).toContain('Finalize Packing List');
  });

  it('requires explicit confirmation with business number, carton count and safe exit', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderPage(buildPackingList({ status: 'OPEN' }), 'ADMIN');
    act(() => buttonByText('Finalize Packing List')!.click());
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull());
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('EIPL/26-27/0001');
    expect(dialog.textContent).toContain('1 carton');
    expect(dialog.textContent).toContain('10 pieces');
    expect(post).not.toHaveBeenCalled();
    const exit = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'Keep Editing');
    act(() => exit!.click());
    expect(post).not.toHaveBeenCalled();
  });

  it('does not expose Finalize on a finalized or dispatched list', async () => {
    await renderPage(buildPackingList({ status: 'FINALIZED' }), 'ADMIN');
    expect(buttonByText('Finalize Packing List')).toBeNull();
  });
});

// ISS-053: Cartons and Style/Size Summary used to render every thumbnail as the empty placeholder,
// because withBusinessKeyIdentity's fake styleId (= styleNumber) would have broken
// StyleThumbnailCell's authenticated fetch even if an image had been wired up. These tests render
// the real page (no IntersectionObserver stub, so thumbnails fetch immediately — unlike
// PackingListPage.test.tsx's ISS-035 lazy-load case) and assert on the actual authenticated
// requests apiClient.get issues, not just on markup.
describe('ISS-053 Style thumbnails — Cartons and Style/Size Summary', () => {
  const imageA = {
    id: 'img-a', styleId: 'style-aaaa-1111', fileId: 'file-a', fileName: 'a.jpg', mimeType: 'image/jpeg',
    sizeBytes: 10, isPrimary: true, sortOrder: 0, createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-01T00:00:00Z',
  };
  const imageB = { ...imageA, id: 'img-b', styleId: 'style-bbbb-2222', fileId: 'file-b', fileName: 'b.jpg' };
  const noImageStyleId = 'style-cccc-3333';

  // Style A repeats across both cartons (and the consolidated summary); Style B appears once;
  // the no-image Style also appears once — covers multiple Styles, a Style repeated across
  // cartons, and the missing-image fallback in one fixture.
  function buildMultiStylePackingList(): ErvePackingListDetail {
    return buildPackingList({
      cartonCount: 2,
      totalQuantity: 30,
      cartons: [
        {
          id: 'carton-1',
          cartonNumber: 'C1',
          factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
          factoryDispatchId: 'fd-1',
          factoryDispatchNumber: 'EIFD/26-27/0001',
          saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
          packageDetails: null,
          weight: null,
          totalQuantity: 10,
          lines: [
            { saleOrderLineId: 'line-1', styleId: imageA.styleId, styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: imageA, sizeCode: 'M', sizeLabel: 'Medium', quantity: 10 },
          ],
        },
        {
          id: 'carton-2',
          cartonNumber: 'C2',
          factory: { id: 'fac-1', code: 'FAC1', name: 'Factory One' },
          factoryDispatchId: 'fd-1',
          factoryDispatchNumber: 'EIFD/26-27/0001',
          saleOrder: { id: 'so-1', saleOrderNumber: 'EISO/26-27/0001' },
          packageDetails: null,
          weight: null,
          totalQuantity: 20,
          lines: [
            { saleOrderLineId: 'line-2', styleId: imageA.styleId, styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: imageA, sizeCode: 'L', sizeLabel: 'Large', quantity: 5 },
            { saleOrderLineId: 'line-3', styleId: imageB.styleId, styleNumber: 'ST-002', styleName: 'Denim Jeans', primaryImage: imageB, sizeCode: 'M', sizeLabel: 'Medium', quantity: 8 },
            { saleOrderLineId: 'line-4', styleId: noImageStyleId, styleNumber: 'ST-003', styleName: 'No Photo Cap', primaryImage: null, sizeCode: 'M', sizeLabel: 'Medium', quantity: 7 },
          ],
        },
      ],
      styleSizeSummary: [
        { styleId: imageA.styleId, styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: imageA, sizeCode: 'M', sizeLabel: 'Medium', quantity: 10 },
        { styleId: imageA.styleId, styleNumber: 'ST-001', styleName: 'Classic Tee', primaryImage: imageA, sizeCode: 'L', sizeLabel: 'Large', quantity: 5 },
        { styleId: imageB.styleId, styleNumber: 'ST-002', styleName: 'Denim Jeans', primaryImage: imageB, sizeCode: 'M', sizeLabel: 'Medium', quantity: 8 },
        { styleId: noImageStyleId, styleNumber: 'ST-003', styleName: 'No Photo Cap', primaryImage: null, sizeCode: 'M', sizeLabel: 'Medium', quantity: 7 },
      ],
    });
  }

  async function renderWithImageTracking(packingList: ErvePackingListDetail): Promise<string[]> {
    mockAuth('ADMIN');
    const imageRequests: string[] = [];
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url === '/erve-packing-lists/epl-1') return { data: { data: packingList } };
      if (url === '/erve-packing-lists/eligible-cartons') return { data: { data: { items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
      if (url.includes('/images/')) {
        imageRequests.push(url);
        return { data: new Blob(['fake-image-bytes'], { type: 'image/jpeg' }) };
      }
      throw new Error(`Unexpected GET: ${url}`);
    });

    act(() => {
      root.render(
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter initialEntries={['/fulfillment/erve-packing-lists/epl-1']}>
            <Routes>
              <Route path="/fulfillment/erve-packing-lists/:id" element={<ErvePackingListDetailPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>,
      );
    });
    await vi.waitFor(() => expect(content()).not.toContain('Loading Erve Packing List'));
    // One row per Style per table (Carton 1: A; Carton 2: A+B+no-image; Summary: A+B+no-image) — 5
    // real images across both cartons + the summary, once IntersectionObserver is undefined (jsdom
    // default here) so every thumbnail fetches immediately rather than waiting to scroll into view.
    await vi.waitFor(() => expect(imageRequests.length).toBeGreaterThanOrEqual(5));
    return imageRequests;
  }

  it("requests every Style's protected image by its real UUID, never by its styleNumber business key", async () => {
    const imageRequests = await renderWithImageTracking(buildMultiStylePackingList());
    for (const url of imageRequests) {
      expect(url).toMatch(/^\/styles\/[^/]+\/images\/[^/]+\/content$/);
      expect(url).not.toMatch(/\/styles\/ST-00\d\//);
    }
  });

  it('requests the same Style A image identically from both cartons and the consolidated summary (repeated Style, same identity)', async () => {
    const imageRequests = await renderWithImageTracking(buildMultiStylePackingList());
    const expectedUrl = `/styles/${imageA.styleId}/images/${imageA.id}/content`;
    const styleARequests = imageRequests.filter((url) => url === expectedUrl);
    // Carton 1's own row, Carton 2's own row, and the consolidated Style/Size Summary row.
    expect(styleARequests).toHaveLength(3);
  });

  it('requests distinct Styles through distinct, correctly-associated image URLs — never swapped', async () => {
    const imageRequests = await renderWithImageTracking(buildMultiStylePackingList());
    const urlA = `/styles/${imageA.styleId}/images/${imageA.id}/content`;
    const urlB = `/styles/${imageB.styleId}/images/${imageB.id}/content`;
    expect(imageRequests).toContain(urlA);
    expect(imageRequests).toContain(urlB);
    expect(urlA).not.toBe(urlB);
    // Carton 2's own row + the summary row — never Style A's image, never Style A's count (3).
    expect(imageRequests.filter((url) => url === urlB)).toHaveLength(2);
  });

  it('never issues an authenticated image request for a Style with no uploaded image (missing-image fallback)', async () => {
    const imageRequests = await renderWithImageTracking(buildMultiStylePackingList());
    expect(imageRequests.some((url) => url.includes(noImageStyleId))).toBe(false);
    // The no-image Style's cell renders without a "View style image" button — a plain placeholder,
    // never a broken reference — in both Carton 2's own grid and the Style/Size Summary.
    const noImageCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-003'));
    expect(noImageCells.length).toBeGreaterThan(0);
    expect(noImageCells.some((cell) => cell.querySelector('button[aria-label="View style image"]'))).toBe(false);
  });

  it('shows a clickable thumbnail for every Style that does have an image, in both the Cartons and Style/Size Summary sections', async () => {
    await renderWithImageTracking(buildMultiStylePackingList());
    const styleACells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-001'));
    const styleBCells = Array.from(container.querySelectorAll('td')).filter((td) => td.textContent?.includes('ST-002'));
    // Carton 1, Carton 2, and the Summary each contribute one Style-A row.
    expect(styleACells.length).toBeGreaterThanOrEqual(3);
    expect(styleACells.every((cell) => cell.querySelector('button[aria-label="View style image"]'))).toBe(true);
    // Carton 2 and the Summary each contribute one Style-B row.
    expect(styleBCells.length).toBeGreaterThanOrEqual(2);
    expect(styleBCells.every((cell) => cell.querySelector('button[aria-label="View style image"]'))).toBe(true);
  });
});
