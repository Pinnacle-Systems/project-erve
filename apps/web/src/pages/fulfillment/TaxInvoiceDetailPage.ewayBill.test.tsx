/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser, Role, TaxInvoiceReviewView } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import * as Auth from '../../auth/AuthContext.js';
import { TaxInvoiceDetailPage } from './TaxInvoiceDetailPage.js';
import { taxInvoiceFixture } from './tax-invoice-test-fixture.js';
import {
  completeMovement,
  historyFixture,
  movementRecord,
  previewFixture,
  readinessFixture,
} from './eway-bill/eway-bill-test-fixture.js';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
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

const text = () => document.body.textContent ?? '';
const tab = (label: string) =>
  Array.from(document.querySelectorAll<HTMLElement>('[role="tab"]')).find(
    (node) => node.textContent?.trim() === label,
  );
const ok = (data: unknown) => ({ data: { success: true, data } });
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
  });
}
async function open(label: string) {
  await act(async () => {
    const node = tab(label)!;
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    node.focus();
    node.click();
  });
  await flush();
}
const ewayCalls = () =>
  vi.mocked(apiClient.get).mock.calls.filter(([url]) => String(url).includes('eway-bill')).length;

async function render(role: Role, invoice: TaxInvoiceReviewView = taxInvoiceFixture({ status: 'FINALIZED', invoiceNumber: 'EI/26-27/0001', finalizedAt: '2026-10-11T05:00:00Z', review: { state: 'FINALIZED', isPreview: false, calculatedAt: null, blockers: [] } })) {
  const user: AuthUser = { id: 'user-1', email: 'u@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(Auth, 'useAuth').mockReturnValue({
    user, token: 't', isInitializing: false, login: vi.fn(), logout: vi.fn(), refreshUser: vi.fn(),
  } as unknown as ReturnType<typeof Auth.useAuth>);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url.endsWith('/review')) return ok(invoice);
    if (url.endsWith('/audit')) return ok([]);
    if (url.endsWith('/eway-bill-readiness')) return ok(readinessFixture());
    if (url.endsWith('/eway-bill/movement')) return ok(movementRecord(completeMovement(), 3));
    if (url.endsWith('/eway-bill/generation-preview')) return ok(previewFixture());
    if (url.endsWith('/eway-bill/attempts')) return ok(historyFixture());
    throw new Error(`Unexpected request: ${url}`);
  });
  await act(async () => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/fulfillment/tax-invoices/inv-1']}>
          <Routes>
            <Route path="/fulfillment/tax-invoices/:id" element={<TaxInvoiceDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
}

describe('Tax Invoice detail — E-Way Bill tab', () => {
  it.each(['ACCOUNTANT', 'ADMIN'] as const)('shows the tab to %s after Review and History', async (role) => {
    await render(role);
    const labels = Array.from(document.querySelectorAll('[role="tab"]')).map((node) => node.textContent);
    expect(labels).toEqual(['Review', 'History', 'E-Way Bill']);
  });

  it.each(['MERCHANDISER', 'SENIOR_MANAGEMENT', 'FACTORY_USER'] as const)(
    'shows no tab and makes no E-Way Bill request for %s',
    async (role) => {
      await render(role);
      expect(tab('E-Way Bill')).toBeUndefined();
      expect(ewayCalls()).toBe(0);
      expect(text()).not.toContain('E-Way Bill status');
    },
  );

  it('makes no E-Way Bill request until the tab is opened', async () => {
    await render('ACCOUNTANT');
    expect(ewayCalls()).toBe(0);
    await open('E-Way Bill');
    expect(ewayCalls()).toBe(4);
    expect(text()).toContain('E-Way Bill status');
    expect(text()).toContain('Movement information');
    expect(text()).toContain('Generation preview');
    expect(text()).toContain('Existing E-Way Bill and history');
  });

  it('leaves the Review and History tabs working and keeps the E-Way Bill panel mounted when switching', async () => {
    await render('ACCOUNTANT');
    expect(text()).toContain('Seller and parties');
    await open('E-Way Bill');
    const input = document.querySelector<HTMLInputElement>('input[maxlength="100"]')!;
    expect(input).toBeTruthy();
    await open('History');
    expect(text()).toContain('Financial history');
    expect(tab('History')!.getAttribute('aria-selected')).toBe('true');
    await open('Review');
    expect(text()).toContain('Seller and parties');
    await open('E-Way Bill');
    expect(document.querySelector<HTMLInputElement>('input[maxlength="100"]')).toBe(input);
    expect(ewayCalls()).toBe(4);
  });

  it('does not change the invoice lifecycle actions', async () => {
    await render('ACCOUNTANT');
    const labels = Array.from(document.querySelectorAll('button')).map((node) => node.textContent?.trim());
    expect(labels).toContain('Cancel invoice');
    await open('E-Way Bill');
    expect(Array.from(document.querySelectorAll('button')).map((node) => node.textContent?.trim())).toContain('Cancel invoice');
  });
});
