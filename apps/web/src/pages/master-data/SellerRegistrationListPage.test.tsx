/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { SellerRegistrationListPage } from './SellerRegistrationListPage.js';
import type { SellerRegistrationSummary } from './types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error(message);
}

function makeSellerRegistration(
  overrides: Partial<SellerRegistrationSummary> = {},
): SellerRegistrationSummary {
  return {
    id: 'seller-1',
    branchCode: 'ERVE-HO',
    legalName: 'ERVE Apparel Private Limited',
    tradeName: 'ERVE',
    gstin: '27AAAAA0000A1Z5',
    city: 'Mumbai',
    state: 'Maharashtra',
    status: 'ACTIVE',
    ...overrides,
  };
}

function mockUser(role: Role) {
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
}

async function renderPage(registrations: SellerRegistrationSummary[], role: Role = 'ADMIN') {
  mockUser(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/seller-registrations') {
      return {
        data: {
          data: { items: registrations, pageInfo: { limit: 25, hasMore: false, nextCursor: null } },
        },
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <SellerRegistrationListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await waitFor(
    () => !container.textContent?.includes('Loading seller registrations'),
    'timed out waiting for loading to clear',
  );
}

describe('SellerRegistrationListPage', () => {
  it('renders seller registration rows with branch code, legal name, GSTIN, city and status', async () => {
    await renderPage([makeSellerRegistration()]);

    expect(container.textContent).toContain('ERVE-HO');
    expect(container.textContent).toContain('ERVE Apparel Private Limited');
    expect(container.textContent).toContain('27AAAAA0000A1Z5');
    expect(container.textContent).toContain('Mumbai');
    expect(container.textContent).toContain('ACTIVE');
  });

  it('shows "Create Seller Registration" for ADMIN', async () => {
    await renderPage([], 'ADMIN');
    const buttons = Array.from(container.querySelectorAll('a, button')).map((el) => el.textContent);
    expect(buttons).toContain('Create Seller Registration');
  });

  it('hides "Create Seller Registration" for a non-ADMIN role', async () => {
    await renderPage([], 'MERCHANDISER');
    const buttons = Array.from(container.querySelectorAll('a, button')).map((el) => el.textContent);
    expect(buttons).not.toContain('Create Seller Registration');
  });

  it('shows an empty state when there are no seller registrations', async () => {
    await renderPage([]);
    expect(container.textContent).toContain('No seller registrations found');
  });
});
