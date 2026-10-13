/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { FactoryEditor } from './FactoryEditor.js';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
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
async function renderEditor(onSaved = vi.fn()) {
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
        <FactoryEditor onSaved={onSaved} onCancel={vi.fn()} />
      </QueryClientProvider>,
    ),
  );
  return onSaved;
}
async function submit() {
  await act(async () => {
    container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe('Factory contained editor (DEMO-015)', () => {
  it('submits Name without an internal code, calling onSaved with the created Factory', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { data: { id: 'new-factory', name: 'Factory One', status: 'ACTIVE' } } });
    const saved = await renderEditor();

    type('Name', 'Factory One');
    await submit();
    expect(post).toHaveBeenCalledWith('/factories', expect.objectContaining({ name: 'Factory One' }));
    expect(post.mock.calls[0]![1]).not.toHaveProperty('code');
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-factory' }));
  });

  it('rejects submission with Name missing, without calling the API', async () => {
    const post = vi.spyOn(apiClient, 'post');
    await renderEditor();
    await submit();
    expect(post).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Name is required');
  });

  it('preserves entered fields and displays the server error after a rejected create', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Factory code already exists'));
    await renderEditor();

    type('Name', 'Factory One');
    await submit();
    expect(input('Name').value).toBe('Factory One');
    expect(container.textContent).toContain('Factory code already exists');
  });
});
