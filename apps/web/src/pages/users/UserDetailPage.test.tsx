/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import * as generateModule from '../../lib/pdf/generate.js';
import * as downloadModule from '../../lib/pdf/download.js';
import { UserDetailPage } from './UserDetailPage.js';
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

async function waitForLoaded(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (!container.textContent?.includes('Loading user')) return;
    await act(async () => {
      await flushMicrotasks();
    });
  }
  throw new Error('Timed out waiting for the user to finish loading');
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

async function renderPage(user: AdminUserSummary) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === `/users/${user.id}`) return { data: { data: user } };
    throw new Error(`Unexpected request: ${url}`);
  });

  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/master-data/users/${user.id}`]}>
          <AuthProvider>
            <Routes>
              <Route path="/master-data/users/:id" element={<UserDetailPage />} />
            </Routes>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await flushMicrotasks();
  });
  await waitForLoaded();
}

describe('UserDetailPage PDF actions', () => {
  it('shows Download PDF and Print actions next to Edit once the user has loaded', async () => {
    await renderPage(makeUser());
    const buttons = Array.from(container.querySelectorAll('button, a')).map((b) => b.textContent);
    expect(buttons).toContain('Download PDF');
    expect(buttons).toContain('Print');
  });

  it('shows an inline error and re-enables the actions if generation fails', async () => {
    await renderPage(makeUser());
    vi.spyOn(generateModule, 'renderPdfBlob').mockRejectedValue(new Error('boom'));

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'PDF generation failed. Please try again.',
    );
    expect(
      Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Download PDF')!
        .disabled,
    ).toBe(false);
  });

  it('generates the PDF from the loaded user and downloads it under a sanitized filename', async () => {
    await renderPage(makeUser({ name: 'Jane O/Doe' }));
    vi.spyOn(generateModule, 'renderPdfBlob').mockResolvedValue(new Blob(['pdf']));
    const downloadSpy = vi.spyOn(downloadModule, 'downloadPdfBlob').mockImplementation(() => {});

    const downloadBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Download PDF',
    )!;
    act(() => downloadBtn.click());
    await waitFor(() => downloadSpy.mock.calls.length > 0);

    expect(downloadSpy).toHaveBeenCalledWith(expect.any(Blob), 'ERVE-User-Jane-O-Doe.pdf');
  });
});

describe('UserDetailPage — U3B mobile field and multiple-mappings display', () => {
  it('shows Mobile when present on the loaded user', async () => {
    await renderPage(makeUser({ mobile: '9876543210' }));
    expect(container.textContent).toContain('Mobile');
    expect(container.textContent).toContain('9876543210');
  });

  it('falls back to the empty-value convention when mobile is absent', async () => {
    await renderPage(makeUser({ mobile: null }));
    const mobileLabel = Array.from(container.querySelectorAll('div')).find(
      (el) => el.textContent === 'Mobile',
    );
    expect(mobileLabel).toBeTruthy();
    expect(mobileLabel?.nextElementSibling?.textContent).toBe('—');
  });

  it('shows all Distributor mappings, not just the first, on Detail', async () => {
    await renderPage(
      makeUser({
        roles: ['DISTRIBUTOR'],
        distributors: [
          { id: 'd1', code: 'D1', name: 'Acme Distribution' },
          { id: 'd2', code: 'D2', name: 'Beta Distribution' },
        ],
      }),
    );
    expect(container.textContent).toContain('Acme Distribution');
    expect(container.textContent).toContain('Beta Distribution');
  });

  it('shows all Factory mappings, not just the first, on Detail', async () => {
    await renderPage(
      makeUser({
        roles: ['FACTORY_USER'],
        factories: [
          { id: 'f1', code: 'F1', name: 'North Factory' },
          { id: 'f2', code: 'F2', name: 'South Factory' },
        ],
      }),
    );
    expect(container.textContent).toContain('North Factory');
    expect(container.textContent).toContain('South Factory');
  });
});
