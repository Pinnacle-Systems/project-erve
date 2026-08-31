/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Outlet } from 'react-router-dom';
import type { AuthUser, Role } from '@erve/types';
import { AppRoutes } from './AppRoutes.js';
import * as AuthContext from '../auth/AuthContext.js';
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
});
