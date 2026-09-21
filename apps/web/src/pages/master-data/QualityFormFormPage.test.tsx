/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { QualityFormFormPage } from './QualityFormFormPage.js';
import type { QualityForm } from './types.js';

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

function makeQualityForm(overrides: Partial<QualityForm> = {}): QualityForm {
  return {
    id: 'qf-1',
    code: 'FINAL',
    name: 'Final Inspection Report',
    description: null,
    activityType: 'INSPECTION',
    executionScope: 'JOB_ORDER',
    status: 'ACTIVE',
    versions: [],
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function mockQualityFormGets(overrides: Record<string, () => Promise<unknown>> = {}) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    const handler = overrides[url];
    if (handler) return handler();
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderQualityFormPage(path: string, routePath: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={<QualityFormFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

function findInputByLabel(label: string): HTMLInputElement | undefined {
  return Array.from(container.querySelectorAll('input')).find(
    (element) => element.labels?.[0]?.textContent?.trim() === label,
  );
}

describe('QualityFormFormPage — UXAUTH-019 edit-load gating', () => {
  it('EDIT route: does not render a writable form while the record is still loading', async () => {
    mockQualityFormGets({ '/quality-forms/qf-1': () => new Promise(() => {}) });
    renderQualityFormPage('/master-data/quality-forms/qf-1/edit', '/master-data/quality-forms/:id/edit');

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.textContent).toContain('Loading Quality Form');
    expect(container.querySelectorAll('form').length).toBe(0);
    expect(container.querySelector('input')).toBeNull();
  });

  it('EDIT route: shows an error state and no writable form when the record fetch fails', async () => {
    mockQualityFormGets({
      '/quality-forms/qf-1': () => Promise.reject(new Error('Quality Form not found')),
    });
    renderQualityFormPage('/master-data/quality-forms/qf-1/edit', '/master-data/quality-forms/:id/edit');

    await waitFor(
      () => !container.textContent?.includes('Loading Quality Form'),
      'timed out waiting for loading to clear',
    );

    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('Unable to load Quality Form');
    expect(container.textContent).toContain('Quality Form not found');
  });

  it('EDIT route: hydrates the form from the real server record on success', async () => {
    const form = makeQualityForm({ code: 'PPM', name: 'Server Hydrated Form' });
    mockQualityFormGets({
      '/quality-forms/qf-1': () => Promise.resolve({ data: { data: form } }),
    });
    renderQualityFormPage('/master-data/quality-forms/qf-1/edit', '/master-data/quality-forms/:id/edit');

    await waitFor(
      () => !container.textContent?.includes('Loading Quality Form'),
      'timed out waiting for loading to clear',
    );

    expect(container.querySelector('form')).not.toBeNull();
    const codeInput = findInputByLabel('Code *');
    const nameInput = findInputByLabel('Name *');
    expect(codeInput?.value).toBe('PPM');
    expect(nameInput?.value).toBe('Server Hydrated Form');
  });

  it('CREATE route (no id): renders the normal blank/default form immediately, unaffected by the edit-load gating', async () => {
    mockQualityFormGets();
    renderQualityFormPage('/master-data/quality-forms/new', '/master-data/quality-forms/new');

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.textContent).not.toContain('Loading Quality Form');
    expect(container.textContent).not.toContain('Unable to load Quality Form');
    expect(container.querySelector('form')).not.toBeNull();
    const codeInput = findInputByLabel('Code *');
    expect(codeInput?.value).toBe('');
  });
});
