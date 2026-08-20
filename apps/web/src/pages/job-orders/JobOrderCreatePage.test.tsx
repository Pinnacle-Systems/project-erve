/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { ThemeProvider } from '@erve/theme';
import { apiClient } from '../../lib/api-client.js';
import { JobOrderCreatePage } from './JobOrderCreatePage.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe('Job Order Process Flow assignment', () => {
  it('selects supported Production and Quality versions and explains unsupported versions', async () => {
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/factories') return ok(config, { success: true, data: [] });
      if (config.url === '/process-flows')
        return ok(config, {
          success: true,
          data: [
            {
              id: 'flow-production',
              code: 'PROD',
              name: 'Production Only',
              description: null,
              status: 'ACTIVE',
              versions: [
                {
                  id: 'version-production',
                  versionNumber: 1,
                  status: 'ACTIVE',
                  hasQualityActivities: false,
                  runtimeSupport: { supported: true, reasons: [] },
                  effectiveFrom: null,
                  createdAt: '2026-01-01T00:00:00.000Z',
                },
              ],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
            {
              id: 'flow-quality',
              code: 'QUALITY',
              name: 'Quality Flow',
              description: null,
              status: 'ACTIVE',
              versions: [
                {
                  id: 'version-quality',
                  versionNumber: 2,
                  status: 'ACTIVE',
                  hasQualityActivities: true,
                  runtimeSupport: { supported: true, reasons: [] },
                  effectiveFrom: null,
                  createdAt: '2026-01-02T00:00:00.000Z',
                },
              ],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
            },
            {
              id: 'flow-unsupported',
              code: 'FUTURE',
              name: 'External Audit Flow',
              description: null,
              status: 'ACTIVE',
              versions: [
                {
                  id: 'version-unsupported',
                  versionNumber: 1,
                  status: 'ACTIVE',
                  hasQualityActivities: true,
                  runtimeSupport: {
                    supported: false,
                    reasons: [
                      'Quality activity "External Audit" uses an unsupported runtime pattern.',
                    ],
                  },
                  effectiveFrom: null,
                  createdAt: '2026-01-03T00:00:00.000Z',
                },
              ],
              createdAt: '2026-01-03T00:00:00.000Z',
              updatedAt: '2026-01-03T00:00:00.000Z',
            },
          ],
        });
      throw new Error(`Unexpected request: ${config.method} ${config.url}`);
    }) satisfies AxiosAdapter;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    act(() => {
      root.render(
        <MemoryRouter>
          <ThemeProvider theme="default" density="comfortable">
            <QueryClientProvider client={queryClient}>
              <JobOrderCreatePage />
            </QueryClientProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });
    await flush();

    expect(container.textContent).toContain(
      'Unsupported versions remain configurable in Process Flow Master but cannot be assigned to new Job Orders.',
    );
    const trigger = container.querySelector<HTMLButtonElement>('#select-process-flow-version');
    expect(trigger).not.toBeNull();
    act(() => trigger!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();

    const options = Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
    const productionOption = options.find((option) =>
      option.textContent?.includes('Production Only v1'),
    );
    const qualityOption = options.find((option) => option.textContent?.includes('Quality Flow v2'));
    const unsupportedOption = options.find((option) =>
      option.textContent?.includes('External Audit Flow v1'),
    );
    expect(productionOption?.getAttribute('data-disabled')).toBeNull();
    expect(qualityOption?.getAttribute('data-disabled')).toBeNull();
    expect(unsupportedOption?.getAttribute('data-disabled')).not.toBeNull();
    expect(unsupportedOption?.textContent).toContain('External Audit');
  });
});
