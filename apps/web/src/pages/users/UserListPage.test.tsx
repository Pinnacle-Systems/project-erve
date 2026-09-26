/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import * as printModule from '../../lib/pdf/print.js';
import { UserListPage } from './UserListPage.js';
import type { AdminUserSummary } from '../master-data/types.js';

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

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if (predicate()) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for condition');
}

function makeUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    id: 'user-1',
    name: 'Jane Doe',
    email: 'jane@erve.test',
    mobile: null,
    status: 'ACTIVE',
    roles: ['ADMIN'],
    distributors: [],
    factories: [],
    createdAt: '2026-08-20T00:00:00.000Z',
    updatedAt: '2026-08-20T00:00:00.000Z',
    ...overrides,
  };
}

async function renderPageWithUsers(users: AdminUserSummary[]) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    // GET /users is cursor-paginated (UP1): one page, nothing more.
    if (url === '/users')
      return {
        data: { data: { items: users, pageInfo: { limit: 25, hasMore: false, nextCursor: null } } },
      };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <AuthProvider>
            <UserListPage />
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
}

describe('UserListPage PDF actions', () => {
  it('shows Download PDF and Print actions near the filter bar', async () => {
    await renderPageWithUsers([]);
    const buttons = Array.from(container.querySelectorAll('button')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    await renderPageWithUsers([makeUser()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockRejectedValue(new Error('boom'));

    const printBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print',
    )!;
    act(() => printBtn.click());
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'PDF generation failed. Please try again.',
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.find((b) => b.textContent === 'Print')!.disabled).toBe(false);
    expect(buttons.find((b) => b.textContent === 'Download PDF')!.disabled).toBe(false);
  });

  it('downloads the user list PDF under the expected filename', async () => {
    await renderPageWithUsers([makeUser()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy.mock.calls[0]![1]).toMatch(/^ERVE-Users-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it('invokes printPdfBlob (not the download path) when Print is clicked', async () => {
    await renderPageWithUsers([makeUser()]);
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const printSpy = vi.spyOn(printModule, 'printPdfBlob').mockImplementation(() => {});
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const printBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Print',
    )!;
    act(() => printBtn.click());
    await waitFor(() => printSpy.mock.calls.length > 0);

    expect(printSpy).toHaveBeenCalledTimes(1);
    expect(downloadSpy).not.toHaveBeenCalled();
  });
});

describe('UserListPage — U3B multiple-mappings display', () => {
  it('shows the first mapping plus a count when a user has more than one', async () => {
    await renderPageWithUsers([
      makeUser({
        distributors: [
          { id: 'd1', code: 'D1', name: 'Acme Distribution' },
          { id: 'd2', code: 'D2', name: 'Beta Distribution' },
        ],
        factories: [
          { id: 'f1', code: 'F1', name: 'North Factory' },
          { id: 'f2', code: 'F2', name: 'South Factory' },
          { id: 'f3', code: 'F3', name: 'East Factory' },
        ],
      }),
    ]);

    await waitFor(() => !container.textContent?.includes('Loading users'));
    expect(container.textContent).toContain('Acme Distribution +1 more');
    expect(container.textContent).toContain('North Factory +2 more');
  });

  it('shows just the single mapping name with no count when there is only one', async () => {
    await renderPageWithUsers([
      makeUser({ distributors: [{ id: 'd1', code: 'D1', name: 'Acme Distribution' }] }),
    ]);

    await waitFor(() => !container.textContent?.includes('Loading users'));
    expect(container.textContent).toContain('Acme Distribution');
    expect(container.textContent).not.toContain('more');
  });

  it('falls back to the empty-value convention when a user has no mappings', async () => {
    await renderPageWithUsers([makeUser({ distributors: [], factories: [] })]);
    await waitFor(() => !container.textContent?.includes('Loading users'));
    const cells = Array.from(container.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells.filter((text) => text === '—').length).toBeGreaterThanOrEqual(2);
  });
});
