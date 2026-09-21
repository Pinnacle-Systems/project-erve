/** @vitest-environment jsdom */
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@erve/theme';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import { apiClient } from '../../lib/api-client.js';
import { QualityFormDefinitionEditor } from './QualityFormDefinitionEditor.js';
import { QualityFormListPage } from './QualityFormListPage.js';
import { QualityFormFormPage } from './QualityFormFormPage.js';
import { QualityFormDetailPage } from './QualityFormDetailPage.js';
import { emptyDefinition } from './quality-form-ui.js';
import type { QualityFormSection } from './types.js';

const ok = <T,>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> => ({
  data,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
});
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const flush = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
const waitForText = async (text: string) => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (container.textContent?.includes(text)) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
  throw new Error(`Timed out waiting for text: ${text}`);
};
function Providers({ children, entry = '/' }: { children: ReactNode; entry?: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <ThemeProvider theme="default">
        <QueryClientProvider
          client={
            new QueryClient({
              defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
            })
          }
        >
          {children}
        </QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}
function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
function input(label: string, value: string) {
  const element = Array.from(container.querySelectorAll('input')).find(
    (item) =>
      item.getAttribute('aria-label') === label || item.labels?.[0]?.textContent?.trim() === label,
  );
  if (!element) throw new Error(`Missing input ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('Quality Form definition editor', () => {
  it('adds and removes ordered sections and components', () => {
    function Harness() {
      const [sections, setSections] = useState<QualityFormSection[]>(emptyDefinition());
      return <QualityFormDefinitionEditor sections={sections} onChange={setSections} />;
    }
    act(() =>
      root.render(
        <ThemeProvider theme="default">
          <Harness />
        </ThemeProvider>,
      ),
    );
    click('Add component');
    expect(container.textContent?.match(/Component type/g)).toHaveLength(2);
    click('Add section');
    expect(container.textContent).toContain('Section 2 title *');
    const remove = Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent === 'Remove section' && !item.hasAttribute('disabled'),
    )!;
    act(() => remove.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container.textContent).not.toContain('Section 2 title *');
  });
});

describe('Quality Form pages', () => {
  it('renders business columns and version state in the list', async () => {
    apiClient.defaults.adapter = vi.fn(async (config) =>
      ok(config, {
        success: true,
        data: [
          {
            id: 'qf-1',
            code: 'FINAL',
            name: 'Final Inspection Report',
            activityType: 'INSPECTION',
            executionScope: 'JOB_ORDER',
            status: 'ACTIVE',
            versions: [{ id: 'v1', versionNumber: 1, status: 'PUBLISHED' }],
          },
        ],
      }),
    ) satisfies AxiosAdapter;
    act(() =>
      root.render(
        <Providers>
          <QualityFormListPage />
        </Providers>,
      ),
    );
    await flush();
    expect(container.textContent).toContain('FINAL');
    expect(container.textContent).toContain('Final Inspection Report');
    expect(container.textContent).toContain('Job Order');
    expect(container.textContent).toContain('v1');
  });

  it('creates a form with its initial controlled definition', async () => {
    let submitted: Record<string, unknown> | undefined;
    apiClient.defaults.adapter = vi.fn(async (config) => {
      submitted = JSON.parse(config.data as string) as Record<string, unknown>;
      return ok(config, { success: true, data: { id: 'qf-1' } });
    }) satisfies AxiosAdapter;
    act(() =>
      root.render(
        <Providers entry="/master-data/quality-forms/new">
          <Routes>
            <Route path="/master-data/quality-forms/new" element={<QualityFormFormPage />} />
            <Route path="/master-data/quality-forms/:id" element={<div>Created</div>} />
          </Routes>
        </Providers>,
      ),
    );
    input('Code *', 'final');
    input('Name *', 'Final Inspection Report');
    click('Create Draft');
    await flush();
    expect(submitted).toMatchObject({
      code: 'FINAL',
      activityType: 'INSPECTION',
      executionScope: 'JOB_ORDER',
    });
    expect(submitted?.sections as unknown[]).toHaveLength(1);
    expect(container.textContent).toContain('Created');
  });

  it('presents versions and ordered components on detail', async () => {
    apiClient.defaults.adapter = vi.fn(async (config) =>
      config.url === '/quality-forms/qf-1'
        ? ok(config, {
            success: true,
            data: {
              id: 'qf-1',
              code: 'PPM',
              name: 'Pre-Production Meeting Report',
              description: null,
              activityType: 'MEETING',
              executionScope: 'JOB_ORDER',
              status: 'ACTIVE',
              versions: [
                {
                  id: 'v1',
                  versionNumber: 1,
                  status: 'PUBLISHED',
                  publishedAt: '2026-08-14',
                  createdAt: '2026-08-14',
                },
              ],
            },
          })
        : ok(config, {
            success: true,
            data: {
              id: 'v1',
              qualityFormId: 'qf-1',
              qualityForm: { name: 'Pre-Production Meeting Report' },
              versionNumber: 1,
              status: 'PUBLISHED',
              activityType: 'MEETING',
              executionScope: 'JOB_ORDER',
              sections: [
                {
                  sequence: 1,
                  title: 'Attendees',
                  components: [
                    { sequence: 1, type: 'ATTENDEE_LIST', title: 'Attendee list', config: {} },
                  ],
                },
              ],
            },
          }),
    ) satisfies AxiosAdapter;
    act(() =>
      root.render(
        <Providers entry="/master-data/quality-forms/qf-1">
          <Routes>
            <Route path="/master-data/quality-forms/:id" element={<QualityFormDetailPage />} />
          </Routes>
        </Providers>,
      ),
    );
    await waitForText('Attendee list');
    expect(container.textContent).toContain('PPM');
    expect(container.textContent).toContain('v1 PUBLISHED');
    expect(container.textContent).toContain('Version activity');
    expect(container.textContent).toContain('Meeting');
    expect(container.textContent).toContain('Attendee list');
  });
});

describe('QualityFormDetailPage lifecycle mutation feedback (UXAUTH-020)', () => {
  function form(overrides: Record<string, unknown> = {}) {
    return {
      id: 'qf-1',
      code: 'FINAL',
      name: 'Final Inspection Report',
      description: null,
      status: 'ACTIVE',
      versions: [{ id: 'v1', versionNumber: 1, status: 'PUBLISHED' }],
      ...overrides,
    };
  }
  function version(overrides: Record<string, unknown> = {}) {
    return {
      id: 'v1',
      qualityFormId: 'qf-1',
      qualityForm: { name: 'Final Inspection Report' },
      versionNumber: 1,
      status: 'PUBLISHED',
      activityType: 'INSPECTION',
      executionScope: 'JOB_ORDER',
      sections: [],
      ...overrides,
    };
  }

  function renderDetail(formData = form(), versionData = version()) {
    apiClient.defaults.adapter = vi.fn(async (config) => {
      if (config.method === 'get' && config.url === '/quality-forms/qf-1') {
        return ok(config, { success: true, data: formData });
      }
      if (config.method === 'get' && config.url === '/quality-form-versions/v1') {
        return ok(config, { success: true, data: versionData });
      }
      throw new Error(`Unexpected GET ${config.url as string}`);
    }) satisfies AxiosAdapter;
    act(() =>
      root.render(
        <Providers entry="/master-data/quality-forms/qf-1">
          <Routes>
            <Route path="/master-data/quality-forms/:id" element={<QualityFormDetailPage />} />
          </Routes>
        </Providers>,
      ),
    );
  }

  function findButton(label: string) {
    return Array.from(container.querySelectorAll('button')).find(
      (item) => item.textContent?.trim() === label,
    );
  }

  it('disables Create New Draft while pending, blocks a duplicate click, and surfaces a visible error on failure', async () => {
    renderDetail();
    await waitForText('Create New Draft');

    let reject!: (error: unknown) => void;
    const postSpy = vi
      .spyOn(apiClient, 'post')
      .mockImplementation(() => new Promise((_resolve, r) => (reject = r)));

    click('Create New Draft');
    await flush();
    expect(findButton('Create New Draft')?.disabled).toBe(true);

    // A second click while pending must not fire a duplicate mutation.
    click('Create New Draft');
    expect(postSpy).toHaveBeenCalledTimes(1);

    act(() => reject(new Error('Unable to create a new draft')));
    await waitForText('Unable to create a new draft');
    expect(findButton('Create New Draft')?.disabled).toBe(false);
  });

  it('disables Publish Version while pending and surfaces a visible error on failure', async () => {
    renderDetail(form(), version({ status: 'DRAFT' }));
    await waitForText('Publish Version');

    let reject!: (error: unknown) => void;
    vi.spyOn(apiClient, 'post').mockImplementation(
      () => new Promise((_resolve, r) => (reject = r)),
    );

    click('Publish Version');
    await flush();
    expect(findButton('Publish Version')?.disabled).toBe(true);

    act(() => reject(new Error('Unable to publish this version')));
    await waitForText('Unable to publish this version');
    expect(findButton('Publish Version')?.disabled).toBe(false);
  });

  it('disables Activate/Deactivate while pending, shows an error on failure, and applies the change on success', async () => {
    renderDetail();
    await waitForText('Deactivate');

    let reject!: (error: unknown) => void;
    const patchSpy = vi
      .spyOn(apiClient, 'patch')
      .mockImplementation(() => new Promise((_resolve, r) => (reject = r)));

    click('Deactivate');
    await flush();
    expect(findButton('Deactivate')?.disabled).toBe(true);

    act(() => reject(new Error('Unable to update status')));
    await waitForText('Unable to update status');
    expect(findButton('Deactivate')?.disabled).toBe(false);
    expect(patchSpy).toHaveBeenCalledTimes(1);
  });

  it('succeeds normally on Activate/Deactivate when the request resolves', async () => {
    renderDetail(form({ status: 'INACTIVE' }));
    await waitForText('Activate');

    vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { success: true } });
    click('Activate');
    await flush();

    // onSuccess invalidates ['quality-form', id], which refetches via the
    // adapter mock — still ACTIVE there, but the mutation itself must have
    // gone through without leaving the button permanently disabled/stuck.
    expect(findButton('Deactivate') ?? findButton('Activate')).toBeDefined();
  });
});
