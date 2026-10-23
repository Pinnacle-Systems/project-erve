/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthUser, Role } from '@erve/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import * as AuthContext from '../../auth/AuthContext.js';
import { HsnFormPage } from './HsnFormPage.js';
import type { GstRuleSetOption, Hsn } from './types.js';

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
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
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

function mockUser(role: Role) {
  const user: AuthUser = {
    id: 'user-1',
    email: 'test@test.local',
    mobile: null,
    name: 'Test User',
    roles: [role],
  };
  vi.spyOn(AuthContext, 'useAuth').mockReturnValue({
    user,
    token: 'valid-token',
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
    isInitializing: false,
  } as unknown as ReturnType<typeof AuthContext.useAuth>);
}

const ruleSetOptions: GstRuleSetOption[] = [
  { id: 'rs-1', code: 'GST-GARMENT-STD', name: 'Garment GST', status: 'ACTIVE' },
];

function hsn(): Hsn {
  return {
    id: 'hsn-1',
    code: '61091000',
    description: 'Boys / T-Shirt',
    status: 'ACTIVE',
    gstRuleSet: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

async function renderEditPage(role: Role, record = hsn(), options = ruleSetOptions) {
  mockUser(role);
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/hsns/hsn-1') return { data: { data: record } };
    if (url === '/hsns/gst-rule-set-options') return { data: { data: options } };
    throw new Error(`Unexpected request: ${url}`);
  });

  const client = mountPage();
  await waitFor(() => Boolean(container.querySelector('form')), 'timed out waiting for form');
  return client;
}

function mountPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  act(() => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/hsns/hsn-1/edit']}>
          <Routes>
            <Route
              path="/hsns/:id/edit"
              element={
                <>
                  <Link to="/hsns/hsn-2/edit">Switch HSN</Link>
                  <HsnFormPage />
                </>
              }
            />
            <Route path="/hsns/:id" element={<div>Saved HSN</div>} />
            <Route path="/hsns/new" element={<HsnFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
  return client;
}

function gstRuleSetSelectTrigger(): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>('#select-gst-rule-set');
}

describe('HsnFormPage — RBAC finalization: GST Rule Set assignment is finance-only', () => {
  it('enables the GST Rule Set field for ADMIN', async () => {
    await renderEditPage('ADMIN');
    const trigger = gstRuleSetSelectTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(false);
    expect(container.textContent).not.toContain('Only Admin or Accountant may assign');
  });

  it('enables the GST Rule Set field for ACCOUNTANT', async () => {
    await renderEditPage('ACCOUNTANT');
    const trigger = gstRuleSetSelectTrigger();
    expect(trigger!.disabled).toBe(false);
  });

  it('disables the GST Rule Set field for MERCHANDISER, who can still edit everything else', async () => {
    await renderEditPage('MERCHANDISER');
    const trigger = gstRuleSetSelectTrigger();
    expect(trigger).not.toBeNull();
    expect(trigger!.disabled).toBe(true);
    expect(container.textContent).toContain('Only Admin or Accountant may assign');

    // Identity fields remain fully editable.
    const codeInput = container.querySelector<HTMLInputElement>('#field-hsn-code');
    expect(codeInput).not.toBeNull();
    expect(codeInput!.disabled).toBe(false);
  });

  it('disables the GST Rule Set field for SENIOR_MANAGEMENT (view-only)', async () => {
    await renderEditPage('SENIOR_MANAGEMENT');
    const trigger = gstRuleSetSelectTrigger();
    expect(trigger!.disabled).toBe(true);
  });
});

