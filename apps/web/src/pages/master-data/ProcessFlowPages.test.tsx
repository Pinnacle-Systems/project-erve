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
import { newDraftStage, ProcessStageEditor, type DraftStage } from './ProcessStageEditor.js';
import type { ProcessFlow, ProcessFlowVersion } from './types.js';

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

describe('process stage authoring', () => {
  it('adds, removes, renames, and reorders stages while showing contiguous sequence', () => {
    function Harness() {
      const [stages, setStages] = useState<DraftStage[]>([
        newDraftStage({ name: 'Cutting' }),
        newDraftStage({ name: 'Sewing' }),
      ]);
      return <ProcessStageEditor stages={stages} onChange={setStages} />;
    }
    act(() =>
      root.render(
        <ThemeProvider theme="default">
          <Harness />
        </ThemeProvider>,
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

    click('Add Stage');
    expect(container.querySelectorAll('ol li')).toHaveLength(3);
    setInput('Stage 3 name *', 'Packing');
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
});

describe('process-flow pages', () => {
  it('creates a process flow and submits the authored stage order', async () => {
    let submitted: Record<string, unknown> | undefined;
    apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
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
    setInput('Stage 1 name *', 'Cutting');
    click('Add Stage');
    setInput('Stage 2 name *', 'Sewing');
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
          effectiveFrom: null,
          createdAt: '2026-02-01T00:00:00.000Z',
        },
        {
          id: 'v1',
          versionNumber: 1,
          status: 'ACTIVE',
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
        stages: [{ id: 's1', sequence: 1, name: 'Cutting', code: null, status: 'ACTIVE' }],
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
        stages: [{ id: 's2', sequence: 1, name: 'Packing', code: null, status: 'ACTIVE' }],
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
    expect(container.textContent).toContain('Edit Draft');
    click('Activate');
    expect(document.body.textContent).toContain('Final stages: 1. Packing');
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
