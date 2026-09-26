/** @vitest-environment jsdom */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import type { UserOption } from '@erve/types';
import { ThemeProvider } from '@erve/theme';
import { apiClient } from '../../lib/api-client.js';
import { UserLookupField, userLookupQueryKey } from './UserLookupField.js';

const PATH = '/distributors/dist-1/user-options';
const dana: UserOption = { id: 'u-1', name: 'Dana Candidate', email: 'dana@test.local' };
const eli: UserOption = { id: 'u-2', name: 'Eli Candidate', email: 'eli@kochi.example' };

let container: HTMLDivElement;
let root: Root;
let originalAdapter: typeof apiClient.defaults.adapter;
let requests: Array<{ url: string; params: unknown }>;
let respond: (params: { search?: string }) => UserOption[];
let queryClient: QueryClient;

function ok<T>(config: InternalAxiosRequestConfig, data: T): AxiosResponse<T> {
  return { data, status: 200, statusText: 'OK', headers: {}, config };
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  originalAdapter = apiClient.defaults.adapter;
  requests = [];
  respond = ({ search = '' }) =>
    [dana, eli].filter((user) =>
      [user.name, user.email].some((field) => field.toLowerCase().includes(search.toLowerCase())),
    );
  apiClient.defaults.adapter = vi.fn(async (config: InternalAxiosRequestConfig) => {
    requests.push({ url: config.url ?? '', params: config.params });
    return ok(config, { success: true, data: respond(config.params ?? {}) });
  }) satisfies AxiosAdapter;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  apiClient.defaults.adapter = originalAdapter;
  vi.unstubAllGlobals();
});

function Harness({ disabled }: { disabled?: boolean }) {
  const [value, setValue] = useState<UserOption | null>(null);
  return (
    <>
      <UserLookupField searchPath={PATH} value={value} onChange={setValue} disabled={disabled} />
      <button type="button" onClick={() => setValue(null)}>
        Assigned
      </button>
    </>
  );
}

function render(props: { disabled?: boolean } = {}) {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  act(() =>
    root.render(
      <ThemeProvider theme="default" density="comfortable">
        <QueryClientProvider client={queryClient}>
          <Harness {...props} />
        </QueryClientProvider>
      </ThemeProvider>,
    ),
  );
}

function input(): HTMLInputElement {
  return document.getElementById('lookup-assign-user') as HTMLInputElement;
}

function options(): HTMLElement[] {
  return Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
}

function panelText(): string {
  return document.body.querySelector('[data-lookup-panel]')?.textContent ?? '';
}

async function open() {
  await act(async () => {
    input().focus();
    input().click();
  });
}

async function type(text: string) {
  await act(async () => {
    input().focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function waitUntil(predicate: () => boolean, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

const fresh = (count: number) => () =>
  options().length === count && document.body.querySelector('[role="listbox"][aria-busy]') === null;

describe('UserLookupField (UL)', () => {
  it('requests nothing until opened, then the bounded initial candidates from its searchPath', async () => {
    render();
    await act(async () => input().focus());
    expect(requests).toHaveLength(0);

    await open();
    await waitUntil(fresh(2));

    expect(requests).toEqual([{ url: PATH, params: { search: '', limit: 20 } }]);
  });

  it('renders the name with the email as secondary text', async () => {
    render();
    await open();
    await waitUntil(fresh(2));

    const first = options()[0]!;
    const [name, email] = Array.from(first.querySelectorAll('span'));
    expect(name!.textContent).toBe('Dana Candidate');
    expect(email!.textContent).toBe('dana@test.local');
    expect(email!.className).toContain('text-muted-foreground');
  });

  it('searches as the user types and restores the initial candidates when cleared', async () => {
    render();
    await open();
    await waitUntil(fresh(2));

    await type('kochi');
    await waitUntil(fresh(1));
    expect(requests.at(-1)).toEqual({ url: PATH, params: { search: 'kochi', limit: 20 } });
    expect(options()[0]!.textContent).toContain('Eli Candidate');

    await type('');
    await waitUntil(fresh(2));
    expect(requests).toHaveLength(2);
  });

  it('selects a candidate, resets when the parent clears it, and refetches after invalidation', async () => {
    render();
    await open();
    await waitUntil(fresh(2));
    await act(async () => options()[0]!.click());
    expect(input().value).toBe('Dana Candidate (dana@test.local)');

    // What the page does after a successful Assign.
    respond = () => [eli];
    const assigned = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Assigned',
    )!;
    await act(async () => assigned.click());
    await act(async () => queryClient.invalidateQueries({ queryKey: userLookupQueryKey(PATH) }));
    expect(input().value).toBe('');

    await open();
    await waitUntil(fresh(1));
    expect(options()[0]!.textContent).toContain('Eli Candidate');
    expect(requests).toHaveLength(2);
  });

  it('distinguishes no eligible users from no matches', async () => {
    respond = () => [];
    render();
    await open();
    await waitUntil(() => panelText().includes('No eligible users available'));

    await type('zzz');
    await waitUntil(() => panelText().includes('No eligible users match your search'));
  });

  it('is inert when disabled', async () => {
    render({ disabled: true });
    expect(input().disabled).toBe(true);
    await open();
    expect(requests).toHaveLength(0);
  });
});
