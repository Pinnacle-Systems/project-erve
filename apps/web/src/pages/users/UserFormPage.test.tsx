/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { UserFormPage } from './UserFormPage.js';
import type { AdminUserSummary } from '../master-data/types.js';

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

function makeUser(overrides: Partial<AdminUserSummary> = {}): AdminUserSummary {
  return {
    id: 'user-1',
    name: 'Jane Admin',
    email: 'jane@test.local',
    status: 'ACTIVE',
    roles: ['ADMIN'],
    distributors: [],
    factories: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    ...overrides,
  };
}

// needsFactory only becomes true in create mode after the FACTORY_USER role
// is selected, which these tests never do — /factories is stubbed defensively
// in case that assumption ever changes.
function mockUserGets(overrides: Record<string, () => Promise<unknown>> = {}) {
  vi.spyOn(apiClient, 'get').mockImplementation(async (url: string) => {
    if (url === '/factories') return { data: { data: [] } };
    const handler = overrides[url];
    if (handler) return handler();
    throw new Error(`Unexpected request: ${url}`);
  });
}

function renderUserPage(path: string, routePath: string) {
  act(() => {
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path={routePath} element={<UserFormPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}

describe('UserFormPage — UXAUTH-019 edit-load gating', () => {
  it('EDIT route: does not render a writable form while the record is still loading', async () => {
    mockUserGets({ '/users/user-1': () => new Promise(() => {}) });
    renderUserPage('/master-data/users/user-1/edit', '/master-data/users/:id/edit');

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.textContent).toContain('Loading user');
    expect(container.querySelectorAll('form').length).toBe(0);
    expect(container.querySelector('input')).toBeNull();
  });

  it('EDIT route: shows an error state and no writable form when the record fetch fails', async () => {
    mockUserGets({
      '/users/user-1': () => Promise.reject(new Error('User not found')),
    });
    renderUserPage('/master-data/users/user-1/edit', '/master-data/users/:id/edit');

    await waitFor(
      () => !container.textContent?.includes('Loading user'),
      'timed out waiting for loading to clear',
    );

    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('input')).toBeNull();
    expect(container.textContent).toContain('Unable to load user');
    expect(container.textContent).toContain('User not found');
  });

  it('EDIT route: hydrates the form from the real server record on success', async () => {
    const user = makeUser({ name: 'Server Hydrated User', email: 'hydrated@test.local' });
    mockUserGets({
      '/users/user-1': () => Promise.resolve({ data: { data: user } }),
    });
    renderUserPage('/master-data/users/user-1/edit', '/master-data/users/:id/edit');

    await waitFor(
      () => !container.textContent?.includes('Loading user'),
      'timed out waiting for loading to clear',
    );

    expect(container.querySelector('form')).not.toBeNull();
    const nameInput = container.querySelector<HTMLInputElement>('#field-name');
    const emailInput = container.querySelector<HTMLInputElement>('#field-email');
    expect(nameInput?.value).toBe('Server Hydrated User');
    expect(emailInput?.value).toBe('hydrated@test.local');
  });

  it('CREATE route (no id): renders the normal blank/default form immediately, unaffected by the edit-load gating', async () => {
    mockUserGets();
    renderUserPage('/master-data/users/new', '/master-data/users/new');

    await act(async () => {
      await flushMicrotasks();
    });
    await act(async () => {
      await flushMicrotasks();
    });

    expect(container.textContent).not.toContain('Loading user');
    expect(container.textContent).not.toContain('Unable to load user');
    expect(container.querySelector('form')).not.toBeNull();
    const nameInput = container.querySelector<HTMLInputElement>('#field-name');
    expect(nameInput?.value).toBe('');
  });
});

describe('UserFormPage — U3B preserved create/edit authorization model', () => {
  it('EDIT: does not render Roles, Initial Password, or Factory sections', async () => {
    const user = makeUser({ roles: ['FACTORY_USER'] });
    mockUserGets({ '/users/user-1': () => Promise.resolve({ data: { data: user } }) });
    renderUserPage('/master-data/users/user-1/edit', '/master-data/users/:id/edit');

    await waitFor(
      () => !container.textContent?.includes('Loading user'),
      'timed out waiting for loading to clear',
    );

    const sectionTitles = Array.from(container.querySelectorAll('h4')).map((h) => h.textContent);
    expect(sectionTitles).toEqual(['Profile']);
    expect(container.textContent).not.toContain('Roles');
    expect(container.textContent).not.toContain('Initial Password');
  });

  it('EDIT: PATCH payload is limited to name and email only', async () => {
    const user = makeUser();
    let patchBody: unknown;
    mockUserGets({ '/users/user-1': () => Promise.resolve({ data: { data: user } }) });
    vi.spyOn(apiClient, 'patch').mockImplementation(async (_url: string, body: unknown) => {
      patchBody = body;
      return { data: { data: user } };
    });
    renderUserPage('/master-data/users/user-1/edit', '/master-data/users/:id/edit');

    await waitFor(
      () => !container.textContent?.includes('Loading user'),
      'timed out waiting for loading to clear',
    );

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(patchBody).toEqual({ name: 'Jane Admin', email: 'jane@test.local' });
  });

  it('CREATE: submits name, email, password, and roles on a successful create', async () => {
    const created = makeUser({ id: 'user-new', name: 'New User', email: 'new-user@test.local' });
    let postBody: unknown;
    mockUserGets();
    vi.spyOn(apiClient, 'post').mockImplementation(async (_url: string, body: unknown) => {
      postBody = body;
      return { data: { data: created } };
    });
    renderUserPage('/master-data/users/new', '/master-data/users/new');
    await act(async () => {
      await flushMicrotasks();
    });

    function setInputValue(input: HTMLInputElement, value: string): void {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    act(() => {
      setInputValue(container.querySelector('#field-name')!, 'New User');
      setInputValue(container.querySelector('#field-email')!, 'new-user@test.local');
      setInputValue(container.querySelector('#password-password')!, 'password123');
      setInputValue(container.querySelector('#password-confirm-password')!, 'password123');
    });
    const roleLabel = Array.from(container.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('MERCHANDISER'),
    ) as HTMLLabelElement;
    const roleCheckbox = roleLabel.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    await act(async () => {
      roleCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(postBody).toEqual({
      name: 'New User',
      email: 'new-user@test.local',
      password: 'password123',
      roles: ['MERCHANDISER'],
      factoryId: undefined,
    });
  });

  it('CREATE: selecting FACTORY_USER requires a factory before submit', async () => {
    mockUserGets({ '/factories': () => Promise.resolve({ data: { data: [] } }) });
    renderUserPage('/master-data/users/new', '/master-data/users/new');
    await act(async () => {
      await flushMicrotasks();
    });

    function setInputValue(input: HTMLInputElement, value: string): void {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }

    act(() => {
      setInputValue(container.querySelector('#field-name')!, 'Factory Person');
      setInputValue(container.querySelector('#field-email')!, 'factory-person@test.local');
      setInputValue(container.querySelector('#password-password')!, 'password123');
      setInputValue(container.querySelector('#password-confirm-password')!, 'password123');
    });
    const roleLabel = Array.from(container.querySelectorAll('label')).find((label) =>
      label.textContent?.includes('FACTORY_USER'),
    ) as HTMLLabelElement;
    const roleCheckbox = roleLabel.querySelector('button[role="checkbox"]') as HTMLButtonElement;
    await act(async () => {
      roleCheckbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(container.textContent).toContain('Factory');

    const form = container.querySelector('form') as HTMLFormElement;
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(container.textContent).toContain('Select a factory for the Factory User role');
  });
});
