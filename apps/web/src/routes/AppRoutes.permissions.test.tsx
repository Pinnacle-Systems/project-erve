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
  AppLayout: () => <div data-testid="layout"><Outlet /></div>
}));
vi.mock('../pages/DashboardPage.js', () => ({ DashboardPage: () => <div>DashboardPage</div> }));
vi.mock('../pages/ForbiddenPage.js', () => ({ ForbiddenPage: () => <div>ForbiddenPage</div> }));
vi.mock('../pages/master-data/FactoryListPage.js', () => ({ FactoryListPage: () => <div>FactoryListPage</div> }));
vi.mock('../pages/purchase-orders/PurchaseOrderListPage.js', () => ({ PurchaseOrderListPage: () => <div>PurchaseOrderListPage</div> }));
vi.mock('../pages/job-orders/JobOrderListPage.js', () => ({ JobOrderListPage: () => <div>JobOrderListPage</div> }));
vi.mock('../pages/job-orders/JobOrderCreatePage.js', () => ({ JobOrderCreatePage: () => <div>JobOrderCreatePage</div> }));
vi.mock('../pages/job-orders/JobOrderDetailPage.js', () => ({ JobOrderDetailPage: () => <div>JobOrderDetailPage</div> }));
vi.mock('../pages/qa/QaQueuePage.js', () => ({ QaQueuePage: () => <div>QaQueuePage</div> }));
vi.mock('../pages/qa/QaDetailPage.js', () => ({ QaDetailPage: () => <div>QaDetailPage</div> }));

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
      </QueryClientProvider>
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
  describe('FACTORY_USER', () => {
    it("can access the factory list, where the API applies the user's factory scope", async () => {
      await renderRoutes('FACTORY_USER', '/master-data/factories');
      const content = getPageContent();
      expect(content).toContain('FactoryListPage');
      expect(content).not.toContain('ForbiddenPage');
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

  describe('ADMIN', () => {
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
    it('cannot access Job Order creation but retains contextual detail and QA access', async () => {
      await renderRoutes('QA_USER', '/job-orders/new');
      expect(getPageContent()).toContain('ForbiddenPage');

      await renderRoutes('QA_USER', '/job-orders/jo-1');
      expect(getPageContent()).toContain('JobOrderDetailPage');
      expect(getPageContent()).not.toContain('ForbiddenPage');

      await renderRoutes('QA_USER', '/qa');
      expect(getPageContent()).toContain('QaQueuePage');
    });
  });
});
