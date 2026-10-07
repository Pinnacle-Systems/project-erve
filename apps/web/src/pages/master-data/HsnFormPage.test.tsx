/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { HsnFormPage } from './HsnFormPage.js';
import type { GstRuleSetOption, Hsn } from './types.js';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
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

function mockUser(role: Role) {
  const user: AuthUser = { id: 'user-1', email: 'test@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

const ruleSetOptions: GstRuleSetOption[] = [{ id: 'rs-1', code: 'GST-GARMENT-STD', name: 'Garment GST', status: 'ACTIVE' }];

function hsn(): Hsn {
  return {
    id: 'hsn-1',
    code: '61091000',
    description: 'Boys / T-Shirt',
    status: 'ACTIVE',
    gstRuleSet: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

async function renderEditPage(role: Role) {
  mockUser(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/hsns/hsn-1') return { data: { data: hsn() } };
    if (url === '/hsns/gst-rule-set-options') return { data: { data: ruleSetOptions } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/master-data/hsns/hsn-1/edit']}>
          <Routes>
            <Route path="/master-data/hsns/:id/edit" element={<HsnFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await waitFor(() => !container.textContent?.includes('Loading HSN'), 'timed out waiting for loading to clear');
}

function gstRuleSetSelectTrigger(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('#select-gst-rule-set');
}

describe('HsnFormPage — RBAC finalization: GST Rule Set assignment is finance-only', () => {
  it('enables the GST Rule Set field for ADMIN', async () => {
    await renderEditPage('ADMIN');
    const trigger = gstRuleSetSelectTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(false);
    expect(container.textContent).not.toContain('Only Admin or Accountant may assign');
  });

  it('enables the GST Rule Set field for ACCOUNTANT', async () => {
    await renderEditPage('ACCOUNTANT');
    const trigger = gstRuleSetSelectTrigger();
    expect(trigger!.disabled).toBe(false);
  });

  it('disables the GST Rule Set field for MERCHANDISER, who can still edit everything else', async () => {
    await renderEditPage('MERCHANDISER');
    const trigger = gstRuleSetSelectTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(true);
    expect(container.textContent).toContain('Only Admin or Accountant may assign');

    // Identity fields remain fully editable.
    const codeInput = container.querySelector<HTMLInputElement>('#field-hsn-code');
    expect(codeInput).not.toBeNull();
    expect(codeInput!.disabled).toBe(false);
  });

  it('disables the GST Rule Set field for SENIOR_MANAGEMENT (view-only)', async () => {
    await renderEditPage('SENIOR_MANAGEMENT');
    const trigger = gstRuleSetSelectTrigger();
    expect(trigger!.disabled).toBe(true);
  });
});
