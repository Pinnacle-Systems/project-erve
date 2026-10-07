/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { GstRuleSetListPage } from './GstRuleSetListPage.js';
import type { GstRuleSetSummary } from '../master-data/types.js';

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

function makeRuleSet(overrides: Partial<GstRuleSetSummary> = {}): GstRuleSetSummary {
  return {
    id: 'rs-1',
    code: 'GST-GARMENT-STD',
    name: 'Garment GST — Standard',
    status: 'ACTIVE',
    versionCount: 1,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
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

async function renderPage(ruleSets: GstRuleSetSummary[], role: Role = 'ADMIN') {
  mockUser(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/gst-rule-sets') {
      return { data: { data: { items: ruleSets, pageInfo: { limit: 25, hasMore: false, nextCursor: null } } } };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <GstRuleSetListPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await waitFor(
    () => !container.textContent?.includes('Loading GST Rule Sets'),
    'timed out waiting for loading to clear',
  );
}

describe('GstRuleSetListPage', () => {
  it('renders rule set rows with code, name, version count and status', async () => {
    await renderPage([makeRuleSet()]);
    expect(container.textContent).toContain('GST-GARMENT-STD');
    expect(container.textContent).toContain('Garment GST — Standard');
    expect(container.textContent).toContain('ACTIVE');
  });

  it('shows "Create GST Rule Set" for ADMIN but not for SENIOR_MANAGEMENT', async () => {
    await renderPage([], 'ADMIN');
    let buttons = Array.from(container.querySelectorAll('a, button')).map((el) => el.textContent);
    expect(buttons).toContain('Create GST Rule Set');

    await renderPage([], 'SENIOR_MANAGEMENT');
    buttons = Array.from(container.querySelectorAll('a, button')).map((el) => el.textContent);
    expect(buttons).not.toContain('Create GST Rule Set');
  });

  it('shows an empty state when there are no GST Rule Sets', async () => {
    await renderPage([]);
    expect(container.textContent).toContain('No GST Rule Sets found');
  });
});
