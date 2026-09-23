/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Outlet } from 'react-router-dom';
import type { AuthUser, Role } from '@erve/types';
import { AppRoutes } from './AppRoutes.js';
import * as AuthContext from '../auth/AuthContext.js';
import { apiClient } from '../lib/api-client.js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock components to simplify route testing
vi.mock('../pages/AppLayout.js', () => ({
  AppLayout: () => (
    <div data-testid="layout">
      <Outlet />
    </div>
  ),
}));
vi.mock('../pages/DashboardPage.js', () => ({ DashboardPage: () => <div>DashboardPage</div> }));
vi.mock('../pages/ForbiddenPage.js', () => ({ ForbiddenPage: () => <div>ForbiddenPage</div> }));
vi.mock('../pages/master-data/FactoryListPage.js', () => ({
  FactoryListPage: () => <div>FactoryListPage</div>,
}));
vi.mock('../pages/master-data/FactoryFormPage.js', () => ({
  FactoryFormPage: () => <div>FactoryFormPage</div>,
}));
vi.mock('../pages/master-data/DistributorListPage.js', () => ({
  DistributorListPage: () => <div>DistributorListPage</div>,
}));
vi.mock('../pages/master-data/DistributorDetailPage.js', () => ({
  DistributorDetailPage: () => <div>DistributorDetailPage</div>,
}));
vi.mock('../pages/master-data/DistributorFormPage.js', () => ({
  DistributorFormPage: () => <div>DistributorFormPage</div>,
}));
vi.mock('../pages/purchase-orders/PurchaseOrderListPage.js', () => ({
  PurchaseOrderListPage: () => <div>PurchaseOrderListPage</div>,
}));
vi.mock('../pages/job-orders/JobOrderListPage.js', () => ({
  JobOrderListPage: () => <div>JobOrderListPage</div>,
}));
vi.mock('../pages/job-orders/JobOrderCreatePage.js', () => ({
  JobOrderCreatePage: () => <div>JobOrderCreatePage</div>,
}));
vi.mock('../pages/job-orders/JobOrderDetailPage.js', () => ({
  JobOrderDetailPage: () => <div>JobOrderDetailPage</div>,
}));
vi.mock('../pages/qa/QaQueuePage.js', () => ({ QaQueuePage: () => <div>QaQueuePage</div> }));
vi.mock('../pages/qa/QaDetailPage.js', () => ({ QaDetailPage: () => <div>QaDetailPage</div> }));
vi.mock('../pages/master-data/QualityFormListPage.js', () => ({
  QualityFormListPage: () => <div>QualityFormListPage</div>,
}));
vi.mock('../pages/price-lists/PriceListListPage.js', () => ({
  PriceListListPage: () => <div>PriceListListPage</div>,
}));
vi.mock('../pages/sale-orders/SaleOrderListPage.js', () => ({
  SaleOrderListPage: () => <div>SaleOrderListPage</div>,
}));
vi.mock('../pages/sale-orders/SaleOrderDetailPage.js', () => ({
  SaleOrderDetailPage: () => <div>SaleOrderDetailPage</div>,
}));
vi.mock('../pages/sale-orders/SaleOrderFormPage.js', () => ({
  SaleOrderFormPage: () => <div>SaleOrderFormPage</div>,
}));
vi.mock('../pages/fulfillment/FactoryPackingQueuePage.js', () => ({
  FactoryPackingQueuePage: () => <div>FactoryPackingQueuePage</div>,
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const renderRoutes = async (role: Role, initialUrl: string) => {
  act(() => {
    root.unmount();
  });
  container.innerHTML = '';
  root = createRoot(container);

  const user: AuthUser = {
    id: 'user-1',
    email: 'test@test.local',
    mobile: null,
    name: 'Test User',
    roles: [role],
  };

  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <AppRoutes />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });

  await act(async () => {
    await flushMicrotasks();
  });
};

function getPageContent(): string {
  return container.textContent ?? '';
}

describe('AppRoutes Permissions', () => {
  it.each([
    ['ADMIN', true],
    ['MERCHANDISER', true],
    ['FACTORY_USER', false],
    ['QA_USER', false],
    ['DISTRIBUTOR', false],
  ] as const)('allows distributor maintenance routes for %s = %s', async (role, allowed) => {
    for (const path of ['/master-data/distributors/new', '/master-data/distributors/dist-1/edit']) {
      await renderRoutes(role, path);
      expect(getPageContent()).toContain(allowed ? 'DistributorFormPage' : 'ForbiddenPage');
    }
  });

  it.each([
    ['ADMIN', true],
    ['MERCHANDISER', true],
    ['SENIOR_MANAGEMENT', false],
    ['FACTORY_USER', false],
    ['QA_USER', false],
    ['DISTRIBUTOR', false],
  ] as const)('allows /master-data/factories/new for %s = %s', async (role, allowed) => {
    await renderRoutes(role, '/master-data/factories/new');
    expect(getPageContent()).toContain(allowed ? 'FactoryFormPage' : 'ForbiddenPage');
  });

  describe('FACTORY_USER', () => {
    it('is denied access to the Factory master — factory info comes from assigned Job Orders', async () => {
      await renderRoutes('FACTORY_USER', '/master-data/factories');
      const content = getPageContent();
      expect(content).not.toContain('FactoryListPage');
      expect(content).toContain('ForbiddenPage');
    });

    it('is denied access to /purchase-orders', async () => {
      await renderRoutes('FACTORY_USER', '/purchase-orders');
      const content = getPageContent();
      expect(content).not.toContain('PurchaseOrderListPage');
      expect(content).toContain('ForbiddenPage');
    });

    it('is denied access to /job-orders/new', async () => {
      await renderRoutes('FACTORY_USER', '/job-orders/new');
      const content = getPageContent();
      expect(content).not.toContain('JobOrderCreatePage');
      expect(content).toContain('ForbiddenPage');
    });

    it('is allowed access to /job-orders', async () => {
      await renderRoutes('FACTORY_USER', '/job-orders');
      const content = getPageContent();
      expect(content).toContain('JobOrderListPage');
      expect(content).not.toContain('ForbiddenPage');
    });
  });

  describe('DISTRIBUTOR', () => {
    it('is denied direct-URL access to the Distributor master list and detail', async () => {
      await renderRoutes('DISTRIBUTOR', '/master-data/distributors');
      expect(getPageContent()).toContain('ForbiddenPage');

      await renderRoutes('DISTRIBUTOR', '/master-data/distributors/dist-1');
      expect(getPageContent()).toContain('ForbiddenPage');
    });

    it('is denied direct-URL access to the Price List master list and detail', async () => {
      await renderRoutes('DISTRIBUTOR', '/price-lists');
      expect(getPageContent()).toContain('ForbiddenPage');
      expect(getPageContent()).not.toContain('PriceListListPage');

      await renderRoutes('DISTRIBUTOR', '/price-lists/pl-1');
      expect(getPageContent()).toContain('ForbiddenPage');
    });

    it('is denied direct-URL access to the Factory master', async () => {
      await renderRoutes('DISTRIBUTOR', '/master-data/factories');
      expect(getPageContent()).toContain('ForbiddenPage');
    });

    it('is denied all access to Order Sheets — planning belongs to Merchandising', async () => {
      await renderRoutes('DISTRIBUTOR', '/purchase-orders');
      expect(getPageContent()).not.toContain('PurchaseOrderListPage');
      expect(getPageContent()).toContain('ForbiddenPage');

      await renderRoutes('DISTRIBUTOR', '/purchase-orders/new');
      expect(getPageContent()).toContain('ForbiddenPage');
    });
  });

  describe('ACCOUNTANT', () => {
    it('is allowed direct-URL access to Price Lists but not other masters', async () => {
      await renderRoutes('ACCOUNTANT', '/price-lists');
      expect(getPageContent()).toContain('PriceListListPage');
      expect(getPageContent()).not.toContain('ForbiddenPage');

      await renderRoutes('ACCOUNTANT', '/master-data/distributors');
      expect(getPageContent()).toContain('ForbiddenPage');

      await renderRoutes('ACCOUNTANT', '/master-data/factories');
      expect(getPageContent()).toContain('ForbiddenPage');
    });

    it('is allowed direct-URL access to the Sale Order list and detail, but not Create/Edit', async () => {
      await renderRoutes('ACCOUNTANT', '/sale-orders');
      expect(getPageContent()).toContain('SaleOrderListPage');
      expect(getPageContent()).not.toContain('ForbiddenPage');

      await renderRoutes('ACCOUNTANT', '/sale-orders/so-1');
      expect(getPageContent()).toContain('SaleOrderDetailPage');
      expect(getPageContent()).not.toContain('ForbiddenPage');

      await renderRoutes('ACCOUNTANT', '/sale-orders/new');
      expect(getPageContent()).toContain('ForbiddenPage');
      expect(getPageContent()).not.toContain('SaleOrderFormPage');

      await renderRoutes('ACCOUNTANT', '/sale-orders/so-1/edit');
      expect(getPageContent()).toContain('ForbiddenPage');
      expect(getPageContent()).not.toContain('SaleOrderFormPage');
    });
  });

  describe('ADMIN', () => {
    it('is allowed access to Quality Form master', async () => {
      await renderRoutes('ADMIN', '/master-data/quality-forms');
      expect(getPageContent()).toContain('QualityFormListPage');
    });
    it('is allowed access to /master-data/factories', async () => {
      await renderRoutes('ADMIN', '/master-data/factories');
      const content = getPageContent();
      expect(content).toContain('FactoryListPage');
    });

    it('is allowed access to /master-data/factories/new', async () => {
      await renderRoutes('ADMIN', '/master-data/factories/new');
      const content = getPageContent();
      expect(content).toContain('FactoryFormPage');
      expect(content).not.toContain('ForbiddenPage');
    });

    it('is allowed access to /purchase-orders', async () => {
      await renderRoutes('ADMIN', '/purchase-orders');
      const content = getPageContent();
      expect(content).toContain('PurchaseOrderListPage');
    });

    it('is allowed access to /job-orders/new', async () => {
      await renderRoutes('ADMIN', '/job-orders/new');
      const content = getPageContent();
      expect(content).toContain('JobOrderCreatePage');
    });

    it('is allowed access to /job-orders', async () => {
      await renderRoutes('ADMIN', '/job-orders');
      const content = getPageContent();
      expect(content).toContain('JobOrderListPage');
    });
  });

  describe('QA_USER', () => {
    it('is denied Quality Form master administration', async () => {
      await renderRoutes('QA_USER', '/master-data/quality-forms');
      expect(getPageContent()).toContain('ForbiddenPage');
    });
    it('cannot create Job Orders, retains detail access, and redirects the retired QA queue', async () => {
      await renderRoutes('QA_USER', '/job-orders/new');
      expect(getPageContent()).toContain('ForbiddenPage');

      await renderRoutes('QA_USER', '/job-orders/jo-1');
      expect(getPageContent()).toContain('JobOrderDetailPage');
      expect(getPageContent()).not.toContain('ForbiddenPage');

      await renderRoutes('QA_USER', '/qa');
      expect(getPageContent()).toContain('JobOrderListPage');
      expect(getPageContent()).not.toContain('QaQueuePage');
    });
  });

  describe('Factory Packing (UXAUTH-003)', () => {
    it.each([
      ['ADMIN', true],
      ['MERCHANDISER', true],
      ['FACTORY_USER', true],
      ['SENIOR_MANAGEMENT', true],
      ['QA_USER', false],
      ['ACCOUNTANT', false],
      ['DISTRIBUTOR', false],
    ] as const)('factory packing queue route for %s = %s', async (role, allowed) => {
      await renderRoutes(role, '/fulfillment/factory-dispatches');
      expect(getPageContent()).toContain(allowed ? 'FactoryPackingQueuePage' : 'ForbiddenPage');
    });
  });

  // UXAUTH-008: /fulfillment/erve-packing-lists/new previously had no route
  // guard of its own and inherited only the broad
  // ERVE_PACKING_LIST_VIEW_ROLES parent guard — SENIOR_MANAGEMENT could
  // directly navigate to it and mount the real create page, which fires the
  // create-only eligible-cartons GET, even though creation
  // (ERVE_DISPATCH_MUTATION_ROLES: ADMIN, MERCHANDISER only) is narrower than
  // view. This uses the REAL ErvePackingListCreatePage component (not
  // mocked) so the assertions prove the component never mounts and never
  // calls its data-fetching endpoint for the forbidden role.
  describe('EIPL /new route guard (UXAUTH-008)', () => {
    it('SENIOR_MANAGEMENT is forbidden from /fulfillment/erve-packing-lists/new — the create component never mounts and its query never fires', async () => {
      const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: [] } });
      await renderRoutes('SENIOR_MANAGEMENT', '/fulfillment/erve-packing-lists/new');

      expect(getPageContent()).toContain('ForbiddenPage');
      expect(getPageContent()).not.toContain('Create Erve Packing List');
      expect(
        get.mock.calls.some((call) => call[0] === '/erve-packing-lists/eligible-cartons'),
      ).toBe(false);
    });

    it.each(['ADMIN', 'MERCHANDISER'] as const)(
      '%s (an authorized create role) reaches the real create page and its query fires',
      async (role) => {
        const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: [] } });
        await renderRoutes(role, '/fulfillment/erve-packing-lists/new');
        await vi.waitFor(() => expect(getPageContent()).toContain('Create Erve Packing List'));

        expect(getPageContent()).not.toContain('ForbiddenPage');
        expect(
          get.mock.calls.some((call) => call[0] === '/erve-packing-lists/eligible-cartons'),
        ).toBe(true);
      },
    );
  });

  // UXAUTH-017: FACTORY_USER has no authorized master-data destination at
  // all (Style/Season/Size/Factory/Distributor/Users/Process
  // Flow/Quality Form are every one ADMIN/MERCHANDISER(/SENIOR_MANAGEMENT)
  // only) — the "Master Data" nav shortcut already reflected that, but the
  // Style list/detail routes had no RoleRoute guard of their own (unlike
  // every sibling master resource) and the broad parent
  // MASTER_DATA_ROUTE_ROLES list still included FACTORY_USER, so a direct
  // URL could mount the real Style page and fire its API request. These use
  // the REAL StyleListPage/StyleDetailPage components (not mocked).
  describe('FACTORY_USER Style route direct-URL guard (UXAUTH-017)', () => {
    it('FACTORY_USER is forbidden from /master-data — never redirected into Styles, and no Style component mounts', async () => {
      const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: [] } });
      await renderRoutes('FACTORY_USER', '/master-data');

      expect(getPageContent()).toContain('ForbiddenPage');
      expect(get.mock.calls.some((call) => call[0] === '/styles')).toBe(false);
    });

    it('FACTORY_USER direct-navigating to /master-data/styles is forbidden — the Style list never mounts and /styles is never called', async () => {
      const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: [] } });
      await renderRoutes('FACTORY_USER', '/master-data/styles');

      expect(getPageContent()).toContain('ForbiddenPage');
      expect(get.mock.calls.some((call) => call[0] === '/styles')).toBe(false);
    });

    it('FACTORY_USER direct-navigating to a Style detail URL is forbidden — the Style detail never mounts and its API is never called', async () => {
      const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: [] } });
      await renderRoutes('FACTORY_USER', '/master-data/styles/style-1');

      expect(getPageContent()).toContain('ForbiddenPage');
      expect(get.mock.calls.some((call) => call[0] === '/styles/style-1')).toBe(false);
    });

    it.each(['ADMIN', 'MERCHANDISER', 'SENIOR_MANAGEMENT'] as const)(
      '%s (a Style-authorized role) still reaches the real Style list, whose API is called',
      async (role) => {
        const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { data: [] } });
        await renderRoutes(role, '/master-data/styles');

        expect(getPageContent()).not.toContain('ForbiddenPage');
        expect(get.mock.calls.some((call) => call[0] === '/styles')).toBe(true);
      },
    );
  });
});
