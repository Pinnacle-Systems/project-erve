/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { GstRuleSetDetailPage } from './GstRuleSetDetailPage.js';
import type { GstRuleSet } from '../master-data/types.js';

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

function buildRuleSet(): GstRuleSet {
  return {
    id: 'rs-1',
    code: 'GST-GARMENT-STD',
    name: 'Garment GST — Standard',
    status: 'ACTIVE',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    versions: [
      {
        id: 'v2',
        versionNumber: 2,
        status: 'DRAFT',
        effectiveFrom: null,
        effectiveTo: null,
        bands: [],
        createdAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
      },
      {
        id: 'v1',
        versionNumber: 1,
        status: 'ACTIVE',
        effectiveFrom: '2017-07-01',
        effectiveTo: null,
        bands: [
          { id: 'b1', minValue: null, maxValue: 2500, gstPercent: 5 },
          { id: 'b2', minValue: 2500, maxValue: null, gstPercent: 18 },
        ],
        createdAt: '2017-07-01T00:00:00.000Z',
        updatedAt: '2017-07-01T00:00:00.000Z',
      },
    ],
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

async function renderPage(ruleSet: GstRuleSet, role: Role = 'ADMIN') {
  mockUser(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/gst-rule-sets/${ruleSet.id}`) {
      return { data: { data: ruleSet } };
    }
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/gst-rule-sets/${ruleSet.id}`]}>
          <Routes>
            <Route path="/gst-rule-sets/:id" element={<GstRuleSetDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await waitFor(() => !container.textContent?.includes('Loading GST Rule Set'), 'timed out waiting for loading to clear');
}

describe('GstRuleSetDetailPage', () => {
  it('renders the rule set header and both versions', async () => {
    await renderPage(buildRuleSet());
    expect(container.textContent).toContain('GST-GARMENT-STD');
    expect(container.textContent).toContain('Garment GST — Standard');
    expect(container.textContent).toContain('v1');
    expect(container.textContent).toContain('v2');
  });

  it('defaults to showing the first (highest-numbered) version\'s bands', async () => {
    await renderPage(buildRuleSet());
    // v2 (the DRAFT, listed first by the API's desc-by-versionNumber order)
    // has no bands yet.
    expect(container.textContent).toContain('Value Bands — v2');
    expect(container.textContent).toContain('No value bands yet');
  });

  it('switches to a different version\'s bands when its row is clicked', async () => {
    await renderPage(buildRuleSet());
    const v1Link = Array.from(container.querySelectorAll('button')).find((el) => el.textContent === 'v1');
    expect(v1Link).toBeTruthy();
    act(() => {
      v1Link!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await waitFor(() => container.textContent?.includes('Value Bands — v1') ?? false, 'did not switch to v1 bands');
    expect(container.textContent).toContain('≤ 2,500');
    expect(container.textContent).toContain('5%');
    expect(container.textContent).toContain('> 2,500');
    expect(container.textContent).toContain('18%');
  });

  it('shows Activate only for a DRAFT version, and only when the user can manage', async () => {
    await renderPage(buildRuleSet(), 'ADMIN');
    let buttons = Array.from(container.querySelectorAll('button')).map((el) => el.textContent);
    // v2 (DRAFT) is the default selection/first row — Activate must be offered for it.
    expect(buttons).toContain('Activate');

    await renderPage(buildRuleSet(), 'SENIOR_MANAGEMENT');
    buttons = Array.from(container.querySelectorAll('button')).map((el) => el.textContent);
    expect(buttons).not.toContain('Activate');
  });
});
