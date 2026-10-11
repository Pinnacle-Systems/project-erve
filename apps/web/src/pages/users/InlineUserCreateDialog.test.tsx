/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { InlineUserCreateDialog } from './InlineUserCreateDialog.js';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function input(label: string) {
  const el = Array.from(container.querySelectorAll('label')).find(
    (e) => e.textContent?.replace(/\*$/, '').trim() === label,
  )!;
  return document.getElementById(el.htmlFor) as HTMLInputElement;
}
function type(label: string, value: string) {
  const el = input(label);
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
function checkbox(roleName: string): HTMLInputElement {
  const label = Array.from(container.querySelectorAll('label')).find((e) => e.textContent?.trim() === roleName)!;
  return label.querySelector('input[type="checkbox"]') as HTMLInputElement;
}
async function renderDialog(props: Partial<Parameters<typeof InlineUserCreateDialog>[0]> = {}) {
  const onCreated = props.onCreated ?? vi.fn();
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <InlineUserCreateDialog
          defaultRoles={props.defaultRoles ?? ['FACTORY_USER']}
          factoryId={props.factoryId ?? 'fac-1'}
          onCancel={props.onCancel ?? vi.fn()}
          onCreated={onCreated}
        />
      </QueryClientProvider>,
    ),
  );
  return onCreated;
}
async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('Inline User create dialog (DEMO-015)', () => {
  it('pre-checks the contextual role (editable) and embeds factoryId for FACTORY_USER at creation', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { data: { id: 'new-user', name: 'New User', email: 'new@test.local' } } });
    const onCreated = await renderDialog();
    expect(checkbox('FACTORY_USER').checked).toBe(true);
    type('Name', 'New User');
    type('Email', 'new@test.local');
    type('Password', 'password123');
    type('Confirm Password', 'password123');
    await submit();
    expect(post).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({ name: 'New User', email: 'new@test.local', roles: ['FACTORY_USER'], factoryId: 'fac-1' }),
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-user' }));
  });

  it('never grants a role beyond what is visibly checked — unchecking the default role excludes it', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { data: { id: 'new-user', name: 'New User', email: 'new@test.local' } } });
    await renderDialog({ defaultRoles: ['DISTRIBUTOR'], factoryId: undefined });
    expect(checkbox('DISTRIBUTOR').checked).toBe(true);
    expect(checkbox('ADMIN').checked).toBe(false);
    type('Name', 'New User');
    type('Email', 'new@test.local');
    type('Password', 'password123');
    type('Confirm Password', 'password123');
    await submit();
    expect(post).toHaveBeenCalledWith(
      '/users',
      expect.objectContaining({ roles: ['DISTRIBUTOR'], factoryId: undefined }),
    );
  });

  it('rejects submission with no roles checked, a short password, or mismatched passwords, without calling the API', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderDialog();
    type('Name', 'New User');
    type('Email', 'new@test.local');
    type('Password', 'short');
    type('Confirm Password', 'short');
    await submit();
    expect(post).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Password must be at least 8 characters');
  });

  it('preserves entered fields and displays the server error after a rejected create', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Email already in use'));
    await renderDialog();
    type('Name', 'New User');
    type('Email', 'dup@test.local');
    type('Password', 'password123');
    type('Confirm Password', 'password123');
    await submit();
    expect(input('Email').value).toBe('dup@test.local');
    expect(container.textContent).toContain('Email already in use');
  });
});
