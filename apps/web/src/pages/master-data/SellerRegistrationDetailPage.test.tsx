/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { SellerRegistrationDetailPage } from './SellerRegistrationDetailPage.js';
import type { SellerRegistration } from './types.js';

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

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error(message);
}

function makeSellerRegistration(overrides: Partial<SellerRegistration> = {}): SellerRegistration {
  return {
    id: 'seller-1',
    branchCode: 'ERVE-HO',
    legalName: 'ERVE Apparel Private Limited',
    tradeName: 'ERVE',
    gstin: '27AAAAA0000A1Z5',
    city: 'Mumbai',
    state: 'Maharashtra',
    status: 'ACTIVE',
    einvoiceApplicable: false,
    addressLine1: '1 Industrial Estate',
    addressLine2: null,
    district: null,
    stateCode: '27',
    postalCode: '400001',
    country: 'India',
    bankName: 'HDFC Bank',
    bankAccountName: 'ERVE Apparel Private Limited',
    bankAccountNumber: '000111222333',
    bankIfsc: 'HDFC0001234',
    bankBranchName: 'Andheri',
    bankAddress: null,
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
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

async function renderPage(registration: SellerRegistration, role: Role = 'ADMIN') {
  mockUser(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/seller-registrations/${registration.id}`) {
      return { data: { data: registration } };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/master-data/seller-registrations/${registration.id}`]}>
          <Routes>
            <Route
              path="/master-data/seller-registrations/:id"
              element={<SellerRegistrationDetailPage />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await waitFor(
    () => !container.textContent?.includes('Loading seller registration'),
    'timed out waiting for loading to clear',
  );
}

describe('SellerRegistrationDetailPage', () => {
  it('renders identity, GST, address and bank detail sections', async () => {
    await renderPage(makeSellerRegistration());

    expect(container.textContent).toContain('Seller Identity');
    expect(container.textContent).toContain('ERVE Apparel Private Limited');
    expect(container.textContent).toContain('GST Registration');
    expect(container.textContent).toContain('27AAAAA0000A1Z5');
    expect(container.textContent).toContain('Registered Address');
    expect(container.textContent).toContain('1 Industrial Estate');
    expect(container.textContent).toContain('Bank Details');
    expect(container.textContent).toContain('HDFC0001234');
  });

  it('shows Edit and Deactivate for ADMIN on an ACTIVE registration', async () => {
    await renderPage(makeSellerRegistration({ status: 'ACTIVE' }), 'ADMIN');
    const buttons = Array.from(container.querySelectorAll('a, button')).map((el) => el.textContent);
    expect(buttons).toContain('Edit');
    expect(buttons).toContain('Deactivate');
  });

  it('hides Edit and Deactivate for a non-ADMIN role', async () => {
    await renderPage(makeSellerRegistration(), 'MERCHANDISER');
    const buttons = Array.from(container.querySelectorAll('a, button')).map((el) => el.textContent);
    expect(buttons).not.toContain('Edit');
    expect(buttons).not.toContain('Deactivate');
  });

  it('deactivates the registration through the confirm dialog without deleting it', async () => {
    const registration = makeSellerRegistration({ status: 'ACTIVE' });
    const patchSpy = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: {} } });
    await renderPage(registration, 'ADMIN');

    const deactivateButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Deactivate',
    )!;
    await act(async () => {
      deactivateButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // ConfirmDialog is rendered via a Radix portal into document.body.
    const confirmButton = Array.from(document.querySelectorAll('button')).find(
      (b) => b.textContent === 'Deactivate' && b !== deactivateButton,
    ) as HTMLButtonElement;
    await act(async () => {
      confirmButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(patchSpy).toHaveBeenCalledWith(`/seller-registrations/${registration.id}/status`, {
      status: 'INACTIVE',
    });
  });
});