function assigned(option = ruleSetOptions[0]!): Hsn {
  return { ...hsn(), gstRuleSet: option };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function inputDescription(value: string) {
  await act(async () => {
    const input = container.querySelector<HTMLInputElement>('#field-description')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit() {
  await act(async () =>
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}

async function selectRuleSet(label: string) {
  await act(async () => gstRuleSetSelectTrigger()!.click());
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
    (item) => item.textContent?.trim() === label,
  );
  expect(option, `option ${label}`).toBeDefined();
  await act(async () => option!.click());
}

describe('HsnFormPage — assigned-record edit safety', () => {
  it.each(['ACCOUNTANT', 'MERCHANDISER'] as const)(
    'hydrates an active assignment for %s and omits it from an unrelated update',
    async (role) => {
      await renderEditPage(role, assigned());
      expect(gstRuleSetSelectTrigger()!.textContent).toContain('Garment GST');
      const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: assigned() } });
      await inputDescription('Updated description');
      await submit();
      await waitFor(() => patch.mock.calls.length === 1, 'save request');
      expect(patch.mock.calls[0]).toEqual([
        '/hsns/hsn-1',
        { code: '61091000', description: 'Updated description', status: 'ACTIVE' },
      ]);
    },
  );

  it.each(['ACCOUNTANT', 'MERCHANDISER'] as const)(
    'keeps an inactive assignment visible for %s',
    async (role) => {
      await renderEditPage(role, assigned({ ...ruleSetOptions[0]!, status: 'INACTIVE' }), []);
      expect(gstRuleSetSelectTrigger()!.textContent).toContain('Garment GST');
      expect(gstRuleSetSelectTrigger()!.textContent).toContain('inactive');
    },
  );

  it.each(['record', 'options'] as const)(
    'preserves the assignment when %s loads first',
    async (first) => {
      mockUser('ACCOUNTANT');
      const record = deferred<{ data: { data: Hsn } }>();
      const options = deferred<{ data: { data: GstRuleSetOption[] } }>();
      vi.spyOn(apiClient, 'get').mockImplementation((url: string) =>
        url.includes('options') ? options.promise : record.promise,
      );
      mountPage();
      await act(async () => {
        if (first === 'record') record.resolve({ data: { data: assigned() } });
        else options.resolve({ data: { data: ruleSetOptions } });
      });
      await act(async () => {
        record.resolve({ data: { data: assigned() } });
        options.resolve({ data: { data: ruleSetOptions } });
      });
      await waitFor(() => Boolean(container.querySelector('form')), 'hydrated form');
      expect(gstRuleSetSelectTrigger()!.textContent).toContain('Garment GST');
    },
  );

  it('preserves unsaved description and explicit selection across record and option refetches', async () => {
    const second = {
      id: 'rs-2',
      code: 'GST-SECOND',
      name: 'Second GST',
      status: 'ACTIVE' as const,
    };
    const client = await renderEditPage('ACCOUNTANT', assigned(), [...ruleSetOptions, second]);
    await inputDescription('Unsaved description');
    await selectRuleSet('GST-SECOND — Second GST');
    await act(async () => {
      client.setQueryData(['hsn', 'hsn-1'], { ...assigned(), description: 'Server refetch' });
      client.setQueryData(['hsn-gst-rule-set-options'], [...ruleSetOptions]);
    });
    expect(container.querySelector<HTMLInputElement>('#field-description')!.value).toBe(
      'Unsaved description',
    );
    expect(gstRuleSetSelectTrigger()!.textContent).toContain('Second GST');
  });

  it('does not expose a previous record while switching to a delayed second record', async () => {
    await renderEditPage('ACCOUNTANT', assigned());
    const second = deferred<{ data: { data: Hsn } }>();
    vi.mocked(apiClient.get).mockImplementation((url: string) =>
      url === '/hsns/hsn-2' ? second.promise : Promise.resolve({ data: { data: ruleSetOptions } }),
    );
    await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click());
    expect(container.querySelector('form')).toBeNull();
    await act(async () =>
      second.resolve({
        data: { data: { ...hsn(), id: 'hsn-2', code: '62034200', description: 'Second HSN' } },
      }),
    );
    await waitFor(() => Boolean(container.querySelector('form')), 'second record');
    expect(container.querySelector<HTMLInputElement>('#field-hsn-code')!.value).toBe('62034200');
    expect(gstRuleSetSelectTrigger()!.textContent).toContain('Unassigned');
  });

  it.each(['change', 'clear'] as const)('submits an authorized explicit %s', async (action) => {
    const second = {
      id: 'rs-2',
      code: 'GST-SECOND',
      name: 'Second GST',
      status: 'ACTIVE' as const,
    };
    await renderEditPage('ACCOUNTANT', assigned(), [...ruleSetOptions, second]);
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: assigned() } });
    await selectRuleSet(action === 'clear' ? 'Unassigned' : 'GST-SECOND — Second GST');
    await submit();
    expect(patch.mock.calls[0]![1]).toMatchObject({
      gstRuleSetId: action === 'clear' ? null : 'rs-2',
    });
  });

  it('does not navigate back to a previous record when its pending save completes', async () => {
    await renderEditPage('ACCOUNTANT', assigned());
    const saved = deferred<{ data: { data: Hsn } }>();
    vi.spyOn(apiClient, 'patch').mockReturnValue(saved.promise);
    await inputDescription('First record save');
    await submit();
    vi.mocked(apiClient.get).mockImplementation(async (url: string) => {
      if (url === '/hsns/hsn-2')
        return { data: { data: { ...hsn(), id: 'hsn-2', code: '62034200' } } };
      if (url === '/hsns/hsn-1') return { data: { data: assigned() } };
      return { data: { data: ruleSetOptions } };
    });
    await act(async () => container.querySelector<HTMLAnchorElement>('a')!.click());
    await waitFor(
      () => container.querySelector<HTMLInputElement>('#field-hsn-code')?.value === '62034200',
      'second record',
    );
    await inputDescription('Second record draft');
    await act(async () => saved.resolve({ data: { data: assigned() } }));
    await act(async () => {
      await flushMicrotasks();
    });
    expect(container.querySelector<HTMLInputElement>('#field-hsn-code')!.value).toBe('62034200');
    expect(container.querySelector<HTMLInputElement>('#field-description')!.value).toBe(
      'Second record draft',
    );
    expect(container.textContent).not.toContain('Saved HSN');
  });

  it('omits an assignment changed back to its original value', async () => {
    await renderEditPage('ACCOUNTANT', assigned());
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: assigned() } });
    await selectRuleSet('Unassigned');
    await selectRuleSet('GST-GARMENT-STD — Garment GST');
    await submit();
    expect(patch.mock.calls[0]![1]).not.toHaveProperty('gstRuleSetId');
  });

  it('retains entered values and the explicit selection after a failed save and refetch', async () => {
    const client = await renderEditPage('ACCOUNTANT', assigned());
    vi.spyOn(apiClient, 'patch').mockRejectedValue(new Error('Save unavailable'));
    await inputDescription('Keep my edits');
    await selectRuleSet('Unassigned');
    await submit();
    await waitFor(() => Boolean(container.textContent?.includes('Save unavailable')), 'save error');
    await act(async () => {
      client.setQueryData(['hsn', 'hsn-1'], { ...assigned(), updatedAt: '2026-10-23T00:00:00Z' });
    });
    expect(container.querySelector<HTMLInputElement>('#field-description')!.value).toBe(
      'Keep my edits',
    );
    expect(gstRuleSetSelectTrigger()!.textContent).toContain('Unassigned');
  });

  it('allows unrelated edits after option loading fails without submitting an assignment', async () => {
    mockUser('ACCOUNTANT');
    vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
      if (url.includes('options')) throw new Error('Options unavailable');
      return { data: { data: assigned() } };
    });
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: assigned() } });
    mountPage();
    await waitFor(
      () => Boolean(container.textContent?.includes('Unable to load GST Rule Sets')),
      'option error',
    );
    expect(gstRuleSetSelectTrigger()!.textContent).toContain('Garment GST');
    expect(gstRuleSetSelectTrigger()!.disabled).toBe(true);
    await submit();
    expect(patch.mock.calls[0]![1]).not.toHaveProperty('gstRuleSetId');
  });

  it('does not offer other inactive rule sets for assignment', async () => {
    await renderEditPage('ACCOUNTANT', assigned(), [
      ...ruleSetOptions,
      { id: 'retired', code: 'RETIRED', name: 'Other inactive', status: 'INACTIVE' },
    ]);
    await act(async () => gstRuleSetSelectTrigger()!.click());
    expect(document.body.textContent).not.toContain('Other inactive');
  });

  it('keeps a draft mounted after a background record fetch fails', async () => {
    const client = await renderEditPage('ACCOUNTANT', assigned());
    await inputDescription('Keep draft on read error');
    vi.mocked(apiClient.get).mockRejectedValue(new Error('Read unavailable'));
    await act(async () => {
      await client.refetchQueries({ queryKey: ['hsn', 'hsn-1'] });
    });
    expect(container.querySelector<HTMLInputElement>('#field-description')!.value).toBe(
      'Keep draft on read error',
    );
    expect(gstRuleSetSelectTrigger()!.textContent).toContain('Garment GST');
  });

  it('omits a pending assignment if the user loses assignment authorization before saving', async () => {
    const client = await renderEditPage('ACCOUNTANT', assigned());
    await selectRuleSet('Unassigned');
    mockUser('MERCHANDISER');
    await act(async () => {
      client.setQueryData(['hsn', 'hsn-1'], {
        ...assigned(),
        description: 'Refetch after role change',
      });
    });
    await waitFor(() => gstRuleSetSelectTrigger()!.disabled, 'updated assignment permission');
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: assigned() } });
    await submit();
    expect(patch.mock.calls[0]![1]).not.toHaveProperty('gstRuleSetId');
  });
});
