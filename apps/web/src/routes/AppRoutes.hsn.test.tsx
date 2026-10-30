/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as AuthContext from '../auth/AuthContext.js';
import { apiClient } from '../lib/api-client.js';
import type { Hsn } from '../pages/master-data/types.js';
import { AppRoutes } from './AppRoutes.js';

// Keep the production registry, guards and HSN pages; omit the unrelated shell.
vi.mock('../pages/AppLayout.js', () => ({ AppLayout: () => <Outlet /> }));

const hsn: Hsn = {
  id: 'hsn-1',
  code: '61091000',
  description: 'Boys / T-Shirt',
  status: 'ACTIVE',
  gstRuleSet: null,
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};
const manageRoles = ['ADMIN', 'MERCHANDISER', 'ACCOUNTANT'] as const satisfies readonly Role[];
let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/hsns') {
      return { data: { data: { items: [hsn], pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
    }
    if (url === '/hsns/hsn-1') return { data: { data: hsn } };
    if (url === '/hsns/gst-rule-set-options') return { data: { data: [] } };
    if (url.endsWith('/history')) return { data: { data: [] } };
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => {
  act(() => root.unmount());
  queryClient.clear();
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
  throw new Error(`HSN navigation did not finish: ${container.textContent}`);
}

async function renderRoutes(role: Role, path: string, ready: () => boolean) {
  const user: AuthUser = { id: 'user-1', email: 'test@test.local', mobile: null, name: 'Test User', roles: [role] };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user, status: 'authenticated', logoutReason: null,
    login: vi.fn(), logout: vi.fn(), retrySession: vi.fn(),
  });
  act(() => root.render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Location />
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  ));
  await waitFor(ready);
}

function findAction(label: string) {
  return Array.from(container.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>('a, button'))
    .find((element) => element.textContent === label);
}

async function clickAction(label: string) {
  const action = findAction(label);
  expect(action, `Missing action: ${label}`).toBeDefined();
  await act(async () => { action!.click(); });
}

function expectLocation(path: string) {
  expect(container.querySelector('[data-testid="location"]')?.textContent).toBe(path);
}

describe.each(manageRoles)('HSN registered navigation for %s', (role) => {
  it('opens the shared HSN import workflow from the listing', async () => {
    await renderRoutes(role, '/hsns', () => Boolean(findAction('Import')));
    await clickAction('Import');
    await waitFor(() => container.textContent?.includes('Import HSNs') ?? false);
    expectLocation('/hsns/import');
    expect(container.textContent).toContain('refer to the Instructions tab');
  });
  it('opens the create form from the list', async () => {
    await renderRoutes(role, '/hsns', () => Boolean(findAction('Create HSN')));
    await clickAction('Create HSN');
    await waitFor(() => Boolean(container.querySelector('form')));
    expectLocation('/hsns/new');
    expect(container.textContent).toContain('Create a new HSN master record');
    expect(container.querySelector<HTMLInputElement>('#field-hsn-code')?.value).toBe('');
  });

  it('opens details from the list', async () => {
    await renderRoutes(role, '/hsns', () => Boolean(findAction(hsn.code)));
    await clickAction(hsn.code);
    await waitFor(() => Boolean(findAction('Edit')));
    expectLocation('/hsns/hsn-1');
    expect(container.textContent).toContain(hsn.description);
  });

  it('opens the edit form from details', async () => {
    await renderRoutes(role, '/hsns/hsn-1', () => Boolean(findAction('Edit')));
    await clickAction('Edit');
    await waitFor(() => container.querySelector<HTMLInputElement>('#field-hsn-code')?.value === hsn.code);
    expectLocation('/hsns/hsn-1/edit');
    expect(findAction('Save Changes')).toBeDefined();
  });

  it('returns to the list from details', async () => {
    await renderRoutes(role, '/hsns/hsn-1', () => Boolean(findAction('Back')));
    await clickAction('Back');
    await waitFor(() => Boolean(findAction(hsn.code)));
    expectLocation('/hsns');
    expect(findAction('Create HSN')).toBeDefined();
  });

  it.each(['create', 'update'] as const)('opens details after successful %s', async (mode) => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { data: hsn } });
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: hsn } });
    await renderRoutes(role, mode === 'create' ? '/hsns/new' : '/hsns/hsn-1/edit',
      () => Boolean(container.querySelector('form')));
    if (mode === 'create') {
      const input = container.querySelector<HTMLInputElement>('#field-hsn-code')!;
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, hsn.code);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
    } else {
      await waitFor(() => container.querySelector<HTMLInputElement>('#field-hsn-code')?.value === hsn.code);
    }
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => Boolean(findAction('Edit')));
    expectLocation('/hsns/hsn-1');
    expect(container.textContent).toContain(hsn.description);
    if (mode === 'create') {
      expect(post).toHaveBeenCalledWith('/hsns', expect.objectContaining({ code: hsn.code }));
      expect(patch).not.toHaveBeenCalled();
    } else {
      expect(patch).toHaveBeenCalledWith('/hsns/hsn-1', expect.objectContaining({ code: hsn.code }));
      expect(post).not.toHaveBeenCalled();
    }
  });
});
