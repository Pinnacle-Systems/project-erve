/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiClient } from '../../lib/api-client.js';
import { RetailStoreEditor } from './RetailStoreEditor.js';
import type { RetailStore } from '@erve/types';

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
async function renderEditor(onSaved = vi.fn(), store?: RetailStore) {
  act(() =>
    root.render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}
      >
        <RetailStoreEditor
          store={store}
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
  it('displays the existing Store Code read-only and omits it from updates', async () => {
    const store: RetailStore = {
      id: 's1', distributorId: 'd1', code: 'LEGACY-STORE', name: 'Store One',
      addressLine1: '12 Road', addressLine2: null, city: 'Chennai', state: 'TN',
      country: 'India', postalCode: '600001', gstin: null, contactName: null,
      contactEmail: null, contactPhone: null, status: 'ACTIVE', createdAt: '', updatedAt: '',
    };
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { data: store } });
    await renderEditor(vi.fn(), store);
    expect(input('Store Code').value).toBe('LEGACY-STORE');
    expect(input('Store Code').readOnly).toBe(true);
    type('City', 'Mumbai');
    await act(async () => {
      container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(patch).toHaveBeenCalledWith('/retail-stores/s1', expect.objectContaining({ city: 'Mumbai' }));
    expect(patch.mock.calls[0]![1]).not.toHaveProperty('code');
  });
  it('keeps the Distributor fixed and submits complete address/contact fields', async () => {
    const post = vi
      .spyOn(apiClient, 'post')
      .mockResolvedValue({ data: { data: { id: 'new-store', code: 'S1', name: 'Store One' } } });
    const saved = await renderEditor();
    expect(input('Distributor').value).toBe('Distributor One');

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
        name: 'Store One',
        city: 'Chennai',
        postalCode: '600001',
        country: 'India',
      }),
    );
    expect(post.mock.calls[0]![1]).not.toHaveProperty('code');
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-store' }));
  });
  it('preserves entered fields and displays server errors after failure', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(new Error('Duplicate Store Code'));
    await renderEditor();

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
    expect(input('Store Name').value).toBe('Store One');
    expect(container.textContent).toContain('Duplicate Store Code');
  });
});
