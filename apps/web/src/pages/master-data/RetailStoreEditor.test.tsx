/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { RetailStoreEditor } from './RetailStoreEditor.js';

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
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
      >
        <RetailStoreEditor
          distributor={{ id: 'd1', name: 'Distributor One' }}
          onSaved={onSaved}
          onCancel={vi.fn()}
        />
      </QueryClientProvider>,
    ),
  );
  return onSaved;
}
describe('Retail Store contained editor', () => {
  it('keeps the Distributor fixed and submits complete address/contact fields', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { data: { id: 'new-store', code: 'S1', name: 'Store One' } } });
    const saved = await renderEditor();
    expect(input('Distributor').value).toBe('Distributor One');
    type('Store Code', 'S1');
    type('Store Name', 'Store One');
    type('Address Line 1', '12 Road');
    type('City', 'Chennai');
    type('State', 'TN');
    type('PIN', '600001');
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(post).toHaveBeenCalledWith(
      '/retail-stores',
      expect.objectContaining({
        distributorId: 'd1',
        code: 'S1',
        name: 'Store One',
        city: 'Chennai',
        postalCode: '600001',
        country: 'India',
      }),
    );
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-store' }));
  });
  it('preserves entered fields and displays server errors after failure', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Duplicate Store Code'));
    await renderEditor();
    type('Store Code', 'S1');
    type('Store Name', 'Store One');
    type('Address Line 1', '12 Road');
    type('City', 'Chennai');
    type('State', 'TN');
    type('PIN', '600001');
    await act(async () => {
      container
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(input('Store Code').value).toBe('S1');
    expect(container.textContent).toContain('Duplicate Store Code');
  });
});
