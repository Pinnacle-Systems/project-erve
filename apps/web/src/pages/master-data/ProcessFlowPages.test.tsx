/** @vitest-environment jsdom */
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import { ThemeProvider } from '@erve/theme';
import type { AuthUser, Role } from '@erve/types';
import { apiClient } from '../../lib/api-client.js';
import { AuthProvider } from '../../auth/AuthContext.js';
import { setStoredToken } from '../../auth/token-storage.js';
import { AppRoutes } from '../../routes/AppRoutes.js';
import { ProcessFlowCreatePage } from './ProcessFlowCreatePage.js';
import { ProcessFlowDetailPage } from './ProcessFlowDetailPage.js';
import {
  newDraftStage,
  ProcessStageEditor,
  validateDraftStages,
  type DraftStage,
} from './ProcessStageEditor.js';
import type { ProcessFlow, ProcessFlowActivity, ProcessFlowVersion } from './types.js';

function ok<T>(config: InternalAxiosRequestConfig, data: T, status = 200): AxiosResponse<T> {
  return { data, status, statusText: 'OK', headers: {}, config };
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
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  sessionStorage.clear();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

function click(label: string): void {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) =>
      candidate.textContent?.trim() === label ||
      candidate.textContent?.trim().startsWith(label) ||
      candidate.getAttribute('aria-label') === label,
  );
  if (!button) throw new Error(`Button not found: ${label}`);
  act(() => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

function setInput(label: string, value: string): void {
  const input = container.querySelector<HTMLInputElement>(
    `input[aria-label="${label}"], input[id="field-${label.toLowerCase().replace(/\s+/g, '-')}"]`,
  );
  if (!input) throw new Error(`Input not found: ${label}`);
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function Providers({
  children,
  initialEntry = '/',
}: {
  children: ReactNode;
  initialEntry?: string;
}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      <ThemeProvider theme="default" density="comfortable">
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
}

const productionActivity = (id: string, name: string): ProcessFlowActivity => ({
  id,
  sequence: 1,
  name,
  code: null,
  status: 'ACTIVE',
  activityType: 'PRODUCTION',
  qualityFormVersionId: null,
  qualityFormVersion: null,
  qualityExecutionMode: null,
  associatedProductionActivityId: null,
  associatedProductionActivity: null,
  qualityAvailabilityPolicy: null,
  progressThresholdPercent: null,
  gateSatisfactionRequirement: null,
  executionMultiplicity: null,
  coverageTarget: null,
});

describe('process activity authoring', () => {
  it('adds, removes, renames, and reorders Production activities while showing contiguous sequence', () => {
    function Harness() {
      const [stages, setStages] = useState<DraftStage[]>([
        newDraftStage({ name: 'Cutting' }),
        newDraftStage({ name: 'Sewing' }),
      ]);
      return <ProcessStageEditor stages={stages} onChange={setStages} />;
    }
    act(() =>
      root.render(
        <Providers>
          <Harness />
        </Providers>,
      ),
    );

    click('Move Sewing up');
    expect(
      Array.from(container.querySelectorAll('ol input')).map(
        (input) => (input as HTMLInputElement).value,
      ),
    ).toEqual(['Sewing', '', 'Cutting', '']);
    expect(container.textContent).toContain('1');
    expect(container.textContent).toContain('2');

    click('Add Activity');
    expect(container.querySelectorAll('ol li')).toHaveLength(3);
    setInput('Activity 3 name *', 'Packing');
    expect(
      Array.from(container.querySelectorAll('ol input')).some(
        (input) => (input as HTMLInputElement).value === 'Packing',
      ),
    ).toBe(true);
    click('Remove Cutting');
    expect(container.querySelectorAll('ol li')).toHaveLength(2);
    expect(
      Array.from(container.querySelectorAll('ol input')).some(
        (input) => (input as HTMLInputElement).value === 'Packing',
      ),
    ).toBe(true);
  });

  it('renders sequential and in-process Quality forms with conditional association and percentage fields', async () => {
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/quality-forms')
        return ok(config, {
          success: true,
          data: [
            {
              id: 'form-1',
              code: 'FINAL',
              name: 'Final Inspection Report',
              status: 'ACTIVE',
              versions: [{ id: 'qfv-1', versionNumber: 1, status: 'PUBLISHED' }],
            },
          ],
        });
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    function Harness() {
      const [stages, setStages] = useState<DraftStage[]>([
        newDraftStage({ id: 'finishing', name: 'Finishing', activityType: 'PRODUCTION' }),
        newDraftStage({
          id: 'final',
          name: 'Final Inspection',
          activityType: 'QUALITY',
          qualityFormVersionId: 'qfv-1',
          qualityExecutionMode: 'SEQUENTIAL_GATE',
        }),
      ]);
      return (
        <>
          <button
            type="button"
            onClick={() =>
              setStages((current) => [
                current[0]!,
                {
                  ...current[1]!,
                  qualityExecutionMode: 'IN_PROCESS',
                  associatedProductionActivityKey: 'finishing',
                  qualityAvailabilityPolicy: 'PROGRESS_PERCENTAGE',
                  progressThresholdPercent: '50',
                },
              ])
            }
          >
            Configure in-process
          </button>
          <ProcessStageEditor stages={stages} onChange={setStages} />
        </>
      );
    }

    act(() =>
      root.render(
        <Providers>
          <Harness />
        </Providers>,
      ),
    );
    await flush();
    expect(container.textContent).toContain('Quality Form version');
    expect(container.textContent).toContain('Sequential gate');
    expect(container.textContent).toContain('Gate satisfied by');
    expect(container.textContent).not.toContain('Associated Production Activity');

    click('Configure in-process');
    expect(container.textContent).toContain('Associated Production Activity');
    expect(container.textContent).toContain('Available when');
    expect(container.textContent).toContain('Execution multiplicity');
    expect(container.textContent).toContain('Progress threshold (%)');
    expect((container.querySelector('input[type="number"]') as HTMLInputElement).value).toBe('50');
    expect(
      validateDraftStages(
        [
          newDraftStage({ id: 'sewing', name: 'Sewing', activityType: 'PRODUCTION' }),
          {
            ...newDraftStage({
              id: 'inline',
              name: 'Inline Inspection',
              activityType: 'QUALITY',
              qualityFormVersionId: 'qfv-1',
              qualityExecutionMode: 'IN_PROCESS',
            }),
            associatedProductionActivityKey: 'missing',
          },
        ],
        true,
      ),
    ).toBe('Select a Production activity from this version');
  });
});

describe('process-flow pages', () => {
  it('creates a process flow and submits the authored stage order', async () => {
    let submitted: Record<string, unknown> | undefined;
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/quality-forms' && config.method === 'get')
        return ok(config, { success: true, data: [] });
      if (config.url === '/process-flows' && config.method === 'post') {
        submitted = JSON.parse(config.data as string) as Record<string, unknown>;
        return ok(
          config,
          {
            success: true,
            data: { id: 'flow-1', versions: [{ id: 'version-1' }] },
          },
          201,
        );
      }
      throw new Error(`Unexpected request: ${config.method} ${config.url}`);
    }) satisfies AxiosAdapter;

    act(() => {
      root.render(
        <Providers initialEntry="/master-data/process-flows/new">
          <Routes>
            <Route path="/master-data/process-flows/new" element={<ProcessFlowCreatePage />} />
            <Route path="/master-data/process-flows/:id" element={<div>Created</div>} />
          </Routes>
        </Providers>,
      );
    });
    setInput('Code *', 'PROD');
    setInput('Name *', 'Production');
    setInput('Activity 1 name *', 'Cutting');
    click('Add Activity');
    setInput('Activity 2 name *', 'Sewing');
    click('Create Draft');
    await flush();

    expect(submitted).toMatchObject({
      code: 'PROD',
      name: 'Production',
      stages: [
        { name: 'Cutting', code: null },
        { name: 'Sewing', code: null },
      ],
    });
    expect(container.textContent).toContain('Created');
  });

  it('keeps explicit version selection, renders the selected stages, and gates draft controls', async () => {
    const flow: ProcessFlow = {
      id: 'flow-1',
      code: 'PROD',
      name: 'Production',
      description: null,
      status: 'ACTIVE',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
      versions: [
        {
          id: 'v2',
          versionNumber: 2,
          status: 'DRAFT',
          hasQualityActivities: false,
          effectiveFrom: null,
          createdAt: '2026-02-01T00:00:00.000Z',
        },
        {
          id: 'v1',
          versionNumber: 1,
          status: 'ACTIVE',
          hasQualityActivities: false,
          effectiveFrom: '2026-01-02T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    const versions: Record<string, ProcessFlowVersion> = {
      v1: {
        id: 'v1',
        processFlowId: flow.id,
        processFlowCode: flow.code,
        processFlowName: flow.name,
        versionNumber: 1,
        status: 'ACTIVE',
        effectiveFrom: '2026-01-02T00:00:00.000Z',
        stages: [productionActivity('s1', 'Cutting')],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
      v2: {
        id: 'v2',
        processFlowId: flow.id,
        processFlowCode: flow.code,
        processFlowName: flow.name,
        versionNumber: 2,
        status: 'DRAFT',
        effectiveFrom: null,
        stages: [
          productionActivity('s2', 'Packing'),
          {
            id: 'q2',
            sequence: 2,
            name: 'Historical Inspection',
            code: 'OLD',
            status: 'ACTIVE',
            activityType: 'QUALITY',
            qualityFormVersionId: 'retired-form-v1',
            qualityFormVersion: {
              id: 'retired-form-v1',
              versionNumber: 1,
              status: 'RETIRED',
              qualityForm: {
                id: 'retired-form',
                code: 'OLD',
                name: 'Historical Inspection',
              },
            },
            qualityExecutionMode: 'SEQUENTIAL_GATE',
            associatedProductionActivityId: null,
            associatedProductionActivity: null,
            qualityAvailabilityPolicy: null,
            progressThresholdPercent: null,
            gateSatisfactionRequirement: 'FINALIZED',
            executionMultiplicity: 'SINGLE',
            coverageTarget: null,
          },
        ],
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      },
    };
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/process-flows/flow-1') return ok(config, { success: true, data: flow });
      const versionId = config.url?.split('/').at(-1);
      if (versionId && versions[versionId])
        return ok(config, { success: true, data: versions[versionId] });
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;

    act(() => {
      root.render(
        <Providers initialEntry="/master-data/process-flows/flow-1?version=v1">
          <Routes>
            <Route path="/master-data/process-flows/:id" element={<ProcessFlowDetailPage />} />
          </Routes>
        </Providers>,
      );
    });
    await flush();
    await flush();
    expect(container.textContent).toContain('Cutting');
    expect(container.textContent).not.toContain('Edit Draft');
    expect(container.textContent).not.toContain('Activate Version');

    click('Version 2');
    await flush();
    await flush();
    expect(container.textContent).toContain('Packing');
    expect(container.textContent).toContain('OLD — Historical Inspection — v1');
    expect(container.textContent).toContain('Edit Draft');
    click('Activate');
    expect(document.body.textContent).toContain('Final activities: 1. Packing (Production)');
    expect(document.body.textContent).toContain('Version 1 will be retired');
    expect(document.body.textContent).toContain('become immutable');
  });
});

describe('process-flow route access', () => {
  async function renderRoutes(roles: Role[]) {
    setStoredToken('valid-token');
    const user: AuthUser = {
      id: 'user-1',
      email: 'user@test.local',
      mobile: null,
      name: 'Test User',
      roles,
    };
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
      if (config.url === '/auth/me') return ok(config, { success: true, data: user });
      throw new Error(`Unexpected request: ${config.url}`);
    }) satisfies AxiosAdapter;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    act(() => {
      root.render(
        <MemoryRouter initialEntries={['/master-data/process-flows/new']}>
          <ThemeProvider theme="default" density="comfortable">
            <QueryClientProvider client={client}>
              <AuthProvider>
                <AppRoutes />
              </AuthProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </MemoryRouter>,
      );
    });
    await flush();
    await flush();
  }

  it('allows approved authoring roles to open the creation route', async () => {
    await renderRoutes(['ADMIN']);
    expect(container.textContent).toContain('Create Process Flow');
  });

  it('rejects factory users from the creation route', async () => {
    await renderRoutes(['FACTORY_USER']);
    expect(container.textContent).toContain('Access denied');
    expect(container.textContent).not.toContain('Create Draft');
  });
});
